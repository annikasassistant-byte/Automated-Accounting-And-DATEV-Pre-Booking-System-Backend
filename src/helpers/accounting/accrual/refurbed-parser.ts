import {
  detectDelimiter,
  headerIndexMap,
  parseAmountToCents,
  parseCsv,
  parseGermanDate,
  pickColumn,
} from '../csv.util.js';
import type { MarketplaceParser } from './marketplace-types.js';
import { mapRefurbedType } from './marketplace-types.js';

export const refurbedParser: MarketplaceParser = {
  marketplace: 'refurbed',
  parse(content: string) {
    const delim = detectDelimiter(content.slice(0, 2000));
    const table = parseCsv(content, delim);
    const errors: { row: number; message: string }[] = [];
    const lines = [];
    let periodStart = null;
    let periodEnd = null;

    if (table.length < 2) {
      return { lines, errors: [{ row: 0, message: 'Leere Refurbed-CSV' }], periodStart, periodEnd };
    }

    const header = table[0];
    const map = headerIndexMap(header);

    for (let i = 1; i < table.length; i += 1) {
      const cols = table[i];
      const rawRow: Record<string, string> = {};
      header.forEach((h, idx) => {
        rawRow[h] = cols[idx] ?? '';
      });

      const transactionId = pickColumn(map, cols, ['transaction_id', 'transaction id', 'id']);
      const orderId = pickColumn(map, cols, ['order_id', 'order id']);
      const typeRaw = pickColumn(map, cols, ['type', 'transaction_type', 'description']);
      const dateRaw = pickColumn(map, cols, [
        'date',
        'datum',
        'created_at',
        'transaction_at',
        'order_at',
      ]);
      const amountRaw = pickColumn(map, cols, ['amount', 'betrag', 'value', 'total']);
      const currency =
        pickColumn(map, cols, ['currency', 'währung', 'amount_currency']) || 'EUR';

      const txnDate = parseGermanDate(dateRaw) || new Date();
      const amountCents = parseAmountToCents(amountRaw);
      if (amountCents === null) {
        errors.push({ row: i + 1, message: 'Ungültiger Betrag' });
        continue;
      }

      const txnType = mapRefurbedType(typeRaw || '');
      const sourceRecordId = transactionId || `${orderId}:${i}`;

      if (!periodStart || txnDate < periodStart) periodStart = txnDate;
      if (!periodEnd || txnDate > periodEnd) periodEnd = txnDate;

      lines.push({
        marketplace: 'refurbed',
        txnType,
        sourceRecordId,
        marketplaceOrderId: orderId || null,
        financialTransactionId: transactionId || sourceRecordId,
        settlementId: null,
        txnDate,
        description: typeRaw || 'Refurbed',
        originalCurrency: currency.toUpperCase(),
        originalAmountCents: amountCents,
        rawRow,
      });
    }

    return { lines, errors, periodStart, periodEnd };
  },
};

export default refurbedParser;
