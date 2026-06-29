// ─────────────────────────────────────────────────────────────────────────────
// Reader XP — the single source of truth for the gamification economy.
//
// This file is PURE (no DB, no Express). The server aggregates raw rows into a
// `stats` object (src/services/xpService.js) and the portal renders the bar
// (site/lib/xp-bar.js); both consume the numbers defined here so they can never
// drift. Everything is a tunable default — change a number here and the whole
// system (points, levels, the bar, the rewards) moves with it.
//
// Design principles:
//   • XP rewards HIGH-SIGNAL, hard-to-fake contribution — a verified read
//     (depth AND time, never a skim), a thorough evaluation, a recommendation
//     that actually LANDS, a pick the crowd later validates.
//   • Levels have BOTH an XP threshold AND a "gate" (a minimum spread of real
//     actions). XP alone can't buy a level — you must have done the work. This
//     is why "reading and recommending can only take you so far": the higher
//     tiers require recommendations that landed and early spots, not grind.
//   • The first reward comes FAST (one quality read + complete feedback ⇒ Scout)
//     to hook new curators; the gaps widen sharply after that.
// ─────────────────────────────────────────────────────────────────────────────

// XP awarded per action. Feedback is scored by THOROUGHNESS — a bare verdict is
// worth little, a verdict + every dimension + written notes + a voice note is a
// "complete" evaluation worth ~55.
export const ACTIONS = {
  read: 10, // a verified, finished read (readingPct ≥ 85 — depth AND time)

  feedbackBase: 15, // leaving any verdict at all
  feedbackPerDimension: 2, // each 1–5 craft/championability dimension rated…
  feedbackDimensionsCap: 15, // …capped, so ~8 of the 11 dimensions max it out
  feedbackNotesMinChars: 120, // written notes must be substantive to count
  feedbackNotes: 10,
  feedbackVoice: 15, // a recorded voice note (with transcript)

  champion: 20, // adding a script to your board — post-decision conviction
  recommendOpened: 5, // your share link was opened by someone
  recommendLanded: 30, // …and that person actually finished the read
  recommendToChampion: 20, // a script you recommended later got championed
  earlySpot: 40, // you championed a script before the crowd did

  // NEW signals — wired now, dormant until the writer & investor surfaces ship.
  writerLike: 10, // a writer endorsed your feedback on their script
  investorFollow: 25, // a Ventures/Anchor investor follows your curation
};

// Max XP a single feedback row can earn (base + dims + notes + voice).
export const FEEDBACK_MAX =
  ACTIONS.feedbackBase + ACTIONS.feedbackDimensionsCap + ACTIONS.feedbackNotes + ACTIONS.feedbackVoice;

// The level ladder. `min` = XP threshold; `gate` = the spread of real actions
// also required to UNLOCK the level's reward; `color` = the bar zone color
// (brand ramp: ash → red → gold → platinum). The reward maps to Chris's perks.
export const LEVELS = [
  {
    key: 'reader',
    name: 'Reader',
    min: 0,
    color: '#3a3a3a',
    gate: null,
    reward: { icon: '🎫', label: 'Public curator profile + badges' },
  },
  {
    key: 'scout',
    name: 'Scout',
    min: 60,
    color: '#8a8f98',
    gate: { reads: 1, feedbacks: 1 },
    reward: {
      icon: '🎟️',
      label: 'Free event admission + podcast appearance',
      note: 'Launch Plots event · early access to new submissions',
    },
  },
  {
    key: 'curator',
    name: 'Curator',
    min: 300,
    color: '#FF0000',
    gate: { reads: 5, feedbacks: 3, champions: 1 },
    reward: { icon: '💬', label: 'Production Chat access', note: 'featured curator' },
  },
  {
    key: 'tastemaker',
    name: 'Tastemaker',
    min: 800,
    color: '#FFD600',
    gate: { recsLanded: 1, champions: 3 },
    reward: { icon: '🗳️', label: 'Voting privileges', note: 'greenlight votes' },
  },
  {
    key: 'partner',
    name: 'Partner',
    min: 2000,
    color: '#E5E4E2',
    gate: { recsLanded: 3, earlySpots: 1 },
    reward: { icon: '🎬', label: 'Screen-credit consideration — “Story Scout”', note: 'set visit / table-read' },
  },
];

// The fixed total length of the XP bar, in XP. The Partner threshold is the end
// of the track; readers past it stay pinned at 100% (with the Partner zone lit).
export const XP_BAR_MAX = LEVELS[LEVELS.length - 1].min;

export const BADGES = {
  'deep-reader': { name: 'Deep Reader', desc: '5+ verified full reads' },
  'early-spotter': { name: 'Early Spotter', desc: 'Championed a script before the crowd did' },
  tastemaker: { name: 'Tastemaker', desc: 'A recommendation that genuinely landed' },
  calibrator: { name: 'Calibrator', desc: '3+ structured evaluations that calibrate the AI' },
  prolific: { name: 'Prolific', desc: 'High reading & feedback volume' },
  connector: { name: 'Connector', desc: 'Recommendations others opened' },
};

// ── Pure helpers ─────────────────────────────────────────────────────────────

const num = (v) => (Number.isFinite(v) ? v : 0);

// XP for ONE feedback row, scaled by how thorough it is.
//   row: { dimensions?: object|array, text?: string, transcript?: string, hasVoice?: bool }
export function feedbackXpForRow(row = {}) {
  let xp = ACTIONS.feedbackBase;
  const dims = row.dimensions;
  const dimCount = Array.isArray(dims)
    ? dims.filter((v) => v != null).length
    : dims && typeof dims === 'object'
      ? Object.values(dims).filter((v) => v != null).length
      : 0;
  xp += Math.min(dimCount * ACTIONS.feedbackPerDimension, ACTIONS.feedbackDimensionsCap);
  if (typeof row.text === 'string' && row.text.trim().length >= ACTIONS.feedbackNotesMinChars) {
    xp += ACTIONS.feedbackNotes;
  }
  if (row.hasVoice) xp += ACTIONS.feedbackVoice;
  return xp;
}

// The highest level whose XP threshold a total has reached (ignores gates).
export function levelForXp(totalXp) {
  let lvl = LEVELS[0];
  for (const l of LEVELS) if (totalXp >= l.min) lvl = l;
  return lvl;
}

// Is a level's action-gate satisfied by these stats? (null gate ⇒ always true.)
export function gateMet(gate, stats = {}) {
  if (!gate) return true;
  return Object.entries(gate).every(([k, need]) => num(stats[k]) >= need);
}

// Which gate requirements are still unmet — drives the bar's 🔒 tooltip.
export function unmetGate(gate, stats = {}) {
  if (!gate) return [];
  return Object.entries(gate)
    .filter(([k, need]) => num(stats[k]) < need)
    .map(([k, need]) => ({ key: k, need, have: num(stats[k]) }));
}

const STAT_LABELS = {
  reads: 'verified reads',
  feedbacks: 'feedback left',
  champions: 'champions',
  recsLanded: 'recommendations that landed',
  earlySpots: 'early spots',
};
export const statLabel = (k) => STAT_LABELS[k] || k;

// The core scorer. Takes already-aggregated `stats` and returns the full XP
// picture the bar needs: total, current level, every level annotated with
// reached/gateMet/unlocked, the next target, badges, and a points breakdown.
//
//   stats: {
//     verifiedReads, feedbackXp, feedbacks, champions, earlySpots,
//     recsSent, recsOpened, recsLanded, recsConverted,
//     writerLikes, investorFollows
//   }
export function scoreReader(stats = {}) {
  const s = {
    verifiedReads: num(stats.verifiedReads),
    feedbackXp: num(stats.feedbackXp),
    feedbacks: num(stats.feedbacks),
    champions: num(stats.champions),
    earlySpots: num(stats.earlySpots),
    recsSent: num(stats.recsSent),
    recsOpened: num(stats.recsOpened),
    recsLanded: num(stats.recsLanded),
    recsConverted: num(stats.recsConverted),
    writerLikes: num(stats.writerLikes),
    investorFollows: num(stats.investorFollows),
  };

  const breakdown = [
    { action: 'read', label: 'Verified reads', count: s.verifiedReads, xp: s.verifiedReads * ACTIONS.read },
    { action: 'feedback', label: 'Feedback', count: s.feedbacks, xp: s.feedbackXp },
    { action: 'champion', label: 'Champions', count: s.champions, xp: s.champions * ACTIONS.champion },
    { action: 'recommendOpened', label: 'Recommends opened', count: s.recsOpened, xp: s.recsOpened * ACTIONS.recommendOpened },
    { action: 'recommendLanded', label: 'Recommends landed', count: s.recsLanded, xp: s.recsLanded * ACTIONS.recommendLanded },
    { action: 'recommendToChampion', label: 'Recommend → champion', count: s.recsConverted, xp: s.recsConverted * ACTIONS.recommendToChampion },
    { action: 'earlySpot', label: 'Early spots', count: s.earlySpots, xp: s.earlySpots * ACTIONS.earlySpot },
    { action: 'writerLike', label: 'Writer likes', count: s.writerLikes, xp: s.writerLikes * ACTIONS.writerLike },
    { action: 'investorFollow', label: 'Investor follows', count: s.investorFollows, xp: s.investorFollows * ACTIONS.investorFollow },
  ];
  const totalXp = breakdown.reduce((a, b) => a + b.xp, 0);

  // gate stats use the bar's vocabulary (reads/feedbacks/champions/recsLanded/earlySpots)
  const gateStats = {
    reads: s.verifiedReads,
    feedbacks: s.feedbacks,
    champions: s.champions,
    recsLanded: s.recsLanded,
    earlySpots: s.earlySpots,
  };

  const levels = LEVELS.map((l) => {
    const reached = totalXp >= l.min;
    const met = gateMet(l.gate, gateStats);
    return {
      key: l.key,
      name: l.name,
      min: l.min,
      color: l.color,
      reward: l.reward,
      gate: l.gate,
      reached,
      gateMet: met,
      unlocked: reached && met, // reward actually earned
      unmet: reached && !met ? unmetGate(l.gate, gateStats) : [],
    };
  });

  const current = [...levels].reverse().find((l) => l.unlocked) || levels[0];
  const currentIndex = levels.findIndex((l) => l.key === current.key);
  const next = levels[currentIndex + 1] || null;

  return {
    totalXp,
    barMax: XP_BAR_MAX,
    level: { key: current.key, name: current.name, index: currentIndex },
    nextLevel: next
      ? {
          key: next.key,
          name: next.name,
          min: next.min,
          xpToGo: Math.max(0, next.min - totalXp),
          gate: next.gate,
          gateMet: next.gateMet,
          unmet: unmetGate(next.gate, gateStats),
        }
      : null,
    levels,
    badges: badgesFor(s),
    breakdown: breakdown.filter((b) => b.count > 0),
    stats: gateStats,
  };
}

export function badgesFor(s = {}) {
  const out = [];
  if (num(s.verifiedReads) >= 5) out.push('deep-reader');
  if (num(s.earlySpots) >= 1) out.push('early-spotter');
  if (num(s.recsLanded) >= 1) out.push('tastemaker');
  if (num(s.feedbacks) >= 3) out.push('calibrator');
  if (num(s.verifiedReads) >= 10 || num(s.feedbacks) >= 5) out.push('prolific');
  if (num(s.recsOpened) >= 3) out.push('connector');
  return out;
}

// The public config the bar fetches once (GET /xp/config).
export function publicConfig() {
  return {
    actions: ACTIONS,
    feedbackMax: FEEDBACK_MAX,
    barMax: XP_BAR_MAX,
    levels: LEVELS.map(({ key, name, min, color, gate, reward }) => ({ key, name, min, color, gate, reward })),
    badges: BADGES,
  };
}
