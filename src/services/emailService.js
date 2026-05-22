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

function buildHtml({ submitterName, title, evaluationJson }) {
  const d = evaluationJson;
  const decision = DECISION_COLORS[d.decision] ?? { bg: '#6b7280', label: d.decision };

  const scoreRows = [
    ['Theme',         d.scores?.theme?.score,         d.scores?.theme?.justification],
    ['Character',     d.scores?.character?.score,      d.scores?.character?.justification],
    ['Dialogue',      d.scores?.dialogue?.score,       d.scores?.dialogue?.justification],
    ['Plot/Structure',d.scores?.plot_structure?.score, d.scores?.plot_structure?.justification],
    ['Marketability', d.scores?.marketability?.score,  d.scores?.marketability?.justification],
    ['Originality',   d.scores?.originality?.score,    d.scores?.originality?.justification],
  ].map(([cat, score, justification]) => `
    <tr>
      <td style="padding:10px 12px;font-weight:600;white-space:nowrap;color:#374151;">${cat}</td>
      <td style="padding:10px 12px;text-align:center;">
        <span style="display:inline-block;background:#f3f4f6;border-radius:20px;padding:3px 12px;font-weight:700;color:#111827;">${score ?? '—'}</span>
      </td>
      <td style="padding:10px 12px;color:#4b5563;font-size:14px;">${justification ?? ''}</td>
    </tr>`).join('');

  const comparables = (d.comparable_films ?? []).map(f =>
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
        <span style="font-size:28px;font-weight:800;color:#0f172a;">${d.weighted_score ?? '—'}<span style="font-size:16px;color:#6b7280;font-weight:400;">/100</span></span>
      </div>

      <!-- Metadata pills -->
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:32px;">
        ${d.genre ? `<span style="background:#eff6ff;color:#1d4ed8;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:600;">${d.genre}</span>` : ''}
        ${d.country ? `<span style="background:#f0fdf4;color:#15803d;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:600;">${d.country}</span>` : ''}
        ${d.max_budget ? `<span style="background:#fefce8;color:#a16207;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:600;">Max Budget: $${Number(d.max_budget).toLocaleString()}</span>` : ''}
      </div>
    </div>

    <!-- Scores table -->
    <div style="padding:0 40px 24px;">
      <h3 style="margin:0 0 12px;color:#0f172a;font-size:15px;text-transform:uppercase;letter-spacing:0.5px;">Category Scores</h3>
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

    <!-- Summary -->
    ${d.summary ? `
    <div style="padding:0 40px 24px;">
      <h3 style="margin:0 0 12px;color:#0f172a;font-size:15px;text-transform:uppercase;letter-spacing:0.5px;">Overall Summary</h3>
      <p style="margin:0;color:#374151;font-size:15px;line-height:1.7;">${d.summary}</p>
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

  try {
    await resend.emails.send({
      from: env.emailFrom,
      to: recipients,
      subject,
      html: buildHtml({ submitterName, title, evaluationJson }),
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
