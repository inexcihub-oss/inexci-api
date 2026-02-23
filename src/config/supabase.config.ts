import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';
// service_role bypassa RLS — usado apenas no backend para storage
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || supabaseKey;

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
  },
});

/** Cliente com service_role: usa para operações de storage no backend */
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET_NAME || 'documents';
