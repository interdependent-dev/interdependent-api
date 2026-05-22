import express from 'express';
import cookieParser from 'cookie-parser';
import { corsMiddleware } from './middleware/cors.js';
import { errorHandler } from './middleware/errorHandler.js';
import authRouter from './routes/auth.js';
import evaluateRouter from './routes/evaluate.js';
import scriptsRouter from './routes/scripts.js';

const app = express();

// Trust proxy headers when running behind Render / AWS ALB
app.set('trust proxy', 1);

// Global middleware
app.use(corsMiddleware);
app.use(express.json());
app.use(cookieParser());

// Health check — no auth required
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Routes
app.use('/auth', authRouter);
app.use('/evaluate', evaluateRouter);
app.use('/scripts', scriptsRouter);

// 404 handler
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler — must be last
app.use(errorHandler);

export default app;
