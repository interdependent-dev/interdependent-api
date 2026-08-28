import { supabase } from './supabaseClient.js';

// One script's chat, oldest-first, with each message's author, endorsement count,
// and whether the viewer endorsed it.
export async function getScriptMessages(scriptId, viewerId) {
  const { data: msgs, error } = await supabase
    .from('script_messages')
    .select('id, reader_id, parent_id, body, created_at, readers(handle, display_name)')
    .eq('script_id', scriptId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`DB getScriptMessages: ${error.message}`);

  const ids = (msgs || []).map((m) => m.id);
  const endBy = {};
  if (ids.length) {
    const { data: ends } = await supabase
      .from('message_endorsements')
      .select('message_id, endorser_id')
      .in('message_id', ids);
    (ends || []).forEach((e) => {
      const x = endBy[e.message_id] || (endBy[e.message_id] = { count: 0, mine: false });
      x.count += 1;
      if (viewerId && e.endorser_id === viewerId) x.mine = true;
    });
  }
  return (msgs || []).map((m) => ({
    id: m.id,
    parentId: m.parent_id,
    body: m.body,
    createdAt: m.created_at,
    reader: m.readers?.display_name || m.readers?.handle || 'A reader',
    handle: m.readers?.handle || null,
    endorsements: endBy[m.id]?.count || 0,
    endorsedByMe: endBy[m.id]?.mine || false,
    mine: viewerId ? m.reader_id === viewerId : false,
  }));
}

export async function insertMessage({ scriptId, readerId, parentId, body }) {
  const { data, error } = await supabase
    .from('script_messages')
    .insert({
      script_id: scriptId,
      reader_id: readerId,
      parent_id: parentId || null,
      body: String(body).slice(0, 4000),
    })
    .select('id, created_at')
    .single();
  if (error) throw new Error(`DB insertMessage: ${error.message}`);
  return data;
}

// Message's script + author — for the "endorser must be a champion, not the author" gate.
export async function getMessageMeta(messageId) {
  const { data, error } = await supabase
    .from('script_messages')
    .select('id, script_id, reader_id')
    .eq('id', messageId)
    .maybeSingle();
  if (error) throw new Error(`DB getMessageMeta: ${error.message}`);
  return data;
}

// Idempotent on UNIQUE(message_id, endorser_id) — a reader endorses a message once.
export async function endorseMessage({ messageId, endorserId }) {
  const { error } = await supabase
    .from('message_endorsements')
    .upsert(
      { message_id: messageId, endorser_id: endorserId },
      { onConflict: 'message_id,endorser_id', ignoreDuplicates: true },
    );
  if (error) throw new Error(`DB endorseMessage: ${error.message}`);
  return { ok: true };
}

// All chat signals for XP aggregation. FAILS OPEN: if the chat tables aren't
// migrated yet, returns empty sets so XP is simply zero (never errors the bar).
export async function getChatSignals() {
  const [m, e] = await Promise.all([
    supabase.from('script_messages').select('id, reader_id, parent_id, script_id'),
    supabase.from('message_endorsements').select('message_id, endorser_id'),
  ]);
  return {
    messages: m.error ? [] : m.data || [],
    endorsements: e.error ? [] : e.data || [],
  };
}
