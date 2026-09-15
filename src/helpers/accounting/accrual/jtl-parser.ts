import ExcelJS from 'exceljs';
import {
  detectDelimiter,
  headerIndexMap,
  parseAmountToCents,
  parseCsv,
  parseGermanDate,
  pickColumn,
  pickFirstNonEmpty,
} from '../csv.util.js';
import type { JtlRecordType } from '../../../enums/accrual.js';
import type { Marketplace } from '../../../enums/accrual.js';
import { isJtlChannelReview, resolveJtlMarketplace } from './jtl-channel-map.js';

export type ParsedJtlRow = {
  recordType: JtlRecordType;
  sourceRecordId: string;
  jtlOrderId: string | null;
  jtlInvoiceNumber: string | null;
  relatedInvoiceNumber: string | null;
  marketplaceOrderId: string | null;
  marketplace: Marketplace | null;
  salesChannel: string | null;
  channelNeedsReview: boolean;
  orderDate: Date | null;
  invoiceDate: Date | null;
  netAmountCents: number | null;
  vatAmountCents: number | null;
  grossAmountCents: number | null;
  currency: string;
  rawRow: Record<string, string>;
};

export type JtlParseResult = {
  rows: ParsedJtlRow[];
  errors: { row: number; message: string }[];
  periodStart: Date | null;
  periodEnd: Date | null;
};

function detectRecordType(raw: string): JtlRecordType {
  const s = raw.toLowerCase();
  if (s.includes('korrektur') || s.includes('correction') || s.includes('storno')) {
    return 'invoice_correction';
  }
  if (s.includes('rechnung') || s.includes('invoice')) return 'invoice';
  if (s.includes('auftrag') || s.includes('order')) return 'order';
  return 'sale';
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object' && value && 'text' in (value as object)) {
    return String((value as { text?: string }).text ?? '');
  }
  if (typeof value === 'object' && value && 'result' in (value as object)) {
    return cellToString((value as { result?: unknown }).result);
  }
  return String(value);
}

export function parseJtlTable(table: string[][]): JtlParseResult {
  const errors: { row: number; message: string }[] = [];
  const rows: ParsedJtlRow[] = [];
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;

  if (table.length < 2) {
    return { rows, errors: [{ row: 0, message: 'Leere JTL-CSV' }], periodStart, periodEnd };
  }

  const header = table[0];
  const map = headerIndexMap(header);

  for (let i = 1; i < table.length; i += 1) {
    const cols = table[i];
    const rawRow: Record<string, string> = {};
    header.forEach((h, idx) => {
      rawRow[h] = cols[idx] ?? '';
    });

    const invoiceNo = pickColumn(map, cols, [
      'rechnungsnummer',
      'invoice',
      'invoice_number',
      'rechnung',
    ]);
    const creditNo = pickColumn(map, cols, ['gutschriftsnummer', 'gutschrift']);
    const relatedInvoiceNumber =
      pickColumn(map, cols, [
        'bezug rechnungsnummer',
        'bezug_rechnungsnummer',
        'original_invoice',
        'originalrechnung',
      ]) || null;
    const orderId = pickColumn(map, cols, [
      'auftragsnummer',
      'order_id',
      'order',
      'bestellnummer',
    ]);
    const mpOrderId = pickColumn(map, cols, [
      'marketplace_order_id',
      'marktplatz_bestellnummer',
      'amazon_bestellnummer',
      'externe_bestellnummer',
      'externe_belegnummer',
      'external_order_id',
      'externe belegnummer',
      'externe bestellnummer',
    ]);
    const channel = pickFirstNonEmpty(map, cols, [
      'shop',
      'marktplatz',
      'kanal',
      'channel',
      'verkaufskanal',
      'plattform',
    ]);
    const typeRaw = pickColumn(map, cols, ['typ', 'type', 'belegtyp']) || '';
    const invoiceDateRaw = pickColumn(map, cols, [
      'rechnungsdatum',
      'invoice_date',
      'erstelldatum_rechnung',
      'erstelldatum rechnung',
      'erstelldatum',
      'datum',
    ]);
    const orderDateRaw = pickColumn(map, cols, [
      'auftragsdatum',
      'order_date',
      'erstelldatum_bestellung',
      'erstelldatum bestellung',
    ]);
    const netRaw = pickColumn(map, cols, ['netto', 'net', 'net_amount']);
    const vatRaw = pickColumn(map, cols, ['ust', 'vat', 'mwst']);
    const grossRaw = pickColumn(map, cols, [
      'brutto',
      'gross',
      'gesamt',
      'gesamtbetrag',
      'gesamtbetrag brutto (alle ust.)',
      'gesamtbetrag brutto',
      'brutto-vk',
      'betrag brutto (2 nachkommastellen)',
    ]);
    const currency = pickColumn(map, cols, ['währung', 'currency', 'auftragswährung']) || 'EUR';

    const invoiceDate = parseGermanDate(invoiceDateRaw);
    const orderDate = parseGermanDate(orderDateRaw);
    const eventDate = invoiceDate || orderDate;
    if (eventDate) {
      if (!periodStart || eventDate < periodStart) periodStart = eventDate;
      if (!periodEnd || eventDate > periodEnd) periodEnd = eventDate;
    }

    let recordType = detectRecordType(typeRaw);
    if (!typeRaw) {
      if (creditNo || relatedInvoiceNumber) {
        recordType = 'invoice_correction';
      } else if (invoiceNo) {
        recordType = 'invoice';
      } else if (orderId || mpOrderId) {
        recordType = 'order';
      }
    }

    const sourceRecordId =
      invoiceNo ||
      creditNo ||
      (mpOrderId && orderId ? `${orderId}:${mpOrderId}:${i}` : null) ||
      orderId ||
      `jtl-row-${i}`;
    const channelNeedsReview = isJtlChannelReview(channel);
    const marketplace = resolveJtlMarketplace(channel, mpOrderId);

    rows.push({
      recordType,
      sourceRecordId,
      jtlOrderId: orderId || null,
      jtlInvoiceNumber: invoiceNo || creditNo || null,
      relatedInvoiceNumber: relatedInvoiceNumber || null,
      marketplaceOrderId: mpOrderId || null,
      marketplace,
      salesChannel: channel || null,
      channelNeedsReview,
      orderDate,
      invoiceDate,
      netAmountCents: parseAmountToCents(netRaw),
      vatAmountCents: parseAmountToCents(vatRaw),
      grossAmountCents: parseAmountToCents(grossRaw),
      currency: currency.toUpperCase(),
      rawRow,
    });
  }

  return { rows, errors, periodStart, periodEnd };
}

export function parseJtlCsv(content: string): JtlParseResult {
  const delim = detectDelimiter(content.slice(0, 2000));
  const table = parseCsv(content, delim);
  return parseJtlTable(table);
}

function worksheetLooksLikeJtl(header: string[]): boolean {
  const joined = header.join(' ').toLowerCase();
  return (
    joined.includes('rechnungsnummer') ||
    joined.includes('gutschriftsnummer') ||
    joined.includes('auftragsnummer') ||
    joined.includes('bestellnummer') ||
    joined.includes('externe bestellnummer') ||
    joined.includes('externe belegnummer')
  );
}

export async function parseJtlXlsx(buffer: Buffer): Promise<JtlParseResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return {
      rows: [],
      errors: [{ row: 0, message: 'JTL-Excel ist ungültig oder beschädigt' }],
      periodStart: null,
      periodEnd: null,
    };
  }

  let chosen: string[][] | null = null;
  for (const sheet of workbook.worksheets) {
    const name = String(sheet.name || '').toLowerCase();
    if (name.includes('hinweis') || name.includes('regel')) continue;
    const table: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      table.push(values.map((v) => cellToString(v)));
    });
    if (table.length < 2) continue;
    if (worksheetLooksLikeJtl(table[0])) {
      chosen = table;
      break;
    }
  }

  if (!chosen) {
    return {
      rows: [],
      errors: [
        {
          row: 0,
          message: 'Keine JTL-Datentabelle in der Excel-Datei (Rechnungsnummer/Auftragsnummer fehlt)',
        },
      ],
      periodStart: null,
      periodEnd: null,
    };
  }

  return parseJtlTable(chosen);
}

export default parseJtlCsv;
