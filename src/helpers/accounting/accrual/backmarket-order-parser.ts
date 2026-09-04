import {
  detectDelimiter,
  headerIndexMap,
  parseAmountToCents,
  parseCsv,
  parseGermanDate,
  pickColumn,
} from '../csv.util.js';
import type { MarketplaceParser } from './marketplace-types.js';

/**
 * Back Market Order Report parser.
 * Creates ORDER_CREATED rows (or CANCELLATION when cancelled before fulfilment).
 * Does NOT book revenue from orderline_fee.
 */
export const backmarketOrderParser: MarketplaceParser = {
  marketplace: 'backmarket',
  parse(content: string) {
    const delim = detectDelimiter(content.slice(0, 2000));
    const table = parseCsv(content, delim);
    const errors: { row: number; message: string }[] = [];
    const lines = [];
    let periodStart = null;
    let periodEnd = null;

    if (table.length < 2) {
      return {
        lines,
        errors: [{ row: 0, message: 'Leere Back-Market-Order-CSV' }],
        periodStart,
        periodEnd,
      };
    }

    const header = table[0];
    const map = headerIndexMap(header);
    const seenOrders = new Set<string>();

    for (let i = 1; i < table.length; i += 1) {
      const cols = table[i];
      const rawRow: Record<string, string> = {};
      header.forEach((h, idx) => {
        rawRow[h] = cols[idx] ?? '';
      });

      const orderId = pickColumn(map, cols, ['order_id', 'order id', 'orderid']);
      if (!orderId || seenOrders.has(orderId)) continue;
      seenOrders.add(orderId);

      const dateRaw =
        pickColumn(map, cols, ['date_creation', 'date_payment', 'date_modification', 'date']) || '';
      const shipRaw = pickColumn(map, cols, ['date_shipping', 'shipping_date']) || '';
      const canceledBy = pickColumn(map, cols, ['canceled_by', 'cancelled_by']) || '';
      const amountRaw = pickColumn(map, cols, ['order_price', 'orderline_price', 'amount', 'total']);
      const currency = pickColumn(map, cols, ['currency', 'währung']) || 'EUR';

      const txnDate = parseGermanDate(dateRaw.replace(/\+.*/, '').replace('T', ' ')) || new Date();
      const amountCents = parseAmountToCents(amountRaw);
      if (amountCents === null) {
        errors.push({ row: i + 1, message: 'Ungültiger Betrag' });
        continue;
      }

      const shipped = Boolean(shipRaw && !shipRaw.startsWith('0001') && shipRaw.trim() !== '');
      const cancelledBeforeFulfilment = Boolean(canceledBy?.trim()) && !shipped;

      if (!periodStart || txnDate < periodStart) periodStart = txnDate;
      if (!periodEnd || txnDate > periodEnd) periodEnd = txnDate;

      lines.push({
        marketplace: 'backmarket' as const,
        txnType: 'order',
        sourceRecordId: `bm-order:${orderId}`,
        marketplaceOrderId: orderId,
        financialTransactionId: null,
        settlementId: null,
        txnDate,
        description: cancelledBeforeFulfilment
          ? `BM Order storniert vor Versand ${orderId}`
          : `BM Order ${orderId}`,
        originalCurrency: currency.toUpperCase(),
        originalAmountCents: amountCents,
        rawRow: {
          ...rawRow,
          _cancelBeforeFulfilment: cancelledBeforeFulfilment ? '1' : '0',
          _shipped: shipped ? '1' : '0',
        },
      });
    }

    return { lines, errors, periodStart, periodEnd };
  },
};

export default backmarketOrderParser;
