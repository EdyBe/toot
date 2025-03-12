// Server Configuration and Initialization
require('dotenv').config(); // Load environment variables from .env file
const express = require('express'); // Express framework for handling HTTP requests
const cors = require('cors'); // CORS middleware for cross-origin requests
const { 
    sendPasswordResetEmail, 
    generateResetToken, 
    storeResetToken, 
    validateResetToken, 
    deleteResetToken 
} = require('./emailService'); // Email service functions for password reset
const multer = require('multer'); // Middleware for handling file uploads
const { Server } = require('@tus/server'); // Import TUS server
const { FileStore } = require('@tus/file-store'); // Import FileStore for TUS
const fs = require('fs');
const axios = require('axios'); // Import Axios for making HTTP requests
const { createClient } = require('@supabase/supabase-js'); // Import Supabase client
const path = require('path'); // Path module for file path operations
const bodyParser = require('body-parser');
const tus = require('tus-js-client');
const { PassThrough } = require('stream'); // Import stream module

// Initialize Express application
const app = express();
const port = process.env.PORT || 4000;

// Middleware Configuration
app.use(express.json()); // Parse JSON request bodies
app.use(cors({
    origin: 'https://toot-jc51.onrender.com', // Replace with your client's domain
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    optionsSuccessStatus: 204
})); // Enable CORS for all routes

// Configure multer storage
const storage = multer.memoryStorage();
const uploadMiddleware = multer({ storage: storage });

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Security and database modules
const bcrypt = require('bcrypt'); // For password hashing

// Application Configuration
const validSchoolNames = ["Burnside", "STAC", "School C", "Christ The King", "Test School"]; // List of valid school names
const validLicenseKeys = ["BurnsideHighSchool", "MP003", "3399", "STUDENT_KEY_1", "TEACHER_KEY_2"]; // Valid license keys

// Cloudflare Stream API configuration
const cloudflareStreamApi = process.env.CLOUDFLARE_STREAM_API;
if (!cloudflareStreamApi) {
    console.error('CLOUDFLARE_STREAM_API is not defined');
    process.exit(1);
}

// Upload endpoint
app.post('/upload', uploadMiddleware.single('video'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const { email, classCode, title, subject } = req.body;

    try {
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (userError || !userData) {
            console.error('User not found:', email);
            return res.status(404).send('User not found');
        }

        const userId = userData.id;

        // Step 1: Request Direct Upload URL from Cloudflare
        const createUploadUrlResponse = await axios.post(
            `${cloudflareStreamApi}/direct_upload`,
            {},
            {
                headers: {
                    Authorization: `Bearer ${process.env.CLOUDFLARE_STREAM_TOKEN}`,
                },
            }
        );

        const uploadUrl = createUploadUrlResponse.data.result.uploadURL;
        const videoId = createUploadUrlResponse.data.result.uid;

        // Step 2: Convert Buffer to Stream (for tus)
        const stream = new PassThrough();
        stream.end(req.file.buffer);

        // Step 3: Upload Video Using tus
        const tusUpload = new tus.Upload(stream, {
            endpoint: uploadUrl, // Set the correct upload URL
            metadata: {
                filename: req.file.originalname,
                filetype: req.file.mimetype,
            },
            uploadSize: req.file.size,
            onError: function (error) {
                console.error('Error uploading video to Cloudflare Stream:', error);
                return res.status(500).send('Error uploading video.');
            },
            onSuccess: async function () {
                try {
                    const { data, error } = await supabase
                        .from('videos')
                        .insert([
                            {
                                video_id: videoId,
                                user_id: userId,
                                class_code: classCode,
                                created_at: new Date(),
                                title: title,
                                subject: subject,
                            },
                        ]);

                    if (error) {
                        throw error;
                    }

                    return res.send({
                        message: 'File uploaded successfully to Cloudflare Stream and metadata stored in Supabase.',
                        videoId,
                    });
                } catch (error) {
                    console.error('Error storing metadata in Supabase:', error);
                    return res.status(500).send('Error storing metadata.');
                }
            },
        });

        tusUpload.start();
    } catch (error) {
        console.error('Error uploading video:', error.message);
        return res.status(500).send(`Error uploading video: ${error.message}`);
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

// Serve static files from the current directory
app.use(express.static(__dirname));

// Set up a route for the root URL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'sign-in.html')); // Adjust the path if your index.html is in a different directory
});

// Listen on the specified port
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
