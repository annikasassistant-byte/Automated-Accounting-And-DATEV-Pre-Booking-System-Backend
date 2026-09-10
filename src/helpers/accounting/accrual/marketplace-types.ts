import type { Marketplace } from '../../../enums/accrual.js';

export type NormalizedMarketplaceLine = {
  marketplace: Marketplace;
  txnType: string;
  sourceRecordId: string;
  marketplaceOrderId: string | null;
  financialTransactionId: string | null;
  settlementId: string | null;
  txnDate: Date;
  description: string;
  originalCurrency: string;
  originalAmountCents: number;
  /** Marketplace-provided EUR settlement amount, if any. */
  eurAmountCents?: number | null;
  exchangeRate?: number | null;
  exchangeRateDate?: Date | null;
  exchangeRateSource?: string | null;
  rawRow: Record<string, string>;
};

export type MarketplaceParseResult = {
  lines: NormalizedMarketplaceLine[];
  errors: { row: number; message: string }[];
  periodStart: Date | null;
  periodEnd: Date | null;
};

export interface MarketplaceParser {
  marketplace: Marketplace;
  parse(content: string): MarketplaceParseResult;
}

export function mapAmazonTransactionType(raw: string): string {
  const t = raw.toLowerCase();
  if (t.includes('gebühr') || t.includes('fee') || t.includes('service-gebühr')) return 'fee';
  if (t.includes('erstatt') || t.includes('refund')) return 'refund';
  if (t.includes('übertrag') || t.includes('auszahl') || t.includes('transfer') || t.includes('payout')) {
    return 'payout';
  }
  if (
    t.includes('nicht verfügbarer') ||
    t.includes('saldo') ||
    t.includes('korrektur') ||
    t.includes('anpass') ||
    t.includes('adjust') ||
    t === 'andere'
  ) {
    return 'adjustment';
  }
  // Financial "Bezahlung der Bestellung" / Bestellung = clearing, never a second sale.
  if (t.includes('bezahlung') || t.includes('bestellung') || t.includes('order')) return 'settlement';
  return 'unknown';
}

/** Financial/Settlement invoice_key → txn types. `sales` = clearing, not revenue. */
export function mapBackMarketInvoiceKey(raw: string): string {
  const k = raw.toLowerCase();
  if (k.includes('sales_fees') || k.includes('payment_fees') || k.includes('ccbm_fees') || k.includes('dp_adjustment_fee') || (k.includes('fee') && !k.includes('refund'))) {
    return 'fee';
  }
  if (k.includes('sales') && !k.includes('fee')) return 'settlement';
  if (k.includes('adjust')) return 'adjustment';
  if (k.includes('deferred_payout') || k.includes('payout')) return 'payout';
  if (k.includes('refund')) return 'refund';
  if (k.includes('monthly_fees')) return 'fee';
  return 'unknown';
}

/**
 * Refurbed payout types: `revenue` = clearing; commissions = fees;
 * revenue_reversal = refund; *_reversal commissions = fee; revenue_discount = adjustment.
 */
export function mapRefurbedType(raw: string): string {
  const t = raw.toLowerCase();
  if (t.includes('commission')) return 'fee';
  if (t.includes('revenue_discount') || (t.includes('discount') && t.includes('revenue'))) {
    return 'adjustment';
  }
  if (t.includes('revenue_reversal') || (t.includes('reversal') && t.includes('revenue'))) {
    return 'refund';
  }
  if (t === 'revenue') return 'settlement';
  if (t.includes('fee')) return 'fee';
  if (t.includes('refund') || t.includes('reversal')) return 'refund';
  if (t.includes('payout') || t.includes('transfer')) return 'payout';
  if (t.includes('sale')) return 'settlement';
  return 'unknown';
}

export type MarketplaceReportType = 'order' | 'financial' | 'auto';

export function detectAmazonReportType(content: string): 'order' | 'financial' {
  const head = content.slice(0, 2500).toLowerCase();
  if (
    head.includes('amazon-order-id') ||
    head.includes('order-status') ||
    head.includes('merchant-order-id') ||
    head.includes('purchase-date')
  ) {
    return 'order';
  }
  return 'financial';
}

export function detectBackMarketReportType(content: string): 'order' | 'financial' {
  const head = content.slice(0, 2500).toLowerCase();
  if (
    head.includes('order_state') ||
    head.includes('orderline_state') ||
    head.includes('date_shipping') ||
    head.includes('order_price')
  ) {
    return 'order';
  }
  return 'financial';
}
