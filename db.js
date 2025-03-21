import { createClient } from '@supabase/supabase-js';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
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
    try {
        console.log('Fetching user data for:', email);
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (error) {
            console.error('Error fetching user:', error);
            throw new Error('User not found: ' + error.message);
        }

        console.log('Retrieved user data:', data);

        let videosData = [];
        if (data.accountType === 'student') {
            console.log('Fetching student videos for user:', data.id);
            const { data: studentVideos, error: studentVideosError } = await supabase
                .from('videos')
                .select('*')
                .eq('user_id', data.id);

            if (studentVideosError) {
                console.error('Error fetching student videos:', studentVideosError);
                throw new Error('Error fetching student videos: ' + studentVideosError.message);
            }
            videosData = studentVideos;
        } else if (data.accountType === 'teacher') {
            console.log('Fetching teacher videos for:', {
                schoolName: data.school_name,
                classCodes: data.classCodesArray
            });
            const { data: teacherVideos, error: teacherVideosError } = await supabase
                .from('videos')
                .select('*')
                .eq('school_name', data.school_name)
                .in('class_code', data.classCodesArray);

            if (teacherVideosError) {
                console.error('Error fetching teacher videos:', teacherVideosError);
                throw new Error('Error fetching teacher videos: ' + teacherVideosError.message);
            }
            videosData = teacherVideos;
        }

        console.log('Retrieved videos:', videosData);

        const videos = videosData.map(video => ({
            videoUid: video.video_id,
            accountId: process.env.CLOUDFLARE_ACCOUNT_ID
        }));

        return { user: data, videos };
    } catch (error) {
        console.error('Error in readUser:', error);
        throw error;
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


// Export functions
 

export { createUser, readUser, updateUser, deleteUser, uploadVideo, storeVideoMetadata };
