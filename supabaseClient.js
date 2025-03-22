
// Load Supabase SDK from CDN
const { createClient } = supabase;

// Initialize Supabase client
const SUPABASE_URL = "process.env.SUPABASE_URL";
const SUPABASE_KEY = "process.env.SUPABASE_KEY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export { supabase };  // Optional: Export if using ES modules
