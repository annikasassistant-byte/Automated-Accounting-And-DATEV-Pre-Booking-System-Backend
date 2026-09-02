import type { BusinessEventType, MarketplaceTxnType } from '../../../enums/accrual.js';
import type { JtlRecordType } from '../../../enums/accrual.js';

export function marketplaceTxnToEventType(txnType: string): BusinessEventType {
  switch (txnType as MarketplaceTxnType) {
    case 'sale_line':
    case 'order':
      return 'SALE';
    case 'fee':
      return 'FEE';
    case 'refund':
      return 'REFUND';
    case 'adjustment':
      return 'ADJUSTMENT';
    case 'settlement':
      return 'SETTLEMENT';
    case 'payout':
      return 'PAYOUT';
    default:
      return 'ADJUSTMENT';
  }
}

export function jtlRecordToEventType(recordType: JtlRecordType, hasMarketplaceMatch: boolean): BusinessEventType {
  if (recordType === 'order') return 'ORDER_CREATED';
  if (recordType === 'invoice_correction') return 'CANCELLATION';
  if (recordType === 'invoice' || recordType === 'sale') {
    return hasMarketplaceMatch ? 'SALE' : 'ORDER_CREATED';
  }
  return 'ORDER_CREATED';
}

export function normalizeMarketplaceOrderId(id: string | null | undefined): string | null {
  if (!id) return null;
  return String(id).trim().toUpperCase();
}
