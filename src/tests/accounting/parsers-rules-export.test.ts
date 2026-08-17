import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBankCsv } from '../../helpers/accounting/bank-parser.js';
import { parsePaypalCsv } from '../../helpers/accounting/paypal-parser.js';
import { applyHumanRules, inventorySeedRule } from '../../helpers/accounting/rule-engine.js';
import { detectBankPaypalClearing, detectMarketplacePark } from '../../helpers/accounting/system-policies.js';
import { buildDatevExtf } from '../../helpers/accounting/datev-writer.js';
import { sha256 } from '../../helpers/accounting/csv.util.js';
import { sidesForPayment, sideForAccount } from '../../helpers/accounting/ledger-sides.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(__dirname, '../../../fixtures/accounting');

describe('Bank parser', () => {
  const content = fs.readFileSync(path.join(fixtures, 'bank_2026-07.csv'), 'utf8');

  it('parses expected row count and sum', () => {
    const result = parseBankCsv(content);
    expect(result.errors.filter((e) => e.message.includes('Ungültig')).length).toBe(0);
    expect(result.rows.length).toBe(10);
    const sum = result.rows.reduce((a, r) => a + r.amountCents, 0);
    expect(sum).toBe(-50000 - 44900 - 4890 + 120000 - 32000 + 45000 - 6240 - 79900 - 1280 + 89050);
  });

  it('is fingerprint-idempotent', () => {
    const a = parseBankCsv(content);
    const b = parseBankCsv(content);
    expect(a.rows.map((r) => r.fingerprint)).toEqual(b.rows.map((r) => r.fingerprint));
    expect(new Set(a.rows.map((r) => r.fingerprint)).size).toBe(a.rows.length);
  });
});

describe('PayPal parser', () => {
  const content = fs.readFileSync(path.join(fixtures, 'paypal_2026-07.csv'), 'utf8');

  it('parses rows and handles excludes', () => {
    const result = parsePaypalCsv(content);
    expect(result.rows.length).toBeGreaterThanOrEqual(8);
    const skipped = result.rows.filter((r) => r.bookability === 'skipped' || r.bookability === 'balance_only');
    expect(skipped.length).toBeGreaterThanOrEqual(1);
    expect(result.balanceCheck).toBeTruthy();
  });

  it('uses Betreff when Artikelbezeichnung is empty (Handyzahlung)', () => {
    const csv = [
      'Datum,Name,Typ,Status,Währung,Brutto,Transaktionscode,Artikelbezeichnung,Betreff,Guthaben',
      '31.07.2026,Oliver Tschauner-Bas,Handyzahlung,Abgeschlossen,EUR,"-100,00",PP-MOB-1,,ps4 + controller,"1.276,72"',
    ].join('\n');
    const result = parsePaypalCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].purpose).toBe('ps4 + controller');
    expect(result.rows[0].article).toBeNull();
    expect(result.rows[0].subject).toBe('ps4 + controller');
    expect(result.rows[0].note).toBeNull();
    expect(result.rows[0].rawDescription).toContain('Handyzahlung');
  });

  it('keeps Artikelbezeichnung and Hinweis as separate fields', () => {
    const csv = [
      'Datum,Name,Typ,Status,Währung,Brutto,Transaktionscode,Artikelbezeichnung,Betreff,Hinweis,Guthaben',
      '15.07.2026,Max Mustermann,Allgemeine Zahlung,Abgeschlossen,EUR,"-50,00",PP-BOTH-1,Sony Alpha 7,Bestellung 12,Bitte als Inventar,"200,00"',
    ].join('\n');
    const result = parsePaypalCsv(csv);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.article).toBe('Sony Alpha 7');
    expect(row.subject).toBe('Bestellung 12');
    expect(row.note).toBe('Bitte als Inventar');
    expect(row.purpose).toContain('Sony Alpha 7');
    expect(row.purpose).toContain('Bitte als Inventar');
  });
});

describe('System policies', () => {
  it('detects bank↔PayPal clearing to 1361', () => {
    const r = detectBankPaypalClearing({
      source: 'bank',
      counterpartyName: 'PayPal Europe S.a.r.l.',
      purpose: 'PayPal Abbuchung',
      amountCents: -50000,
    });
    expect(r.matched).toBe(true);
    if (r.matched) expect(r.konto).toBe('1361');
  });

  it('parks marketplace payouts', () => {
    const r = detectMarketplacePark({
      counterpartyName: 'Amazon Payments Europe',
      purpose: 'Marketplace Auszahlung',
    });
    expect(r.parkOpen).toBe(true);
  });
});

describe('Rule engine', () => {
  const inventory = { ...inventorySeedRule(), _id: 'rule-inv', enabled: true };

  it('0 matches → open', () => {
    const r = applyHumanRules(
      { source: 'bank', amountCents: -1000, purpose: 'Unknown vendor', counterpartyName: 'X', rawDescription: 'X' },
      [inventory],
    );
    expect(r.status).toBe('open');
  });

  it('1 match → matched to 3220', () => {
    const r = applyHumanRules(
      {
        source: 'bank',
        amountCents: -44900,
        purpose: 'PS5 Slim',
        counterpartyName: 'MediaMarkt',
        rawDescription: 'PS5 Slim Konsole',
      },
      [inventory],
    );
    expect(r.status).toBe('matched');
    if (r.status === 'matched') expect(r.booking.konto).toBe('3220');
  });

  it('≥2 matches → conflict', () => {
    const r2 = {
      _id: 'rule-2',
      enabled: true,
      conditions: [{ field: 'purpose', operator: 'contains', value: 'PS5' }],
      actions: { konto: '3200', gegenkonto: '1201' },
    };
    const r = applyHumanRules(
      {
        source: 'bank',
        amountCents: -44900,
        purpose: 'PS5 Slim',
        counterpartyName: 'MediaMarkt',
        rawDescription: 'PS5 Slim Konsole',
      },
      [inventory, r2],
    );
    expect(r.status).toBe('conflict');
    expect(r.matchedRuleIds.length).toBe(2);
  });
});

describe('DATEV EXTF writer', () => {
  it('builds LexOffice-like header and locks conceptual uniqueness via hash', () => {
    const { content, fileName, fileHash, rowCount } = buildDatevExtf(
      [
        {
          amountCents: -4890,
          sollHaben: 'S',
          konto: '4910',
          gegenkonto: '1201',
          buKey: '',
          belegdatum: new Date(Date.UTC(2026, 6, 5)),
          belegfeld1: 'DHL-1',
          buchungstext: 'DHL Versand',
        },
      ],
      {
        advisorNumber: '12345',
        clientNumber: '67890',
        periodStart: new Date(Date.UTC(2026, 6, 1)),
        periodEnd: new Date(Date.UTC(2026, 6, 31)),
      },
    );
    expect(content.startsWith('\uFEFFEXTF;700;21;Buchungsstapel')).toBe(true);
    expect(content).toContain('03');
    expect(content).toContain('EUR');
    expect(fileName).toContain('EXTF_Buchungsstapel');
    expect(rowCount).toBe(1);
    expect(fileHash).toBe(sha256(content));
  });
});

describe('Ledger double-entry sides', () => {
  it('posts outflow to konto Soll and gegenkonto Haben', () => {
    const tx = {
      amountCents: -10000,
      booking: { konto: '4910', gegenkonto: '1201' },
    };
    const sides = sidesForPayment(tx);
    expect(sides).toBeTruthy();
    if (!sides) return;
    expect(sides.kontoSide).toBe('S');
    expect(sides.gegenkontoSide).toBe('H');
    expect(sides.amountCents).toBe(10000);
    expect(sideForAccount(sides, '4910')).toEqual({ side: 'S', contraAccount: '1201' });
    expect(sideForAccount(sides, '1201')).toEqual({ side: 'H', contraAccount: '4910' });
  });

  it('honours booking.sollHaben when set', () => {
    const sides = sidesForPayment({
      amountCents: 5000,
      booking: { konto: '1361', gegenkonto: '1201', sollHaben: 'S' },
    });
    expect(sides?.kontoSide).toBe('S');
    expect(sides?.gegenkontoSide).toBe('H');
  });
});
