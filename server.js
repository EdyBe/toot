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



// Configure multer storage
const storage = multer.memoryStorage();
const uploadMiddleware = multer({ storage: storage });


// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);


// Database related imports
const { uploadVideo, createUser, updateUser, readUser } = require('./db');

// Initialize Express application
const app = express();
const port = process.env.PORT || 4000;

// Middleware Configuration
app.use(cors({
    origin: 'https://toot-jc51.onrender.com', // Replace with your client's domain
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    optionsSuccessStatus: 204
}));



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




////


////

const cloudflareStreamId = process.env.CLOUDFLARE_STREAM_ID;

if (!cloudflareStreamId) {
    console.error('CLOUDFLARE_STREAM_ID is not defined');
    process.exit(1);
}







const cloudflareStreamToken = process.env.CLOUDFLARE_STREAM_TOKEN;

if (!cloudflareStreamId || !cloudflareStreamToken) {
    console.error('Cloudflare Stream API configuration is not defined');
    process.exit(1);
}

// ...existing code...




if (!cloudflareStreamId || !cloudflareStreamToken) {
    console.error('Cloudflare Stream API configuration is not defined');
    process.exit(1);
}

// Endpoint to get upload URL
app.post('/api/get-upload-url', async (req, res) => {
    try {
        const endpoint = `https://api.cloudflare.com/client/v4/accounts/${cloudflareStreamId}/stream?direct_user=true`;
        
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                Authorization: `bearer ${cloudflareStreamToken}`,
                "Tus-Resumable": "1.0.0",
                "Upload-Length": req.headers['upload-length'],
                "Upload-Metadata": req.headers['upload-metadata']
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to get upload URL: ${response.statusText}`);
        }

        const destination = response.headers.get('Location');
        
        res.set({
            'Access-Control-Expose-Headers': 'Location',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Origin': '*',
            'Location': destination
        }).send();
    } catch (error) {
        console.error('Error getting upload URL:', error);
        res.status(500).send('Error getting upload URL');
    }
});

// Existing upload endpoint
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
        const endpoint = `https://api.cloudflare.com/client/v4/accounts/${cloudflareStreamId}/stream?direct_user=true`;
        // Set default duration (4 hours) since we can't get duration from in-memory file
        let duration = 14400; // 4 hours in seconds
        // Only try to get duration if file is on disk
        if (req.file.path && fs.existsSync(req.file.path)) {
            const { execSync } = require('child_process');
            try {
                const ffprobeOutput = execSync(
                    `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${req.file.path}"`
                );
                duration = parseFloat(ffprobeOutput.toString().trim()) || duration;
            } catch (error) {
                console.error('Error getting video duration:', error);
            }
        }

        // Validate file properties
        if (!req.file || !req.file.buffer || !req.file.originalname || !req.file.mimetype) {
            throw new Error('Invalid file properties');
        }

        // Prepare TUS headers
        const tusHeaders = {
            'Authorization': `Bearer ${cloudflareStreamToken}`,
            'Tus-Resumable': '1.0.0',
            'Upload-Length': req.file.size.toString(),
            'Upload-Metadata': `filename ${Buffer.from(req.file.originalname).toString('base64')},filetype ${Buffer.from(req.file.mimetype).toString('base64')}`,
            'Content-Type': 'application/offset+octet-stream'
        };

        // Create upload URL
        const createUploadUrlResponse = await axios.post(
            endpoint,
            {
                creator: email,
                meta: {
                    name: req.file.originalname,
                    creator: email,
                    duration: duration,
                    classCode: classCode,
                    title: title,
                    subject: subject
                },
                requireSignedURLs: false,
                maxDurationSeconds: duration > 0 ? Math.ceil(duration) : 14400,
                watermark: {
                    uid: 'default_watermark',
                    size: 0.1,
                    position: 'bottom-right'
                }
            },
            {
                headers: tusHeaders,
                maxBodyLength: Infinity,
                maxContentLength: Infinity
            }
        );

        if (createUploadUrlResponse.status !== 200 && createUploadUrlResponse.status !== 201) {
            console.error('Failed to get upload URL from Cloudflare:', {
                status: createUploadUrlResponse.status,
                data: createUploadUrlResponse.data,
                headers: createUploadUrlResponse.headers
            });
            return res.status(400).send('Failed to get upload URL from Cloudflare.');
        }

        const uploadUrl = createUploadUrlResponse.headers['location'];
        
        // Set CORS headers
        res.set({
            'Access-Control-Expose-Headers': 'Location',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Origin': '*',
            'Location': uploadUrl
        });
        // Extract video ID from location header
        const location = createUploadUrlResponse.headers['location'];
        if (!location) {
            console.error('Failed to get location header from Cloudflare response:', createUploadUrlResponse.headers);
            return res.status(400).send('Failed to get upload location from Cloudflare.');
        }
        
        // Extract video ID from location URL
        const videoId = location.split('/').pop().split('?')[0];
        if (!videoId) {
            console.error('Failed to extract video ID from location:', location);
            return res.status(400).send('Failed to extract video ID from Cloudflare response.');
        }

        // Step 2: Convert Buffer to Stream (for tus)
        const stream = new PassThrough();
        stream.end(req.file.buffer);

        // Step 3: Upload Video Using tus
        const tusUpload = new tus.Upload(stream, {
            endpoint: uploadUrl,
            retryDelays: [0, 1000, 3000, 5000],
            headers: {
                'Authorization': `Bearer ${cloudflareStreamToken}`,
                'Tus-Resumable': '1.0.0',
                'Upload-Metadata': `filename ${Buffer.from(req.file.originalname).toString('base64')},filetype ${Buffer.from(req.file.mimetype).toString('base64')}`
            },
            metadata: {
                filename: req.file.originalname,
                filetype: req.file.mimetype,
            },
            uploadSize: req.file.size,
            chunkSize: 5 * 1024 * 1024, // 5MB chunks
            onError: function (error) {
                console.error('Error uploading video to Cloudflare Stream:', error);
                return res.status(500).send('Error uploading video.');
            },
            onProgress: function (bytesUploaded, bytesTotal) {
                console.log(`Upload progress: ${bytesUploaded}/${bytesTotal} bytes`);
            },
            onAfterResponse: function (req, res) {
                console.log('TUS Response:', res.getStatus(), res.getHeader('Upload-Offset'));
            },
            onSuccess: async function () {
                console.log('TUS upload completed successfully');
                try {
                    // Fetch video details from Cloudflare
                    const videoDetailsResponse = await axios.get(
                        `https://api.cloudflare.com/client/v4/accounts/${cloudflareStreamId}/stream/${videoId}`,
                        {
                            headers: {
                                Authorization: `Bearer ${cloudflareStreamToken}`
                            }
                        }
                    );

                    if (videoDetailsResponse.status !== 200) {
                        console.error('Failed to fetch video details from Cloudflare:', videoDetailsResponse.data);
                        return res.status(400).send('Failed to fetch video details from Cloudflare.');
                    }

                    const videoDetails = videoDetailsResponse.data.result;

                    // Get user's school name
                    const { data: userData, error: userError } = await supabase
                        .from('users')
                        .select('schoolName')
                        .eq('id', userId)
                        .single();

                    if (userError || !userData) {
                        console.error('Error fetching user school name:', userError);
                        return res.status(400).send('Error fetching user information');
                    }

                    const { data, error } = await supabase
                        .from('videos')
                        .insert([
                            {
                                video_id: videoId,
                                user_id: userId,
                                user_email: email,
                                class_code: classCode,
                                created_at: new Date(),
                                title: title,
                                subject: subject,
                                school_name: userData.schoolName,
                                hls_manifest_url: videoDetails.playback.hls,
                                dash_manifest_url: videoDetails.playback.dash,
                                firstName: userData.firstName
                            },
                        ]);

                    if (error) {
                        throw error;
                    }

                    return res.send({
                        message: 'File uploaded successfully to Cloudflare Stream and metadata stored in Supabase.',
                        videoId,
                        hlsManifestUrl: videoDetails.playback.hls,
                        dashManifestUrl: videoDetails.playback.dash
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
///

///




// Function to upload video to Cloudflare Stream using TUS
async function uploadVideoToCloudflare(videoPath, originalname) {
    return new Promise((resolve, reject) => {
        const file = fs.createReadStream(videoPath);
        const size = fs.statSync(videoPath).size;
        
const options = {
        endpoint: `${cloudflareStreamApi}`,

        

            headers: {
                'Authorization': `Bearer ${process.env.CLOUDFLARE_STREAM_TOKEN}`
            },
            metadata: {
                filename: originalname,
                filetype: 'video/mp4'
            },
            uploadSize: size,
            onError: (error) => {
                console.error('Error uploading to Cloudflare:', error);
                reject(error);
            },
            onSuccess: () => {
                console.log('Upload to Cloudflare successful');
                resolve(upload.url);
            }
        };

        const upload = new tus.Upload(file, options);
        upload.start();
    });
}



    





/////





// Sign-in endpoint
app.post('/sign-in', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Query Supabase to find user by email
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (error) {
            console.error('Error fetching user:', error);
            return res.status(500).json({
                message: 'Internal Server Error',
                error: error.message
            });
        }

        const user = data;

        if (user) {
            // Compare the provided password with the hashed password
            const match = await bcrypt.compare(password, user.password);
            if (match) {
                // Determine the redirect page based on account type
                let redirectPage = '';
                if (user.accountType === 'student') {
                    redirectPage = 'student-.html';
                } else if (user.accountType === 'teacher') {
                    redirectPage = 'teacher-.html';
                }

                // Authentication successful
                res.json({
                    user: { email: user.email, id: user.id },
                    redirectPage: redirectPage
                });
            } else {
                // Authentication failed
                res.status(401).json({
                    message: 'Invalid email or password'
                });
            }
        } else {
            // User not found
            res.status(401).json({
                message: 'Invalid email or password'
            });
        }
    } catch (error) {
        console.error('Error during sign-in:', error);
        res.status(500).json({
            message: 'Internal Server Error',
            error: error.message // Include the error message in the response for debugging
        });
    }
});

// Fetch class codes endpoint
app.get('/class-codes', async (req, res) => {
    try {
        const { email } = req.query;

        // Query Supabase to find class codes associated with the user's email
        const { data, error } = await supabase
            .from('users')
            .select('classCodesArray')
            .eq('email', email)
            .single();

        if (error) {
            console.error('Error fetching class codes:', error);
            return res.status(500).json({
                message: 'Internal Server Error',
                error: error.message
            });
        }

        const user = data;

        if (user && user.classCodesArray) {
            res.json({ classCodes: user.classCodesArray });
        } else {
            res.status(404).json({
                message: 'Class codes not found for the user'
            });
        }
    } catch (error) {
        console.error('Error fetching class codes:', error);
        res.status(500).json({
            message: 'Internal Server Error',
            error: error.message // Include the error message in the response for debugging
        });
    }
});

// TUS Server Configuration
const tusServer = new Server({
    path: '/files', // TUS endpoint
    datastore: new FileStore({
        directory: './uploads' // Directory to store uploads
    }),
    onError: (error, req, res) => {
        console.error('Error during TUS upload:', error);
        res.status(500).send('Internal Server Error');
    },
});

// Middleware to handle TUS uploads
app.use('/files', tusServer.handle.bind(tusServer));



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

        console.log('Fetching user info for:', email);
        const { user, videos } = await readUser(email);
        if (!user) {
            console.error('User not found in database:', email);
            return res.status(404).json({ message: 'User not found' });
        }

        console.log('Retrieved user:', user);
        
        // Capitalize first name for display
        const capitalizedFirstName = user.firstName.charAt(0).toUpperCase() + user.firstName.slice(1);
        
        const responseData = {
            firstName: capitalizedFirstName,
            classCodes: user.classCodesArray,
            schoolName: user.schoolName
        };
        
        console.log('Sending user info:', responseData);
        res.json(responseData);
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

// Endpoint to fetch videos for a user (GET)
app.get('/videos', async (req, res) => {
    try {
        const email = req.query.email;
        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        // Get user details to determine account type
        console.log('Fetching videos for:', email);
        
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('accountType, schoolName, classCodesArray')
            .eq('email', email)
            .single();

        if (userError || !user) {
            console.error('Error fetching user:', userError || 'User not found');
            throw userError || new Error('User not found');
        }

        console.log('Retrieved user data:', user);

        let query = supabase
            .from('videos')
            .select('*');

        if (user.accountType === 'teacher') {
            console.log('Filtering videos for teacher:', {
                schoolName: user.schoolName,
                classCodes: user.classCodesArray
            });
            query = query
                .eq('school_name', user.schoolName)
                .in('class_code', user.classCodesArray);
        } else {
            console.log('Filtering videos for student by email:', email);
            query = query.eq('user_email', email);
        }

        const { data: videos, error } = await query;

        if (error) {
            console.error('Error fetching videos:', error);
            throw error;
        }

        console.log('Retrieved videos:', videos);

        // Format videos for frontend
        const formattedVideos = videos.map(video => ({
            _id: video.video_id,
            metadata: {
                title: video.title,
                subject: video.subject,
                classCode: video.class_code,
                createdAt: video.created_at,
                hlsUrl: video.hls_manifest_url,
                dashUrl: video.dash_manifest_url,
                name: video.firstName
            }
        }));

        console.log('Sending formatted videos:', formattedVideos);
        res.json(formattedVideos);
    } catch (error) {
        console.error('Error fetching videos:', error);
        res.status(500).json({ message: 'Failed to fetch videos' });
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
    console.log(`Server is running on port ${port}`);
});
