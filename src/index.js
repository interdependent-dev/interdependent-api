import 'dotenv/config';
import { env } from './config/env.js';
import app from './app.js';

const server = app.listen(env.port, () => {
  console.log(`interdependent-api running on port ${env.port}`);
});

// Graceful shutdown — give in-flight requests up to 10s to complete
function shutdown(signal) {
  console.log(`${signal} received — shutting down gracefully`);
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
