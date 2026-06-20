import express from 'express';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { corsMiddleware } from './middleware/cors.js';
import { errorHandler } from './middleware/errorHandler.js';
import { pingModel, candidateModels } from './services/anthropicService.js';
import authRouter from './routes/auth.js';
import evaluateRouter from './routes/evaluate.js';
import scriptsRouter from './routes/scripts.js';
import readersRouter from './routes/readers.js';
import leaderboardRouter from './routes/leaderboard.js';

const app = express();

// Trust proxy headers when running behind Render / AWS ALB
app.set('trust proxy', 1);

// Global middleware
app.use(corsMiddleware);
app.use(express.json());
app.use(cookieParser());

// Deep health probes make (tiny) paid API calls — keep them scarce
const deepHealthLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Deep health check is rate-limited — try again later' },
});

// Health check — no auth required.
// /health?deep=1 probes each evaluation model candidate with a 1-token request
// and reports which work, so a bad ANTHROPIC_MODEL or API-key problem is
// diagnosable from the outside without log access.
app.get('/health', async (req, res, next) => {
  if (req.query.deep !== '1') return res.json({ status: 'ok' });
  return deepHealthLimiter(req, res, async () => {
    try {
      const models = await Promise.all(candidateModels().map((m) => pingModel(m)));
      const healthy = models.some((m) => m.ok);
      res.status(healthy ? 200 : 503).json({
        status: healthy ? 'ok' : 'degraded',
        primaryModel: models[0],
        fallbacks: models.slice(1),
      });
    } catch (err) {
      next(err);
    }
  });
});

// Routes
app.use('/auth', authRouter);
app.use('/evaluate', evaluateRouter);
app.use('/scripts', scriptsRouter);
app.use('/readers', readersRouter);
app.use('/leaderboard', leaderboardRouter);

// 404 handler
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler — must be last
app.use(errorHandler);

export default app;
