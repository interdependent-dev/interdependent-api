// ─────────────────────────────────────────────────────────────────────────────
// Reader XP email TEMPLATES — pure (no DB, no Resend, no env), so they render in
// isolation and are unit-testable. The service (services/xpEmailService.js) does
// the sending + idempotency. Warm, personal notes from Christopher Amell + the
// whole team. Dark, branded.
// ─────────────────────────────────────────────────────────────────────────────

const SITE = 'https://www.interdependent.studio';
const RED = '#FF0000';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function signature() {
  return `
    <tr><td style="padding:6px 36px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-top:1px solid #1d1d1d;width:100%;margin-top:10px;">
        <tr><td style="padding-top:20px;">
          <div style="color:#fff;font-weight:700;font-size:15px;">Christopher Gilbert Amell</div>
          <div style="color:#8a8a8a;font-size:12px;letter-spacing:.04em;margin-top:2px;">Founder &nbsp;|&nbsp; Executive Director</div>
          <div style="color:${RED};font-size:11px;letter-spacing:.22em;text-transform:uppercase;font-weight:700;margin-top:12px;">…and the whole team at</div>
          <div style="color:#fff;font-size:13px;letter-spacing:.34em;font-weight:700;margin-top:3px;">I N T E R D E P E N D E N T</div>
        </td></tr>
      </table>
    </td></tr>`;
}

// The branded dark email shell. opts: { eyebrow, heading, bodyHtml, cta:{text,url} }.
export function wrap(opts) {
  const cta = opts.cta
    ? `<tr><td style="padding:6px 36px 4px;">
         <a href="${esc(opts.cta.url)}" style="display:inline-block;background:${RED};color:#fff;text-decoration:none;font-weight:700;font-size:12px;letter-spacing:.14em;text-transform:uppercase;padding:14px 26px;border-radius:6px;">${esc(opts.cta.text)}</a>
       </td></tr>`
    : '';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head>
<body style="margin:0;padding:0;background:#000;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#000;">
    <tr><td align="center" style="padding:32px 14px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#0a0a0a;border:1px solid #1c1c1c;border-radius:14px;border-top:3px solid ${RED};overflow:hidden;">
        <tr><td style="padding:26px 36px 6px;">
          <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${RED};vertical-align:middle;"></span>
          <span style="color:#fff;font-size:12px;letter-spacing:.3em;font-weight:700;vertical-align:middle;margin-left:10px;">I N T E R D E P E N D E N T</span>
        </td></tr>
        <tr><td style="padding:18px 36px 0;">
          ${opts.eyebrow ? `<div style="color:${RED};font-size:11px;letter-spacing:.2em;text-transform:uppercase;font-weight:700;">${esc(opts.eyebrow)}</div>` : ''}
          <h1 style="margin:8px 0 0;color:#fff;font-size:23px;line-height:1.25;font-weight:800;letter-spacing:.01em;">${opts.heading}</h1>
        </td></tr>
        <tr><td style="padding:16px 36px 6px;color:#c9c9c9;font-size:15px;line-height:1.65;">${opts.bodyHtml}</td></tr>
        ${cta}
        ${signature()}
        <tr><td style="padding:22px 36px 26px;">
          <div style="border-top:1px solid #161616;padding-top:14px;color:#6a6a6a;font-size:11px;line-height:1.6;">
            You're getting this because you're a reader at INTERDEPENDENT.
            <a href="${SITE}/account.html" style="color:#8a8a8a;">Manage your account</a> · <a href="${SITE}" style="color:#8a8a8a;">interdependent.studio</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

const hi = (name) => `<p style="margin:0 0 14px;">Hi ${esc(name)},</p>`;

// ── Action emails (first review / first champion) ────────────────────────────

export function feedbackEmail(name, scriptTitle) {
  const t = scriptTitle ? `<strong style="color:#fff;">“${esc(scriptTitle)}”</strong>` : 'a screenplay';
  return {
    subject: 'Thank you for your first read',
    html: wrap({
      eyebrow: 'Your first review',
      heading: 'A real reader just weighed in — thank you.',
      bodyHtml: hi(name) +
        `<p style="margin:0 0 14px;">You read ${t} and left real feedback — the kind a writer actually learns from, and the kind we build everything on. Most people scroll. You read, you thought, and you said something true. That matters more than you know.</p>` +
        `<p style="margin:0 0 14px;">Every honest read makes our taste sharper and gives the right scripts a path forward. You just earned XP toward your first perk — and you helped a writer in the process.</p>` +
        `<p style="margin:0 0 8px;">Keep going. The next great film gets made because readers like you showed up.</p>`,
      cta: { text: 'Read another', url: `${SITE}/submissions.html` },
    }),
  };
}

export function championEmail(name, scriptTitle) {
  const t = scriptTitle ? `<strong style="color:#fff;">“${esc(scriptTitle)}”</strong>` : 'a screenplay';
  return {
    subject: 'You championed your first script',
    html: wrap({
      eyebrow: 'Your first champion',
      heading: 'You put your name behind a story. That counts.',
      bodyHtml: hi(name) +
        `<p style="margin:0 0 14px;">You championed ${t} — you didn't just like it, you stood up for it. Conviction is rare, and it's exactly what moves a screenplay from a pile to a production. When you champion, we listen.</p>` +
        `<p style="margin:0 0 8px;">Spot the right ones early and back them, and you're not just a reader anymore — you're part of how these films get made.</p>`,
      cta: { text: 'Find your next one', url: `${SITE}/submissions.html` },
    }),
  };
}

// ── Perk-unlock emails ───────────────────────────────────────────────────────

const UNLOCK = {
  event: {
    subject: '🎟️ You’re in — free admission unlocked',
    eyebrow: 'Perk unlocked · Event',
    heading: 'You earned your seat at the July 31 event.',
    body:
      `<p style="margin:0 0 14px;">You read <strong style="color:#fff;">The Carrier</strong> and reviewed it — and that just unlocked <strong style="color:#fff;">free admission to our July 31 event at Plots</strong>. This one's on us, because you did the work that makes the whole thing real.</p>` +
      `<p style="margin:0 0 8px;">We'd love to see you there. Come meet the people building this with you.</p>`,
    cta: { text: 'See the details', url: `${SITE}/account.html` },
  },
  podcast: {
    subject: '🎙️ A seat on the podcast is yours',
    eyebrow: 'Perk unlocked · Podcast',
    heading: 'You’ve read enough to have something to say.',
    body:
      `<p style="margin:0 0 14px;">Your reads and reviews just unlocked a <strong style="color:#fff;">podcast appearance</strong>. We want your voice on the show — your taste, what you're seeing in the submissions, the scripts you'd fight for.</p>` +
      `<p style="margin:0 0 8px;">Readers shape what gets made. Now you get the mic.</p>`,
    cta: { text: 'Claim your spot', url: `${SITE}/account.html` },
  },
  chat: {
    subject: '💬 Production Chat is open to you',
    eyebrow: 'Perk unlocked · Production Chat',
    heading: 'You’re in the room now.',
    body:
      `<p style="margin:0 0 14px;">Your reading, feedback, and champions just unlocked <strong style="color:#fff;">Production Chat</strong> — direct access to the conversations where these films take shape. You've earned a real seat at the table.</p>` +
      `<p style="margin:0 0 8px;">Bring your taste. We're listening.</p>`,
    cta: { text: 'Open Production Chat', url: `${SITE}/account.html` },
  },
  voting: {
    subject: '🗳️ You can vote on what gets made',
    eyebrow: 'Perk unlocked · Voting',
    heading: 'Your taste has been validated — now it carries weight.',
    body:
      `<p style="margin:0 0 14px;">A recommendation of yours landed, and your conviction has shown up again and again. That just unlocked <strong style="color:#fff;">voting privileges</strong> on what we greenlight. Few people get this. You earned it by being right.</p>` +
      `<p style="margin:0 0 8px;">Help us pick the next one.</p>`,
    cta: { text: 'See open votes', url: `${SITE}/account.html` },
  },
  credit: {
    subject: '🎬 You’re eligible for a screen credit',
    eyebrow: 'Perk unlocked · Story Scout',
    heading: 'Your name could be on a film.',
    body:
      `<p style="margin:0 0 14px;">You've reached <strong style="color:#fff;">Story Scout</strong> — the top tier of reader standing — which makes you <strong style="color:#fff;">eligible for a screen credit</strong>. To be clear: this is rare, and it's earned. Each film carries only a few “Story Scout” credit slots, awarded to the curators who did the most for <em>that</em> film — who spotted it early, recommended it, championed it, and read it closely.</p>` +
      `<p style="margin:0 0 8px;">Keep backing the right films early. That's how your name ends up in the credits of one.</p>`,
    cta: { text: 'See how credit works', url: `${SITE}/account.html` },
  },
};

export function unlockEmail(name, perkKey) {
  const e = UNLOCK[perkKey];
  if (!e) return null;
  return {
    subject: e.subject,
    html: wrap({ eyebrow: e.eyebrow, heading: e.heading, bodyHtml: hi(name) + e.body, cta: e.cta }),
  };
}

export const UNLOCK_KEYS = Object.keys(UNLOCK);
