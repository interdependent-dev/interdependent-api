import cors from 'cors';
import { env } from '../config/env.js';

const allowedOrigins = new Set(env.corsOrigins);

export const corsMiddleware = cors({
  origin(origin, callback) {
    // Allow requests with no origin (curl, server-to-server, Render health checks)
    if (!origin) return callback(null, true);

    if (allowedOrigins.has(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin '${origin}' is not allowed`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  // 'X-Reader-Session' carries the 30-day reader session token used for read-first
  // personalization/identity (curator eval-gating, champion state, taste match). It is
  // a non-safelisted header, so it MUST be echoed here or the browser's preflight blocks
  // every cross-origin request that sends it (www.interdependent.studio → this API).
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Reader-Session'],
  credentials: true,
  maxAge: 86400,
});
