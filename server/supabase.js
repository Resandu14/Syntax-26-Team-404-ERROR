import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && serviceRoleKey);

export const supabaseAdmin = isSupabaseConfigured
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

export const publicSupabaseConfig = {
  configured: isSupabaseConfigured && Boolean(process.env.SUPABASE_ANON_KEY),
  url: process.env.SUPABASE_URL || '',
  anonKey: process.env.SUPABASE_ANON_KEY || '',
};

export async function getUserFromToken(token) {
  if (!supabaseAdmin || !token) return { user: null, error: new Error('Missing authentication token.') };

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  return { user: data?.user ?? null, error };
}
