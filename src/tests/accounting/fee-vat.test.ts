import {
  buildFeeVatExtraLines,
  vatCentsFromNet,
  resolveFeeVatTreatment,
} from '../../helpers/accounting/accrual/fee-vat.util.js';
import { inventorySeedRule, applyHumanRules } from '../../helpers/accounting/rule-engine.js';

describe('Fee VAT §13b / Amazon input VAT', () => {
  it('€10,000 net at 19% → €1,900 VAT cents', () => {
    expect(vatCentsFromNet(1_000_000, 19)).toBe(190_000);
  });

  it('Back Market / Refurbed default to reverse charge', () => {
    expect(resolveFeeVatTreatment('backmarket', 'auto')).toBe('reverse_charge_13b');
    expect(resolveFeeVatTreatment('refurbed', 'auto')).toBe('reverse_charge_13b');
  });

  it('Amazon defaults to German input VAT', () => {
    expect(resolveFeeVatTreatment('amazon', 'auto')).toBe('input_vat_de');
  });

  it('invoice override wins over marketplace default', () => {
    expect(resolveFeeVatTreatment('backmarket', 'none')).toBe('none');
    expect(resolveFeeVatTreatment('amazon', 'reverse_charge_13b')).toBe('reverse_charge_13b');
  });

  it('RC pair is balanced Soll 1577 / Haben 1787', () => {
    const extra = buildFeeVatExtraLines({
      netCents: 1_000_000,
      marketplace: 'backmarket',
      override: 'auto',
    });
    expect(extra.vatCents).toBe(190_000);
    expect(extra.lines).toHaveLength(2);
    const soll = extra.lines.find((l) => l.sollHaben === 'S');
    const haben = extra.lines.find((l) => l.sollHaben === 'H');
    expect(soll?.accountNumber).toBe('1577');
    expect(haben?.accountNumber).toBe('1787');
    expect(soll?.amountCents).toBe(haben?.amountCents);
  });

  it('Amazon input VAT books Vorsteuer 1576', () => {
    const extra = buildFeeVatExtraLines({
      netCents: 100_000,
      marketplace: 'amazon',
      override: 'auto',
      clearingAccount: '1400',
    });
    expect(extra.treatment).toBe('input_vat_de');
    expect(extra.lines[0].accountNumber).toBe('1576');
    expect(extra.lines[0].sollHaben).toBe('S');
  });
});

describe('S15 private purchases → 3349 no input VAT', () => {
  const inventory = { ...inventorySeedRule(), _id: 'rule-inv', enabled: true };

  it('1 match → 3349 empty BU', () => {
    const r = applyHumanRules(
      {
        source: 'bank',
        amountCents: -44900,
        purpose: 'PS5 Slim',
        counterpartyName: 'Private seller',
        rawDescription: 'PS5 Slim Konsole',
      },
      [inventory],
    );
    expect(r.status).toBe('matched');
    if (r.status === 'matched') {
      expect(r.booking.konto).toBe('3349');
      expect(r.booking.buKey).toBe('');
    }
  });
});
