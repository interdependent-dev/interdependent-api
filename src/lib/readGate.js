// Canonical "finished read" definition — kept byte-for-byte in sync with the
// portal's site/lib/read-gate.js so the client (maybeMarkRead) and the server
// (/reads/status) never disagree on what "read" means. Reached the end (depth)
// AND spent real active time consistent with reading — never scroll alone.
// Forgiving by design; page-count aware when known, safe when it isn't.
export function isFinishedRead(depth, seconds, pages) {
  const d = depth || 0, s = seconds || 0;
  const reached = pages ? Math.max(1, Math.round(pages * (d / 100))) : 0;
  const timeFloor = Math.max(90, reached * 3); // ~3s per page reached, min 90s
  return d >= 85 && s >= timeFloor;
}
