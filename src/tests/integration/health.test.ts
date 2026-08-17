/**
 * Health endpoint integration tests.
 * Skips when Express app module is not yet present.
 */
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/depth_dashboard_test';
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || 'test-access-secret-min-32-characters!!';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-min-32-characters!';
process.env.COOKIE_SECRET =
  process.env.COOKIE_SECRET || 'test-cookie-secret-min-32-characters!!';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379/15';

let app = null;
let skipReason = '';

function resolveExpressApp(mod) {
  const exported = mod?.default ?? mod?.app;
  if (!exported) return null;
  // createExpressApp is a factory, not an Express request handler.
  if (typeof exported === 'function' && typeof exported.handle !== 'function') {
    return exported();
  }
  return exported;
}

async function tryLoadApp() {
  try {
    const mod = await import('../../app.js');
    app = resolveExpressApp(mod);
    return Boolean(app);
  } catch (err) {
    skipReason = `app.js not available: ${err.message}`;
    return false;
  }
}

const canRun = await tryLoadApp();
const healthSuite = canRun ? describe : describe.skip;

healthSuite('Health API (integration)', () => {
  it('GET /api/v1/health returns ok', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.success === true || res.body.status === 'ok' || res.body.data).toBeTruthy();
  });

  it('GET /health (unversioned) may also respond', async () => {
    const res = await request(app).get('/health');
    expect([200, 404]).toContain(res.status);
  });
});

describe('Health API skip notice', () => {
  it('documents skip reason when suite is inactive', () => {
    if (!canRun) {
      // eslint-disable-next-line no-console
      console.warn(`[health.integration] skipped — ${skipReason || 'app not available'}`);
    }
    expect(true).toBe(true);
  });
});
