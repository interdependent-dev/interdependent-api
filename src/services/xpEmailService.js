// ─────────────────────────────────────────────────────────────────────────────
// Reader XP emails — sends the branded notes (lib/xpEmailTemplates.js) when a
// reader does something that matters or unlocks a perk.
//
// Frequency (a deliberate default — tune freely): a thank-you on a reader's FIRST
// review and FIRST champion (not every action, to respect the inbox + deliverability),
// and a celebration at EVERY perk unlock (the real milestones). Idempotent via
// reader_notifications, so nothing double-sends.
//
// Every send is non-fatal + fire-and-forget — a reader's action never fails or
// waits on an email. No email on file → silently skipped.
// ─────────────────────────────────────────────────────────────────────────────

import { Resend } from 'resend';
import { env } from '../config/env.js';
import { getReaderById } from './readerService.js';
import { claimNotification } from './supabaseService.js';
import { getReaderXp } from './xpService.js';
import { feedbackEmail, championEmail, unlockEmail } from '../lib/xpEmailTemplates.js';

const resend = new Resend(env.resendApiKey);
// From the founder, so it reads as a personal note.
const FROM = `Christopher Amell · INTERDEPENDENT <${env.emailFrom}>`;

async function send(to, email) {
  if (!email) return;
  try {
    await resend.emails.send({ from: FROM, to, subject: email.subject, html: email.html });
  } catch (err) {
    console.error(`XP email "${email.subject}" → ${to} failed:`, err.message);
  }
}

// Called (fire-and-forget) after a reader's durable action. Sends a first-of-kind
// thank-you and a celebration for any newly-unlocked perk. Idempotent + non-fatal.
//   { readerId, handle, kind: 'feedback'|'champion', scriptTitle? }
export async function notifyReaderActivity({ readerId, handle, kind, scriptTitle }) {
  try {
    const reader = await getReaderById(readerId).catch(() => null);
    if (!reader || !reader.email) return; // no inbox on file — nothing to do
    const name = reader.display_name || reader.handle;

    // first-of-kind action thank-you (once ever, per kind)
    if (kind === 'feedback' && (await claimNotification(reader.id, 'first_feedback', ''))) {
      await send(reader.email, feedbackEmail(name, scriptTitle));
    } else if (kind === 'champion' && (await claimNotification(reader.id, 'first_champion', ''))) {
      await send(reader.email, championEmail(name, scriptTitle));
    }

    // Celebrate a newly-unlocked perk. We claim EVERY freshly-unlocked perk (so none
    // re-sends later) but email at most the SINGLE HIGHEST one per action — a
    // belt-and-suspenders guard so an unseeded reader can never get a burst of
    // historical perk emails. (Pair with src/db/seed_reader_notifications.mjs, which
    // pre-claims existing milestones at launch.)
    const xp = await getReaderXp(handle).catch(() => null);
    if (xp && xp.levels) {
      const fresh = [];
      for (const lvl of xp.levels) {
        if (lvl.min > 0 && lvl.unlocked && (await claimNotification(reader.id, 'unlock', lvl.key))) fresh.push(lvl);
      }
      const top = fresh.sort((a, b) => b.min - a.min)[0];
      if (top) await send(reader.email, unlockEmail(name, top.key));
    }
  } catch (err) {
    console.error('notifyReaderActivity error:', err.message);
  }
}
