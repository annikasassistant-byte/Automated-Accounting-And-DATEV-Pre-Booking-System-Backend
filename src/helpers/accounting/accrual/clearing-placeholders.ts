import type { Marketplace } from '../../../enums/accrual.js';

/** Placeholder DATEV numbers — classification is the logic; advisor may change Konten later. */
export type MarketplaceClearingAccounts = {
  revenueAccount: string;
  clearingAccount: string;
  feeAccount: string;
  refundAccount: string;
  debtorAccount: string;
  adjustmentAccount: string;
  fxGainAccount: string;
  fxLossAccount: string;
};

const SHARED_OFFSETS = {
  clearingAccount: '1400',
  feeAccount: '3100',
  debtorAccount: '1400',
  adjustmentAccount: '2160',
  fxGainAccount: '2150',
  fxLossAccount: '2150',
};

export const CLEARING_PLACEHOLDERS: Record<Marketplace, MarketplaceClearingAccounts> = {
  amazon: {
    ...SHARED_OFFSETS,
    revenueAccount: '81971',
    refundAccount: '81971',
  },
  refurbed: {
    ...SHARED_OFFSETS,
    revenueAccount: '81972',
    refundAccount: '81972',
  },
  backmarket: {
    ...SHARED_OFFSETS,
    revenueAccount: '81973',
    refundAccount: '81973',
  },
  kaufland: {
    ...SHARED_OFFSETS,
    revenueAccount: '81975',
    refundAccount: '81975',
  },
};

export const DEFAULT_REVENUE_ACCOUNT = '81971';

export const DEFAULT_FX_POLICY_NOTE =
  'ECB-Tageskurs (Frankfurter). Wochenende/Feiertag = letzter veröffentlichter ECB-Kurs. Marktplatz-EUR oder Marktplatz-Kurs hat Vorrang bei Settlement/Clearing. Originalwährung, Originalbetrag, Kurs, Kursdatum, EUR-Betrag und Quelle werden gespeichert.';

export function fillMarketplaceAccounts(
  existing: Partial<MarketplaceClearingAccounts> | undefined,
  defaults: MarketplaceClearingAccounts,
): MarketplaceClearingAccounts {
  const merged = { ...defaults, ...(existing || {}) };
  for (const key of Object.keys(defaults) as (keyof MarketplaceClearingAccounts)[]) {
    if (!merged[key]) merged[key] = defaults[key];
  }
  return merged;
}
