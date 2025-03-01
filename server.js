// Server Configuration and Initialization
require('dotenv').config(); // Load environment variables from .env file
const express = require('express'); // Express framework for handling HTTP requests
const { 
    sendPasswordResetEmail, 
    generateResetToken, 
    storeResetToken, 
    validateResetToken, 
    deleteResetToken 
} = require('./emailService'); // Email service functions for password reset
const multer = require('multer'); // Middleware for handling file uploads
const { Server } = require('@tus/server'); // Import TUS server
const { CloudflareStream } = require('@fixers/cloudflare-stream'); // Import Cloudflare Stream
const { createClient } = require('@supabase/supabase-js'); // Import Supabase client
const path = require('path'); // Path module for file path operations

// Database related imports
const { uploadVideo, createUser, updateUser, readUser } = require('./db');
const cors = require('cors'); // CORS middleware for cross-origin requests

// Initialize Express application
const app = express();
const port = 3000; // Server port

// Security and database modules
const bcrypt = require('bcrypt'); // For password hashing

// Application Configuration
const validSchoolNames = ["Burnside", "STAC", "School C", "Christ The King", "Test School"]; // List of valid school names
const validLicenseKeys = ["BurnsideHighSchool", "MP003", "3399", "STUDENT_KEY_1", "TEACHER_KEY_2"]; // Valid license keys

// Middleware Configuration
app.use(express.json()); // Parse JSON request bodies
app.use(cors()); // Enable CORS for all routes

// File Upload Configuration
const upload = multer({
    storage: multer.memoryStorage(), // Store files in memory
    limits: {
        fileSize: 5 * 1024 * 1024 * 1024, // 5GB file size limit
        fieldSize: 5 * 1024 * 1024 * 1024 // 5GB field size limit
    },
    fileFilter: (req, file, cb) => {
        // Validate file type - only allow video files
        if (file.mimetype.startsWith('video/')) {
            cb(null, true);
        } else {
            cb(new Error('Only video files are allowed'), false);
        }
    }
});

// Initialize Cloudflare Stream
const cloudflareStream = new CloudflareStream({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID, // Cloudflare Account ID from environment variables
    apiToken: process.env.CLOUDFLARE_API_KEY // Cloudflare API Key from environment variables
});

// TUS Server Configuration
const tusServer = new Server({
    path: '/files', // TUS endpoint
    onError: (error, req, res) => {
        console.error('Error during TUS upload:', error);
        res.status(500).send('Internal Server Error');
    },
});

// Middleware to handle TUS uploads
app.use('/files', tusServer.handle.bind(tusServer));

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);


/**
 * Retrieves user information including first name, class codes, and school name
 * @param {string} email - User's email address (query parameter)
 * @returns {Object} JSON response with user information
 */
app.get('/user-info', async (req, res) => {
    try {
        const email = req.query.email;
        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        const { user, videos } = await readUser(email);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Capitalize first name for display
        const capitalizedFirstName = user.firstName.charAt(0).toUpperCase() + user.firstName.slice(1);
        
        res.json({
            firstName: capitalizedFirstName,
            classCodes: user.classCodesArray,
            schoolName: user.schoolName
        });
    } catch (error) {
        console.error('Error fetching user info:', error);
        res.status(500).json({ message: 'Failed to fetch user info' });
    }
});

/**
 * Handles video uploads to Cloudflare Stream
 * @param {Object} req.file - Uploaded video file
 * @param {Object} req.body - Video metadata
 * @returns {Object} JSON response with upload status
 */
app.post('/upload', upload.single('video'), async (req, res) => {
    console.log('Upload request received');
    console.log('Request body:', req.body);
    console.log('Uploaded file:', req.file);

    if (!req.file) {
        console.log('No file uploaded');
        return res.status(400).json({ message: 'No video file uploaded' });
    }

    try {
        console.log('Looking up user:', req.body.email);
        const user = await readUser(req.body.email);
        if (!user) {
            console.log('User not found');
            return res.status(404).json({ message: 'User not found' });
        }

        // Prepare video data for storage
        const videoData = {
            title: req.body.title,
            subject: req.body.subject,
            userId: user.id,
            userEmail: user.email,
            classCode: req.body.classCode,
            accountType: user.accountType,
            schoolName: user.schoolName,
            buffer: req.file.buffer,
            filename: `${Date.now()}_${req.file.originalname}`,
            mimetype: req.file.mimetype,
            studentName: user.firstName
        };

        console.log('Video data:', videoData);

        // Upload video to Cloudflare Stream
        await uploadVideo(videoData);

        // Redirect back to upload page after successful upload
        res.redirect('/upload-.html');
    } catch (error) {
        console.error('Video upload error:', error);
        res.status(500).json({ 
            message: 'Failed to upload video',
            error: error.message 
        });
    }
});

// Serve static files from the current directory
app.use(express.static(__dirname));

// Set up a route for the root URL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'sign-in.html')); // Adjust the path if your index.html is in a different directory
});

/**
 * Handles user registration with validation and account creation
 * @param {Object} req.body - Registration data including license key, school name, etc.
 * @returns {Object} JSON response with registration status
 */
app.post('/register', async (req, res) => {
    console.log("Registration request received:", req.body);
    const { licenseKey, schoolName, firstName, email, password, classCodes, accountType } = req.body;

    if (validLicenseKeys.includes(licenseKey)) {
        // Validate school name
        if (!validSchoolNames.includes(schoolName)) {
            return res.status(400).json({ message: "Invalid school name." });
        }
        
        // Process class codes
        const classCodesArray = classCodes.split(',').map(code => code.trim());
        
        // Hash password for secure storage
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create new user object
        const newUser = {
            firstName,
            email,
            password: hashedPassword,
            classCodesArray,
            licenseKey,
            accountType,
            schoolName
        };

        // Create user in database
        try {
            await createUser(newUser);
            res.status(200).json({ message: "Registration successful!", email });
        } catch (error) {
            console.error("Error during user registration:", error.message);
            res.status(400).json({ message: error.message });
        }
    } else {
        res.status(400).json({ message: "Invalid license key" });
    }
});

// Password Reset Request Endpoint
app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;

    try {
        const user = await readUser(email);
        
        // For security, don't reveal if email exists or not
        if (!user) {
            return res.status(200).send('If your email exists in our system, you will receive a password reset link.');
        }

        // Generate and store reset token
        const token = generateResetToken();
        storeResetToken(email, token);

        // Log the reset link (for development/testing)
        console.log('Password reset link:', `http://localhost:3000/reset-password.html?token=${token}`);

        // In production, this would send an actual email
        await sendPasswordResetEmail(email, token);

        res.status(200).send('If your email exists in our system, you will receive a password reset link.');
    } catch (error) {
        console.error('Error processing password reset request:', error);
        return res.status(500).send('An error occurred. Please try again later.');
    }
});

// Password Reset Endpoint
app.post('/api/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;

    try {
        // Validate the reset token
        const email = validateResetToken(token);
        if (!email) {
            return res.status(400).send('This password reset link has expired or is invalid. Please request a new one.');
        }

        // Hash the new password and update it in the database
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const result = await updateUser(email, { password: hashedPassword });

        if (result.modifiedCount === 0) {
            return res.status(400).send('Unable to update password. Please try again.');
        }

        // Delete the used token
        deleteResetToken(token);

        res.status(200).send('Your password has been reset successfully. You can now log in with your new password.');
    } catch (error) {
        console.error('Error resetting password:', error);
        return res.status(500).send('An error occurred while resetting your password. Please try again.');
    }
});

// Video Viewing Functionality
app.post('/videos/view', async (req, res) => {
    const videoId = req.body.id; // Get the video ID from the request body
    console.log('Mark as viewed request received for video ID:', videoId); // Log the video ID

    if (!videoId) {
        return res.status(400).json({ message: 'Video ID is required' });
    }

    try {
        const result = await updateUser(req.body.email, { videoId }, 'view');
        if (result.modifiedCount === 0) {
            return res.status(404).json({ message: 'Video not found or already viewed' });
        }

        console.log('Video marked as viewed successfully:', videoId);
        res.status(200).json({ message: 'Video marked as viewed successfully' });
    } catch (error) {
        console.error('Error marking video as viewed:', error);
        res.status(500).json({ message: 'Failed to mark video as viewed' });
    }
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
