import amazonParser from './amazon-parser.js';
import backmarketParser from './backmarket-parser.js';
import refurbedParser from './refurbed-parser.js';
import type { Marketplace } from '../../../enums/accrual.js';
import type { MarketplaceParser } from './marketplace-types.js';

const parsers: Record<Marketplace, MarketplaceParser> = {
  amazon: amazonParser,
  backmarket: backmarketParser,
  refurbed: refurbedParser,
};

export function getMarketplaceParser(channel: Marketplace): MarketplaceParser {
  const parser = parsers[channel];
  if (!parser) throw new Error(`Unbekannter Marktplatz: ${channel}`);
  return parser;
}

export { amazonParser, backmarketParser, refurbedParser };
