import amazonParser from './amazon-parser.js';
import backmarketParser from './backmarket-parser.js';
import backmarketOrderParser from './backmarket-order-parser.js';
import refurbedParser from './refurbed-parser.js';
import type { Marketplace } from '../../../enums/accrual.js';
import type { MarketplaceParser, MarketplaceReportType } from './marketplace-types.js';
import { detectBackMarketReportType } from './marketplace-types.js';

const parsers: Record<Marketplace, MarketplaceParser> = {
  amazon: amazonParser,
  backmarket: backmarketParser,
  refurbed: refurbedParser,
};

export function getMarketplaceParser(
  channel: Marketplace,
  reportType: MarketplaceReportType = 'auto',
  content?: string,
): MarketplaceParser {
  if (channel === 'backmarket') {
    let kind: 'order' | 'financial' = 'financial';
    if (reportType === 'order') kind = 'order';
    else if (reportType === 'financial') kind = 'financial';
    else if (content) kind = detectBackMarketReportType(content);
    return kind === 'order' ? backmarketOrderParser : backmarketParser;
  }

  const parser = parsers[channel];
  if (!parser) throw new Error(`Unbekannter Marktplatz: ${channel}`);
  return parser;
}

export { amazonParser, backmarketParser, backmarketOrderParser, refurbedParser };
