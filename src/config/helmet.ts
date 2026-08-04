import type { HelmetOptions } from 'helmet';
import env, { isProduction } from './env.js';

/**
 * Split comma-separated origins into valid CSP source entries (one origin each).
 * CSP rejects commas inside a single source value.
 */
function cspOrigins(...values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    if (!value) continue;
    for (const part of String(value).split(',')) {
      const origin = part.trim().replace(/\/$/, '');
      if (!origin || origin === '*' || seen.has(origin)) continue;
      // Only allow absolute http(s) origins in connect-src
      if (!/^https?:\/\//i.test(origin)) continue;
      seen.add(origin);
      out.push(origin);
    }
  }

  return out;
}

/**
 * Helmet security middleware options.
 */
export const helmetOptions: HelmetOptions = {
  contentSecurityPolicy: isProduction
    ? {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
          imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
          connectSrc: [
            "'self'",
            ...cspOrigins(env.FRONTEND_URL, env.CORS_ORIGIN, env.SOCKET_CORS_ORIGIN),
          ],
          fontSrc: ["'self'", 'https:', 'data:', 'https://cdn.jsdelivr.net'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: [],
        },
      }
    : false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  dnsPrefetchControl: { allow: false },
  frameguard: { action: 'deny' },
  hidePoweredBy: true,
  hsts: isProduction
    ? {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      }
    : false,
  ieNoOpen: true,
  noSniff: true,
  originAgentCluster: true,
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  referrerPolicy: { policy: 'no-referrer' },
  xssFilter: true,
};

export default helmetOptions;
