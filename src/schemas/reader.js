import { z } from 'zod';

// ─── Registration ────────────────────────────────────────────────────────────

export const registerBeginSchema = z.object({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  // A recovery email is collected at registration so a reader who later loses
  // every passkey can prove ownership and add a new one.
  email: z.string().email('A valid email is required').max(254),
});

export const registerCompleteSchema = z.object({
  challengeId: z.string().uuid(),
  credential: z.object({}).passthrough(),
});

// ─── Authentication ──────────────────────────────────────────────────────────

export const authBeginSchema = z.object({
  handle: z.string().optional(),
});

export const authCompleteSchema = z.object({
  challengeId: z.string().uuid(),
  credential: z.object({}).passthrough(),
});

// ─── Recovery email ──────────────────────────────────────────────────────────

export const setEmailSchema = z.object({ email: z.string().email('A valid email is required').max(254) });

// ─── Add a device ────────────────────────────────────────────────────────────

export const addDeviceCompleteSchema = z.object({
  challengeId: z.string().uuid(),
  credential: z.object({}).passthrough(),
});

// ─── Account recovery by email ───────────────────────────────────────────────

export const recoverRequestSchema = z.object({
  handle: z.string().min(1).max(80),
  email: z.string().email().max(254),
});

export const recoverBeginSchema = z.object({
  readerId: z.string().uuid(),
  token: z.string().min(32).max(128),
});

export const recoverCompleteSchema = z.object({
  challengeId: z.string().uuid(),
  credential: z.object({}).passthrough(),
});
