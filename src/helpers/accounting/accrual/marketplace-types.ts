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

export function mapBackMarketInvoiceKey(raw: string): string {
  const k = raw.toLowerCase();
  if (k.includes('sales_fees') || k.includes('payment_fees') || k.includes('fee')) return 'fee';
  if (k.includes('sales') && !k.includes('fee')) return 'sale_line';
  if (k.includes('adjust')) return 'adjustment';
  if (k.includes('deferred_payout') || k.includes('payout')) return 'payout';
  if (k.includes('refund')) return 'refund';
  return 'unknown';
}

export function mapRefurbedType(raw: string): string {
  const t = raw.toLowerCase();
  if (t.includes('commission') || t.includes('fee')) return 'fee';
  if (t.includes('revenue') || t.includes('sale')) return 'sale_line';
  if (t.includes('reversal') || t.includes('refund')) return 'refund';
  if (t.includes('payout') || t.includes('transfer')) return 'payout';
  return 'unknown';
}
