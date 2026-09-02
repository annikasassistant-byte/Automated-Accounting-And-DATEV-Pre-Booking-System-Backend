import {
  detectDelimiter,
  headerIndexMap,
  parseAmountToCents,
  parseCsv,
  parseGermanDate,
  pickColumn,
} from '../csv.util.js';
import type { JtlRecordType } from '../../../enums/accrual.js';
import type { Marketplace } from '../../../enums/accrual.js';

export type ParsedJtlRow = {
  recordType: JtlRecordType;
  sourceRecordId: string;
  jtlOrderId: string | null;
  jtlInvoiceNumber: string | null;
  marketplaceOrderId: string | null;
  marketplace: Marketplace | null;
  salesChannel: string | null;
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

function detectMarketplace(channel: string): Marketplace | null {
  const c = channel.toLowerCase();
  if (c.includes('amazon') || c.includes('amzn')) return 'amazon';
  if (c.includes('back') && c.includes('market')) return 'backmarket';
  if (c.includes('refurbed')) return 'refurbed';
  return null;
}

function detectRecordType(raw: string): JtlRecordType {
  const s = raw.toLowerCase();
  if (s.includes('korrektur') || s.includes('correction') || s.includes('storno')) {
    return 'invoice_correction';
  }
  if (s.includes('rechnung') || s.includes('invoice')) return 'invoice';
  if (s.includes('auftrag') || s.includes('order')) return 'order';
  return 'sale';
}

export function parseJtlCsv(content: string): JtlParseResult {
  const delim = detectDelimiter(content.slice(0, 2000));
  const table = parseCsv(content, delim);
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
    const orderId = pickColumn(map, cols, ['auftragsnummer', 'order_id', 'order', 'bestellnummer']);
    const mpOrderId = pickColumn(map, cols, [
      'marketplace_order_id',
      'marktplatz_bestellnummer',
      'amazon_bestellnummer',
      'externe_bestellnummer',
      'external_order_id',
    ]);
    const channel = pickColumn(map, cols, ['kanal', 'channel', 'shop', 'verkaufskanal']);
    const typeRaw = pickColumn(map, cols, ['typ', 'type', 'belegtyp']) || 'sale';
    const invoiceDateRaw = pickColumn(map, cols, ['rechnungsdatum', 'invoice_date', 'datum']);
    const orderDateRaw = pickColumn(map, cols, ['auftragsdatum', 'order_date']);
    const netRaw = pickColumn(map, cols, ['netto', 'net', 'net_amount']);
    const vatRaw = pickColumn(map, cols, ['ust', 'vat', 'mwst']);
    const grossRaw = pickColumn(map, cols, ['brutto', 'gross', 'gesamt']);
    const currency = pickColumn(map, cols, ['währung', 'currency']) || 'EUR';

    const invoiceDate = parseGermanDate(invoiceDateRaw);
    const orderDate = parseGermanDate(orderDateRaw);
    const eventDate = invoiceDate || orderDate;
    if (eventDate) {
      if (!periodStart || eventDate < periodStart) periodStart = eventDate;
      if (!periodEnd || eventDate > periodEnd) periodEnd = eventDate;
    }

    const sourceRecordId = invoiceNo || orderId || `jtl-row-${i}`;
    const marketplace = channel ? detectMarketplace(channel) : null;

    rows.push({
      recordType: detectRecordType(typeRaw),
      sourceRecordId,
      jtlOrderId: orderId || null,
      jtlInvoiceNumber: invoiceNo || null,
      marketplaceOrderId: mpOrderId || null,
      marketplace,
      salesChannel: channel || null,
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

export default parseJtlCsv;
