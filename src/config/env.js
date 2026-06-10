import { z } from 'zod';

const envSchema = z.object({
  PORT: z.string().default('3001'),
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  SUBMISSION_PASSCODE: z.string().length(4, 'SUBMISSION_PASSCODE must be exactly 4 characters'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRY: z.string().default('86400'),
  CORS_ORIGINS: z.string().default('https://www.interdependent.studio,https://interdependent.studio'),
  ANTHROPIC_MODEL: z.string().default('claude-opus-4-7'),
  RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY is required'),
  EMAIL_FROM: z.string().email('EMAIL_FROM must be a valid email (e.g. noreply@interdependent.studio)'),
  ADMIN_EMAIL: z.string().email('ADMIN_EMAIL must be a valid email').optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  parsed.error.issues.forEach((issue) => {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  });
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
  anthropicModel: parsed.data.ANTHROPIC_MODEL,
  resendApiKey: parsed.data.RESEND_API_KEY,
  emailFrom: parsed.data.EMAIL_FROM,
  adminEmail: parsed.data.ADMIN_EMAIL,
};
