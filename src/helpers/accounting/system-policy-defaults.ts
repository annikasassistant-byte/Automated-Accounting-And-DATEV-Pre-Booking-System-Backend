/**
 * Default system policy config (seeded to Mongo; editable by admin).
 * Values match the former hard-coded detectors so SQA stays green out of the box.
 */

export type SystemPolicyEnabled = {
  s1ExcludePaypalTypes: boolean;
  s2GuthabenIntegrity: boolean;
  s3EurOnly: boolean;
  s5BankPaypalClearing: boolean;
  s9MarketplacePark: boolean;
  s10CommercialVatPark: boolean;
  s11OwnerRelatedPark: boolean;
  s12ForbiddenCollectives: boolean;
  s15Inventory: boolean;
};

export type SystemPolicyConfig = {
  accounts: {
    bank: string;
    paypal: string;
    clearing: string;
    privateInventory: string;
    forbiddenCollectives: string[];
  };
  enabled: SystemPolicyEnabled;
  paypalExcludeTypes: string[];
  marketplacePatterns: string[];
  bankPaypalCounterpartyPatterns: string[];
  bankPaypalPurposePatterns: string[];
  paypalBankTransferTypePatterns: string[];
  ownerRelatedPatterns: string[];
  commercialVatHints: string[];
  inventoryKeywords: string[];
  clearingBookingText: string;
};

export const DEFAULT_SYSTEM_POLICY: SystemPolicyConfig = {
  accounts: {
    bank: '1201',
    paypal: '1203',
    clearing: '1361',
    privateInventory: '3220',
    forbiddenCollectives: ['10001', '70002'],
  },
  enabled: {
    s1ExcludePaypalTypes: true,
    s2GuthabenIntegrity: true,
    s3EurOnly: true,
    s5BankPaypalClearing: true,
    s9MarketplacePark: true,
    s10CommercialVatPark: true,
    s11OwnerRelatedPark: true,
    s12ForbiddenCollectives: true,
    s15Inventory: true,
  },
  paypalExcludeTypes: [
    'Rückbuchung allgemeiner Einbehaltung',
    'Einbehaltung für offene Autorisierung',
    'Rückbuchung von ACH-Gutschrift',
    'Rückbuchung von ACH-Abbuchung',
  ],
  marketplacePatterns: [
    'amazon\\s*payments',
    'amazon\\s*marketplace',
    'amzn',
    'refurbed',
    'back\\s*market',
    'kaufland',
    '\\bebay\\b',
    'paypal\\s*marketplace',
  ],
  bankPaypalCounterpartyPatterns: [
    'paypal\\s*europe',
    'paypal\\s*\\(europe\\)',
    'paypal\\s*p\\.?t\\.?e',
    'paypal',
  ],
  bankPaypalPurposePatterns: [
    'bankgutschrift',
    'überweisung als zahlungsquelle',
    'ueberweisung als zahlungsquelle',
    'abbuchung von paypal',
    'paypal.*transfer',
    'transfer.*paypal',
    'geld senden',
    'allgemeine abbuchung',
    'allgemeine gutschrift',
  ],
  paypalBankTransferTypePatterns: [
    'bankgutschrift',
    'überweisung als zahlungsquelle',
    'ueberweisung als zahlungsquelle',
    'abbuchung auf bankkonto',
    'transfer to bank',
    'bank transfer',
  ],
  ownerRelatedPatterns: [
    'privatentnahme',
    'privateinlage',
    'eigentümer',
    'gesellschafter',
    'inhaber',
    'eigenkapital',
  ],
  commercialVatHints: [
    'ust[\\s.-]*id',
    'umsatzsteuer',
    'mwst',
    'vat\\s*id',
    'rechnung\\s*nr',
    '\\brn[\\s.-]*\\d+',
  ],
  inventoryKeywords: [
    'PS4',
    'PS5',
    'PlayStation',
    'Xbox',
    'Lumix',
    'Sony',
    'Alpha',
    'Panasonic',
    'Nintendo',
    'Switch',
    'iPhone',
    'MacBook',
    'Galaxy',
  ],
  clearingBookingText: 'Verrechnung Bank ↔ PayPal',
};

export function cloneDefaultSystemPolicy(): SystemPolicyConfig {
  return structuredClone(DEFAULT_SYSTEM_POLICY);
}
