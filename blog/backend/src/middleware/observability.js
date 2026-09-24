const client = require('prom-client');

// One registry for the whole process: default Node.js metrics plus HTTP RED metrics.
const register = new client.Registry();
register.setDefaultLabels({ app: 'blog-backend' });
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: 'blog_http_requests_total',
  help: 'Total HTTP requests handled by the Marginal blog API',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'blog_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// Endpoints that are hit every few seconds by probes/scrapers: measured, but not logged.
const QUIET_PATHS = new Set(['/metrics', '/api/health', '/api/ready']);

// Use the matched Express route pattern (e.g. /api/posts/:id/like) instead of the raw URL,
// so post IDs do not explode the number of Prometheus time series.
function routeLabel(req) {
  if (req.route && req.route.path) {
    return `${req.baseUrl || ''}${req.route.path === '/' ? '' : req.route.path}` || '/';
  }
  return 'unmatched';
}

function requestObserver(req, res, next) {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const labels = { method: req.method, route: routeLabel(req), status_code: String(res.statusCode) };
    const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, seconds);

    if (!QUIET_PATHS.has(req.path)) {
      // One JSON line per request: easy to filter in Loki, e.g. {app="backend"} | json | status >= 500
      console.log(
        JSON.stringify({
          level: res.statusCode >= 500 ? 'error' : 'info',
          msg: 'http_request',
          method: req.method,
          route: labels.route,
          status: res.statusCode,
          durationMs: Math.round(seconds * 1000),
          ip: req.ip,
        })
      );
    }
  });
  next();
}

async function metricsHandler(req, res) {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
}

module.exports = { requestObserver, metricsHandler, register };
