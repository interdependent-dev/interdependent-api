// ─────────────────────────────────────────────────────────────────────────────
// Assigned reads — staff assign a script to a reader; the reader "decides" it by
// submitting feedback. All shaping/partitioning logic is pure (lib/assignments.js);
// this file is only the DB access.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from './supabaseClient.js';
import {
  partitionAssignments,
  earliestFeedbackByScript,
  isDuplicateError,
} from '../lib/assignments.js';

// Create an assignment. Throws with `.duplicate = true` on the UNIQUE
// (reader_id, script_id) violation so the route can answer 409.
export async function createAssignment({ readerId, scriptId, assignedBy, note = null }) {
  const { data, error } = await supabase
    .from('reader_assignments')
    .insert({ reader_id: readerId, script_id: scriptId, assigned_by: assignedBy, note })
    .select('id, reader_id, script_id, assigned_by, note, created_at, decided_at')
    .single();
  if (error) {
    const err = new Error(`DB createAssignment: ${error.message}`);
    err.duplicate = isDuplicateError(error.message);
    throw err;
  }
  return data;
}

// Every assignment, newest first, with reader handle/name + script title (staff view).
export async function listAssignments() {
  const { data, error } = await supabase
    .from('reader_assignments')
    .select(
      'id, reader_id, script_id, assigned_by, note, created_at, decided_at, readers(handle, display_name), scripts(title)',
    )
    .order('created_at', { ascending: false });
  if (error) throw new Error(`DB listAssignments: ${error.message}`);
  return data || [];
}

// Delete by id. Returns true if a row was removed.
export async function deleteAssignment(id) {
  const { data, error } = await supabase
    .from('reader_assignments')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw new Error(`DB deleteAssignment: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

// One reader's assignments split into { pending, decided }, with the self-heal:
// an undecided assignment whose script this reader already left feedback on is
// reported decided (at the feedback timestamp) and the stamp is backfilled
// best-effort — the response reflects the healed state even if the write fails.
export async function getReaderAssignments(readerId) {
  const [asg, fb] = await Promise.all([
    supabase
      .from('reader_assignments')
      .select('id, script_id, assigned_by, note, created_at, decided_at, scripts(title)')
      .eq('reader_id', readerId)
      .order('created_at', { ascending: false }),
    supabase.from('reader_feedback').select('script_id, created_at').eq('reader_id', readerId),
  ]);
  if (asg.error) throw new Error(`DB getReaderAssignments: ${asg.error.message}`);
  // Feedback lookup failing is non-fatal: no heal this time, state still correct.
  const feedbackAt = earliestFeedbackByScript(fb.error ? [] : fb.data);
  const { pending, decided, heal } = partitionAssignments(asg.data || [], feedbackAt);
  if (heal.length) {
    try {
      await Promise.all(
        heal.map((h) =>
          supabase
            .from('reader_assignments')
            .update({ decided_at: h.decidedAt })
            .eq('id', h.id)
            .is('decided_at', null),
        ),
      );
    } catch {
      /* best-effort — next read heals again */
    }
  }
  return { pending, decided };
}

// Feedback auto-complete: stamp decided_at on any still-pending assignment for
// this (reader, script). Callers treat failure as non-fatal.
export async function markAssignmentDecided({ readerId, scriptId }) {
  const { error } = await supabase
    .from('reader_assignments')
    .update({ decided_at: new Date().toISOString() })
    .eq('reader_id', readerId)
    .eq('script_id', scriptId)
    .is('decided_at', null);
  if (error) throw new Error(`DB markAssignmentDecided: ${error.message}`);
}
