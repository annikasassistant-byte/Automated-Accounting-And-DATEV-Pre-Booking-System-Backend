import type { Marketplace } from '../../../enums/accrual.js';

/** Amazon order-ID format, e.g. 403-1234567-1234567 */
export const AMAZON_ORDER_ID_RE = /^\d{3}-\d{7}-\d{7}$/;

export function isAmazonOrderId(value: string | null | undefined): boolean {
  const id = String(value || '').trim();
  return AMAZON_ORDER_ID_RE.test(id);
}

/**
 * Client-locked JTL Shop aliases (case-insensitive).
 * Blank Shop must never classify as Amazon by itself.
 */
const SHOP_ALIASES: Array<{ marketplace: Marketplace; needles: string[] }> = [
  { marketplace: 'amazon', needles: ['amazon', 'amzn'] },
  { marketplace: 'backmarket', needles: ['backmarket', 'back market'] },
  { marketplace: 'refurbed', needles: ['refurbed'] },
  { marketplace: 'kaufland', needles: ['kaufland', 'buyback'] },
];

export function mapJtlShopToMarketplace(shop: string | null | undefined): Marketplace | null {
  const c = String(shop || '')
    .toLowerCase()
    .trim();
  if (!c) return null;
  for (const { marketplace, needles } of SHOP_ALIASES) {
    if (needles.some((n) => c.includes(n))) return marketplace;
  }
  return null;
}

/**
 * Resolve JTL channel: Shop aliases first, then Amazon order-ID on Externe Belegnummer.
 * A blank Shop alone never maps to Amazon.
 */
export function resolveJtlMarketplace(
  shop: string | null | undefined,
  externalOrderId?: string | null,
): Marketplace | null {
  const fromShop = mapJtlShopToMarketplace(shop);
  if (fromShop) return fromShop;
  if (isAmazonOrderId(externalOrderId)) return 'amazon';
  return null;
}

export default resolveJtlMarketplace;
