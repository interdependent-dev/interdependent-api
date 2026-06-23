import { Resend } from 'resend';
import { env } from '../config/env.js';

const resend = new Resend(env.resendApiKey);

const DECISION_COLORS = {
  RECOMMEND: { bg: '#16a34a', label: 'RECOMMEND' },
  CONSIDER:  { bg: '#d97706', label: 'CONSIDER'  },
  PASS:      { bg: '#dc2626', label: 'PASS'       },
};

function scoreBar(score) {
  const filled = Math.round(score);
  const blocks = '█'.repeat(filled) + '░'.repeat(10 - filled);
  return `${blocks} ${score}/10`;
}

// Two evaluators have shipped: "Casey" (6 categories → weighted_score, comps,
// summary) and "BARAKA" (7 craft categories → final_craft_score, plus a separate
// Championability HIGH/MED/LOW axis). Collapse either into one render shape.
const CRAFT_NAMES = {
  story_architecture: 'Story Architecture', character_construction: 'Character Construction',
  scene_craft: 'Scene Craft', screenplay_execution: 'Screenplay Execution',
  dialogue_effectiveness: 'Dialogue', thematic_cohesion: 'Thematic Cohesion',
  emotional_engagement: 'Emotional Engagement',
};
const CHAMP_NAMES = {
  distinctiveness: 'Distinctiveness', writers_voice: "Writer's Voice",
  memorability: 'Memorability', genre_competence: 'Genre Competence',
};
const CHAMP_COLORS = { HIGH: '#16a34a', MEDIUM: '#d97706', LOW: '#dc2626' };

function normalizeForEmail(d) {
  d = d || {};
  const e = d.evaluation;
  const isBaraka = e && typeof e === 'object' && (e.craft_score || e.championability_rating);
  if (isBaraka) {
    const cs = e.craft_score || {};
    const cr = e.championability_rating || {};
    const categories = Object.keys(CRAFT_NAMES).filter((k) => cs[k]).map((k) => ({
      name: CRAFT_NAMES[k], score: cs[k].score, justification: cs[k].rationale ?? cs[k].justification,
    }));
    const items = Object.keys(CHAMP_NAMES).filter((k) => cr[k]).map((k) => ({
      name: CHAMP_NAMES[k], description: cr[k].description ?? cr[k].rationale,
    }));
    const rating = (cr.final_championability_rating || '').toString().toUpperCase();
    return {
      decision: d.decision, genre: d.genre, country: d.country, budget: d.budget || null,
      scoreValue: cs.final_craft_score, scoreLabel: 'Craft Score',
      categories, championship: (rating || items.length) ? { rating, items, justification: cr.championability_justification } : null,
      comps: null, summary: d.logline || d.summary || cs.craft_justification || '',
      craftAssessment: cs.craft_justification || '', readVerified: d.read_verified,
    };
  }
  const scores = d.scores || {};
  const categories = [['theme', 'Theme'], ['character', 'Character'], ['dialogue', 'Dialogue'],
    ['plot_structure', 'Plot/Structure'], ['marketability', 'Marketability'], ['originality', 'Originality']]
    .filter(([k]) => scores[k]).map(([k, name]) => ({ name, score: scores[k]?.score, justification: scores[k]?.justification }));
  return {
    decision: d.decision, genre: d.genre, country: d.country,
    budget: d.max_budget != null ? `$${Number(d.max_budget).toLocaleString()}` : null,
    scoreValue: d.weighted_score, scoreLabel: 'Weighted Score',
    categories, championship: null, comps: d.comparable_films || null, summary: d.logline || d.summary || '',
    craftAssessment: '', readVerified: undefined,
  };
}

function buildHtml({ submitterName, title, evaluationJson }) {
  const d = evaluationJson;
  const n = normalizeForEmail(d);
  const decision = DECISION_COLORS[n.decision] ?? { bg: '#6b7280', label: n.decision };

  const scoreRows = n.categories.map(({ name, score, justification }) => `
    <tr>
      <td style="padding:10px 12px;font-weight:600;white-space:nowrap;color:#374151;">${name}</td>
      <td style="padding:10px 12px;text-align:center;">
        <span style="display:inline-block;background:#f3f4f6;border-radius:20px;padding:3px 12px;font-weight:700;color:#111827;">${score ?? '—'}</span>
      </td>
      <td style="padding:10px 12px;color:#4b5563;font-size:14px;">${justification ?? ''}</td>
    </tr>`).join('');

  const champ = n.championship;
  const championabilitySection = champ ? `
    <div style="padding:0 40px 24px;">
      <h3 style="margin:0 0 12px;color:#0f172a;font-size:15px;text-transform:uppercase;letter-spacing:0.5px;">Championability
        <span style="display:inline-block;margin-left:8px;background:${CHAMP_COLORS[champ.rating] || '#6b7280'};color:#fff;font-weight:700;font-size:12px;letter-spacing:1px;padding:3px 12px;border-radius:6px;vertical-align:middle;">${champ.rating || '—'}</span>
      </h3>
      ${champ.items.map((it) => `
        <p style="margin:0 0 10px;"><strong style="color:#374151;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">${it.name}</strong><br>
          <span style="color:#4b5563;font-size:14px;line-height:1.6;">${it.description ?? ''}</span></p>`).join('')}
      ${champ.justification ? `<p style="margin:8px 0 0;color:#374151;font-size:14px;line-height:1.7;font-style:italic;">${champ.justification}</p>` : ''}
    </div>` : '';

  const comparables = (n.comps ?? []).map((f) =>
    `<li style="margin-bottom:4px;"><strong>${f.title}</strong> — $${Number(f.budget).toLocaleString()}</li>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:680px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="background:#0f172a;padding:32px 40px;">
      <p style="margin:0;color:#94a3b8;font-size:13px;letter-spacing:1px;text-transform:uppercase;">Interdependent Studio</p>
      <h1 style="margin:8px 0 0;color:#f8fafc;font-size:24px;">Screenplay Evaluation</h1>
    </div>

    <!-- Title + Decision -->
    <div style="padding:32px 40px 0;">
      <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;">${title}</h2>
      <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Submitted by ${submitterName}</p>

      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:24px;">
        <span style="display:inline-block;background:${decision.bg};color:#fff;font-weight:700;font-size:15px;letter-spacing:1px;padding:8px 20px;border-radius:6px;">${decision.label}</span>
        <span style="font-size:28px;font-weight:800;color:#0f172a;">${n.scoreValue ?? '—'}<span style="font-size:16px;color:#6b7280;font-weight:400;">/100 ${n.scoreLabel.toLowerCase()}</span></span>
      </div>

      <!-- Metadata pills -->
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:32px;">
        ${n.genre ? `<span style="background:#eff6ff;color:#1d4ed8;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:600;">${n.genre}</span>` : ''}
        ${n.country ? `<span style="background:#f0fdf4;color:#15803d;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:600;">${n.country}</span>` : ''}
        ${n.budget ? `<span style="background:#fefce8;color:#a16207;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:600;">Budget: ${n.budget}</span>` : ''}
      </div>
    </div>

    <!-- Scores table -->
    <div style="padding:0 40px 24px;">
      <h3 style="margin:0 0 12px;color:#0f172a;font-size:15px;text-transform:uppercase;letter-spacing:0.5px;">${champ ? 'Craft Scores' : 'Category Scores'}</h3>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Category</th>
            <th style="padding:10px 12px;text-align:center;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Score</th>
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Justification</th>
          </tr>
        </thead>
        <tbody>${scoreRows}</tbody>
      </table>
    </div>

    ${n.readVerified === false ? `
    <div style="padding:0 40px 16px;">
      <p style="margin:0;background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #d97706;border-radius:6px;padding:10px 14px;color:#92400e;font-size:13px;">⚠ Partial read — the model could not be confirmed to have read the ending. Treat the scores and summary with caution.</p>
    </div>` : ''}

    ${championabilitySection}

    <!-- Summary -->
    ${n.summary ? `
    <div style="padding:0 40px 24px;">
      <h3 style="margin:0 0 12px;color:#0f172a;font-size:15px;text-transform:uppercase;letter-spacing:0.5px;">Summary</h3>
      <p style="margin:0;color:#374151;font-size:15px;line-height:1.7;">${n.summary}</p>
    </div>` : ''}

    ${n.craftAssessment && n.craftAssessment !== n.summary ? `
    <div style="padding:0 40px 24px;">
      <h3 style="margin:0 0 12px;color:#0f172a;font-size:15px;text-transform:uppercase;letter-spacing:0.5px;">Craft Assessment</h3>
      <p style="margin:0;color:#374151;font-size:15px;line-height:1.7;">${n.craftAssessment}</p>
    </div>` : ''}

    <!-- Comparable films -->
    ${comparables ? `
    <div style="padding:0 40px 24px;">
      <h3 style="margin:0 0 12px;color:#0f172a;font-size:15px;text-transform:uppercase;letter-spacing:0.5px;">Comparable Films</h3>
      <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:1.8;">${comparables}</ul>
    </div>` : ''}

    <!-- Footer -->
    <div style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e5e7eb;">
      <p style="margin:0;color:#9ca3af;font-size:12px;">Full evaluation data attached as <strong>evaluation.txt</strong>. This evaluation is confidential and intended for internal review purposes only.</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Send a plain-text alert to the admin address only.
 * Used for operational issues like credits exhaustion.
 */
export async function sendAdminAlert({ subject, message }) {
  if (!env.adminEmail) return;
  try {
    await resend.emails.send({
      from: env.emailFrom,
      to: env.adminEmail,
      subject,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:40px auto;">
        <h2 style="color:#dc2626;">⚠️ ${subject}</h2>
        <p style="color:#374151;font-size:15px;line-height:1.6;">${message}</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
        <p style="color:#9ca3af;font-size:12px;">Interdependent Studio — api.interdependent.studio</p>
      </div>`,
    });
  } catch (err) {
    console.error('Failed to send admin alert:', err.message);
  }
}

/**
 * Send an evaluation result email to the submitter and a BCC to the admin.
 * Attaches the full JSON as a .txt file.
 * Non-fatal: logs errors rather than throwing.
 */
export async function sendEvaluationEmail({ submitterName, submitterEmail, title, evaluationJson, rawText }) {
  const decision = evaluationJson?.decision ?? 'EVALUATED';
  const subject = `[${decision}] Screenplay Evaluation — ${title}`;

  const attachmentContent = Buffer.from(
    evaluationJson ? JSON.stringify(evaluationJson, null, 2) : rawText,
    'utf-8',
  ).toString('base64');

  const recipients = [submitterEmail];
  if (env.adminEmail && env.adminEmail !== submitterEmail) {
    recipients.push(env.adminEmail);
  }

  // buildHtml needs parsed JSON; with raw-text-only results send a plain version
  const html = evaluationJson
    ? buildHtml({ submitterName, title, evaluationJson })
    : `<p>Screenplay evaluation for <strong>${title}</strong> (submitted by ${submitterName}) is attached.</p>`;

  try {
    await resend.emails.send({
      from: env.emailFrom,
      to: recipients,
      subject,
      html,
      attachments: [
        {
          filename: `${title.replace(/[^a-z0-9]/gi, '_')}_evaluation.txt`,
          content: attachmentContent,
        },
      ],
    });
  } catch (err) {
    console.error('Failed to send evaluation email:', err.message);
  }
}

/**
 * Alert the admin that an evaluation failed, with the reason. Non-fatal.
 */
export async function sendFailureAlert({ title, submitterName, submitterEmail, reason }) {
  if (!env.adminEmail) return;
  try {
    await resend.emails.send({
      from: env.emailFrom,
      to: [env.adminEmail],
      subject: `[ERROR] Screenplay evaluation failed — ${title}`,
      html: `
        <p><strong>${title}</strong> (submitted by ${submitterName}, ${submitterEmail}) failed to evaluate.</p>
        <p style="color:#b91c1c;font-family:monospace;">${reason}</p>
        <p>The submission and PDF are stored — it can be retried after the cause is fixed.
        Check <code>https://interdependent-api.onrender.com/health?deep=1</code> for model/API status.</p>`,
    });
  } catch (err) {
    console.error('Failed to send failure alert:', err.message);
  }
}
