import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

// The ONE shared Supabase client (service-role key — server-side only, bypasses
// RLS). Every service imports this singleton instead of constructing its own
// identical client, so connection/auth config is defined in exactly one place.
export const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false },
});
