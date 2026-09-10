import { detectDelimiter, headerIndexMap, parseCsv, pickColumn } from './csv.util.js';

const FORBIDDEN_COLLECTIVE = new Set(['10001', '70002']);

export type LexofficeDatevLine = {
  konto: string;
  gegenkonto: string;
  buKey: string;
  bookingText: string;
  partner: string;
};

function normalizePartner(raw: string): string {
  return raw
    .replace(/['"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/**
 * Parse a LexOffice DATEV EXTF Buchungsstapel into booking lines.
 * Skips the EXTF meta row. Collective SKR 10001 / 70002 are never returned as Konto.
 */
export function parseLexofficeDatev(content: string): LexofficeDatevLine[] {
  const delim = detectDelimiter(content.slice(0, 4000)) || ';';
  const table = parseCsv(content, delim);
  if (table.length < 2) return [];

  let headerIdx = 0;
  for (let i = 0; i < Math.min(table.length, 5); i += 1) {
    const joined = (table[i] || []).join(';').toLowerCase();
    if (joined.includes('konto') && joined.includes('gegenkonto')) {
      headerIdx = i;
      break;
    }
  }

  const header = table[headerIdx];
  const map = headerIndexMap(header);
  const lines: LexofficeDatevLine[] = [];

  for (let i = headerIdx + 1; i < table.length; i += 1) {
    const cols = table[i];
    const konto = (pickColumn(map, cols, ['konto']) || '').replace(/\D/g, '');
    const gegenkonto = (pickColumn(map, cols, ['gegenkonto']) || '').replace(/\D/g, '');
    if (!konto || !gegenkonto) continue;
    if (FORBIDDEN_COLLECTIVE.has(konto) || FORBIDDEN_COLLECTIVE.has(gegenkonto)) continue;

    const bookingText = pickColumn(map, cols, ['buchungstext']) || '';
    const buKey = pickColumn(map, cols, ['bu-schluessel', 'bu-schlüssel', 'bu_schluessel']) || '';

    let partner = '';
    for (const [key, artIdx] of map.entries()) {
      if (!key.includes('beleginfo') || !key.includes('art')) continue;
      const art = String(cols[artIdx] || '').toLowerCase();
      if (!art.includes('geschäftspartner') && !art.includes('geschaeftspartner')) continue;
      const inhaltKey = key.replace('art', 'inhalt');
      const inhaltIdx = map.get(inhaltKey);
      if (inhaltIdx != null) partner = String(cols[inhaltIdx] || '');
      break;
    }
    if (!partner) {
      partner = bookingText.split(/\s+/).slice(0, 3).join(' ');
    }

    lines.push({
      konto,
      gegenkonto,
      buKey,
      bookingText,
      partner: normalizePartner(partner || bookingText),
    });
  }

  return lines;
}

export { FORBIDDEN_COLLECTIVE };
