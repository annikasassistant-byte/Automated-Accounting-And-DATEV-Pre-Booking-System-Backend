/** Accrual domain enums — separate from cash Transaction lifecycle. */

export const MARKETPLACES = ['amazon', 'backmarket', 'refurbed'] as const;
export type Marketplace = (typeof MARKETPLACES)[number];







export const BUSINESS_EVENT_TYPES = [
  'ORDER_CREATED',
  'SALE',
  'CANCELLATION',
  'REFUND',
  'FEE',
  'ADJUSTMENT',
  'SETTLEMENT',
  'PAYOUT',
] as const;
export type BusinessEventType = (typeof BUSINESS_EVENT_TYPES)[number];

export const BUSINESS_EVENT_STATUSES = [
  'draft',
  'pending_match',
  'matched',
  'posted',
  'exception',
  'void',
] as const;
export type BusinessEventStatus = (typeof BUSINESS_EVENT_STATUSES)[number];

export const MATCH_STATUSES = ['MATCHED', 'UNMATCHED', 'AMBIGUOUS'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const PAYOUT_RECON_STATUSES = [
  'MATCHED',
  'UNMATCHED',
  'AMBIGUOUS',
  'PARTIAL',
  'EXCEPTION',
] as const;
export type PayoutReconStatus = (typeof PAYOUT_RECON_STATUSES)[number];

export const EVIDENCE_SOURCES = [
  'jtl_csv',
  'marketplace_csv',
  'bank_csv',
  'paypal_csv',
  'document_pdf',
  'manual',
] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export const MARKETPLACE_TXN_TYPES = [
  'order',
  'sale_line',
  'fee',
  'refund',
  'adjustment',
  'settlement',
  'payout',
  'unknown',
] as const;
export type MarketplaceTxnType = (typeof MARKETPLACE_TXN_TYPES)[number];

export const JTL_RECORD_TYPES = [
  'order',
  'sale',
  'invoice',
  'invoice_correction',
] as const;
export type JtlRecordType = (typeof JTL_RECORD_TYPES)[number];

export const ACCOUNTING_EXCEPTION_TYPES = [
  'MISSING_INVOICE',
  'MULTIPLE_TAX_CODES',
  'UNMATCHED_MARKETPLACE_EVENT',
  'UNMATCHED_PAYOUT',
  'FX_REVIEW',
  'DUPLICATE_SOURCE_RECORD',
  'UNKNOWN_TRANSACTION_TYPE',
  'VAT_REVIEW',
  'AMBIGUOUS_MATCH',
] as const;
export type AccountingExceptionType = (typeof ACCOUNTING_EXCEPTION_TYPES)[number];

export const EXCEPTION_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];

export const JOURNAL_ENTRY_STATUSES = ['draft', 'posted', 'exported', 'void'] as const;
export type JournalEntryStatus = (typeof JOURNAL_ENTRY_STATUSES)[number];

export const ACCRUAL_IMPORT_SOURCES = [
  'jtl',
  'marketplace_amazon',
  'marketplace_backmarket',
  'marketplace_refurbed',
] as const;
export type AccrualImportSource = (typeof ACCRUAL_IMPORT_SOURCES)[number];

export const ALL_IMPORT_SOURCES = [
  'bank',
  'paypal',
  ...ACCRUAL_IMPORT_SOURCES,
] as const;
export type ImportBatchSource = (typeof ALL_IMPORT_SOURCES)[number];
