// ─────────────────────────────────────────────────────────────────────────────
// Pure assignment shaping — no DB, no env, no Express (unit-tested in
// test/assignments.test.js). The service (assignmentService.js) feeds raw
// Supabase rows through here; the routes return the shapes unchanged.
// ─────────────────────────────────────────────────────────────────────────────

// Shape one reader_assignments row (with the scripts(title) join) for the API.
export function shapeAssignment(row) {
  return {
    id: row.id,
    scriptId: row.script_id,
    title: row.scripts?.title ?? null,
    note: row.note ?? null,
    assignedBy: row.assigned_by,
    createdAt: row.created_at,
  };
}

// Split a reader's assignment rows into { pending, decided, heal }.
//
// SELF-HEAL: an assignment whose decided_at is null but whose script already has
// a reader_feedback row from this reader IS decided — the reader did the work,
// the stamp was just missed (e.g. feedback predates the assignment, or the
// auto-complete write failed). Such rows are reported as decided (using the
// feedback timestamp) and listed in `heal` so the caller can best-effort
// persist the backfill.
//
//   rows:                reader_assignments rows (scripts(title) joined)
//   feedbackAtByScript:  { [script_id]: earliest feedback created_at } for this reader
export function partitionAssignments(rows, feedbackAtByScript = {}) {
  const pending = [];
  const decided = [];
  const heal = [];
  for (const row of rows || []) {
    const shaped = shapeAssignment(row);
    let decidedAt = row.decided_at || null;
    if (!decidedAt && feedbackAtByScript[row.script_id]) {
      decidedAt = feedbackAtByScript[row.script_id];
      heal.push({ id: row.id, decidedAt });
    }
    if (decidedAt) decided.push({ ...shaped, decidedAt });
    else pending.push(shaped);
  }
  return { pending, decided, heal };
}

// Earliest feedback timestamp per script from a reader's feedback rows — the
// decided_at a self-healed assignment gets (truthful: when they actually decided).
export function earliestFeedbackByScript(feedbackRows) {
  const at = {};
  for (const f of feedbackRows || []) {
    if (!f.script_id || !f.created_at) continue;
    if (!at[f.script_id] || f.created_at < at[f.script_id]) at[f.script_id] = f.created_at;
  }
  return at;
}

// Postgres unique-violation detection (same heuristic claimNotification uses) —
// lets the route answer 409 on a duplicate (reader, script) assignment.
export function isDuplicateError(message) {
  return /duplicate|unique|23505/i.test(String(message || ''));
}
