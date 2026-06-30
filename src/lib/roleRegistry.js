// ─────────────────────────────────────────────────────────────────────────────
// Role registry — the SINGLE SOURCE OF TRUTH for the Operating Agreement §16.3
// role roster. Metadata only (no behavior): each entry is { name, oa, family }.
//
//   name   — the display string the client renders for the role.
//   oa     — the Operating Agreement §16.3 citation that defines the role
//            (e.g. '16.3.1-7'), or null for product-internal pseudo-roles.
//   family — production | studio | modifier | partner | product.
//
// Today every reader resolves to the 'reader' role, so nothing here changes
// behavior — it just removes the bare 'Reader' string literal from xpService
// and gives the rest of the platform one place to look roles up as the role
// system fills in.
// ─────────────────────────────────────────────────────────────────────────────

export const ROLES = {
  // ── Production roles (§16.3.1) ──────────────────────────────────────────────
  reader:                { name: 'Reader',               oa: '16.3.1-7',  family: 'production' },
  scriptographer:        { name: 'Scriptographer',       oa: '16.3.1-4',  family: 'production' },
  catalyst:              { name: 'Catalyst',             oa: '16.3.1-5',  family: 'production' },
  cineaste:              { name: 'Cineaste',             oa: '16.3.1-6',  family: 'production' },
  'executive-producer':  { name: 'Executive Producer',   oa: '16.3.1-8',  family: 'production' },
  director:              { name: 'Director',             oa: '16.3.1-9',  family: 'production' },
  'assistant-director':  { name: 'Assistant Director',   oa: '16.3.1-10', family: 'production' },
  actor:                 { name: 'Actor',                oa: '16.3.1-13', family: 'production' },
  audiographer:          { name: 'Audiographer',         oa: '16.3.1-15', family: 'production' },
  musician:              { name: 'Musician',             oa: '16.3.1-16', family: 'production' },
  cinematographer:       { name: 'Cinematographer',      oa: '16.3.1-18', family: 'production' },
  effector:              { name: 'Effector',             oa: '16.3.1-20', family: 'production' },
  scenographer:          { name: 'Scenographer',         oa: '16.3.1-22', family: 'production' },
  editor:                { name: 'Editor',               oa: '16.3.1-23', family: 'production' },
  'production-assistant': { name: 'Production Assistant', oa: '16.3.1-24', family: 'production' },
  agent:                 { name: 'Agent',                oa: '16.3.1-26', family: 'production' },
  exhibitor:             { name: 'Exhibitor',            oa: '16.3.1-27', family: 'production' },

  // ── Studio roles (§16.3.2) ──────────────────────────────────────────────────
  producer:              { name: 'Producer',             oa: '16.3.2-5',  family: 'studio' },
  'associate-producer':  { name: 'Associate Producer',   oa: '16.3.2-4',  family: 'studio' },

  // ── Modifier overlays (§16.3.1) ─────────────────────────────────────────────
  supervisor:            { name: 'Supervisor',           oa: '16.3.1-28', family: 'modifier' },
  coordinator:           { name: 'Coordinator',          oa: '16.3.1-29', family: 'modifier' },

  // ── Product-internal pseudo-roles (no OA citation) ──────────────────────────
  scout:                 { name: 'Scout',                oa: null,        family: 'product' },
  undecided:             { name: 'Undecided',            oa: null,        family: 'product' },
};

// Display name for a role slug. Defaults to 'Reader' for unknown/missing slugs
// so the XP bar always has a sensible label.
export function roleName(slug) {
  return ROLES[slug]?.name ?? 'Reader';
}
