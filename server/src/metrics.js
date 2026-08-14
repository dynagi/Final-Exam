/**
 * Prometheus metrics for the crypto service, scraped by Prometheus and
 * visualized in Grafana (see /monitoring at the repo root).
 */
const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'secureaiexam_' });

const httpRequestDuration = new client.Histogram({
  name: 'secureaiexam_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [register],
});

const httpRequestsTotal = new client.Counter({
  name: 'secureaiexam_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

// One counter for every audited business event (seal, cosign, print, scan, ...)
// since every sensitive action already flows through the audit() helper.
const auditEventsTotal = new client.Counter({
  name: 'secureaiexam_audit_events_total',
  help: 'Total audited business events, by action',
  labelNames: ['action'],
  registers: [register],
});

const criticalAlertsTotal = new client.Counter({
  name: 'secureaiexam_critical_alerts_total',
  help: 'Total CRITICAL alerts raised, by type',
  labelNames: ['type'],
  registers: [register],
});

function httpMetricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const route = req.route?.path ? (req.baseUrl || '') + req.route.path : req.path;
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    const labels = { method: req.method, route, status: res.statusCode };
    httpRequestDuration.observe(labels, seconds);
    httpRequestsTotal.inc(labels);
  });
  next();
}

module.exports = { register, httpMetricsMiddleware, auditEventsTotal, criticalAlertsTotal };
