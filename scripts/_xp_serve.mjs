// Local XP-page preview server. Safe to re-run (read-only against Supabase;
// serves on :3001 until killed). NB: the API path below is hardcoded to the
// author's machine — point it at your checkout before use. Real Supabase creds
// from .env; throwaway values for the schema-required vars the XP read path
// doesn't use; CORS opened to the local static server. A tiny /xp/_previewtoken
// route mints a portal token so the preview page can read the gated leaderboard
// without a passcode.
//   node scripts/_xp_serve.mjs
import express from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

const API = '/Users/camell/Documents/interdependent-web/interdependent-api';
dotenv.config({ path: `${API}/.env` });
const DUMMY = {
  ANTHROPIC_API_KEY: 'sk-ant-dummy',
  SUBMISSION_PASSCODE: '0000',
  JWT_SECRET: 'smoke-secret-key-1234567890',
  RESEND_API_KEY: 're_dummy',
  EMAIL_FROM: 'noreply@interdependent.studio',
  CORS_ORIGINS: 'http://localhost:8080,http://127.0.0.1:8080',
  PORT: '3001',
};
for (const [k, v] of Object.entries(DUMMY)) if (!process.env[k]) process.env[k] = v;

const { default: app } = await import(`${API}/src/app.js`);

const wrap = express();
wrap.get('/xp/_previewtoken', (_req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.type('text/plain').send(jwt.sign({ authenticated: true }, process.env.JWT_SECRET, { expiresIn: '12h' }));
});
wrap.use(app);
wrap.listen(3001, () => console.log('xp preview API on http://127.0.0.1:3001'));
