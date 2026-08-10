import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBankCsv } from '../../helpers/accounting/bank-parser.js';
import { parsePaypalCsv } from '../../helpers/accounting/paypal-parser.js';
import { applyHumanRules, inventorySeedRule } from '../../helpers/accounting/rule-engine.js';
import { detectBankPaypalClearing, detectMarketplacePark } from '../../helpers/accounting/system-policies.js';
import { buildDatevExtf } from '../../helpers/accounting/datev-writer.js';
import { sha256 } from '../../helpers/accounting/csv.util.js';

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
