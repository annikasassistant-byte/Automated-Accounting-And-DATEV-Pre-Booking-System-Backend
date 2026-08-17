/**
 * System policies S1–S15 detectors.
 * Config comes from Mongo (admin-editable); DEFAULT_SYSTEM_POLICY used as fallback.
 */

import {
  DEFAULT_SYSTEM_POLICY,
  type SystemPolicyConfig,
} from './system-policy-defaults.js';

export type { SystemPolicyConfig, SystemPolicyEnabled } from './system-policy-defaults.js';
export { DEFAULT_SYSTEM_POLICY, cloneDefaultSystemPolicy } from './system-policy-defaults.js';

/** @deprecated Use policy.accounts — kept for offline scripts/tests */
export const SYSTEM_ACCOUNTS = Object.freeze({
  BANK: DEFAULT_SYSTEM_POLICY.accounts.bank,
  PAYPAL: DEFAULT_SYSTEM_POLICY.accounts.paypal,
  CLEARING: DEFAULT_SYSTEM_POLICY.accounts.clearing,
  PRIVATE_INVENTORY: DEFAULT_SYSTEM_POLICY.accounts.privateInventory,
  LEXOFFICE_COLLECTIVE_FORBIDDEN: DEFAULT_SYSTEM_POLICY.accounts.forbiddenCollectives,
});

/** @deprecated Use policy.inventoryKeywords */
export const INVENTORY_KEYWORDS = DEFAULT_SYSTEM_POLICY.inventoryKeywords;

export type SystemMatchResult =
  | {
      matched: true;
      systemRuleId: string;
      konto: string;
      gegenkonto: string;
      buKey: string;
      bookingText: string;
      sollHaben: 'S' | 'H';
      status: 'matched';
      note: string;
    }
  | {
      matched: false;
      parkOpen?: boolean;
      reason?: string;
    };

function compilePatterns(patterns: string[]): RegExp[] {
  const out: RegExp[] = [];
  for (const raw of patterns || []) {
    const src = String(raw || '').trim();
    if (!src) continue;
    try {
      out.push(new RegExp(src, 'i'));
    } catch {
      // Invalid admin regex — skip rather than crash imports
    }
  }
  return out;
}

function resolvePolicy(policy?: SystemPolicyConfig | null): SystemPolicyConfig {
  return policy || DEFAULT_SYSTEM_POLICY;
}

export function detectMarketplacePark(
  tx: {
    counterpartyName?: string;
    purpose?: string;
    rawDescription?: string;
    article?: string | null;
    paypalSubject?: string | null;
    paypalNote?: string | null;
  },
  policy?: SystemPolicyConfig | null,
): SystemMatchResult {
  const cfg = resolvePolicy(policy);
  if (!cfg.enabled.s9MarketplacePark) return { matched: false };

  const hay = `${tx.counterpartyName || ''} ${tx.purpose || ''} ${tx.rawDescription || ''} ${tx.article || ''} ${tx.paypalSubject || ''} ${tx.paypalNote || ''}`;
  if (compilePatterns(cfg.marketplacePatterns).some((re) => re.test(hay))) {
    return { matched: false, parkOpen: true, reason: 'Marketplace-Auszahlung — Phase 2 (S9)' };
  }
  return { matched: false };
}

/**
 * S5/S6: Bank ↔ PayPal both directions → clearing account.
 */
export function detectBankPaypalClearing(
  tx: {
    source: 'bank' | 'paypal';
    counterpartyName?: string;
    purpose?: string;
    rawDescription?: string;
    amountCents: number;
    paypalType?: string | null;
  },
  policy?: SystemPolicyConfig | null,
): SystemMatchResult {
  const cfg = resolvePolicy(policy);
  if (!cfg.enabled.s5BankPaypalClearing) return { matched: false };

  const hay = `${tx.counterpartyName || ''} ${tx.purpose || ''} ${tx.rawDescription || ''} ${tx.paypalType || ''}`;
  const counterpartyRes = compilePatterns(cfg.bankPaypalCounterpartyPatterns);
  const purposeRes = compilePatterns(cfg.bankPaypalPurposePatterns);
  const typeRes = compilePatterns(cfg.paypalBankTransferTypePatterns);
  const { bank, paypal, clearing } = cfg.accounts;
  const bookingText = cfg.clearingBookingText || 'Verrechnung Bank ↔ PayPal';

  if (tx.source === 'bank') {
    const isPaypalCounterparty = counterpartyRes.some((re) => re.test(tx.counterpartyName || ''));
    const isPaypalPurpose = purposeRes.some((re) => re.test(hay));
    if (isPaypalCounterparty || isPaypalPurpose) {
      const sollHaben: 'S' | 'H' = tx.amountCents < 0 ? 'S' : 'H';
      return {
        matched: true,
        systemRuleId: 'S5_BANK_PAYPAL_CLEARING',
        konto: clearing,
        gegenkonto: bank,
        buKey: '',
        bookingText,
        sollHaben,
        status: 'matched',
        note: `Systemregel S5: Clearing ${clearing}`,
      };
    }
  }

  if (tx.source === 'paypal') {
    const type = (tx.paypalType || '').toLowerCase();
    const isBankTransfer =
      typeRes.some((re) => re.test(type)) ||
      (/paypal/.test(hay) && /bank/.test(hay) && (/gutschrift/.test(hay) || /abbuchung/.test(hay)));

    if (isBankTransfer || purposeRes.some((re) => re.test(hay))) {
      const sollHaben: 'S' | 'H' = tx.amountCents < 0 ? 'S' : 'H';
      return {
        matched: true,
        systemRuleId: 'S5_BANK_PAYPAL_CLEARING',
        konto: clearing,
        gegenkonto: paypal,
        buKey: '',
        bookingText,
        sollHaben,
        status: 'matched',
        note: `Systemregel S5: Clearing ${clearing}`,
      };
    }
  }

  return { matched: false };
}

/**
 * S10: Commercial supplier VAT → park Open (no auto rule).
 * S11: Owner/related-party → park Open until human rule exists.
 */
export function detectManualParkPolicies(
  tx: {
    counterpartyName?: string;
    purpose?: string;
    rawDescription?: string;
    article?: string | null;
    paypalSubject?: string | null;
    paypalNote?: string | null;
  },
  policy?: SystemPolicyConfig | null,
): SystemMatchResult {
  const cfg = resolvePolicy(policy);
  const hay = `${tx.counterpartyName || ''} ${tx.purpose || ''} ${tx.rawDescription || ''} ${tx.article || ''} ${tx.paypalSubject || ''} ${tx.paypalNote || ''}`;

  if (cfg.enabled.s11OwnerRelatedPark) {
    if (compilePatterns(cfg.ownerRelatedPatterns).some((re) => re.test(hay))) {
      return {
        matched: false,
        parkOpen: true,
        reason: 'Eigentümer/nahestehende Person — manuell prüfen (S11)',
      };
    }
  }

  if (cfg.enabled.s10CommercialVatPark) {
    if (compilePatterns(cfg.commercialVatHints).some((re) => re.test(hay))) {
      return {
        matched: false,
        parkOpen: true,
        reason: 'Gewerblicher Lieferant/USt — keine Auto-Regel (S10)',
      };
    }
  }

  return { matched: false };
}

export function defaultGegenkonto(
  source: 'bank' | 'paypal',
  policy?: SystemPolicyConfig | null,
): string {
  const cfg = resolvePolicy(policy);
  return source === 'paypal' ? cfg.accounts.paypal : cfg.accounts.bank;
}

export function isForbiddenCollectiveAccount(
  konto: string,
  policy?: SystemPolicyConfig | null,
): boolean {
  const cfg = resolvePolicy(policy);
  if (!cfg.enabled.s12ForbiddenCollectives) return false;
  return cfg.accounts.forbiddenCollectives.map(String).includes(String(konto));
}

export function toPolicyPlain(doc: Record<string, unknown> | null | undefined): SystemPolicyConfig {
  if (!doc) return structuredClone(DEFAULT_SYSTEM_POLICY);
  const accounts = (doc.accounts as SystemPolicyConfig['accounts']) || DEFAULT_SYSTEM_POLICY.accounts;
  const enabled = (doc.enabled as SystemPolicyConfig['enabled']) || DEFAULT_SYSTEM_POLICY.enabled;
  return {
    accounts: {
      bank: String(accounts.bank || DEFAULT_SYSTEM_POLICY.accounts.bank),
      paypal: String(accounts.paypal || DEFAULT_SYSTEM_POLICY.accounts.paypal),
      clearing: String(accounts.clearing || DEFAULT_SYSTEM_POLICY.accounts.clearing),
      privateInventory: String(
        accounts.privateInventory || DEFAULT_SYSTEM_POLICY.accounts.privateInventory,
      ),
      forbiddenCollectives: Array.isArray(accounts.forbiddenCollectives)
        ? accounts.forbiddenCollectives.map(String)
        : [...DEFAULT_SYSTEM_POLICY.accounts.forbiddenCollectives],
    },
    enabled: { ...DEFAULT_SYSTEM_POLICY.enabled, ...enabled },
    paypalExcludeTypes: Array.isArray(doc.paypalExcludeTypes)
      ? (doc.paypalExcludeTypes as string[]).map(String)
      : [...DEFAULT_SYSTEM_POLICY.paypalExcludeTypes],
    marketplacePatterns: Array.isArray(doc.marketplacePatterns)
      ? (doc.marketplacePatterns as string[]).map(String)
      : [...DEFAULT_SYSTEM_POLICY.marketplacePatterns],
    bankPaypalCounterpartyPatterns: Array.isArray(doc.bankPaypalCounterpartyPatterns)
      ? (doc.bankPaypalCounterpartyPatterns as string[]).map(String)
      : [...DEFAULT_SYSTEM_POLICY.bankPaypalCounterpartyPatterns],
    bankPaypalPurposePatterns: Array.isArray(doc.bankPaypalPurposePatterns)
      ? (doc.bankPaypalPurposePatterns as string[]).map(String)
      : [...DEFAULT_SYSTEM_POLICY.bankPaypalPurposePatterns],
    paypalBankTransferTypePatterns: Array.isArray(doc.paypalBankTransferTypePatterns)
      ? (doc.paypalBankTransferTypePatterns as string[]).map(String)
      : [...DEFAULT_SYSTEM_POLICY.paypalBankTransferTypePatterns],
    ownerRelatedPatterns: Array.isArray(doc.ownerRelatedPatterns)
      ? (doc.ownerRelatedPatterns as string[]).map(String)
      : [...DEFAULT_SYSTEM_POLICY.ownerRelatedPatterns],
    commercialVatHints: Array.isArray(doc.commercialVatHints)
      ? (doc.commercialVatHints as string[]).map(String)
      : [...DEFAULT_SYSTEM_POLICY.commercialVatHints],
    inventoryKeywords: Array.isArray(doc.inventoryKeywords)
      ? (doc.inventoryKeywords as string[]).map(String)
      : [...DEFAULT_SYSTEM_POLICY.inventoryKeywords],
    clearingBookingText:
      String(doc.clearingBookingText || DEFAULT_SYSTEM_POLICY.clearingBookingText),
  };
}
