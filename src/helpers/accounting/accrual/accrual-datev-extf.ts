/**
 * Thin Accrual DATEV EXTF helper — reuses cash column style via datev-writer (import only).
 */
import {
  buildDatevExtf,
  validateDatevRows,
  type DatevBookingRow,
  type DatevHeaderParams,
} from '../datev-writer.js';

export type AccrualDatevLineInput = {
  amountCents: number;
  sollHaben: 'S' | 'H';
  accountNumber: string;
  gegenkonto?: string;
  buKey?: string | null;
  postingDate: Date;
  documentReference?: string;
  bookingText?: string;
};

/**
 * Pair S/H lines into DATEV rows (konto + gegenkonto) when possible;
 * otherwise emit one-sided rows with empty gegenkonto (validation may warn).
 */
export function accrualLinesToDatevRows(lines: AccrualDatevLineInput[]): DatevBookingRow[] {
  const sorted = [...lines].sort((a, b) => {
    const da = a.postingDate?.getTime?.() || 0;
    const db = b.postingDate?.getTime?.() || 0;
    return da - db;
  });

  const rows: DatevBookingRow[] = [];
  const used = new Set<number>();

  for (let i = 0; i < sorted.length; i += 1) {
    if (used.has(i)) continue;
    const a = sorted[i];
    let paired = -1;
    for (let j = i + 1; j < sorted.length; j += 1) {
      if (used.has(j)) continue;
      const b = sorted[j];
      if (
        a.sollHaben !== b.sollHaben &&
        Math.abs(a.amountCents) === Math.abs(b.amountCents) &&
        a.postingDate?.getTime?.() === b.postingDate?.getTime?.()
      ) {
        paired = j;
        break;
      }
    }
    if (paired >= 0) {
      const b = sorted[paired];
      used.add(i);
      used.add(paired);
      rows.push({
        amountCents: Math.abs(a.amountCents),
        sollHaben: a.sollHaben,
        konto: a.accountNumber,
        gegenkonto: b.accountNumber,
        buKey: a.buKey || b.buKey || null,
        belegdatum: a.postingDate,
        belegfeld1: a.documentReference || '',
        buchungstext: a.bookingText || b.bookingText || '',
      });
    } else {
      used.add(i);
      rows.push({
        amountCents: Math.abs(a.amountCents),
        sollHaben: a.sollHaben,
        konto: a.accountNumber,
        gegenkonto: a.gegenkonto || '',
        buKey: a.buKey || null,
        belegdatum: a.postingDate,
        belegfeld1: a.documentReference || '',
        buchungstext: a.bookingText || '',
      });
    }
  }
  return rows;
}

export function buildAccrualDatevExtf(
  lines: AccrualDatevLineInput[],
  header: DatevHeaderParams,
): { content: string; fileName: string; fileHash: string; rowCount: number; rows: DatevBookingRow[] } {
  const rows = accrualLinesToDatevRows(lines);
  const extf = buildDatevExtf(rows, {
    ...header,
    description: header.description || 'Accrual Buchungsstapel',
  });
  return { ...extf, rows };
}

export { validateDatevRows, buildDatevExtf };
