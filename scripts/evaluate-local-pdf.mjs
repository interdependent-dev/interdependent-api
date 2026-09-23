// Run the FULL submission pipeline on a local PDF, without the deployed API.
// The evaluation itself is produced by `claude -p` (operator's CLI, same pinned
// model + the same SYSTEM_PROMPT extracted verbatim from services/anthropic/prompts.js);
// everything around it — pdf-parse extraction, format gate, JSON salvage,
// deterministic decision, read-to-end check, Supabase persistence — is the
// portal's own code, imported from src/.
//
//   ANTHROPIC_API_KEY=local-noop SUBMISSION_PASSCODE=0000 \
//   JWT_SECRET=local-noop-local-noop RESEND_API_KEY=noop \
//   EMAIL_FROM=noreply@interdependent.studio \
//   node --env-file=.env scripts/evaluate-local-pdf.mjs <cmd> ...   (run from the repo root)
//
//   prep    <pdf> --dir <workdir>
//             extract text (pdf-parse, same as the portal), run the format gate,
//             write script.txt + the three prompt files + user prompts.
//   process --dir <workdir> [--verifier-raw <file>]
//             parse the claude -p result (baraka.raw.txt in workdir), recompute the
//             weighted craft score, apply the deterministic decision, run the
//             read-to-end check, apply a verifier veto if present. Writes eval.json
//             + a human report. NO database writes.
//   commit  <pdf> --dir <workdir> --title <t> --name <n> --email <e>
//             upsertUser + saveScript + uploadPDF + updateScriptEvaluation, exactly
//             like a portal submission. Prints the new script id.

import fs from 'node:fs';
import path from 'node:path';

const [, , cmd, ...rest] = process.argv;
const argOf = (n) => {
  const i = rest.indexOf(n);
  return i >= 0 ? rest[i + 1] : null;
};
const dir = argOf('--dir');
if (!cmd || !dir) {
  console.error(
    'usage: scripts/evaluate-local-pdf.mjs <prep|process|commit> [pdf] --dir <workdir> [...]',
  );
  process.exit(2);
}
fs.mkdirSync(dir, { recursive: true });
const P = (f) => path.join(dir, f);

// Extract a const-string prompt verbatim from the prompts module source.
function extractPrompt(name) {
  const src = fs.readFileSync(
    new URL('../src/services/anthropic/prompts.js', import.meta.url),
    'utf8',
  );
  const re = new RegExp(`const ${name} = \`([\\s\\S]*?)\`;\\n`);
  const m = re.exec(src);
  if (!m) {
    console.error(`could not extract ${name}`);
    process.exit(1);
  }
  return m[1];
}

const MAX_CHARS = 600_000; // same cap as evaluateScreenplay

if (cmd === 'prep') {
  const pdfPath = rest.find((a) => !a.startsWith('--') && a !== dir);
  const buffer = fs.readFileSync(pdfPath);
  const { extractText } = await import('../src/services/pdfService.js');
  const pdfData = await extractText(buffer);
  const { screenplayFormatGate } = await import('../src/services/formatGate.js');
  const fmt = screenplayFormatGate(pdfData.text, { pageCount: pdfData.pageCount });

  const scriptForModel =
    pdfData.text.length > MAX_CHARS
      ? pdfData.text.slice(0, MAX_CHARS) + '\n\n[...exceeded maximum length...]'
      : pdfData.text;

  fs.writeFileSync(P('script.txt'), scriptForModel);
  fs.writeFileSync(P('baraka-system.txt'), extractPrompt('SYSTEM_PROMPT'));
  fs.writeFileSync(
    P('baraka-user.txt'),
    `Please evaluate the following screenplay:\n\n${scriptForModel}`,
  );
  fs.writeFileSync(P('translation-system.txt'), extractPrompt('TRANSLATION_PROMPT'));
  fs.writeFileSync(
    P('translation-user.txt'),
    `SCREENPLAY EXCERPT:\n\n${scriptForModel.slice(0, 60_000)}`,
  );
  fs.writeFileSync(P('verifier-system.txt'), extractPrompt('VERIFIER_PROMPT'));
  fs.writeFileSync(
    P('meta.json'),
    JSON.stringify(
      {
        pageCount: pdfData.pageCount,
        wordCount: pdfData.wordCount,
        charCount: pdfData.charCount,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        pageCount: pdfData.pageCount,
        wordCount: pdfData.wordCount,
        charCount: pdfData.charCount,
        formatGate: fmt,
        systemPromptChars: fs.statSync(P('baraka-system.txt')).size,
      },
      null,
      2,
    ),
  );
  process.exit(fmt.ok ? 0 : 3);
}

if (cmd === 'process') {
  const { extractJson } = await import('../src/services/anthropic/extraction.js');
  const { barakaDecision } = await import('../src/services/anthropic/evaluation.js');
  const { verifyReadToEnd } = await import('../src/services/anthropic/verification.js');
  const raw = fs.readFileSync(P('baraka.raw.txt'), 'utf8');
  const ev = extractJson(raw);
  if (!ev) {
    console.error('unparseable evaluation JSON');
    process.exit(1);
  }

  // Recompute the weighted craft score in code — the rubric's formula is
  // deterministic, and the decision matrix depends on it being right.
  const WEIGHTS = {
    story_architecture: 2,
    character_construction: 2,
    scene_craft: 1.5,
    screenplay_execution: 1.5,
    dialogue_effectiveness: 1,
    thematic_cohesion: 1,
    emotional_engagement: 1,
  };
  const cs = ev?.evaluation?.craft_score;
  const cr = ev?.evaluation?.championability_rating;
  if (!cs || !cr) {
    console.error('missing craft_score / championability_rating');
    process.exit(1);
  }
  const computed = Object.entries(WEIGHTS).reduce((t, [k, w]) => t + Number(cs[k]?.score) * w, 0);
  const claimed = Number(cs.final_craft_score);
  const arithmeticOk = Math.abs(computed - claimed) < 0.01;
  if (!arithmeticOk) cs.final_craft_score = computed; // rubric math wins, like barakaDecision

  ev.decision =
    barakaDecision(cs.final_craft_score, cr.final_championability_rating) ?? ev.decision;

  const scriptText = fs.readFileSync(P('script.txt'), 'utf8');
  ev.read_verified = verifyReadToEnd(ev, scriptText);

  // Optional Opus-verifier result (only produced when the decision is RECOMMEND).
  const vraw = argOf('--verifier-raw');
  if (vraw && fs.existsSync(vraw)) {
    const v = extractJson(fs.readFileSync(vraw, 'utf8'));
    if (v && typeof v.veto === 'boolean') {
      ev.verifier = {
        decision_in: 'RECOMMEND',
        ...v,
        modelUsed: 'claude-opus-4-8 (local claude -p)',
      };
      if (v.veto) ev.decision = v.recommended_decision || 'CONSIDER';
    }
  }

  fs.writeFileSync(P('eval.json'), JSON.stringify(ev, null, 2));
  console.log(
    JSON.stringify(
      {
        decision: ev.decision,
        craft: cs.final_craft_score,
        claimedCraft: claimed,
        arithmeticOk,
        championability: cr.final_championability_rating,
        read_verified: ev.read_verified,
        scores: Object.fromEntries(Object.keys(WEIGHTS).map((k) => [k, Number(cs[k]?.score)])),
        vetoApplied: ev.verifier?.veto ?? null,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (cmd === 'commit') {
  const pdfPath = rest.find((a) => !a.startsWith('--') && a !== dir);
  const title = argOf('--title'),
    name = argOf('--name'),
    email = argOf('--email');
  if (!pdfPath || !title || !name || !email) {
    console.error('commit needs <pdf> --title --name --email');
    process.exit(2);
  }
  const buffer = fs.readFileSync(pdfPath);
  const meta = JSON.parse(fs.readFileSync(P('meta.json'), 'utf8'));
  const ev = JSON.parse(fs.readFileSync(P('eval.json'), 'utf8'));
  const raw = fs.readFileSync(P('baraka.raw.txt'), 'utf8');
  const { upsertUser, saveScript, uploadPDF, updateScriptStoragePath, updateScriptEvaluation } =
    await import('../src/services/supabaseService.js');

  const user = await upsertUser({ name, email });
  const script = await saveScript({
    userId: user.id,
    title,
    filename: path.basename(pdfPath),
    storagePath: null,
    pageCount: meta.pageCount,
    wordCount: meta.wordCount,
    charCount: meta.charCount,
    submitterName: name,
    submitterEmail: email,
  });
  try {
    const storagePath = await uploadPDF({
      userId: user.id,
      scriptId: script.id,
      filename: path.basename(pdfPath),
      buffer,
    });
    await updateScriptStoragePath({ id: script.id, storagePath });
  } catch (err) {
    console.warn('PDF upload to storage failed (non-fatal):', err.message);
  }
  await updateScriptEvaluation({ id: script.id, evaluationResult: raw, evaluationJson: ev });
  console.log(
    JSON.stringify(
      { scriptId: script.id, userId: user.id, decision: ev.decision, status: 'evaluated' },
      null,
      2,
    ),
  );
  process.exit(0);
}

console.error(`unknown command: ${cmd}`);
process.exit(2);
