import { formatEuroDE, sha256 } from './csv.util.js';

export type DatevBookingRow = {
  amountCents: number;
  sollHaben: 'S' | 'H';
  konto: string;
  gegenkonto: string;
  buKey?: string | null;
  belegdatum: Date;
  belegfeld1?: string;
  buchungstext?: string;
};

export type DatevHeaderParams = {
  advisorNumber: string;
  clientNumber: string;
  periodStart: Date;
  periodEnd: Date;
  createdAt?: Date;
  description?: string;
};

function padDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}${mm}${yyyy}`;
}

function belegdatumShort(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}${mm}`;
}

function csvEscape(value: string): string {
  const s = String(value ?? '');
  if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * LexOffice-compatible EXTF Buchungsstapel (format 700, category 21, SKR 03).
 * Delimiter `;`. Empty unused columns.
 */
export function buildDatevExtf(
  rows: DatevBookingRow[],
  header: DatevHeaderParams,
): { content: string; fileName: string; fileHash: string; rowCount: number } {
  const created = header.createdAt || new Date();
  const desc = header.description || 'Buchungsstapel';

  // Header aligned with LexOffice EXTF samples
  const headerLine = [
    'EXTF',
    '700',
    '21',
    'Buchungsstapel',
    '9',
    padDate(created),
    '', // timestamp time optional
    '',
    '',
    '',
    csvEscape(header.advisorNumber || ''),
    csvEscape(header.clientNumber || ''),
    padDate(header.periodStart),
    padDate(header.periodEnd),
    '""',
    '"03"',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '"EUR"',
    '',
    csvEscape(desc),
  ].join(';');

  // Column titles (LexOffice-style abbreviated set — unused left empty in data rows)
  const columnHeader = [
    'Umsatz (ohne Soll/Haben-Kz)',
    'Soll/Haben-Kennzeichen',
    'WKZ Umsatz',
    'Kurs',
    'Basis-Umsatz',
    'WKZ Basis-Umsatz',
    'Konto',
    'Gegenkonto (ohne BU-Schlüssel)',
    'BU-Schlüssel',
    'Belegdatum',
    'Belegfeld 1',
    'Belegfeld 2',
    'Skonto',
    'Buchungstext',
  ].join(';');

  const dataLines = rows.map((r) => {
    const umsatz = formatEuroDE(Math.abs(r.amountCents));
    const sh = r.sollHaben || (r.amountCents < 0 ? 'S' : 'H');
    const bu = r.buKey ?? '';
    const cells = [
      umsatz,
      sh,
      '',
      '',
      '',
      '',
      r.konto,
      r.gegenkonto,
      bu,
      belegdatumShort(r.belegdatum),
      csvEscape(r.belegfeld1 || ''),
      '',
      '',
      csvEscape((r.buchungstext || '').slice(0, 60)),
    ];
    return cells.join(';');
  });

  const content = `\uFEFF${headerLine}\n${columnHeader}\n${dataLines.join('\n')}\n`;
  const from = header.periodStart.toISOString().slice(0, 10);
  const to = header.periodEnd.toISOString().slice(0, 10);
  const fileName = `EXTF_Buchungsstapel_${from}_${to}.csv`;
  return {
    content,
    fileName,
    fileHash: sha256(content),
    rowCount: rows.length,
  };
}

export function validateDatevRows(
  rows: DatevBookingRow[],
  forbiddenCollectives: string[] = ['10001', '70002'],
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const forbidden = new Set(forbiddenCollectives.map(String));
  if (!rows.length) errors.push('Keine Buchungszeilen für Export');
  for (const [i, r] of rows.entries()) {
    if (!r.konto) errors.push(`Zeile ${i + 1}: Konto fehlt`);
    if (!r.gegenkonto) errors.push(`Zeile ${i + 1}: Gegenkonto fehlt`);
    if (!r.amountCents) errors.push(`Zeile ${i + 1}: Betrag fehlt`);
    if (forbidden.has(String(r.konto)) || forbidden.has(String(r.gegenkonto))) {
      errors.push(
        `Zeile ${i + 1}: LexOffice-Sammelkonto ${[...forbidden].join('/')} ist verboten (S12)`,
      );
    }
  }
  return { errors, warnings };
}
