import {
    headerIndexMap,
    parseAmountToCents,
    parseCsv,
    parseGermanDate,
    paypalFingerprint,
    pickColumn,
    pickFirstNonEmpty,
    sha256,
} from './csv.util.js';

import { DEFAULT_SYSTEM_POLICY } from './system-policy-defaults.js';

/** S1 — PayPal types safe to exclude when balance still reconciles (default seed). */
export const PAYPAL_EXCLUDE_TYPES = DEFAULT_SYSTEM_POLICY.paypalExcludeTypes;

export type PaypalParseOptions = {
  excludeTypes?: string[];
  /** When false, never mark rows as skipped for S1 exclude types. */
  enableExcludeTypes?: boolean;
  /** When false, do not demote excludes to balance_only for S2 integrity. */
  enableGuthabenIntegrity?: boolean;
};

export type ParsedPaypalRow = {
  bookingDate: Date;
  valueDate: Date | null;
  amountCents: number;
  currency: string;
  counterpartyName: string;
  counterpartyEmail: string | null;
  purpose: string;
  article: string | null;
  subject: string | null;
  note: string | null;
  rawDescription: string;
  transactionCode: string;
  type: string;
  status: string;
  feeCents: number | null;
  relatedTransactionCode: string | null;
  guthabenAfter: number | null;
  fingerprint: string;
  rawRowHash: string;
  rawRow: Record<string, string>;
  bookability: 'bookable' | 'skipped' | 'balance_only';
  skipReason: string | null;
};

export type PaypalParseResult = {
  rows: ParsedPaypalRow[];
  errors: { row: number; message: string }[];
  periodStart: Date | null;
  periodEnd: Date | null;
  balanceCheck: {
    expectedGuthaben: number | null;
    calculatedGuthaben: number | null;
    matched: boolean | null;
    note: string | null;
  };
};

function isExcludedType(type: string, excludeTypes: string[]): boolean {
  const t = type.trim().toLowerCase();
  return excludeTypes.some((x) => t === x.toLowerCase());
}

/**
 * Parse PayPal DE CSV. Retains EUR amounts only (S3). Soft-exclude types (S1/S2)
 * with balance integrity check against last Guthaben.
 * Exclude-type lists come from admin system policies (defaults = former hard-coded).
 */
export function parsePaypalCsv(content: string, options: PaypalParseOptions = {}): PaypalParseResult {
  const excludeTypes =
    options.excludeTypes?.length ? options.excludeTypes : [...PAYPAL_EXCLUDE_TYPES];
  const enableExclude = options.enableExcludeTypes !== false;
  const enableIntegrity = options.enableGuthabenIntegrity !== false;
  const table = parseCsv(content, ',');
  // PayPal DE often uses comma; some exports use semicolon — try both
  const table2 = table.length >= 2 && table[0].length < 5 ? parseCsv(content, ';') : table;
  const data = table2.length > table.length ? table2 : table2[0]?.length >= table[0]?.length ? table2 : table;

  if (data.length < 2) {
    return {
      rows: [],
      errors: [{ row: 0, message: 'Leere oder ungültige PayPal-CSV' }],
      periodStart: null,
      periodEnd: null,
      balanceCheck: { expectedGuthaben: null, calculatedGuthaben: null, matched: null, note: null },
    };
  }

  let headerIdx = 0;
  for (let i = 0; i < Math.min(10, data.length); i += 1) {
    const joined = data[i].join('|').toLowerCase();
    if (joined.includes('datum') && (joined.includes('brutto') || joined.includes('netto') || joined.includes('betrag'))) {
      headerIdx = i;
      break;
    }
    if (joined.includes('date') && joined.includes('gross')) {
      headerIdx = i;
      break;
    }
  }

  const header = data[headerIdx];
  const map = headerIndexMap(header);
  const rows: ParsedPaypalRow[] = [];
  const errors: { row: number; message: string }[] = [];
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;

  // Collect chronological rows for balance chain (PayPal files are often newest-first)
  type Interim = ParsedPaypalRow & { _order: number };
  const interim: Interim[] = [];

  for (let i = headerIdx + 1; i < data.length; i += 1) {
    const cols = data[i];
    const rawRow: Record<string, string> = {};
    header.forEach((h, idx) => {
      rawRow[h] = cols[idx] ?? '';
    });

    const dateRaw = pickColumn(map, cols, ['datum', 'date']);
    const timeRaw = pickColumn(map, cols, ['uhrzeit', 'time']);
    const name = pickColumn(map, cols, ['name', 'name des käufers', 'absender', 'empfaenger']);
    const type = pickColumn(map, cols, ['typ', 'type']);
    const status = pickColumn(map, cols, ['status']);
    const currency = (pickColumn(map, cols, ['währung', 'waehrung', 'currency']) || 'EUR').toUpperCase();
    const grossRaw = pickColumn(map, cols, ['brutto', 'gross', 'betrag', 'amount']);
    const feeRaw = pickColumn(map, cols, ['gebühr', 'gebuehr', 'fee']);
    const netRaw = pickColumn(map, cols, ['netto', 'net']);
    const txnCode = pickColumn(map, cols, ['transaktionscode', 'transaction id', 'transactionid']);
    const articleTitle = pickFirstNonEmpty(map, cols, ['artikelbezeichnung', 'article title']);
    const subject = pickFirstNonEmpty(map, cols, ['betreff', 'subject']);
    const note = pickFirstNonEmpty(map, cols, ['hinweis', 'note']);
    const article = articleTitle || null;
    const email = pickColumn(map, cols, ['absender e-mail-adresse', 'empfaenger e-mail-adresse', 'from email address', 'to email address', 'e-mail']);
    const guthabenRaw = pickColumn(map, cols, ['guthaben', 'balance', 'available balance']);
    const related = pickColumn(map, cols, ['zugehöriger transaktionscode', 'zugehoeriger transaktionscode', 'reference txn id']);

    // S3: EUR only — non-EUR rows still may appear in FX; use EUR amount columns if present
    let amountCents = parseAmountToCents(grossRaw);
    if (currency !== 'EUR') {
      // Prefer EUR equivalent columns if present
      const eurGross = pickColumn(map, cols, ['brutto in euro', 'gross in euro']);
      const eurAlt = parseAmountToCents(eurGross);
      if (eurAlt !== null) {
        amountCents = eurAlt;
      } else {
        // skip non-EUR without EUR amount
        errors.push({ row: i + 1, message: `Nicht-EUR ohne EUR-Betrag übersprungen (${currency})` });
        continue;
      }
    }

    const bookingDate = parseGermanDate(dateRaw);
    if (!bookingDate || amountCents === null) {
      errors.push({ row: i + 1, message: `Ungültiges Datum/Betrag in Zeile` });
      continue;
    }

    // Attach time if present (for ordering)
    if (timeRaw) {
      const tm = timeRaw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (tm) {
        bookingDate.setUTCHours(+tm[1], +tm[2], +(tm[3] || 0), 0);
      }
    }

    const feeCents = feeRaw ? parseAmountToCents(feeRaw) : null;
    const guthabenAfter = guthabenRaw ? parseAmountToCents(guthabenRaw) : null;
    const purposeParts = [articleTitle, subject, note].filter(Boolean);
    const uniquePurpose = [...new Set(purposeParts)];
    const purpose = uniquePurpose.join(' — ') || type;
    const rawDescription = [type, ...uniquePurpose].filter(Boolean).join(' — ');
    const fingerprint = paypalFingerprint(txnCode, `${dateRaw}|${amountCents}|${name}|${type}`);
    const rawRowHash = sha256(JSON.stringify(rawRow));

    const excluded = enableExclude && isExcludedType(type, excludeTypes);
    // Keep refunds (S4)
    let bookability: ParsedPaypalRow['bookability'] = 'bookable';
    let skipReason: string | null = null;
    if (excluded) {
      bookability = 'skipped';
      skipReason = `PayPal-Typ ausgeschlossen (S1): ${type}`;
    }

    if (!periodStart || bookingDate < periodStart) periodStart = bookingDate;
    if (!periodEnd || bookingDate > periodEnd) periodEnd = bookingDate;

    interim.push({
      bookingDate,
      valueDate: null,
      amountCents,
      currency: 'EUR',
      counterpartyName: name,
      counterpartyEmail: email || null,
      purpose,
      article: article || null,
      subject: subject || null,
      note: note || null,
      rawDescription,
      transactionCode: txnCode,
      type,
      status,
      feeCents,
      relatedTransactionCode: related || null,
      guthabenAfter: guthabenAfter !== null ? guthabenAfter / 100 : null,
      fingerprint,
      rawRowHash,
      rawRow,
      bookability,
      skipReason,
      _order: i,
    });

    // silence unused
    void netRaw;
  }

  // Balance integrity (S2): integer-cent chain including Gebühr (Netto = Brutto + Gebühr).
  // Brutto-only left a real +2¢ gap on July 2026 (two −1¢ fee rows).
  const withBalance = interim.filter((r) => r.guthabenAfter !== null);
  let expectedGuthaben: number | null = null;
  let calculatedGuthaben: number | null = null;
  let matched: boolean | null = null;
  let note: string | null = null;

  const rowDeltaCents = (r: { amountCents: number; feeCents: number | null }) =>
    r.amountCents + (r.feeCents ?? 0);

  if (interim.length > 0) {
    const chrono = [...interim].sort((a, b) => a.bookingDate.getTime() - b.bookingDate.getTime());
    const lastInFile = interim[0]; // CSV usually newest-first
    const newest = [...interim].sort((a, b) => b.bookingDate.getTime() - a.bookingDate.getTime())[0];
    const expectedCents =
      newest?.guthabenAfter != null
        ? Math.round(newest.guthabenAfter * 100)
        : lastInFile?.guthabenAfter != null
          ? Math.round(lastInFile.guthabenAfter * 100)
          : null;
    expectedGuthaben = expectedCents != null ? expectedCents / 100 : null;

    const oldest = chrono[0];
    if (oldest?.guthabenAfter != null && expectedCents != null) {
      const oldestAfterCents = Math.round(oldest.guthabenAfter * 100);
      let runningCents = oldestAfterCents - rowDeltaCents(oldest);
      for (const r of chrono) {
        runningCents += rowDeltaCents(r);
      }
      calculatedGuthaben = runningCents / 100;
      matched = runningCents === expectedCents;
      note = matched
        ? 'Guthaben stimmt überein (Brutto+Gebühr, Cent-genau)'
        : `Guthaben-Differenz: berechnet ${calculatedGuthaben}, Datei ${expectedGuthaben} (${runningCents - expectedCents} Cent)`;
    } else if (withBalance.length > 0) {
      note = 'Guthaben-Spalte teilweise vorhanden — Vollprüfung eingeschränkt';
      matched = null;
    }

    // If excluding still breaks balance, demote excludes to balance_only (keep in chain)
    if (enableIntegrity && matched === false) {
      for (const r of interim) {
        if (r.bookability === 'skipped' && isExcludedType(r.type, excludeTypes)) {
          r.bookability = 'balance_only';
          r.skipReason = `${r.skipReason} — beibehalten für Guthaben-Integrität (S2)`;
        }
      }
      note = `${note || ''} | Ausschlüsse als balance_only markiert (Integrität > Filter).`.trim();
    }
  }

  for (const r of interim) {
    const { _order, ...rest } = r;
    void _order;
    rows.push(rest);
  }

  return {
    rows,
    errors,
    periodStart,
    periodEnd,
    balanceCheck: { expectedGuthaben, calculatedGuthaben, matched, note },
  };
}
