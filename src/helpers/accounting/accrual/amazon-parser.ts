import {
  detectDelimiter,
  headerIndexMap,
  parseAmountToCents,
  parseCsv,
  parseGermanDate,
  pickColumn,
} from '../csv.util.js';
import type { MarketplaceParser, NormalizedMarketplaceLine } from './marketplace-types.js';
import { mapAmazonTransactionType } from './marketplace-types.js';

function updatePeriod(start: Date | null, end: Date | null, d: Date) {
  let ps = start;
  let pe = end;
  if (!ps || d < ps) ps = d;
  if (!pe || d > pe) pe = d;
  return { periodStart: ps, periodEnd: pe };
}

export const amazonParser: MarketplaceParser = {
  marketplace: 'amazon',
  parse(content: string) {
    const delim = detectDelimiter(content.slice(0, 2000));
    const table = parseCsv(content, delim);
    const errors: { row: number; message: string }[] = [];
    const lines: NormalizedMarketplaceLine[] = [];
    let periodStart: Date | null = null;
    let periodEnd: Date | null = null;

    if (table.length < 2) {
      return { lines, errors: [{ row: 0, message: 'Leere Amazon-CSV' }], periodStart, periodEnd };
    }

    const header = table[0];
    const map = headerIndexMap(header);

    for (let i = 1; i < table.length; i += 1) {
      const cols = table[i];
      const rawRow: Record<string, string> = {};
      header.forEach((h, idx) => {
        rawRow[h] = cols[idx] ?? '';
      });

      const dateRaw = pickColumn(map, cols, ['datum', 'date', 'buchungsdatum']);
      const typeRaw = pickColumn(map, cols, ['transaktionstyp', 'transaction type', 'type']);
      const txnId = pickColumn(map, cols, [
        'transaktionsnummer',
        'transaction id',
        'bestellnummer',
        'order id',
      ]);
      const amountRaw = pickColumn(map, cols, ['summe', 'amount', 'betrag', 'gesamt']);
      const currency = pickColumn(map, cols, ['währung', 'currency']) || 'EUR';

      const txnDate = parseGermanDate(dateRaw);
      const amountCents = parseAmountToCents(amountRaw);
      if (!txnDate || amountCents === null) {
        errors.push({ row: i + 1, message: 'Ungültiges Datum/Betrag' });
        continue;
      }

      const txnType = mapAmazonTransactionType(typeRaw || '');
      const sourceRecordId = `${txnId || 'row'}:${typeRaw}:${dateRaw}`.trim();
      ({ periodStart, periodEnd } = updatePeriod(periodStart, periodEnd, txnDate));

      lines.push({
        marketplace: 'amazon',
        txnType,
        sourceRecordId,
        marketplaceOrderId: txnId || null,
        financialTransactionId: txnId || sourceRecordId,
        settlementId: null,
        txnDate,
        description: typeRaw || 'Amazon',
        originalCurrency: currency.toUpperCase(),
        originalAmountCents: amountCents,
        rawRow,
      });
    }

    return { lines, errors, periodStart, periodEnd };
  },
};

export default amazonParser;
