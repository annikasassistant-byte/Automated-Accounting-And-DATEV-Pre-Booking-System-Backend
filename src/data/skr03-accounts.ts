/**
 * SKR03 chart seed — distinct Konten for BuyBack pre-booking MVP.
 * Includes required clearing/inventory/marketplace accounts.
 */

export type SeedAccount = {
  number: string;
  name: string;
  type: 'asset' | 'liability' | 'expense' | 'revenue' | 'clearing' | 'other';
  isSystemProtected?: boolean;
  notes?: string;
};

export const REQUIRED_EXTRA_ACCOUNTS: SeedAccount[] = [
  {
    number: '1361',
    name: 'Verrechnungskonto Bank ↔ PayPal',
    type: 'clearing',
    isSystemProtected: true,
    notes: 'System: Bank↔PayPal clearing (nie Erlöse/Aufwand)',
  },
  {
    number: '3220',
    name: 'Private Wareneinkäufe (ohne USt-Schlüssel)',
    type: 'expense',
    isSystemProtected: true,
    notes: 'Private inventory — BU-Schlüssel leer',
  },
  { number: '81971', name: 'Amazon Marketplace', type: 'revenue', isSystemProtected: true },
  { number: '81972', name: 'Refurbed', type: 'revenue', isSystemProtected: true },
  { number: '81973', name: 'Back Market', type: 'revenue', isSystemProtected: true },
  { number: '81974', name: 'Eigener Online-Shop', type: 'revenue', isSystemProtected: true },
  { number: '81975', name: 'Kaufland', type: 'revenue', isSystemProtected: true },
  { number: '81976', name: 'eBay', type: 'revenue', isSystemProtected: true },
];

/** Core SKR03 subset used in daily bookkeeping (~100 unique Konten). */
export const SKR03_SEED_ACCOUNTS: SeedAccount[] = [
  { number: '1000', name: 'Kasse', type: 'asset' },
  { number: '1200', name: 'Bank', type: 'asset' },
  { number: '1201', name: 'Bank Betriebskonto', type: 'asset', isSystemProtected: true, notes: 'Default Bank offset' },
  { number: '1203', name: 'PayPal', type: 'asset', isSystemProtected: true, notes: 'Default PayPal offset' },
  { number: '1360', name: 'Geldtransit', type: 'clearing' },
  { number: '1400', name: 'Forderungen aus Lieferungen und Leistungen', type: 'asset' },
  { number: '1571', name: 'Abziehbare Vorsteuer 7%', type: 'asset' },
  { number: '1576', name: 'Abziehbare Vorsteuer 19%', type: 'asset' },
  { number: '1600', name: 'Verbindlichkeiten aus Lieferungen und Leistungen', type: 'liability' },
  { number: '1771', name: 'Umsatzsteuer 7%', type: 'liability' },
  { number: '1776', name: 'Umsatzsteuer 19%', type: 'liability' },
  { number: '1800', name: 'Privatentnahmen allgemein', type: 'liability' },
  { number: '1890', name: 'Privateinlagen', type: 'liability' },
  { number: '2000', name: 'Gezeichnetes Kapital', type: 'liability' },
  { number: '2100', name: 'Gewinnvortrag', type: 'liability' },
  { number: '2150', name: 'Verlustvortrag', type: 'liability' },
  { number: '3000', name: 'Wareneingang', type: 'expense' },
  { number: '320', name: 'Pkw', type: 'asset', notes: 'Achtung: Pkw ≠ Inventar' },
  { number: '3200', name: 'Wareneingang 19% Vorsteuer', type: 'expense' },
  { number: '3300', name: 'Wareneingang 7% Vorsteuer', type: 'expense' },
  { number: '3400', name: 'Wareneingang ohne Vorsteuer', type: 'expense' },
  { number: '3500', name: 'Wareneingang 0% (Innergemeinschaftlich)', type: 'expense' },
  { number: '3550', name: 'Wareneingang aus Drittländern', type: 'expense' },
  { number: '3730', name: 'Erhaltene Skonti', type: 'expense' },
  { number: '3800', name: 'Bezugsnebenkosten', type: 'expense' },
  { number: '4000', name: 'Materialaufwand', type: 'expense' },
  { number: '4100', name: 'Löhne', type: 'expense' },
  { number: '4110', name: 'Gehälter', type: 'expense' },
  { number: '4120', name: 'Sozialversicherungsbeiträge', type: 'expense' },
  { number: '4130', name: 'Freiwillige soziale Aufwendungen', type: 'expense' },
  { number: '4140', name: 'Pauschale Steuer für Aushilfen', type: 'expense' },
  { number: '4200', name: 'Raumkosten', type: 'expense' },
  { number: '4210', name: 'Miete', type: 'expense' },
  { number: '4220', name: 'Pacht', type: 'expense' },
  { number: '4240', name: 'Gas, Strom, Wasser', type: 'expense' },
  { number: '4250', name: 'Reinigung', type: 'expense' },
  { number: '4260', name: 'Instandhaltung betrieblicher Räume', type: 'expense' },
  { number: '4280', name: 'Sonstige Raumkosten', type: 'expense' },
  { number: '4300', name: 'Betriebsbedarf', type: 'expense' },
  { number: '4350', name: 'Verpackungsmaterial', type: 'expense' },
  { number: '4360', name: 'Reparaturen und Instandhaltung', type: 'expense' },
  { number: '4380', name: 'Kleine Anlagen und Werkzeuge', type: 'expense' },
  { number: '4390', name: 'Sonstige Betriebsstoffe', type: 'expense' },
  { number: '4500', name: 'Fahrzeugkosten', type: 'expense' },
  { number: '4510', name: 'Kfz-Steuer', type: 'expense' },
  { number: '4520', name: 'Kfz-Versicherung', type: 'expense' },
  { number: '4530', name: 'Laufende Kfz-Betriebskosten', type: 'expense' },
  { number: '4540', name: 'Kfz-Reparaturen', type: 'expense' },
  { number: '4570', name: 'Mietleasing Kfz', type: 'expense' },
  { number: '4600', name: 'Werbe- und Reisekosten', type: 'expense' },
  { number: '4610', name: 'Werbekosten', type: 'expense' },
  { number: '4630', name: 'Geschenke abzugsfähig', type: 'expense' },
  { number: '4650', name: 'Bewirtungskosten', type: 'expense' },
  { number: '4660', name: 'Reisekosten Unternehmer', type: 'expense' },
  { number: '4670', name: 'Reisekosten Arbeitnehmer', type: 'expense' },
  { number: '4700', name: 'Kosten der Warenabgabe', type: 'expense' },
  { number: '4710', name: 'Verpackungsmaterial Warenabgabe', type: 'expense' },
  { number: '4730', name: 'Transport durch Dritte', type: 'expense' },
  { number: '4750', name: 'Ausgangsfrachten', type: 'expense' },
  { number: '4800', name: 'Reparaturen und Instandhaltung von Anlagen', type: 'expense' },
  { number: '4805', name: 'Wartungskosten', type: 'expense' },
  { number: '4900', name: 'Sonstige betriebliche Aufwendungen', type: 'expense' },
  { number: '4910', name: 'Porto', type: 'expense' },
  { number: '4920', name: 'Telefon', type: 'expense' },
  { number: '4930', name: 'Bürobedarf', type: 'expense' },
  { number: '4940', name: 'Zeitschriften, Bücher', type: 'expense' },
  { number: '4945', name: 'Fortbildungskosten', type: 'expense' },
  { number: '4950', name: 'Rechts- und Beratungskosten', type: 'expense' },
  { number: '4955', name: 'Buchführungskosten', type: 'expense' },
  { number: '4957', name: 'Abschluss- und Prüfungskosten', type: 'expense' },
  { number: '4960', name: 'Mieten für Einrichtungen', type: 'expense' },
  { number: '4964', name: 'Aufwand für Lizenzen und Konzessionen', type: 'expense' },
  { number: '4970', name: 'Nebenkosten des Geldverkehrs', type: 'expense' },
  { number: '4980', name: 'Betriebsbedarf sonstig', type: 'expense' },
  { number: '4985', name: 'Werkzeuge und Kleingeräte', type: 'expense' },
  { number: '5400', name: 'Wareneinsatz', type: 'expense' },
  { number: '5730', name: 'Gewährte Skonti', type: 'expense' },
  { number: '8000', name: 'Umsatzerlöse', type: 'revenue' },
  { number: '8100', name: 'Steuerfreie Umsätze § 4 Nr. 1a UStG', type: 'revenue' },
  { number: '8120', name: 'Steuerfreie innergemeinschaftliche Lieferungen', type: 'revenue' },
  { number: '8125', name: 'Steuerfreie Ausfuhrlieferungen', type: 'revenue' },
  { number: '8200', name: 'Erlöse', type: 'revenue' },
  { number: '8300', name: 'Erlöse 7% USt', type: 'revenue' },
  { number: '8400', name: 'Erlöse 19% USt', type: 'revenue' },
  { number: '8500', name: 'Provisionserlöse', type: 'revenue' },
  { number: '8600', name: 'Sonstige betriebliche Erträge', type: 'revenue' },
  { number: '8900', name: 'Erträge aus der Auflösung von Rückstellungen', type: 'revenue' },
  { number: '8920', name: 'Erträge aus Anlagenabgang', type: 'revenue' },
  { number: '8950', name: 'Erstattungen', type: 'revenue' },
  { number: '9000', name: 'Saldenvorträge Sachkonten', type: 'other' },
  { number: '9800', name: 'Statistikkonto', type: 'other' },
  ...REQUIRED_EXTRA_ACCOUNTS,
];

/** Deduplicate by account number (extras may already appear). */
export function getUniqueSeedAccounts(): SeedAccount[] {
  const map = new Map<string, SeedAccount>();
  for (const acc of SKR03_SEED_ACCOUNTS) {
    map.set(acc.number, acc);
  }
  for (const acc of REQUIRED_EXTRA_ACCOUNTS) {
    map.set(acc.number, acc);
  }
  return [...map.values()].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
}
