import {
  detectDelimiter,
  headerIndexMap,
  parseAmountToCents,
  parseCsv,
  parseGermanDate,
  pickColumn,
} from '../csv.util.js';
import type { MarketplaceParser } from './marketplace-types.js';
import { mapBackMarketInvoiceKey } from './marketplace-types.js';

export const backmarketParser: MarketplaceParser = {
  marketplace: 'backmarket',
  parse(content: string) {
    const delim = detectDelimiter(content.slice(0, 2000));
    const table = parseCsv(content, delim);
    const errors: { row: number; message: string }[] = [];
    const lines = [];
    let periodStart = null;
    let periodEnd = null;

    if (table.length < 2) {
      return { lines, errors: [{ row: 0, message: 'Leere Back-Market-CSV' }], periodStart, periodEnd };
    }

    const header = table[0];
    const map = headerIndexMap(header);

    for (let i = 1; i < table.length; i += 1) {
      const cols = table[i];
      const rawRow: Record<string, string> = {};
      header.forEach((h, idx) => {
        rawRow[h] = cols[idx] ?? '';
      });

      const orderId = pickColumn(map, cols, ['order_id', 'order id', 'orderid']);
      const invoiceKey = pickColumn(map, cols, ['invoice_key', 'invoice key', 'type']);
      const dateRaw = pickColumn(map, cols, ['date', 'datum', 'invoice_date']);
      const amountRaw = pickColumn(map, cols, ['amount', 'betrag', 'value', 'total']);
      const currency = pickColumn(map, cols, ['currency', 'währung']) || 'SEK';

      const txnDate = parseGermanDate(dateRaw) || new Date();
      const amountCents = parseAmountToCents(amountRaw);
      if (amountCents === null) {
        errors.push({ row: i + 1, message: 'Ungültiger Betrag' });
        continue;
      }

      const txnType = mapBackMarketInvoiceKey(invoiceKey || '');
      const sourceRecordId = `${orderId || 'row'}:${invoiceKey}:${i}`;

      if (!periodStart || txnDate < periodStart) periodStart = txnDate;
      if (!periodEnd || txnDate > periodEnd) periodEnd = txnDate;

      lines.push({
        marketplace: 'backmarket',
        txnType,
        sourceRecordId,
        marketplaceOrderId: orderId || null,
        financialTransactionId: sourceRecordId,
        settlementId: null,
        txnDate,
        description: invoiceKey || 'Back Market',
        originalCurrency: currency.toUpperCase(),
        originalAmountCents: amountCents,
        rawRow,
      });
    }

    return { lines, errors, periodStart, periodEnd };
  },
};

export default backmarketParser;
