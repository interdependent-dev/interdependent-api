import 'dotenv/config';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import app from './app.js';

const server = app.listen(env.port, () => {
  logger.info({ port: env.port }, 'interdependent-api running');
});

// Graceful shutdown — give in-flight requests up to 10s to complete
function shutdown(signal) {
  logger.info({ signal }, 'shutting down gracefully');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
