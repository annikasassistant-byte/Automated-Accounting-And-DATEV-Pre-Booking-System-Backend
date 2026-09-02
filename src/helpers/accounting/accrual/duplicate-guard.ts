import { sha256 } from '../csv.util.js';

export function buildSourceIdentityKey(parts: Record<string, string | null | undefined>): string {
  const normalized = Object.keys(parts)
    .sort()
    .map((k) => `${k}=${String(parts[k] ?? '').trim().toLowerCase()}`)
    .join('|');
  return sha256(normalized);
}

export function buildMarketplaceTxnKey(
  marketplace: string,
  sourceRecordId: string,
  txnType?: string,
): string {
  return buildSourceIdentityKey({
    kind: 'marketplace_txn',
    marketplace,
    sourceRecordId,
    txnType: txnType || '',
  });
}

export function buildJtlRecordKey(sourceRecordId: string, recordType: string): string {
  return buildSourceIdentityKey({ kind: 'jtl', sourceRecordId, recordType });
}

export function buildBusinessEventKey(parts: {
  eventType: string;
  marketplace?: string | null;
  marketplaceOrderId?: string | null;
  sourceRecordId?: string | null;
  financialTransactionId?: string | null;
}): string {
  return buildSourceIdentityKey({
    kind: 'business_event',
    eventType: parts.eventType,
    marketplace: parts.marketplace || '',
    marketplaceOrderId: parts.marketplaceOrderId || '',
    sourceRecordId: parts.sourceRecordId || '',
    financialTransactionId: parts.financialTransactionId || '',
  });
}

export function buildEvidenceKey(source: string, sourceRecordId: string): string {
  return buildSourceIdentityKey({ kind: 'evidence', source, sourceRecordId });
}
