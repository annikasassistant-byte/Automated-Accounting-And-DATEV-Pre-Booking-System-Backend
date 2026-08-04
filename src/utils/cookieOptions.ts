import type { CookieOptions } from 'express';
import env from '../config/env.js';

/**
 * Placeholders / non-host values that must never be sent as Cookie Domain.
 * Invalid Domain attributes cause browsers to drop the cookie entirely.
 */
const INVALID_COOKIE_DOMAINS = new Set([
  '',
  'localhost',
  '127.0.0.1',
  '::1',
  'production',
  'development',
  'test',
  'staging',
  'prod',
  'dev',
]);

/**
 * Resolve a safe Cookie Domain.
 * Empty / placeholder → omit (host-only cookie on the API host).
 * Required for cross-origin SPAs (e.g. Vercel → Render) so the browser
 * actually stores cookies for the API host.
 */
export function resolveCookieDomain(raw: string | undefined = env.COOKIE_DOMAIN): string | undefined {
  const domain = String(raw ?? '')
    .trim()
    .replace(/^\./, '')
    .toLowerCase();

  if (!domain || INVALID_COOKIE_DOMAINS.has(domain)) return undefined;
  // Reject bare words without a dot (not a registrable domain)
  if (!domain.includes('.')) return undefined;
  return domain;
}

/**
 * Shared auth/CSRF cookie options. Omits Domain when unset/invalid.
 * Forces Secure when SameSite=None (browser requirement).
 */
export function buildAuthCookieOptions(overrides: CookieOptions = {}): CookieOptions {
  const sameSite = (overrides.sameSite ?? env.COOKIE_SAME_SITE) as CookieOptions['sameSite'];
  const secure =
    overrides.secure ??
    (sameSite === 'none' ? true : env.COOKIE_SECURE);
  const domain = resolveCookieDomain(
    typeof overrides.domain === 'string' ? overrides.domain : env.COOKIE_DOMAIN,
  );

  const options: CookieOptions = {
    httpOnly: overrides.httpOnly ?? env.COOKIE_HTTP_ONLY,
    secure,
    sameSite,
    path: overrides.path ?? env.COOKIE_PATH,
  };

  if (domain) options.domain = domain;
  if (overrides.maxAge !== undefined) options.maxAge = overrides.maxAge;

  return options;
}
