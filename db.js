const { createClient } = require('@supabase/supabase-js'); // Import Supabase client

// Supabase Configuration
const supabaseUrl = process.env.SUPABASE_URL; // Supabase URL from environment variables
const supabaseKey = process.env.SUPABASE_KEY; // Supabase Key from environment variables
const supabase = createClient(supabaseUrl, supabaseKey);

// License Key Management System
const licenseKeyLimits = {
    "BurnsideHighSchool": 4,
    "MP003": 8,
    "3399": 20,
    "STUDENT_KEY_1": 20,
    "TEACHER_KEY_2": 20,
};

// Valid License Keys by Account Type
const validLicenseKeys = {
    student: ["STUDENT_KEY_1", "STUDENT_KEY_2"],
    teacher: ["TEACHER_KEY_1", "TEACHER_KEY_2"]
};

/**
 * Creates a new user in Supabase
 * @param {Object} userData - User information including email, licenseKey, and accountType
 * @returns {Promise<Object>} Created user data
 * @throws {Error} If user creation fails
 */
async function createUser(userData) {
    // Check for existing user with the same email
    const { data: existingUser, error: emailCheckError } = await supabase
        .from('users')
        .select('*')
        .eq('email', userData.email)
        .single();

    if (emailCheckError && emailCheckError.code !== 'PGRST116') { // PGRST116 indicates no rows found
        throw new Error('Error checking email uniqueness: ' + emailCheckError.message);
    }

    if (existingUser) {
        throw new Error('Email already in use');
    }

    // Validate license key for account type
    if (!validLicenseKeys[userData.accountType].includes(userData.licenseKey)) {
        throw new Error('Invalid license key for the selected account type.');
    }

    const { data, error } = await supabase
        .from('users')
        .insert([userData]);

    if (error) {
        throw new Error('Failed to register user: ' + error.message);
    }

    return data[0];
}

/**
 * Retrieves user information and associated videos
 * @param {string} email - User's email address
 * @returns {Promise<Object>} Object containing user data and associated videos
 * @throws {Error} If user is not found
 */
async function readUser(email) {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .single();

    if (error) {
        throw new Error('User not found: ' + error.message);
    }

    let videosData;
    let videosError;

    if (data.accountType === 'student') {
        // Fetch videos associated with the student
        ({ data: videosData, error: videosError } = await supabase
            .from('videos')
            .select('*')
            .eq('user_id', data.id));
    } else if (data.accountType === 'teacher') {
        // Fetch videos associated with the teacher based on school name and class code
        ({ data: videosData, error: videosError } = await supabase
            .from('videos')
            .select('*')
            .eq('school_name', data.school_name) // Assuming school_name is part of user data
            .eq('class_code', data.class_code)); // Assuming class_code is part of user data
    }

    if (videosError) {
        throw new Error('Error fetching videos: ' + videosError.message);
    }

    const videos = videosData.map(video => ({
        videoUid: video.video_id, // Assuming video_id is the UID
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID // Use the account ID from environment variables
    }));

    return { user: data, videos };
}

/**
 * Updates user's class codes by adding or removing a code
 * @param {string} email - User's email address
 * @param {Object} options - Contains classCode to add/remove
 * @param {string} action - 'add' or 'delete' operation
 * @returns {Promise<Object>} Success message
 * @throws {Error} If user not found or operation fails
 */
async function updateUser(email, { classCode }, action) {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .single();

    if (error) {
        throw new Error('User not found: ' + error.message);
    }

    if (action === 'add') {
        // Add new class code to user's array
        const { error: updateError } = await supabase
            .from('users')
            .update({ classCodesArray: [...data.classCodesArray, classCode] })
            .eq('email', email);

        if (updateError) {
            throw new Error('No changes made while adding class code: ' + updateError.message);
        }
    } else if (action === 'delete') {
        // Verify class code exists before removal
        if (!data.classCodesArray.includes(classCode)) {
            throw new Error('Class code does not exist');
        }

        const { error: deleteError } = await supabase
            .from('users')
            .update({ classCodesArray: data.classCodesArray.filter(code => code !== classCode) })
            .eq('email', email);

        if (deleteError) {
            throw new Error('No changes made while deleting class code: ' + deleteError.message);
        }
    } else {
        throw new Error('Invalid action. Use "add" or "delete".');
    }

    return { message: `Class code ${action === 'add' ? 'added' : 'deleted'} successfully!` };
}

/**
 * Deletes a user and optionally their associated videos
 * @param {string} email - User's email address
 * @returns {Promise<Object>} Delete operation result
 * @throws {Error} If user is not found
 */
async function deleteUser(email) {
    const { data, error } = await supabase
        .from('users')
        .delete()
        .eq('email', email);

    if (error) {
        throw new Error('User not found: ' + error.message);
    }

    // Clean up associated videos
    await cloudflareStream.deleteVideos({ userEmail: email });

    return data;
}

/**
 * Uploads a video to Cloudflare Stream with associated metadata
 * @param {Object} videoData - Video information including buffer, metadata, and user details
 * @returns {Promise<Object>} Upload result containing file ID and metadata
 * @throws {Error} If upload fails
 */
async function uploadVideo(videoData) {
    try {
        const uploadResult = await cloudflareStream.upload(videoData.buffer, {
            metadata: {
                title: videoData.title,
                subject: videoData.subject,
                userId: videoData.userId,
                userEmail: videoData.userEmail,
                classCode: videoData.classCode,
                contentType: videoData.mimetype,
                schoolName: videoData.schoolName
            }
        });

        // Store video metadata in Supabase
        await storeVideoMetadata({
            videoId: uploadResult.id,
            schoolName: videoData.schoolName,
            classCode: videoData.classCode,
            title: videoData.title,
            subject: videoData.subject,
            userId: videoData.userId // Include user ID here
        });

        return uploadResult;
    } catch (error) {
        throw new Error('Failed to upload video: ' + error.message);
    }
}

// Function to store video metadata in Supabase
async function storeVideoMetadata(videoData) {
    const { data, error } = await supabase
        .from('videos')
        .insert([{
            video_id: videoData.videoId,
            school_name: videoData.schoolName,
            class_code: videoData.classCode,
            title: videoData.title,
            subject: videoData.subject,
            user_id: videoData.userId // Include user ID here
        }]);

    if (error) {
        throw new Error('Failed to store video metadata: ' + error.message);
    }

    return data[0];
}

// Function to retrieve videos for a teacher
async function getVideosForTeacher(schoolName, classCode) {
    const { data, error } = await supabase
        .from('videos')
        .select('*')
        .eq('school_name', schoolName)
        .eq('class_code', classCode);

    if (error) {
        throw new Error('Failed to retrieve videos: ' + error.message);
    }

    return data; // This will return an array of video metadata
}

module.exports = { createUser, readUser, updateUser, deleteUser, uploadVideo, storeVideoMetadata, getVideosForTeacher };
