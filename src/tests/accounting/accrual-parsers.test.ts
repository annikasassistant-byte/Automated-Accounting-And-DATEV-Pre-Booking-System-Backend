import { buildBusinessEventKey, buildMarketplaceTxnKey } from '../../helpers/accounting/accrual/duplicate-guard.js';
import { amazonParser } from '../../helpers/accounting/accrual/amazon-parser.js';
import { amazonOrderParser } from '../../helpers/accounting/accrual/amazon-order-parser.js';
import { refurbedParser } from '../../helpers/accounting/accrual/refurbed-parser.js';
import { parseJtlCsv } from '../../helpers/accounting/accrual/jtl-parser.js';
import {
  marketplaceTxnToEventType,
  jtlRecordToEventType,
} from '../../helpers/accounting/accrual/matching.util.js';
import {
  mapBackMarketInvoiceKey,
  mapRefurbedType,
  detectBackMarketReportType,
  detectAmazonReportType,
} from '../../helpers/accounting/accrual/marketplace-types.js';
import { FxService } from '../../services/accounting/accrual/fx.service.js';
import { parseLexofficeDatev } from '../../helpers/accounting/lexoffice-datev.util.js';

describe('Accrual duplicate guard', () => {
  it('builds stable marketplace keys', () => {
    const a = buildMarketplaceTxnKey('amazon', 'TX-1', 'fee');
    const b = buildMarketplaceTxnKey('amazon', 'TX-1', 'fee');
    expect(a).toBe(b);
    expect(a).not.toBe(buildMarketplaceTxnKey('amazon', 'TX-1', 'sale_line'));
  });

  it('builds stable business event keys', () => {
    const key = buildBusinessEventKey({
      eventType: 'SALE',
      marketplace: 'amazon',
      marketplaceOrderId: '123',
      sourceRecordId: 'row-1',
    });
    expect(key).toHaveLength(64);
  });
});

describe('Amazon parser', () => {
  it('parses settlement rows', () => {
    const csv = [
      'Datum,Transaktionstyp,Transaktionsnummer,Summe,Währung',
      '01.08.2026,Gebühr,AMZ-FEE-1,"-2,50",EUR',
      '02.08.2026,Bestellung,AMZ-ORD-9,"100,00",EUR',
    ].join('\n');
    const result = amazonParser.parse(csv);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].txnType).toBe('fee');
    expect(result.lines[1].txnType).toBe('settlement');
    expect(result.lines[1].originalAmountCents).toBe(10000);
  });
});

describe('Refurbed parser', () => {
  it('maps commission to fee', () => {
    const csv = [
      'transaction_id,order_id,type,date,amount,currency',
      'RF-1,ORD-9,Commission,01.08.2026,"-5,00",EUR',
    ].join('\n');
    const result = refurbedParser.parse(csv);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].txnType).toBe('fee');
  });
});

describe('JTL parser', () => {
  it('detects marketplace order id and channel', () => {
    const csv = [
      'Rechnungsnummer,Auftragsnummer,Marktplatz_Bestellnummer,Kanal,Rechnungsdatum,Brutto',
      'RE-100,AO-50,AMZ-999,Amazon,15.07.2026,"119,00"',
    ].join('\n');
    const result = parseJtlCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].marketplace).toBe('amazon');
    expect(result.rows[0].marketplaceOrderId).toBe('AMZ-999');
    expect(result.rows[0].grossAmountCents).toBe(11900);
  });
});

describe('Matching util', () => {
  it('maps txn types to business events (order ≠ SALE; settlement = clearing)', () => {
    expect(marketplaceTxnToEventType('order')).toBe('ORDER_CREATED');
    expect(marketplaceTxnToEventType('sale_line')).toBe('SALE');
    expect(marketplaceTxnToEventType('settlement')).toBe('SETTLEMENT');
    expect(marketplaceTxnToEventType('fee')).toBe('FEE');
    expect(jtlRecordToEventType('invoice', true)).toBe('SALE');
    expect(jtlRecordToEventType('invoice', false)).toBe('ORDER_CREATED');
  });
});

describe('Back Market type maps', () => {
  it('maps financial sales to settlement (clearing)', () => {
    expect(mapBackMarketInvoiceKey('sales')).toBe('settlement');
    expect(mapBackMarketInvoiceKey('sales_fees')).toBe('fee');
    expect(mapRefurbedType('revenue')).toBe('settlement');
    expect(mapRefurbedType('base_commission')).toBe('fee');
    expect(mapRefurbedType('revenue_reversal')).toBe('refund');
    expect(detectBackMarketReportType('order_id;order_state;order_price')).toBe('order');
    expect(detectBackMarketReportType('invoice_key,value_date,amount')).toBe('financial');
  });
});

describe('Amazon order report', () => {
  it('detects order vs financial and voids cancelled orders', () => {
    expect(detectAmazonReportType('amazon-order-id\torder-status\tpurchase-date')).toBe('order');
    expect(detectAmazonReportType('Datum,Transaktionstyp,Summe (EUR)')).toBe('financial');

    const txt = [
      'amazon-order-id\torder-status\tpurchase-date\titem-price\tcurrency',
      '407-1500559-6228345\tCancelled\t2026-07-02T10:00:00+00:00\t12.00\tEUR',
      '407-1500559-6228346\tShipped\t2026-07-03T10:00:00+00:00\t40.00\tEUR',
    ].join('\n');
    const result = amazonOrderParser.parse(txt);
    expect(result.lines).toHaveLength(2);
    const cancelled = result.lines.find((l) => l.marketplaceOrderId === '407-1500559-6228345');
    const shipped = result.lines.find((l) => l.marketplaceOrderId === '407-1500559-6228346');
    expect(cancelled?.txnType).toBe('order');
    expect(cancelled?.rawRow._amazonCancelled).toBe('1');
    expect(shipped?.rawRow._amazonShipped).toBe('1');
  });
});

describe('FxService', () => {
  it('keeps EUR 1:1 without rewriting history', async () => {
    const fx = new FxService();
    const resolved = await fx.resolve({
      originalCurrency: 'EUR',
      originalAmountCents: 12345,
      txnDate: new Date('2026-07-15T00:00:00.000Z'),
    });
    expect(resolved.eurAmountCents).toBe(12345);
    expect(resolved.exchangeRate).toBe(1);
    expect(resolved.fxReview).toBe(false);
  });

  it('prefers marketplace EUR over ECB', async () => {
    const fx = new FxService();
    const resolved = await fx.resolve({
      originalCurrency: 'GBP',
      originalAmountCents: 10000,
      txnDate: new Date('2026-07-15T00:00:00.000Z'),
      marketplaceEurCents: 11700,
      marketplaceRate: 1.17,
      marketplaceRateDate: new Date('2026-07-15T00:00:00.000Z'),
      marketplaceRateSource: 'marketplace',
    });
    expect(resolved.eurAmountCents).toBe(11700);
    expect(resolved.exchangeRateSource).toBe('marketplace');
    expect(resolved.fxReview).toBe(false);
  });
});

describe('LexOffice DATEV parser', () => {
  it('skips 10001/70002 collectives', () => {
    const csv = [
      'EXTF;700;21',
      'Umsatz;Soll/Haben-Kennzeichen;Konto;Gegenkonto;Buchungstext;Beleginfo - Art 1;Beleginfo - Inhalt 1',
      '10,00;S;10001;1201;Sammel;Geschäftspartner;Lex',
      '20,00;S;3100;1201;Hosting;Geschäftspartner;Hetzner',
    ].join('\n');
    const lines = parseLexofficeDatev(csv);
    expect(lines.some((l) => l.konto === '10001')).toBe(false);
    expect(lines.some((l) => l.konto === '3100')).toBe(true);
  });
});
