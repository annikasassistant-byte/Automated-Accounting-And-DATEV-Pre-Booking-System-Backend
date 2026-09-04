import { buildBusinessEventKey, buildMarketplaceTxnKey } from '../../helpers/accounting/accrual/duplicate-guard.js';
import { amazonParser } from '../../helpers/accounting/accrual/amazon-parser.js';
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
} from '../../helpers/accounting/accrual/marketplace-types.js';

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
    expect(result.lines[1].txnType).toBe('sale_line');
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
