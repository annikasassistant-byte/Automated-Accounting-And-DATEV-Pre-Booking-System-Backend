import {
  detectDelimiter,
  headerIndexMap,
  parseAmountToCents,
  parseCsv,
  parseGermanDate,
  pickColumn,
} from '../csv.util.js';
import type { MarketplaceParser, NormalizedMarketplaceLine } from './marketplace-types.js';

function updatePeriod(start: Date | null, end: Date | null, d: Date) {
  let ps = start;
  let pe = end;
  if (!ps || d < ps) ps = d;
  if (!pe || d > pe) pe = d;
  return { periodStart: ps, periodEnd: pe };
}

function isCancelled(status: string) {
  return status.toLowerCase().includes('cancel');
}

function isShipped(status: string) {
  const s = status.toLowerCase();
  return s.includes('ship') || s.includes('complete');
}

/**
 * Amazon _GET_FLAT_FILE_ALL_ORDERS_DATA_ report (tab or comma).
 * One line per amazon-order-id. Cancelled Amazon orders never become revenue.
 */
export const amazonOrderParser: MarketplaceParser = {
  marketplace: 'amazon',
  parse(content: string) {
    const delim = detectDelimiter(content.slice(0, 2500));
    const table = parseCsv(content, delim);
    const errors: { row: number; message: string }[] = [];
    const lines: NormalizedMarketplaceLine[] = [];
    let periodStart: Date | null = null;
    let periodEnd: Date | null = null;

    if (table.length < 2) {
      return { lines, errors: [{ row: 0, message: 'Leerer Amazon-Bestellreport' }], periodStart, periodEnd };
    }

    const header = table[0];
    const map = headerIndexMap(header);
    const byOrder = new Map<
      string,
      {
        cancelled: boolean;
        shipped: boolean;
        amountCents: number;
        currency: string;
        date: Date;
        description: string;
        rawRow: Record<string, string>;
      }
    >();

    for (let i = 1; i < table.length; i += 1) {
      const cols = table[i];
      const rawRow: Record<string, string> = {};
      header.forEach((h, idx) => {
        rawRow[h] = cols[idx] ?? '';
      });

      const orderId = pickColumn(map, cols, [
        'amazon-order-id',
        'amazon order id',
        'bestellnummer',
        'order-id',
        'order id',
      ]);
      if (!orderId) {
        errors.push({ row: i + 1, message: 'Keine Amazon-Bestellnummer' });
        continue;
      }

      const status = pickColumn(map, cols, ['order-status', 'order status', 'status']);
      const dateRaw = pickColumn(map, cols, [
        'purchase-date',
        'purchase date',
        'last-updated-date',
        'datum',
      ]);
      const txnDate = parseGermanDate(dateRaw);
      if (!txnDate) {
        errors.push({ row: i + 1, message: 'Ungültiges Bestelldatum' });
        continue;
      }

      const currency = (pickColumn(map, cols, ['currency', 'währung']) || 'EUR').toUpperCase();
      const amountCents = parseAmountToCents(pickColumn(map, cols, ['item-price', 'item price', 'item-price-tax'])) || 0;
      const product = pickColumn(map, cols, ['product-name', 'product name', 'sku']);

      const existing = byOrder.get(orderId);
      const cancelled = isCancelled(status);
      const shipped = isShipped(status);
      if (!existing) {
        byOrder.set(orderId, {
          cancelled,
          shipped,
          amountCents: cancelled ? 0 : amountCents,
          currency,
          date: txnDate,
          description: product || `Amazon ${orderId}`,
          rawRow,
        });
      } else {
        existing.cancelled = existing.cancelled || cancelled;
        existing.shipped = existing.shipped || shipped;
        if (!cancelled) existing.amountCents += amountCents;
        if (txnDate < existing.date) existing.date = txnDate;
      }
      ({ periodStart, periodEnd } = updatePeriod(periodStart, periodEnd, txnDate));
    }

    for (const [orderId, row] of byOrder) {
      const cancelled = row.cancelled;
      lines.push({
        marketplace: 'amazon',
        txnType: 'order',
        sourceRecordId: `amazon-order:${orderId}`,
        marketplaceOrderId: orderId,
        financialTransactionId: orderId,
        settlementId: null,
        txnDate: row.date,
        description: cancelled ? `Storniert: ${row.description}` : row.description,
        originalCurrency: row.currency,
        originalAmountCents: row.amountCents,
        eurAmountCents: row.currency === 'EUR' ? row.amountCents : null,
        rawRow: {
          ...row.rawRow,
          _amazonCancelled: cancelled ? '1' : '0',
          _amazonShipped: row.shipped && !cancelled ? '1' : '0',
          'order-status': cancelled ? 'Cancelled' : row.shipped ? 'Shipped' : 'Pending',
        },
      });
    }

    return { lines, errors, periodStart, periodEnd };
  },
};

export default amazonOrderParser;
