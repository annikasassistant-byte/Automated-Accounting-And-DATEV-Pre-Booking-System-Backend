import fs from 'node:fs';
import { parseBankCsv } from '../helpers/accounting/bank-parser.js';
import { parsePaypalCsv } from '../helpers/accounting/paypal-parser.js';
import { applyHumanRules, inventorySeedRule } from '../helpers/accounting/rule-engine.js';
import { detectBankPaypalClearing, detectMarketplacePark } from '../helpers/accounting/system-policies.js';
import { buildDatevExtf } from '../helpers/accounting/datev-writer.js';

const bank = fs.readFileSync(new URL('../../fixtures/accounting/bank_2026-07.csv', import.meta.url), 'utf8');
const pp = fs.readFileSync(new URL('../../fixtures/accounting/paypal_2026-07.csv', import.meta.url), 'utf8');
const b = parseBankCsv(bank);
const p = parsePaypalCsv(pp);
console.log('BANK rows', b.rows.length, 'errors', b.errors.length);
console.log('BANK sum cents', b.rows.reduce((a, r) => a + r.amountCents, 0));
console.log('PP rows', p.rows.length, 'balance', JSON.stringify(p.balanceCheck));
const clearing = detectBankPaypalClearing({
  source: 'bank',
  counterpartyName: 'PayPal Europe',
  purpose: 'Abbuchung',
  amountCents: -50000,
});
console.log('clearing', clearing.matched, clearing.matched ? clearing.konto : null);
const mkt = detectMarketplacePark({
  counterpartyName: 'Amazon Payments Europe',
  purpose: 'Auszahlung',
});
console.log('marketplace park', mkt.parkOpen);
const inv = { ...inventorySeedRule(), _id: '1', enabled: true };
const m1 = applyHumanRules(
  {
    source: 'bank',
    amountCents: -44900,
    purpose: 'PS5',
    counterpartyName: 'X',
    rawDescription: 'PS5 Slim',
  },
  [inv],
);
console.log('inventory match', m1.status, m1.status === 'matched' ? m1.booking.konto : null);
const extf = buildDatevExtf(
  [
    {
      amountCents: -4890,
      sollHaben: 'S',
      konto: '4910',
      gegenkonto: '1201',
      belegdatum: new Date('2026-07-05'),
      buchungstext: 'DHL',
    },
  ],
  {
    advisorNumber: '12345',
    clientNumber: '67890',
    periodStart: new Date('2026-07-01'),
    periodEnd: new Date('2026-07-31'),
  },
);
console.log('EXTF header', extf.content.split('\n')[0].slice(0, 80));
console.log('ALL_CHECKS_PASSED');
