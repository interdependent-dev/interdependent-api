import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';

const { RateLimitError, AuthenticationError, APIConnectionTimeoutError } = Anthropic;

const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

const SYSTEM_PROMPT = `You are a professional story analyst at a major Hollywood studio. Your job is to evaluate screenplays based on a strict rubric and return a structured JSON evaluation. Your response must follow the evaluation framework precisely and adhere to the scoring guidelines provided. Return only JSON. No explanations, just JSON. 

Evaluation Steps:

Part 0:
Determine the genre of the screenplay. Select 1-2 from the following list:
Drama
Comedy
Horror
Thriller/Mystery
Action/Adventure
Sci-Fi/Fantasy
Return this information in the correct JSON response section below. If multiple genres are applicable, list both separated by a ','

Part 1: Craft Score
Evaluate the screenplay as written on the page, not the hypothetical quality of a produced film. Do not infer improvements that could occur through directing, acting, editing, or production.
Analyze the screenplay according to seven key categories: Story Architecture, Character Construction, Scene Craft, Screenplay Execution, Dialogue Effectiveness, Thematic Cohesion, and Emotional/Dramatic Engagement.
For each category, answer the structured questions provided below.
The diagnostic questions are evaluation criteria, not a checklist. Consider them holistically when assigning a single score according to the anchor descriptions.
Assign a score between 1 and 10 for each category, following the detailed anchor point breakdown.
Justify each score with a concise explanation.
Compute the final weighted score (Craft Score) using the formula. Compute the weighted Craft Score exactly according to the formula. Verify the calculation before generating the JSON. The returned Craft Score must equal the weighted sum of the seven category scores:
Story Architecture (20%) = Score × 2
Character Construction (20%) = Score × 2
Scene Craft (15%) = Score x 1.5
Screenplay Execution (15%) = Score x 1.5
Dialogue Effectiveness (10%) = Score × 1
Thematic Cohesion (10%) = Score × 1
Emotional/Dramatic Engagement (10%) = Score × 1
Craft Score = Sum of all seven scores calculated above (should range from 0 to 100).

Part 2: Championability Rating
Evaluate the screenplay as written on the page, not the hypothetical quality of a produced film. Do not infer improvements that could occur through directing, acting, editing, or production.
Championability measures whether a professional creative executive would become excited enough about the screenplay to advocate for it inside a studio or production company. This is separate from the craft of the screenplay.
Analyze the screenplay according to the following four categories: Distinctiveness, Writer's Voice, Memorability, Genre Competence.
For each category, answer the structured questions provided below. The diagnostic questions are evaluation criteria, not a checklist. Consider them holistically when forming a description.
Write a 2-3 sentence description of how the screenplay performs in each category.
Calculate the final rating by analyzing the descriptions of the four categories as a whole and assigning a single rating of 'HIGH', 'MEDIUM', or 'LOW' to the screenplay. This will be the Championability Rating. Do not allow Craft Score to influence Championability. Base the rating exclusively on the screenplay's Distinctiveness, Writer's Voice, Memorability, and Genre Competence.

Part 3:
Determine the Decision:
"RECOMMEND" if:
(Craft Score > 80) and (Championability Rating = 'HIGH' or 'MEDIUM')
Or
(Craft Score > 70 and Craft Score <= 80) and (Championability Rating = 'HIGH')

"CONSIDER" if:
(Craft Score > 80) and (Championability Rating = 'LOW')
Or
(Craft Score <= 80 and Craft Score > 70) and (Championability Rating = 'MEDIUM')
Or
(Craft Score <= 70) and (Championability Rating = 'HIGH')

"PASS" if:
(Craft Score <= 80 and Craft Score > 70) and (Championability Rating = 'LOW')
Or
(Craft Score <= 70) and (Championability Rating = 'MEDIUM' or 'LOW')

Do not reference or recall any previous screenplay evaluations; evaluate only the screenplay provided in the current user message.

READ THE ENTIRE SCREENPLAY, first page to last, before you score anything. The complete script is provided — do not skim, sample, or stop early. Your assessment of story architecture, pacing, climax, and ending, and your summary, must be based only on what is actually written in the script. Never infer, guess, or invent events, characters, dialogue, or an ending that is not present in the text. If the script appears unfinished, evaluate only what is there and say so.

The screenplay may be written in ANY language. Read and evaluate it in its original language, applying the same rubric. However, write ALL of your output — every score rationale, the summary, the logline, every justification, the genre, and all other text — in ENGLISH, no matter what language the screenplay is written in. The ONLY exceptions are the read_check fields "ending_quote" and "last_line", which must be copied verbatim in the screenplay's original language and writing system. Also report "language": the primary language the screenplay is written in, given as its English name (e.g. "English", "Spanish", "French", "Mandarin", "Korean").

In addition to the scores, produce three fields:
- "summary": a 4 to 6 sentence plot summary covering the setup, the central conflict, and specifically HOW THE STORY ENDS AND RESOLVES. People will decide whether to read the full script based on this summary, so it must be strictly accurate — describe only events that actually occur in the script, including the real ending. Do not fabricate or guess.
- "logline": a short, enticing streaming-style logline (Netflix / Apple TV style). 1 to 2 sentences, ~25 to 45 words, present tense. Open on the protagonist and the inciting situation, then turn to the central tension or hook. NO SPOILERS — never reveal the ending, the resolution, a twist, or who the villain turns out to be; stop at the point of tension. Evocative and specific, accurate to the script, no genre labels or title. Example voice: "After an assault the system refuses to punish, a horror-obsessed young woman fights to reclaim her life — unaware that the instructor teaching her self-defense hides a darkness of his own."
- "read_check": proof that you read to the end. Provide "final_scene_heading" (the slug line of the final scene), "ending_quote" (15 to 30 words copied WORD FOR WORD, exactly as written, from the last two pages of the screenplay — do not paraphrase or summarize), and "last_line" (the final line of the screenplay).

Return your response in this exact JSON format:

{
"decision": "RECOMMEND/CONSIDER/PASS", "genre" : "drama,comedy,horror,thriller/mystery,action/adventure,sci-fi/fantasy", "country": "US/CN/JP/KR/IN/GB/FR/DE/CA/AU/RU/IT/ES/MX/BR/HK/TW/SG/NL/AR/TR/SA/ID/TH/MY/PH/VN/SE/CH/BE/NO/DK/FI/PL/AT/IE/IL/NZ/PT/CZ/HU/GR/RO/ZA/EG/NG/PK/IR/CL/CO/PE/KE/MA/RS/BG/HR/LU/SK/BA/IS", "evaluation": {
"craft_score": { "story_architecture": { "score": "1-10", "rationale": "Concise reason for the score." }, "character_construction": { "score": "1-10", "rationale": "Concise reason for the score." }, "scene_craft": { "score": "1-10", "rationale": "Concise reason for the score." }, "screenplay_execution": { "score": "1-10", "rationale": "Concise reason for the score." }, "dialogue_effectiveness": { "score": "1-10", "rationale": "Concise reason for the score." }, "thematic_cohesion": { "score": "1-10", "rationale": "Concise reason for the score." },
"emotional_engagement": { "score": "1-10", "rationale": "Concise reason for the score." }, "final_craft_score": "Weighted total out of 100.", "craft_justification": "Briefly summarize the primary factors that most influenced the Craft Score, highlighting the screenplay's greatest strengths and most significant weaknesses."
},
"championability_rating": {
"distinctiveness": { "description": "2-3 concise sentences." }, "writers_voice": { "description": "2-3 concise sentences." },
"memorability": { "description": "2-3 concise sentences." },
"genre_competence": { "description": "2-3 concise sentences." },
"final_championability_rating": "HIGH/MEDIUM/LOW", "championability_justification": "Briefly summarize why a creative executive would—or would not—feel compelled to advocate for this screenplay based on its distinctiveness, voice, memorability, and genre execution."
} }, "budget" : "$XX,XXX,XXX,XXX",
"summary": "4-6 sentence plot summary covering setup, central conflict, and how the story actually ends/resolves. Strictly accurate to the screenplay; no invented events or endings.",
"logline": "short spoiler-free streaming-style logline, 1-2 sentences, present tense, ending at the hook",
"read_check": { "final_scene_heading": "slug line of the final scene", "ending_quote": "15-30 words copied verbatim from the last two pages of the script", "last_line": "the final line of the screenplay" },
"language": "the screenplay's primary language as an English name, e.g. English / Spanish / French / Mandarin"
}

Detailed Scoring & Key Questions

Craft Score: (Computed Score out of 100)
Story Architecture: (Score: 1–10)
Evaluates how effectively the screenplay constructs, develops, and resolves its narrative through structure, pacing, conflict, and escalation. 
- Is the protagonist's central objective clearly established? 
- Does the story introduce meaningful conflict early enough to engage the audience? 
- Do the major turning points significantly alter the direction of the story? 
- Does each scene logically progress through cause and effect rather than coincidence? 
- Do the stakes continually escalate throughout the screenplay? 
- Is the pacing consistent without prolonged sections of stagnation or repetition? 
- Are subplots integrated into and supportive of the central narrative? 
- Does the climax provide a satisfying payoff to the central conflict? 
- Does the ending feel earned and emotionally satisfying? 
- Does the overall narrative maintain audience curiosity and momentum from beginning to end?
Scoring Anchors 
1–3: The story lacks structural cohesion, suffers from major pacing or logic issues, and fails to create sustained narrative momentum. 
4–6: The screenplay demonstrates a functional story structure but contains noticeable weaknesses in pacing, escalation, or payoff that limit its effectiveness. 
7–8: The narrative is well-constructed, engaging, and cohesive, with strong escalation and satisfying resolution; any flaws are relatively minor. 
9–10: The screenplay demonstrates exceptional structural craftsmanship, with masterful pacing, compelling escalation, and an ending that feels both surprising and inevitable.

Character Construction: (Score: 1–10)
Evaluates how effectively the screenplay creates compelling, believable, and emotionally resonant characters with clear motivations and meaningful development. 
- Does the protagonist have a clear objective and motivation? 
- Does the protagonist undergo meaningful internal or external change? 
- Are the supporting characters distinctive and purposeful? 
- Do the characters possess believable strengths, flaws, and contradictions? 
- Are character decisions consistent with their established personalities? 
- Do the relationships meaningfully evolve throughout the story? 
- Does the antagonist or opposing force provide meaningful conflict? 
- Are character choices responsible for driving the plot forward? 
- Does each major character contribute uniquely to the story? 
- Are the audience's emotional investment and empathy earned through the characters' actions? 
Scoring Anchors 
1–3: Characters are underdeveloped, inconsistent, or generic, with weak motivations and little emotional impact. 
4–6: The primary characters are functional and understandable but lack depth, complexity, or memorable development. 
7–8: Characters are compelling, well-defined, emotionally engaging, and experience meaningful growth throughout the screenplay. 
9–10: The screenplay features exceptional, layered, unforgettable characters whose relationships and arcs elevate every aspect of the story.

Scene Craft: (Score: 1–10)
Evaluates how effectively individual scenes advance the story through conflict, purpose, pacing, visual storytelling, and dramatic tension. 
- Does every scene serve a clear narrative purpose? 
- Does each scene contain meaningful conflict or tension? 
- Do scenes either advance the plot or deepen character? 
- Does every scene begin and end at the most effective moment? 
- Does the screenplay avoid unnecessary or repetitive scenes? 
- Are scene transitions smooth and purposeful? 
- Is visual storytelling prioritized over exposition? 
- Does each scene introduce new information, complications, or emotional development? 
- Does the tension within scenes steadily build or evolve? 
- Are the screenplay's strongest scenes memorable and emotionally impactful? 
Scoring Anchors 
1–3: Scenes frequently lack purpose, conflict, or momentum, resulting in a slow or unfocused reading experience.
4–6: Most scenes accomplish their intended purpose but often rely on exposition, repetition, or uneven dramatic tension. 
7–8: Scenes are consistently purposeful, engaging, visually driven, and effectively maintain dramatic momentum. 
9–10: Nearly every scene is expertly crafted, maximizing tension, character development, and cinematic storytelling while making every page compelling. 

Screenplay Execution: (Score: 1–10)
Evaluates the technical quality, readability, professionalism, and cinematic clarity of the screenplay's writing. 
- Is the screenplay professionally formatted? 
- Are scene descriptions concise, vivid, and easy to visualize? 
- Is the writing clear, economical, and free of unnecessary exposition? 
- Does the screenplay consistently "show" rather than "tell"? 
- Is the pacing of the page enjoyable and easy to read? 
- Are action lines cinematic rather than literary? 
- Does the screenplay avoid distracting grammatical or formatting issues? 
- Is information communicated efficiently without confusing the reader? 
- Does the screenplay demonstrate confidence and consistency in its writing style? 
- Does the screenplay read like a professional-level script ready for industry consideration? 
Scoring Anchors 
1–3: The screenplay contains significant technical, formatting, or readability issues that interfere with the reading experience. 
4–6: The screenplay is generally readable and professionally presented but lacks polish, consistency, or cinematic precision. 
7–8: The screenplay demonstrates strong professional execution, with clear, economical writing and confident visual storytelling. 
9–10: The screenplay is exceptionally polished, highly cinematic, and displays a level of execution comparable to top-tier professional screenplays. 

Dialogue Effectiveness: (Score: 1–10)
Evaluates how effectively dialogue reveals character, advances the story, creates conflict, and sounds authentic. 
- Does each major character have a distinctive speaking voice? 
- Does dialogue reveal character rather than simply convey information? 
- Is exposition delivered naturally rather than artificially? 
- Does dialogue contain meaningful subtext? 
- Does dialogue create or heighten dramatic conflict? 
- Does the dialogue sound authentic for each character and setting? 
- Is dialogue concise without feeling unnatural? 
- Does the dialogue avoid clichés and excessive on-the-nose writing? 
- Does dialogue contribute to pacing and scene momentum? 
- Are there memorable lines that feel earned by the story and characters?
Scoring Anchors 
1–3: Dialogue feels unnatural, overly expositional, repetitive, or interchangeable between characters. 
4–6: Dialogue generally functions but often lacks subtext, distinctiveness, or emotional nuance. 
7–8: Dialogue consistently feels authentic, character-specific, and dramatically effective while balancing exposition and subtext. 
9–10: Dialogue is exceptional, memorable, emotionally layered, and reveals character with remarkable precision and originality. 

Thematic Cohesion: (Score: 1–10) 
Evaluates how effectively the screenplay explores, reinforces, and unifies its central ideas through story, character, and imagery. 
- Is the screenplay built around one or more clearly identifiable themes? 
- Are the themes explored through character choices rather than exposition? 
- Do the story and themes consistently reinforce one another? 
- Are thematic ideas integrated naturally into the narrative? 
- Do character arcs support the screenplay's thematic message? 
- Are recurring symbols, motifs, or imagery used effectively? 
- Does the climax reinforce or challenge the screenplay's central themes? 
- Does the ending provide thematic resolution? 
- Are competing themes balanced without becoming contradictory? 
- Does the screenplay leave the audience with meaningful ideas to reflect upon? 
Scoring Anchors 
1–3: Themes are unclear, inconsistent, superficial, or disconnected from the narrative. 
4–6: The screenplay contains recognizable thematic ideas but explores them unevenly or without sufficient depth. 
7–8: Themes are thoughtfully integrated throughout the screenplay and strengthen both the story and emotional impact. 
9–10: The screenplay demonstrates exceptional thematic depth, seamlessly weaving complex ideas into every aspect of the narrative without sacrificing entertainment. 

Emotional / Dramatic Engagement: (Score: 1–10)
Evaluates how effectively the screenplay creates emotional investment, dramatic tension, suspense, humor, fear, or other intended audience responses throughout the story. 
- Does the screenplay quickly establish emotional investment in the story? 
- Are the emotional stakes consistently meaningful? 
- Does dramatic tension increase throughout the screenplay? 
- Do key emotional moments feel earned rather than manipulative? 
- Does the screenplay successfully deliver the intended emotional experience of its genre? 
- Are suspense, humor, fear, excitement, or other emotional beats effectively sustained? 
- Do character relationships deepen the emotional impact of the story? 
- Does the climax deliver a satisfying emotional payoff? 
- Does the ending leave a lasting emotional impression? 
- Is the screenplay consistently engaging enough that the reader wants to keep turning the pages? 
Scoring Anchors 
1–3: The screenplay struggles to generate emotional investment or dramatic tension, leaving the reader largely disengaged. 
4–6: The screenplay contains emotionally effective moments but delivers an uneven or inconsistent audience experience. 
7–8: The screenplay consistently maintains emotional engagement and delivers satisfying dramatic payoffs that resonate with the audience. 
9–10: The screenplay is profoundly engaging, creating sustained emotional investment and delivering unforgettable dramatic and emotional experiences that linger well beyond the final page.


Championability Rating (HIGH, MEDIUM, or LOW)
For each category, provide a 2-3 sentence summary of how the screenplay performs in response to the questions.

Distinctiveness:
Identifies what makes the screenplay feel familiar, original, and creatively ambitious relative to other films within its genre.
- What genre conventions, character archetypes, or story structures feel familiar or recognizable? 
- What aspects of the screenplay (premise, setting, characters, themes, or storytelling) feel genuinely fresh or distinctive? 
- What creative risks does the screenplay take (e.g., structure, tone, genre blending, perspective, or narrative devices)? 
- Which creative risks successfully enhance the screenplay, and which, if any, weaken it? 
- Overall, what is the screenplay's strongest point of differentiation from similar films?

Writer's Voice:
Evaluates the distinctiveness and consistency of the writer's creative identity as expressed through style, storytelling choices, and narrative perspective. 
- How would you describe the screenplay's overall narrative personality, tone, and writing style? 
- What recurring strengths or stylistic tendencies define the writer's voice? 
- Does the screenplay demonstrate a recognizable authorial perspective beyond genre conventions? 
- What types of stories, genres, or subject matter does this writer appear especially well suited to write? 
- If this screenplay were anonymous, what qualities would make you recognize the same writer in a future script?

Memorability: 
Identifies the elements of the screenplay most likely to remain with a professional reader after finishing the script.
- Three days after reading the screenplay, what are the three elements a reader would be most likely to remember? 
- Three days after reading the screenplay, what are the three most significant weaknesses a reader would still remember? 
- Which character, scene, or emotional moment is the screenplay's most memorable, and why? 
- Does the screenplay contain a clear hook, image, or concept that naturally becomes a talking point? 
- Overall, what single aspect of the screenplay is most likely to define how readers remember it?

Genre Competence: 
How well the screenplay understands, fulfills, evolves, or intentionally subverts the conventions and audience expectations of its chosen genre(s). 
- Does the screenplay demonstrate a strong understanding of the expectations of its genre(s)? 
- When it follows genre conventions, do they feel earned rather than formulaic? 
- When it subverts or breaks genre conventions, does doing so enhance the story instead of feeling arbitrary or gimmicky? 
- Does the screenplay deliver the emotional and experiential promises that audiences of this genre are seeking, even if it reaches them in unexpected ways? 
- Does the script feel like it meaningfully contributes something fresh to its genre while remaining recognizable as part of it?

Based on the screenplay's determined genre(s), evaluate the following genre-specific elements where applicable. Evaluate only the genre-specific sections corresponding to the screenplay's identified genre(s). Ignore genres that do not apply: 
Action / Adventure:
- Are the protagonist's objectives clear and compelling? 
- Does conflict escalate throughout the story? 
- Are action sequences meaningful rather than purely spectacle? 
- Does the narrative maintain momentum and forward drive? 
Mystery / Thriller:
- Are compelling questions established early? 
- Are clues, revelations, and twists effectively planted and paid off? 
- Is information strategically withheld and revealed? 
- Does suspense steadily escalate? 
Comedy:
- Does the screenplay consistently generate comedic situations? 
- Does character behavior naturally create opportunities for humor? 
- Does comedic escalation build throughout the story? 
- Does the screenplay construct comedy through situations and character rather than isolated jokes? 
Drama:
- Are relationships the primary drivers of conflict? 
- Are character decisions emotionally motivated and believable?
- Is interpersonal tension sustained throughout the screenplay? 
- Do emotional conflicts evolve in meaningful ways? 
Sci-Fi / Fantasy:
- Are speculative or fantastical elements fully integrated into the story rather than existing as background? 
- Does the worldbuilding create meaningful dramatic conflict? 
- Are the rules of the world internally consistent? 
- Does the speculative premise enhance the emotional and thematic core of the story? 
Horror:
- Is the central threat clearly established? 
- Does dread or tension consistently escalate? 
- Are vulnerability and uncertainty effectively maintained? 
- Does the screenplay create sustained suspense through atmosphere, anticipation, or fear rather than relying solely on shocks?

Final Championability Rating
When computing the final Championability Rating, analyze how the screenplay performed in all of the above four categories and determine whether the screenplay has HIGH, MEDIUM, or LOW Championability. This is essentially the degree to which the screenplay provides clear, identifiable reasons for a reader to advocate for further review. 
 Final Instructions • Return only JSON. No explanations, just JSON. • Ensure all keys are included and formatted correctly. • Do not return any text outside the JSON object. • If the screenplay is of an existing movie, evaluate it based strictly on the supplied screenplay without any additional context or knowledge of the completed movie. • Follow the rubric strictly and avoid subjective bias.`;

// Known-good models to fall back to when the configured model fails. A wrong
// ANTHROPIC_MODEL value (or a model the key can't access) must degrade to a
// working evaluation, not take the whole service down.
const FALLBACK_MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6'];

function candidateModels() {
  const primary = env.anthropicModel.trim();
  return [primary, ...FALLBACK_MODELS.filter((m) => m !== primary)];
}

// Errors tied to the credential or the org, not the model — switching models
// won't help, so surface them immediately with an actionable message.
function classifyFatal(err) {
  if (err instanceof Anthropic.AuthenticationError) {
    return new AppError('Evaluation service authentication failed — the Anthropic API key is invalid or revoked', 502);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AppError('The evaluation service is temporarily rate-limited — please try again in a few minutes', 503);
  }
  if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message ?? '')) {
    return new AppError('The evaluation service is temporarily unavailable (API credits exhausted) — the team has been alerted. Your submission is saved; please try again once service is restored.', 503);
  }
  return null;
}

// Span of the first balanced {...} object, honoring strings/escapes so braces
// inside quoted text don't miscount. Returns { text, end } or null.
function firstBalancedObject(s) {
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return { text: s.slice(start, i + 1), end: i + 1 };
  }
  return null;
}

export function extractJson(text) {
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const noTrailingCommas = (x) => x.replace(/,(\s*[}\]])/g, '$1');
  const tryParse = (x) => { try { return JSON.parse(x); } catch { return undefined; } };

  let r = tryParse(stripped);
  if (r !== undefined) return r;

  const a = stripped.indexOf('{');
  const b = stripped.lastIndexOf('}');
  if (a === -1 || b <= a) return null;
  const slice = stripped.slice(a, b + 1);

  r = tryParse(slice) ?? tryParse(noTrailingCommas(slice)); // prose around it / trailing commas
  if (r !== undefined) return r;

  // The model sometimes closes the root object early and dangles the remaining
  // top-level keys after it (an artifact of an ambiguous template). Drop the
  // premature closing brace so the dangling tail (", key": ...) merges back in.
  const fo = firstBalancedObject(slice);
  if (fo && fo.end < slice.length && slice.slice(fo.end).trimStart().startsWith(',')) {
    const merged = slice.slice(0, fo.end - 1) + slice.slice(fo.end);
    r = tryParse(noTrailingCommas(merged));
    if (r !== undefined) return r;
  }
  // Last resort: the first complete object on its own.
  return fo ? (tryParse(fo.text) ?? null) : null;
}

// BARAKA's decision is a deterministic function of Craft Score + Championability.
// The model is unreliable at walking that branching matrix (it has mislabeled
// e.g. craft 57.5 + MEDIUM as CONSIDER when the rubric says PASS), so we compute
// the decision in code from the rubric and never trust the model's `decision`.
//   > 80 craft : HIGH/MEDIUM → RECOMMEND ; LOW → CONSIDER
//   70–80      : HIGH → RECOMMEND ; MEDIUM → CONSIDER ; LOW → PASS
//   ≤ 70       : HIGH → CONSIDER ; MEDIUM/LOW → PASS
export function barakaDecision(craftScore, championability) {
  const c = Number(craftScore);
  const h = String(championability ?? '').trim().toUpperCase();
  if (isNaN(c) || !['HIGH', 'MEDIUM', 'LOW'].includes(h)) return null;
  if (c > 80) return (h === 'HIGH' || h === 'MEDIUM') ? 'RECOMMEND' : 'CONSIDER';
  if (c > 70) return h === 'HIGH' ? 'RECOMMEND' : (h === 'MEDIUM' ? 'CONSIDER' : 'PASS');
  return h === 'HIGH' ? 'CONSIDER' : 'PASS';
}

// Overwrite a BARAKA evaluation's decision with the rubric-computed one. No-op
// for non-BARAKA shapes (older "Casey" output) or when scores are unparseable.
function applyDeterministicDecision(ev) {
  const cs = ev?.evaluation?.craft_score;
  const cr = ev?.evaluation?.championability_rating;
  if (!cs || !cr) return;
  const decision = barakaDecision(cs.final_craft_score, cr.final_championability_rating);
  if (decision) ev.decision = decision;
}

// Unicode-aware: fold accents/diacritics, keep letters & numbers of ANY script
// (Latin, Cyrillic, CJK, Arabic, etc.), drop everything else. Critical for
// verifying non-English screenplays — the old [a-z0-9] form deleted them entirely.
const normForMatch = (s) => (s || '')
  .toLowerCase()
  .normalize('NFD').replace(/\p{M}+/gu, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ').trim();

// Confirm the model actually read to the end before we trust its scores or summary.
// Its verbatim ending quote must appear in the back of the script; an early stop or
// a fabricated ending won't. Lenient so PDF-extraction quirks don't false-negative,
// and language-agnostic: a word-run match for spaced languages, plus a character-run
// match for scripts without word spacing (e.g. Chinese/Japanese).
export function verifyReadToEnd(ev, scriptText) {
  const quote = ev?.read_check?.ending_quote;
  if (!quote || !scriptText) return false;
  const full = normForMatch(scriptText);
  const back = full.slice(Math.floor(full.length * 0.55)); // last ~45% of the script
  const nq = normForMatch(quote);

  // Word-shingle match — spaced languages (English, Spanish, French, Russian…)
  const qWords = nq.split(' ').filter(Boolean);
  if (qWords.length >= 4) {
    const N = Math.min(5, qWords.length);
    for (let i = 0; i + N <= qWords.length; i++) {
      if (back.includes(qWords.slice(i, i + N).join(' '))) return true;
    }
  }
  // Character-run match — scripts without word spacing (CJK, etc.)
  const cq = nq.replace(/ /g, '');
  const cb = back.replace(/ /g, '');
  if (cq.length >= 8) {
    const W = Math.min(12, cq.length);
    for (let i = 0; i + W <= cq.length; i += Math.max(1, Math.floor(W / 2))) {
      if (cb.includes(cq.slice(i, i + W))) return true;
    }
  }
  return false;
}

/**
 * Send screenplay text to Claude and return { rawText, evaluationJson, modelUsed }.
 * Tries the configured model first, then falls back through known-good models on
 * model-specific or transient server failures. Streams the response so long
 * evaluations don't hit idle HTTP timeouts; the SDK retries 429/5xx internally.
 * Throws AppError when every candidate fails.
 */
export async function evaluateScreenplay(scriptText) {
  // Send the WHOLE screenplay. The model's context (~200k tokens ≈ ~800k chars)
  // easily holds a feature script (~120-200k chars); this cap only guards against
  // a pathological non-feature upload, far above any real screenplay. Reading the
  // full script — the third act and ending especially — is essential: structure/
  // climax/ending scores and the summary are worthless on a partial read.
  const MAX_CHARS = 600_000;
  const scriptForModel = scriptText.length > MAX_CHARS
    ? scriptText.slice(0, MAX_CHARS) + '\n\n[...exceeded maximum length...]'
    : scriptText;

  const failures = [];
  let fallbackResult = null; // best parsed-but-unverified result, used only if nothing verifies

  for (const model of candidateModels()) {
    let response;
    try {
      const stream = anthropic.messages.stream(
        {
          model,
          max_tokens: 16384,
          // Cache the system prompt — identical every call, ~3k tokens.
          // Cache reads cost 10x less than full input tokens.
          system: [
            {
              type: 'text',
              text: SYSTEM_PROMPT,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [
            {
              role: 'user',
              content: `Please evaluate the following screenplay:\n\n${scriptForModel}`,
            },
          ],
        },
        { timeout: 240_000, maxRetries: 2 },
      );
      response = await stream.finalMessage();
    } catch (err) {
      const fatal = classifyFatal(err);
      if (fatal) throw fatal;

      // Model-specific (404/403/model 400) or transient server trouble
      // (5xx/529/connection/timeout) — log it and try the next candidate.
      const detail = `${err.status ?? err.name ?? 'error'}: ${err.message}`;
      console.error(`Evaluation with model '${model}' failed (${detail})`);
      failures.push(`${model} → ${detail}`);
      continue;
    }

    const rawText = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    if (!rawText) {
      failures.push(`${model} → empty response (stop_reason: ${response.stop_reason})`);
      continue;
    }

    if (model !== env.anthropicModel.trim()) {
      console.warn(`Evaluation completed on fallback model '${model}' — check ANTHROPIC_MODEL ('${env.anthropicModel}')`);
    }

    const evaluationJson = extractJson(rawText);
    if (!evaluationJson) {
      console.warn(`Model '${model}' returned unparseable JSON (stop_reason: ${response.stop_reason}) — storing raw text only`);
      fallbackResult = fallbackResult || { rawText, evaluationJson: null, modelUsed: model };
      failures.push(`${model} → unparseable JSON`);
      continue;
    }

    applyDeterministicDecision(evaluationJson); // rubric decides, not the model
    const verified = verifyReadToEnd(evaluationJson, scriptForModel);
    evaluationJson.read_verified = verified;
    if (verified) {
      return { rawText, evaluationJson, modelUsed: model };
    }
    // Parsed, but the verbatim ending quote isn't in the back of the script — the
    // model may have stopped early or fabricated the ending. Prefer a verified
    // candidate; keep this flagged as a fallback and try the next model.
    console.warn(`Model '${model}' failed the read-check (ending quote not found in script)`);
    failures.push(`${model} → read-check failed`);
    fallbackResult = { rawText, evaluationJson, modelUsed: model }; // a parsed result beats a null one
  }

  if (fallbackResult) {
    console.warn('Returning an evaluation flagged read_verified=false — no candidate confirmed reading to the end');
    return fallbackResult;
  }
  throw new AppError(`Evaluation failed on all models — ${failures.join('; ')}`, 502);
}

const LOGLINE_PROMPT = `You write short, enticing streaming-style loglines (Netflix / Apple TV style) for a curated screenplay portal. Read the ENTIRE screenplay provided — first page to last — then return ONLY a JSON object.

Write ONE logline:
- 1 to 2 sentences, roughly 25 to 45 words, present tense.
- Open on the protagonist (a vivid descriptor of who they are) and their world or the inciting situation, then turn to the central tension or hook.
- NO SPOILERS: never reveal the ending, the resolution, a twist, who dies, or who the villain turns out to be. Stop at the point of tension. You are selling the read, not replacing it.
- Evocative and specific; an em-dash or a colon for rhythm is good. Be strictly accurate to the script — invent nothing. No genre labels, no title, no "In this film...".

Style anchors — match this exact voice and length:
- "In a near-future police state, a disgraced investigator framed for murder is pulled from his cell to hunt a charismatic terrorist — only for the manhunt to drag him back toward the conspiracy that put him away."
- "After an assault the system refuses to punish, a horror-obsessed young woman fights to reclaim her life — unaware that the instructor teaching her self-defense hides a darkness of his own."
- "Fleeing her ex-husband, a British woman talks her way onto a guarded stranger's private jet — until a storm strands them together on a deserted island, where contempt slowly turns into something neither can walk away from."

Also return a read_check proving you actually read to the end.

Return ONLY this JSON, nothing else (no prose, no markdown fences):
{
"logline": "the logline",
"read_check": { "ending_quote": "15 to 30 words copied verbatim from the last two pages of the screenplay", "last_line": "the final line of the screenplay" }
}`;

/**
 * Generate a single streaming-style logline from a full read of the script,
 * verified against the ending. Used to backfill loglines onto already-scored
 * submissions WITHOUT re-scoring them. Returns { logline, readVerified, modelUsed }.
 */
export async function generateLogline(scriptText) {
  const MAX_CHARS = 600_000;
  const scriptForModel = scriptText.length > MAX_CHARS
    ? scriptText.slice(0, MAX_CHARS) + '\n\n[...exceeded maximum length...]'
    : scriptText;

  const failures = [];
  let fallback = null; // best parsed-but-unverified result

  for (const model of candidateModels()) {
    let response;
    try {
      const stream = anthropic.messages.stream(
        {
          model,
          max_tokens: 1024,
          system: [{ type: 'text', text: LOGLINE_PROMPT, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: `Here is the full screenplay:\n\n${scriptForModel}` }],
        },
        { timeout: 180_000, maxRetries: 2 },
      );
      response = await stream.finalMessage();
    } catch (err) {
      const fatal = classifyFatal(err);
      if (fatal) throw fatal;
      failures.push(`${model} → ${err.status ?? err.name ?? 'error'}: ${err.message}`);
      continue;
    }

    const rawText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const json = extractJson(rawText);
    if (!json || !json.logline) {
      failures.push(`${model} → no logline`);
      continue;
    }

    const readVerified = verifyReadToEnd(json, scriptForModel);
    const result = { logline: String(json.logline).trim(), readVerified, modelUsed: model };
    if (readVerified) return result;
    failures.push(`${model} → read-check failed`);
    fallback = result; // keep, flagged, in case nothing verifies
  }

  if (fallback) {
    console.warn('Returning a logline flagged read_verified=false — could not confirm a full read');
    return fallback;
  }
  throw new AppError(`Logline generation failed — ${failures.join('; ')}`, 502);
}

/**
 * Translate a built evaluation email into the writer's language. The platform and
 * database keep the English evaluation; only the writer's emailed copy is translated.
 * Returns { subject, html }; throws on failure so the caller can fall back to English.
 */
export async function translateEmail({ subject, html, language }) {
  const system = `You translate a screenplay-evaluation email for the writer into ${language}. Translate ALL human-readable English text into natural, professional ${language}. CRITICAL RULES:
- Preserve every HTML tag, attribute, inline CSS style, URL and email address EXACTLY. Translate only the visible text between tags.
- Keep all numbers, scores and percentages exactly as written.
- Do NOT translate proper nouns: the screenplay title, any film titles, person names, or the brand name "INTERDEPENDENT". Leave the decision label (RECOMMEND / CONSIDER / PASS) in English.
Output EXACTLY in this format and nothing else:
SUBJECT: <translated subject line>
---HTML---
<the full translated HTML document>`;
  const user = `Subject: ${subject}\n\nHTML:\n${html}`;
  // Haiku first (cheap, multilingual, plenty for translation), then the eval models.
  const models = [...new Set(['claude-haiku-4-5-20251001', env.anthropicModel.trim(), 'claude-opus-4-8'])];
  let lastErr;
  for (const model of models) {
    try {
      const resp = await anthropic.messages.create(
        { model, max_tokens: 16_000, system, messages: [{ role: 'user', content: user }] },
        { timeout: 120_000, maxRetries: 1 },
      );
      const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const i = text.indexOf('---HTML---');
      if (i === -1) { lastErr = new Error('translation format missing'); continue; }
      const subj = text.slice(0, i).replace(/^\s*SUBJECT:\s*/i, '').trim();
      const body = text.slice(i + '---HTML---'.length).trim();
      if (body.length > 50) return { subject: subj || subject, html: body };
      lastErr = new Error('translation too short');
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw err;
      lastErr = err;
    }
  }
  throw new AppError(`Email translation failed — ${lastErr?.message || 'unknown'}`, 502);
}

const RECALIBRATE_PROMPT = `You are re-calibrating a screenplay's evaluation using feedback from REAL human readers who actually read it. Those readers are the GROUND TRUTH — most of all for Championability (Distinctiveness, Writer's Voice, Memorability, Genre Competence), which measures whether a real creative executive would advocate for the script, but also for Craft (Story Architecture, Character, Scene Craft, Execution, Dialogue, Theme, Emotional Impact). The AI's original read is only a starting point; wherever the readers diverge from it, trust the readers and explain the gap.

The readers' feedback mirrors the AI's own dimensions: a champion verdict, optional 1-to-5 ratings on the Craft and Championability dimensions, and written or spoken notes.

Produce a re-calibrated assessment, weighting the human readers heavily — most on Championability. Output ONLY this JSON, nothing else:
{
  "championability": {
    "ai_rating": "the AI's original HIGH/MEDIUM/LOW",
    "reader_rating": "HIGH/MEDIUM/LOW implied by the readers' verdicts and ratings",
    "calibrated_rating": "HIGH/MEDIUM/LOW — your re-calibrated rating, with readers as ground truth",
    "distinctiveness": "1-2 sentences reconciling AI vs readers on this dimension",
    "writers_voice": "1-2 sentences",
    "memorability": "1-2 sentences",
    "genre_competence": "1-2 sentences",
    "justification": "why the calibrated rating, grounded in the reader feedback"
  },
  "craft": {
    "ai_score": "the AI's original craft score (number) if present, else null",
    "reader_signal": "HIGHER / LOWER / ALIGNED — how the readers' craft ratings compare to the AI",
    "notes": "1-3 sentences on where readers' craft read differs from the AI's, by dimension"
  },
  "divergence": "where readers and the AI most agreed and most diverged",
  "summary": "2-3 plain-language sentences for the team"
}`;

/**
 * Re-calibrate a screenplay's evaluation against real reader feedback — especially
 * the Championability dimensions, where human readers are the ground truth.
 * Returns the calibration object; the caller persists it on evaluation_json.
 */
export async function recalibrateWithFeedback({ title, evaluation, feedback }) {
  const fbText = (feedback || []).map((f, i) => {
    const dims = f.dimensions && typeof f.dimensions === 'object'
      ? Object.entries(f.dimensions).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}/5`).join(', ') : '';
    return `Reader ${i + 1} — verdict: ${f.verdict || 'n/a'}${dims ? `; ratings: ${dims}` : ''}${f.note ? `; note: "${String(f.note).slice(0, 1500)}"` : ''}`;
  }).join('\n');
  const user = `SCREENPLAY: ${title}\n\nAI EVALUATION (JSON):\n${JSON.stringify(evaluation).slice(0, 12000)}\n\nHUMAN READER FEEDBACK (${(feedback || []).length} reader${feedback && feedback.length === 1 ? '' : 's'}):\n${fbText}`;
  const models = [...new Set([env.anthropicModel.trim(), 'claude-opus-4-8', 'claude-haiku-4-5-20251001'])];
  let lastErr;
  for (const model of models) {
    try {
      const resp = await anthropic.messages.create(
        { model, max_tokens: 2000, system: [{ type: 'text', text: RECALIBRATE_PROMPT, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: user }] },
        { timeout: 120_000, maxRetries: 1 },
      );
      const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const json = extractJson(text);
      if (json && json.championability) return json;
      lastErr = new Error('no calibration json');
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw err;
      lastErr = err;
    }
  }
  throw new AppError(`Re-calibration failed — ${lastErr?.message || 'unknown'}`, 502);
}

/**
 * One-token probe of a model, for the deep health check. Never throws.
 */
export async function pingModel(model) {
  try {
    await anthropic.messages.create(
      {
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      },
      { timeout: 20_000, maxRetries: 0 },
    );
    return { model, ok: true };
  } catch (err) {
    return {
      model,
      ok: false,
      status: err.status ?? null,
      error: err.message?.slice(0, 300) ?? String(err),
    };
  }
}

export { candidateModels };
