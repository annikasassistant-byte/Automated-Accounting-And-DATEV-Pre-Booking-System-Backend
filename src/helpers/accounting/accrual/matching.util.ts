import type { BusinessEventType, MarketplaceTxnType } from '../../../enums/accrual.js';
import type { JtlRecordType } from '../../../enums/accrual.js';

/**
 * Client v5:
 * - order report rows → ORDER_CREATED (not revenue)
 * - sale_line → recognized SALE (order/fulfilment evidence)
 * - settlement → Financial sales/revenue clearing movement (NOT second sale)
 */
export function marketplaceTxnToEventType(txnType: string): BusinessEventType {
  switch (txnType as MarketplaceTxnType) {
    case 'order':
      return 'ORDER_CREATED';
    case 'sale_line':
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
