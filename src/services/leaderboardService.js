import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

export async function getLeaderboardByReaderId(readerId) {
  const { data, error } = await supabase
    .from('reader_leaderboard')
    .select(`
      id,
      position,
      added_at,
      script_id,
      scripts (
        id,
        title,
        filename,
        page_count,
        word_count,
        status,
        submitted_at,
        evaluation_json
      )
    `)
    .eq('reader_id', readerId)
    .order('position', { ascending: true });
  if (error) throw new Error(`DB getLeaderboardByReaderId: ${error.message}`);
  return data ?? [];
}

export async function getLeaderboardEntry(readerId, scriptId) {
  const { data, error } = await supabase
    .from('reader_leaderboard')
    .select('id, position')
    .eq('reader_id', readerId)
    .eq('script_id', scriptId)
    .maybeSingle();
  if (error) throw new Error(`DB getLeaderboardEntry: ${error.message}`);
  return data;
}

export async function getMaxPosition(readerId) {
  const { data, error } = await supabase
    .from('reader_leaderboard')
    .select('position')
    .eq('reader_id', readerId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`DB getMaxPosition: ${error.message}`);
  return data?.position ?? 0;
}

export async function addToLeaderboard(readerId, scriptId) {
  const nextPos = (await getMaxPosition(readerId)) + 1;
  const { data, error } = await supabase
    .from('reader_leaderboard')
    .insert({ reader_id: readerId, script_id: scriptId, position: nextPos })
    .select('id, position, added_at')
    .single();
  if (error) throw new Error(`DB addToLeaderboard: ${error.message}`);
  return data;
}

export async function removeFromLeaderboard(readerId, scriptId) {
  const { data: entry, error: fetchErr } = await supabase
    .from('reader_leaderboard')
    .select('id, position')
    .eq('reader_id', readerId)
    .eq('script_id', scriptId)
    .maybeSingle();
  if (fetchErr) throw new Error(`DB removeFromLeaderboard fetch: ${fetchErr.message}`);
  if (!entry) return false;

  const { error: delErr } = await supabase
    .from('reader_leaderboard')
    .delete()
    .eq('id', entry.id);
  if (delErr) throw new Error(`DB removeFromLeaderboard delete: ${delErr.message}`);

  // Compact positions above the deleted one so there are no gaps
  const { data: above } = await supabase
    .from('reader_leaderboard')
    .select('id, position')
    .eq('reader_id', readerId)
    .gt('position', entry.position)
    .order('position', { ascending: true });

  if (above?.length) {
    await Promise.all(
      above.map((row) =>
        supabase.from('reader_leaderboard').update({ position: row.position - 1 }).eq('id', row.id),
      ),
    );
  }
  return true;
}

// Accepts a full ordered array of script UUIDs and renumbers them 1..N
export async function reorderLeaderboard(readerId, scriptIds) {
  // Verify all IDs belong to this reader before mutating
  const existing = await getLeaderboardByReaderId(readerId);
  const existingIds = new Set(existing.map((e) => e.script_id));
  for (const id of scriptIds) {
    if (!existingIds.has(id)) throw new Error(`Script ${id} is not on this leaderboard`);
  }
  if (scriptIds.length !== existing.length) {
    throw new Error('scriptIds must contain every script currently on the leaderboard');
  }

  await Promise.all(
    scriptIds.map((scriptId, idx) =>
      supabase
        .from('reader_leaderboard')
        .update({ position: idx + 1 })
        .eq('reader_id', readerId)
        .eq('script_id', scriptId),
    ),
  );
}
