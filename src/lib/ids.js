// Shared LOOSE uuid shape-check (36 chars of hex/hyphen) used to reject junk
// ids at the route edge before they reach the DB — Postgres does the strict
// validation; this is a cheap, deliberately permissive gate. Was previously
// copy-pasted per route. NOTE: routes/reads.js keeps its own STRICT segmented
// regex on purpose (it answers `{ finished:false }` instead of 400 on junk).
export const UUID = /^[0-9a-fA-F-]{36}$/;
