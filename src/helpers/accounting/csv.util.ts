import crypto from 'node:crypto';

export function sha256(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function normalizeWhitespace(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizePurpose(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9äöüß€+\-./ ]/gi, '');
}

/** Parse German/EU decimal amounts like "1.234,56" or "-12,50" or "12.50" → cents. */
export function parseAmountToCents(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.round(raw * 100);
  }
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/\s/g, '').replace(/€/g, '');
  const negative = /^-/.test(s) || /^\(.*\)$/.test(String(raw).trim());
  s = s.replace(/[()]/g, '').replace(/^-/, '');
  if (s.includes(',') && s.includes('.')) {
    // 1.234,56 → European
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(Math.abs(n) * 100);
  return negative || String(raw).trim().startsWith('-') ? -cents : cents;
}

/** Parse DE dates: DD.MM.YYYY, YYYY-MM-DD, DD/MM/YYYY */
export function parseGermanDate(raw: unknown): Date | null {
  if (!raw) return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  const s = String(raw).trim();
  if (!s) return null;

  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const fallback = new Date(s);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

export function centsToEuro(cents: number): number {
  return Math.round(cents) / 100;
}

export function formatEuroDE(cents: number): string {
  return centsToEuro(cents).toFixed(2).replace('.', ',');
}

export function detectDelimiter(sample: string): ';' | ',' | '\t' {
  const firstLine = sample.split(/\r?\n/).find((l) => l.trim()) || '';
  const semis = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const tabs = (firstLine.match(/\t/g) || []).length;
  if (tabs >= semis && tabs >= commas && tabs > 0) return '\t';
  if (semis >= commas) return ';';
  return ',';
}

/** Simple CSV parse supporting quotes and chosen delimiter. */
export function parseCsv(content: string, delimiter?: ';' | ',' | '\t'): string[][] {
  const delim = delimiter || detectDelimiter(content);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = '';
  };
  const pushRow = () => {
    // skip fully empty trailing rows
    if (row.length === 1 && row[0] === '' && rows.length === 0) {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    const next = content[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delim) {
      pushCell();
      continue;
    }
    if (ch === '\n') {
      pushCell();
      pushRow();
      continue;
    }
    if (ch === '\r') continue;
    cell += ch;
  }
  if (cell.length || row.length) {
    pushCell();
    pushRow();
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

export function headerIndexMap(headerRow: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headerRow.forEach((h, i) => {
    const key = normalizeWhitespace(h).toLowerCase();
    map.set(key, i);
  });
  return map;
}

export function pickColumn(map: Map<string, number>, row: string[], aliases: string[]): string {
  for (const alias of aliases) {
    const idx = map.get(alias.toLowerCase());
    if (idx !== undefined && row[idx] !== undefined) return String(row[idx] ?? '').trim();
  }
  return '';
}

/** Like pickColumn, but skips blank cells so a later alias (e.g. Betreff) can win. */
export function pickFirstNonEmpty(
  map: Map<string, number>,
  row: string[],
  aliases: string[],
): string {
  for (const alias of aliases) {
    const idx = map.get(alias.toLowerCase());
    if (idx === undefined || row[idx] === undefined) continue;
    const value = String(row[idx] ?? '').trim();
    if (value) return value;
  }
  return '';
}

export function bankFingerprint(input: {
  bookingDate: Date;
  amountCents: number;
  counterpartyIban?: string | null;
  counterpartyName?: string | null;
  purpose?: string | null;
}): string {
  const date = input.bookingDate.toISOString().slice(0, 10);
  const iban = normalizeWhitespace(input.counterpartyIban || '').toUpperCase();
  const name = normalizeWhitespace(input.counterpartyName || '').toLowerCase();
  const purpose = normalizePurpose(input.purpose || '');
  return sha256(`bank|${date}|${input.amountCents}|${iban}|${name}|${purpose}`);
}

export function paypalFingerprint(transactionCode: string, fallback?: string): string {
  const code = normalizeWhitespace(transactionCode);
  if (code) return sha256(`paypal|${code}`);
  return sha256(`paypal|fallback|${fallback || ''}`);
}
