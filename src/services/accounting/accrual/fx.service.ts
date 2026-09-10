/**
 * ECB Euro foreign exchange reference rates (via Frankfurter, ECB source).
 * Marketplace actual EUR / rate always wins over ECB.
 */

const FRANKFURTER = 'https://api.frankfurter.app';

type FxQuote = {
  rate: number;
  rateDate: string;
  source: 'ECB' | 'marketplace';
};

const memoryCache = new Map<string, FxQuote>();

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addUtcDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return toIsoDate(d);
}

export class FxService {
  async getEcbRate(fromCurrency: string, accountingDate: Date): Promise<FxQuote | null> {
    const from = String(fromCurrency || 'EUR').toUpperCase();
    if (from === 'EUR') {
      return { rate: 1, rateDate: toIsoDate(accountingDate), source: 'ECB' };
    }

    const start = toIsoDate(accountingDate);
    const cacheKey = `${from}|${start}`;
    if (memoryCache.has(cacheKey)) return memoryCache.get(cacheKey) || null;

    for (let i = 0; i < 12; i += 1) {
      const iso = addUtcDays(start, -i);
      try {
        const url = `${FRANKFURTER}/${iso}?from=${encodeURIComponent(from)}&to=EUR`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;
        const json = (await res.json()) as { date?: string; rates?: { EUR?: number } };
        const rate = json.rates?.EUR;
        if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
          const quote: FxQuote = {
            rate,
            rateDate: json.date || iso,
            source: 'ECB',
          };
          memoryCache.set(cacheKey, quote);
          return quote;
        }
      } catch {
        /* try previous day */
      }
    }
    return null;
  }

  /**
   * Resolve EUR amount. Marketplace settlement/rate wins; else ECB daily (or last prior day).
   */
  async resolve(input: {
    originalCurrency: string;
    originalAmountCents: number;
    txnDate: Date;
    marketplaceEurCents?: number | null;
    marketplaceRate?: number | null;
    marketplaceRateDate?: Date | null;
    marketplaceRateSource?: string | null;
  }): Promise<{
    originalCurrency: string;
    originalAmountCents: number;
    eurAmountCents: number | null;
    exchangeRate: number | null;
    exchangeRateDate: Date | null;
    exchangeRateSource: string | null;
    fxReview: boolean;
  }> {
    const originalCurrency = String(input.originalCurrency || 'EUR').toUpperCase();
    const originalAmountCents = input.originalAmountCents ?? 0;

    if (
      input.marketplaceEurCents != null &&
      Number.isFinite(input.marketplaceEurCents) &&
      originalCurrency !== 'EUR'
    ) {
      const rate =
        originalAmountCents !== 0
          ? Math.abs(input.marketplaceEurCents / originalAmountCents)
          : input.marketplaceRate || null;
      return {
        originalCurrency,
        originalAmountCents,
        eurAmountCents: input.marketplaceEurCents,
        exchangeRate: rate,
        exchangeRateDate: input.marketplaceRateDate || input.txnDate,
        exchangeRateSource: input.marketplaceRateSource || 'marketplace',
        fxReview: false,
      };
    }

    if (input.marketplaceRate && Number.isFinite(input.marketplaceRate) && originalCurrency !== 'EUR') {
      return {
        originalCurrency,
        originalAmountCents,
        eurAmountCents: Math.round(originalAmountCents * input.marketplaceRate),
        exchangeRate: input.marketplaceRate,
        exchangeRateDate: input.marketplaceRateDate || input.txnDate,
        exchangeRateSource: 'marketplace',
        fxReview: false,
      };
    }

    if (originalCurrency === 'EUR') {
      return {
        originalCurrency,
        originalAmountCents,
        eurAmountCents: originalAmountCents,
        exchangeRate: 1,
        exchangeRateDate: input.txnDate,
        exchangeRateSource: 'ECB',
        fxReview: false,
      };
    }

    const quote = await this.getEcbRate(originalCurrency, input.txnDate);
    if (!quote) {
      return {
        originalCurrency,
        originalAmountCents,
        eurAmountCents: null,
        exchangeRate: null,
        exchangeRateDate: null,
        exchangeRateSource: null,
        fxReview: true,
      };
    }

    return {
      originalCurrency,
      originalAmountCents,
      eurAmountCents: Math.round(originalAmountCents * quote.rate),
      exchangeRate: quote.rate,
      exchangeRateDate: new Date(`${quote.rateDate}T00:00:00.000Z`),
      exchangeRateSource: 'ECB',
      fxReview: false,
    };
  }
}

export default FxService;
