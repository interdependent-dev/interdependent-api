import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

// ─── Readers ────────────────────────────────────────────────────────────────

export async function getReaderByHandle(handle) {
  const { data, error } = await supabase
    .from('readers')
    .select('id, handle, display_name, created_at')
    .eq('handle', handle)
    .maybeSingle();
  if (error) throw new Error(`DB getReaderByHandle: ${error.message}`);
  return data;
}

export async function getReaderById(id) {
  const { data, error } = await supabase
    .from('readers')
    .select('id, handle, display_name, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`DB getReaderById: ${error.message}`);
  return data;
}

export async function createReader({ id, handle, displayName }) {
  const { data, error } = await supabase
    .from('readers')
    .insert({ id, handle, display_name: displayName })
    .select('id, handle, display_name, created_at')
    .single();
  if (error) throw new Error(`DB createReader: ${error.message}`);
  return data;
}

// ─── Credentials ────────────────────────────────────────────────────────────

export async function getCredentialsByReaderId(readerId) {
  const { data, error } = await supabase
    .from('reader_credentials')
    .select('id, credential_id, public_key, counter, device_type, backed_up, transports')
    .eq('reader_id', readerId);
  if (error) throw new Error(`DB getCredentialsByReaderId: ${error.message}`);
  return data ?? [];
}

export async function getCredentialById(credentialId) {
  const { data, error } = await supabase
    .from('reader_credentials')
    .select('id, reader_id, credential_id, public_key, counter, device_type, backed_up, transports')
    .eq('credential_id', credentialId)
    .maybeSingle();
  if (error) throw new Error(`DB getCredentialById: ${error.message}`);
  return data;
}

export async function createCredential({ readerId, credentialId, publicKey, counter, deviceType, backedUp, transports }) {
  const { error } = await supabase.from('reader_credentials').insert({
    reader_id: readerId,
    credential_id: credentialId,
    public_key: publicKey,
    counter,
    device_type: deviceType,
    backed_up: backedUp,
    transports,
  });
  if (error) throw new Error(`DB createCredential: ${error.message}`);
}

export async function updateCredentialCounter({ id, counter }) {
  const { error } = await supabase
    .from('reader_credentials')
    .update({ counter, last_used_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`DB updateCredentialCounter: ${error.message}`);
}

// ─── Challenges ─────────────────────────────────────────────────────────────

export async function storeChallenge({ challenge, readerId = null, metadata = null }) {
  const { data, error } = await supabase
    .from('passkey_challenges')
    .insert({ challenge, reader_id: readerId, metadata })
    .select('id')
    .single();
  if (error) throw new Error(`DB storeChallenge: ${error.message}`);
  return data.id;
}

export async function consumeChallenge(challengeId) {
  const { data, error } = await supabase
    .from('passkey_challenges')
    .select('id, challenge, reader_id, metadata, expires_at')
    .eq('id', challengeId)
    .maybeSingle();
  if (error) throw new Error(`DB consumeChallenge: ${error.message}`);
  if (!data) return null;

  // Delete immediately — one-shot use
  await supabase.from('passkey_challenges').delete().eq('id', challengeId);

  if (new Date(data.expires_at) < new Date()) return null;
  return data;
}

// Periodic cleanup (call from a cron or startup) — removes expired rows
export async function purgeExpiredChallenges() {
  await supabase.from('passkey_challenges').delete().lt('expires_at', new Date().toISOString());
}
