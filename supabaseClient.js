import { createClient } from '@supabase/supabase-js'; // 
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize Supabase client with environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Export the supabase client for use in other files
export { supabase };


