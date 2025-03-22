import dotenv from 'dotenv';
dotenv.config();  // Loads environment variables from .env file

// Import Supabase SDK in a Node.js environment
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client with environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Export if you need to use it elsewhere
export { supabase };
