require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const pool = require('./src/config/db');
const authRoutes = require('./src/routes/authRoutes');
const postRoutes = require('./src/routes/postRoutes');
const { errorHandler } = require('./src/middleware/errorHandler');
const { apiLimiter } = require('./src/middleware/rateLimiter');
const { requestObserver, metricsHandler } = require('./src/middleware/observability');

const app = express();

app.disable('x-powered-by');
// Behind proxies (ALB -> nginx) trust exactly that many hops, so req.ip is the real client IP
// and the rate limiter counts each user separately instead of counting the nginx pod.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 0));
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  })
);
app.use(requestObserver);
app.use(express.json({ limit: '256kb' })); // long-form posts

// Probe and metrics endpoints sit before the rate limiter so Kubernetes and Prometheus are never throttled.
// Liveness: the process is up and serving HTTP.
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
// Readiness: the pod can also reach MySQL, so it is safe to send user traffic to it.
app.get('/api/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ready' });
  } catch (err) {
    res.status(503).json({ status: 'unavailable', error: 'database unreachable' });
  }
});
// Prometheus scrape endpoint. nginx only forwards /api/*, so this is never reachable from the internet.
app.get('/metrics', metricsHandler);

app.use('/api', apiLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/posts', postRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 4000;
  const server = app.listen(PORT, () => console.log(`Marginal blog API listening on port ${PORT}`));

  // Graceful shutdown: Kubernetes sends SIGTERM during rolling updates. Finish in-flight requests,
  // close the MySQL pool, then exit. Force-exit after 10s so the pod never hangs.
  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down gracefully`);
    server.close(async () => {
      await pool.end().catch(() => {});
      console.log('HTTP server closed and database pool drained');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
