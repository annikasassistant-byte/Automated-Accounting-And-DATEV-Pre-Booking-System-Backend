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
  if (t.includes('gebühr') || t.includes('fee')) return 'fee';
  if (t.includes('erstatt') || t.includes('refund')) return 'refund';
  if (t.includes('anpass') || t.includes('adjust')) return 'adjustment';
  if (t.includes('auszahl') || t.includes('transfer') || t.includes('payout')) return 'payout';
  if (t.includes('bestell') || t.includes('order') || t.includes('bezahlung')) return 'sale_line';
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
