import {
  bankFingerprint,
  headerIndexMap,
  parseAmountToCents,
  parseCsv,
  parseGermanDate,
  pickColumn,
  sha256,
} from './csv.util.js';

export type ParsedBankRow = {
  bookingDate: Date;
  valueDate: Date | null;
  amountCents: number;
  currency: string;
  counterpartyName: string;
  counterpartyIban: string | null;
  purpose: string;
  rawDescription: string;
  bookingText: string | null;
  mandateRef: string | null;
  creditorId: string | null;
  customerRef: string | null;
  fingerprint: string;
  rawRowHash: string;
  rawRow: Record<string, string>;
};

export type BankParseResult = {
  rows: ParsedBankRow[];
  errors: { row: number; message: string }[];
  periodStart: Date | null;
  periodEnd: Date | null;
};

/**
 * Parse VR-Bank / German bank CSV (semicolon, DE headers).
 */
export function parseBankCsv(content: string): BankParseResult {
  const table = parseCsv(content, ';');
  if (table.length < 2) {
    return { rows: [], errors: [{ row: 0, message: 'Leere oder ungültige Bank-CSV' }], periodStart: null, periodEnd: null };
  }

  // Some bank exports have meta lines before the header — find header row
  let headerIdx = 0;
  for (let i = 0; i < Math.min(15, table.length); i += 1) {
    const joined = table[i].join(';').toLowerCase();
    if (
      joined.includes('buchungstag') ||
      joined.includes('valuta') ||
      (joined.includes('betrag') && joined.includes('verwendungszweck'))
    ) {
      headerIdx = i;
      break;
    }
  }

  const header = table[headerIdx];
  const map = headerIndexMap(header);
  const rows: ParsedBankRow[] = [];
  const errors: { row: number; message: string }[] = [];
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;

  for (let i = headerIdx + 1; i < table.length; i += 1) {
    const cols = table[i];
    const rawRow: Record<string, string> = {};
    header.forEach((h, idx) => {
      rawRow[h] = cols[idx] ?? '';
    });

    const bookingRaw = pickColumn(map, cols, [
      'buchungstag',
      'buchungsdatum',
      'datum',
      'date',
      'wertstellung',
    ]);
    const valueRaw = pickColumn(map, cols, ['valuta', 'wertstellung', 'value date', 'valuedate']);
    const amountRaw = pickColumn(map, cols, ['betrag', 'umsatz', 'amount']);
    const currency = pickColumn(map, cols, ['währung', 'waehrung', 'currency']) || 'EUR';
    const name = pickColumn(map, cols, [
      'name zahlungsbeteiligter',
      'auftraggeber/empfänger',
      'auftraggeber / empfänger',
      'empfänger',
      'auftraggeber',
      'name',
      'counterparty',
    ]);
    const iban = pickColumn(map, cols, [
      'iban',
      'iban zahlungsbeteiligter',
      'konto/iban',
      'kontonummer/iban',
    ]);
    const purpose = pickColumn(map, cols, [
      'verwendungszweck',
      'buchungstext',
      'purpose',
      'description',
    ]);
    const bookingText = pickColumn(map, cols, ['buchungstext', 'umsatzart', 'vorgang']);
    const mandateRef = pickColumn(map, cols, ['mandatsreferenz', 'mandate']);
    const creditorId = pickColumn(map, cols, ['gläubiger-id', 'glaeubiger-id', 'creditor id']);
    const customerRef = pickColumn(map, cols, ['kundenreferenz', 'end-to-end-ref.', 'referenz']);

    const bookingDate = parseGermanDate(bookingRaw);
    const amountCents = parseAmountToCents(amountRaw);

    if (!bookingDate || amountCents === null) {
      errors.push({ row: i + 1, message: `Ungültiges Datum/Betrag: ${bookingRaw} / ${amountRaw}` });
      continue;
    }

    if (currency && currency.toUpperCase() !== 'EUR') {
      // Keep EUR only — skip non-EUR bank rows with warning
      errors.push({ row: i + 1, message: `Nicht-EUR übersprungen (${currency})` });
      continue;
    }

    const fingerprint = bankFingerprint({
      bookingDate,
      amountCents,
      counterpartyIban: iban,
      counterpartyName: name,
      purpose,
    });
    const rawRowHash = sha256(JSON.stringify(rawRow));

    if (!periodStart || bookingDate < periodStart) periodStart = bookingDate;
    if (!periodEnd || bookingDate > periodEnd) periodEnd = bookingDate;

    rows.push({
      bookingDate,
      valueDate: parseGermanDate(valueRaw),
      amountCents,
      currency: 'EUR',
      counterpartyName: name,
      counterpartyIban: iban || null,
      purpose,
      rawDescription: [bookingText, purpose, name].filter(Boolean).join(' | '),
      bookingText: bookingText || null,
      mandateRef: mandateRef || null,
      creditorId: creditorId || null,
      customerRef: customerRef || null,
      fingerprint,
      rawRowHash,
      rawRow,
    });
  }

  return { rows, errors, periodStart, periodEnd };
}
