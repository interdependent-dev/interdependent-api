import { z } from 'zod';
import { logger } from '../lib/logger.js';

// Exported so test/envExample.test.js can assert .env.example covers every key.
export const envSchema = z.object({
  PORT: z.string().default('3001'),
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  SUBMISSION_PASSCODE: z.string().length(4, 'SUBMISSION_PASSCODE must be exactly 4 characters'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRY: z.string().default('86400'),
  CORS_ORIGINS: z
    .string()
    .default('https://www.interdependent.studio,https://interdependent.studio'),
  RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY is required'),
  EMAIL_FROM: z
    .string()
    .email('EMAIL_FROM must be a valid email (e.g. noreply@interdependent.studio)'),
  ADMIN_EMAIL: z.string().email('ADMIN_EMAIL must be a valid email').optional(),
  // Passkey / WebAuthn
  RP_ID: z.string().default('interdependent.studio'),
  RP_NAME: z.string().default('Interdependent Studio'),
  ACTION_TOKEN_EXPIRY: z.string().default('300'), // seconds; 5 min default
  // Read-first / Curator model.
  READER_SESSION_EXPIRY: z.string().default('30d'), // long-lived reader IDENTITY (read personalization only; NOT writes)
  CURATOR_MIN_XP: z.string().default('1724'), // XP at/above which a reader is a Curator (sees AI evals, curates) — "the magic number"
  // Always-Curator/admin handles (staff). Baked default; overridable via the env var on Render.
  // Only include handles that are ALREADY registered (an unregistered admin handle is
  // squattable → add michael-lin here AFTER he creates his account).
  ADMIN_HANDLES: z.string().default('christopher-amell,abhinav-vadhera'),
  // Featured (Carrier) script for the event perk gate: an explicit id wins;
  // otherwise xpService falls back to a title-substring match.
  FEATURED_SCRIPT_ID: z.string().optional(),
  FEATURED_SCRIPT_TITLE: z.string().default('carrier'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  logger.fatal(
    { issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
    'Invalid environment variables',
  );
  process.exit(1);
}

export const env = {
  port: parseInt(parsed.data.PORT, 10),
  anthropicApiKey: parsed.data.ANTHROPIC_API_KEY,
  supabaseUrl: parsed.data.SUPABASE_URL,
  supabaseServiceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
  submissionPasscode: parsed.data.SUBMISSION_PASSCODE,
  jwtSecret: parsed.data.JWT_SECRET,
  jwtExpiry: parseInt(parsed.data.JWT_EXPIRY, 10),
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((o) => o.trim()),
  // Operator decision (Chris, 2026-06-10): Sonnet is the evaluation model,
  // pinned in code so a stale dashboard env var can't override it. To change
  // models, edit this line; fallbacks live in anthropicService.js.
  anthropicModel: 'claude-sonnet-4-6',
  resendApiKey: parsed.data.RESEND_API_KEY,
  emailFrom: parsed.data.EMAIL_FROM,
  adminEmail: parsed.data.ADMIN_EMAIL,
  rpId: parsed.data.RP_ID,
  rpName: parsed.data.RP_NAME,
  actionTokenExpiry: parseInt(parsed.data.ACTION_TOKEN_EXPIRY, 10),
  readerSessionExpiry: parsed.data.READER_SESSION_EXPIRY,
  curatorMinXp: parseInt(parsed.data.CURATOR_MIN_XP, 10),
  adminHandles: new Set(
    parsed.data.ADMIN_HANDLES.split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  ),
  featuredScriptId: parsed.data.FEATURED_SCRIPT_ID,
  featuredScriptTitle: parsed.data.FEATURED_SCRIPT_TITLE,
};

// JWT_SECRET must be a real random secret, not a template placeholder. Names the
// variable only — never prints the value.
if (/change[-_ ]?me|placeholder|your[-_ ]?secret/i.test(parsed.data.JWT_SECRET)) {
  logger.error(
    'JWT_SECRET looks like a placeholder (e.g. "change-me…"). ' +
      'Set a real random secret: openssl rand -hex 32',
  );
  if (process.env.NODE_ENV === 'production') {
    logger.fatal('Refusing to start in production with a placeholder JWT_SECRET.');
    process.exit(1);
  }
}

if (process.env.ANTHROPIC_MODEL && process.env.ANTHROPIC_MODEL.trim() !== env.anthropicModel) {
  logger.warn(
    { envVar: process.env.ANTHROPIC_MODEL, pinned: env.anthropicModel },
    'ANTHROPIC_MODEL env var is ignored — the model is pinned in src/config/env.js',
  );
}
