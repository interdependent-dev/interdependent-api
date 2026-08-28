import { randomUUID } from 'node:crypto';
import { logger } from '../lib/logger.js';

// Request logging + correlation. Mounted FIRST in app.js so every request —
// including CORS rejections and 404s — gets a requestId and one 'request'
// line on finish with method/path/status/latency.
//
// The id is honored from an inbound X-Request-Id (so a proxy/front-end can
// correlate across hops) or minted here, echoed back on the response, and
// exposed to downstream handlers as req.id / req.log (a child logger that
// stamps requestId on everything it emits).
export function requestLogger(req, res, next) {
  const inbound = req.headers['x-request-id'];
  const requestId =
    typeof inbound === 'string' && /^[\w.-]{1,64}$/.test(inbound) ? inbound : randomUUID();

  req.id = requestId;
  req.log = logger.child({ requestId });
  res.setHeader('X-Request-Id', requestId);

  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    req.log.info(
      {
        method: req.method,
        // path only — query strings can carry tokens/PII
        path: (req.originalUrl || req.url).split('?')[0],
        status: res.statusCode,
        latencyMs: Math.round(latencyMs * 10) / 10,
      },
      'request',
    );
  });

  next();
}
