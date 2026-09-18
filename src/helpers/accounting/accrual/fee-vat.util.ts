/**
 * Marketplace fee VAT — §13b reverse charge vs German input VAT.
 * Amounts are cents. VAT is calculated on the stored FEE amount (net base).
 * Placeholder DATEV Konten / BU keys are admin-overridable via ClearingConfig + TaxCode.
 */

export const FEE_VAT_TREATMENTS = ['auto', 'reverse_charge_13b', 'input_vat_de', 'none'] as const;
export type FeeVatTreatment = (typeof FEE_VAT_TREATMENTS)[number];

export type ResolvedFeeVatTreatment = Exclude<FeeVatTreatment, 'auto'>;

export type FeeVatMarketplaceConfig = {
  treatment: ResolvedFeeVatTreatment;
  ratePercent: number;
  inputVatAccount: string;
  outputVatAccount: string | null;
};

export const DEFAULT_FEE_VAT: Record<string, FeeVatMarketplaceConfig> = {
  amazon: {
    treatment: 'input_vat_de',
    ratePercent: 19,
    inputVatAccount: '1576',
    outputVatAccount: null,
  },
  backmarket: {
    treatment: 'reverse_charge_13b',
    ratePercent: 19,
    inputVatAccount: '1577',
    outputVatAccount: '1787',
  },
  refurbed: {
    treatment: 'reverse_charge_13b',
    ratePercent: 19,
    inputVatAccount: '1577',
    outputVatAccount: '1787',
  },
  kaufland: {
    treatment: 'none',
    ratePercent: 19,
    inputVatAccount: '1577',
    outputVatAccount: '1787',
  },
};

export const DEFAULT_TAX_CODES = [
  {
    code: 'RC19_13B',
    label: '§13b reverse charge 19%',
    description: 'Back Market / Refurbed fee invoices — output VAT payable + deductible input VAT',
    buKey: '94',
    vatRatePercent: 19,
    classification: 'reverse_charge_13b',
    enabled: true,
  },
  {
    code: 'DE19_INPUT',
    label: 'German input VAT 19%',
    description: 'Amazon fee invoices with German VAT — regular Vorsteuer',
    buKey: '9',
    vatRatePercent: 19,
    classification: 'input_vat_de',
    enabled: true,
  },
  {
    code: 'NO_VAT',
    label: 'No VAT / §25a margin purchases',
    description: 'Private seller goods — no input VAT; identify for §25a overall-margin',
    buKey: '',
    vatRatePercent: 0,
    classification: 'section_25a_no_input_vat',
    enabled: true,
  },
];

export function vatCentsFromNet(netCents: number, ratePercent: number): number {
  if (!netCents || !ratePercent) return 0;
  return Math.round((Math.abs(netCents) * ratePercent) / 100);
}

export function resolveFeeVatTreatment(
  marketplace: string | null | undefined,
  override: FeeVatTreatment | string | null | undefined,
  feeVatConfig?: Record<string, Partial<FeeVatMarketplaceConfig>> | null,
): ResolvedFeeVatTreatment {
  if (override && override !== 'auto' && FEE_VAT_TREATMENTS.includes(override as FeeVatTreatment)) {
    return override as ResolvedFeeVatTreatment;
  }
  const key = String(marketplace || '').toLowerCase();
  const fromConfig = feeVatConfig?.[key]?.treatment;
  if (fromConfig && fromConfig !== 'auto') return fromConfig as ResolvedFeeVatTreatment;
  return DEFAULT_FEE_VAT[key]?.treatment || 'none';
}

export function resolveFeeVatConfig(
  marketplace: string | null | undefined,
  override: FeeVatTreatment | string | null | undefined,
  feeVatConfig?: Record<string, Partial<FeeVatMarketplaceConfig>> | null,
): FeeVatMarketplaceConfig {
  const key = String(marketplace || '').toLowerCase();
  const base = { ...(DEFAULT_FEE_VAT[key] || DEFAULT_FEE_VAT.kaufland) };
  const overlay = feeVatConfig?.[key] || {};
  const merged: FeeVatMarketplaceConfig = {
    treatment: overlay.treatment || base.treatment,
    ratePercent: overlay.ratePercent ?? base.ratePercent,
    inputVatAccount: overlay.inputVatAccount || base.inputVatAccount,
    outputVatAccount:
      overlay.outputVatAccount === undefined ? base.outputVatAccount : overlay.outputVatAccount,
  };
  merged.treatment = resolveFeeVatTreatment(marketplace, override, {
    [key]: merged,
  });
  return merged;
}

export type FeeVatLineDraft = {
  accountNumber: string;
  sollHaben: 'S' | 'H';
  amountCents: number;
  buKey: string;
  bookingText: string;
  taxCode: string;
};

/**
 * Extra journal lines for a FEE event (net already booked on fee vs clearing).
 * Reverse charge: Soll Vorsteuer §13b + Haben USt §13b (same VAT amount).
 * German input VAT: Soll Vorsteuer 19%; Haben clearing (gross-up) so the entry stays balanced.
 */
export function buildFeeVatExtraLines(opts: {
  netCents: number;
  marketplace?: string | null;
  override?: FeeVatTreatment | string | null;
  feeVatConfig?: Record<string, Partial<FeeVatMarketplaceConfig>> | null;
  clearingAccount?: string | null;
}): { treatment: ResolvedFeeVatTreatment; vatCents: number; lines: FeeVatLineDraft[] } {
  const cfg = resolveFeeVatConfig(opts.marketplace, opts.override, opts.feeVatConfig);
  const vatCents = vatCentsFromNet(opts.netCents, cfg.ratePercent);
  if (cfg.treatment === 'none' || vatCents <= 0) {
    return { treatment: cfg.treatment, vatCents: 0, lines: [] };
  }

  if (cfg.treatment === 'reverse_charge_13b' && cfg.inputVatAccount && cfg.outputVatAccount) {
    return {
      treatment: cfg.treatment,
      vatCents,
      lines: [
        {
          accountNumber: cfg.inputVatAccount,
          sollHaben: 'S',
          amountCents: vatCents,
          buKey: '94',
          bookingText: 'Vorsteuer §13b UStG 19% (Marktplatzgebühr)',
          taxCode: 'RC19_13B',
        },
        {
          accountNumber: cfg.outputVatAccount,
          sollHaben: 'H',
          amountCents: vatCents,
          buKey: '94',
          bookingText: 'Umsatzsteuer §13b UStG 19% (Marktplatzgebühr)',
          taxCode: 'RC19_13B',
        },
      ],
    };
  }

  if (cfg.treatment === 'input_vat_de' && cfg.inputVatAccount) {
    const contra = opts.clearingAccount || '1400';
    return {
      treatment: cfg.treatment,
      vatCents,
      lines: [
        {
          accountNumber: cfg.inputVatAccount,
          sollHaben: 'S',
          amountCents: vatCents,
          buKey: '9',
          bookingText: 'Abziehbare Vorsteuer 19% (Amazon-Gebührenrechnung)',
          taxCode: 'DE19_INPUT',
        },
        {
          accountNumber: contra,
          sollHaben: 'H',
          amountCents: vatCents,
          buKey: '9',
          bookingText: 'Vorsteuer 19% Gegenbuchung Gebühren',
          taxCode: 'DE19_INPUT',
        },
      ],
    };
  }

  return { treatment: cfg.treatment, vatCents: 0, lines: [] };
}
