import { ApiError } from '../../../utils/ApiError.js';

/**
 * Posts FX true-up deltas when marketplace EUR actual differs from provisional ECB booked amount.
 * Does NOT change FxService.resolve priority (marketplace EUR still wins at import).
 */
export class FxTrueUpService {
  constructor(deps: {
    businessEventRepository: any;
    journalEntryRepository: any;
    journalLineRepository: any;
    marketplaceTxnRepository: any;
    clearingConfigRepository: any;
    accountingExceptionRepository: any;
    auditRepository?: any;
  }) {
    this.events = deps.businessEventRepository;
    this.entries = deps.journalEntryRepository;
    this.lines = deps.journalLineRepository;
    this.marketplaceTxns = deps.marketplaceTxnRepository;
    this.clearing = deps.clearingConfigRepository;
    this.exceptions = deps.accountingExceptionRepository;
    this.audit = deps.auditRepository;
  }

  events;
  entries;
  lines;
  marketplaceTxns;
  clearing;
  exceptions;
  audit;

  async trueUpEvent(eventId: string, userId?: string, ctx: Record<string, unknown> = {}) {
    const event = await this.events.findById(eventId);
    if (!event) throw ApiError.notFound('Geschäftsvorfall nicht gefunden');

    if (event.metadata?.fxTrueUp?.posted) {
      throw ApiError.badRequest('FX True-up bereits gebucht');
    }

    const entry = await this.entries.findByBusinessEventId(eventId);
    if (!entry || !['posted', 'exported'].includes(entry.status)) {
      throw ApiError.badRequest('Kein gebuchtes Journal für FX True-up');
    }

    const journalLines = await this.lines.findByJournalEntryId(entry._id);
    const primary = (journalLines || []).find((l: any) => l.lineOrder === 1) || journalLines?.[0];
    const bookedEurCents = Math.abs(
      primary?.eurAmountCents ?? primary?.amountCents ?? event.fx?.eurAmountCents ?? 0,
    );

    const provisionalEurCents =
      event.metadata?.provisionalFx?.eurAmountCents ??
      (event.fx?.exchangeRateSource === 'ECB' ? event.fx?.eurAmountCents : null) ??
      bookedEurCents;

    const actual = await this.#resolveMarketplaceActual(event);
    if (actual == null || !Number.isFinite(actual.eurAmountCents)) {
      throw ApiError.badRequest('Kein Marktplatz-EUR (actual) für True-up vorhanden');
    }

    const deltaCents = Math.round(actual.eurAmountCents) - Math.round(provisionalEurCents);
    if (deltaCents === 0) {
      await this.#resolveFxExceptions(eventId, userId, 'Delta 0 — kein True-up nötig');
      return {
        eventId,
        deltaCents: 0,
        provisionalEurCents,
        actualEurCents: actual.eurAmountCents,
        posted: false,
        message: 'Kein Differenzbetrag',
      };
    }

    const config = await this.clearing.getOrCreateDefault();
    if (!config.provisionalFxEnabled) {
      throw ApiError.badRequest('Provisorisches FX ist deaktiviert (provisionalFxEnabled=false)');
    }

    const mpAccounts = config.marketplaces?.[event.marketplace] || {};
    const fxGain = mpAccounts.fxGainAccount;
    const fxLoss = mpAccounts.fxLossAccount;
    const clearingAccount = mpAccounts.clearingAccount;
    if (!fxGain || !fxLoss || !clearingAccount) {
      throw ApiError.badRequest('FX-/Clearing-Konten nicht konfiguriert');
    }

    const absDelta = Math.abs(deltaCents);
    const postingDate = event.accountingDate || event.eventDate || new Date();
    const isGain = deltaCents > 0;
    // Gain: S clearing / H fxGain — Loss: S fxLoss / H clearing
    const linePayload = isGain
      ? [
          {
            accountNumber: clearingAccount,
            sollHaben: 'S' as const,
            bookingText: `FX True-up gain ${event.marketplaceOrderId || event.sourceRecordId}`,
          },
          {
            accountNumber: fxGain,
            sollHaben: 'H' as const,
            bookingText: `FX True-up gain ${event.marketplaceOrderId || event.sourceRecordId}`,
          },
        ]
      : [
          {
            accountNumber: fxLoss,
            sollHaben: 'S' as const,
            bookingText: `FX True-up loss ${event.marketplaceOrderId || event.sourceRecordId}`,
          },
          {
            accountNumber: clearingAccount,
            sollHaben: 'H' as const,
            bookingText: `FX True-up loss ${event.marketplaceOrderId || event.sourceRecordId}`,
          },
        ];

    const trueUpEntry = await this.entries.create({
      businessEventId: eventId,
      postingDate,
      description: `FX True-up ${isGain ? 'gain' : 'loss'} ${event.marketplaceOrderId || event.sourceRecordId}`,
      status: 'posted',
      metadata: {
        kind: 'fx_true_up',
        provisionalEurCents,
        actualEurCents: actual.eurAmountCents,
        deltaCents,
        provisionalRate: event.metadata?.provisionalFx?.exchangeRate ?? event.fx?.exchangeRate,
        actualRate: actual.exchangeRate,
        actualRateSource: actual.exchangeRateSource,
      },
    });

    const createdLines = [];
    let order = 1;
    for (const lp of linePayload) {
      createdLines.push(
        await this.lines.create({
          journalEntryId: trueUpEntry._id,
          businessEventId: eventId,
          accountNumber: lp.accountNumber,
          sollHaben: lp.sollHaben,
          amountCents: absDelta,
          currency: 'EUR',
          eurAmountCents: absDelta,
          postingDate,
          bookingText: lp.bookingText,
          lineOrder: order++,
          sourceReference: 'fx_true_up',
        }),
      );
    }

    await this.events.update(eventId, {
      fx: {
        ...(event.fx || {}),
        eurAmountCents: actual.eurAmountCents,
        exchangeRate: actual.exchangeRate ?? event.fx?.exchangeRate,
        exchangeRateDate: actual.exchangeRateDate ?? event.fx?.exchangeRateDate,
        exchangeRateSource: actual.exchangeRateSource || 'marketplace',
      },
      metadata: {
        ...(event.metadata || {}),
        provisionalFx: {
          eurAmountCents: provisionalEurCents,
          exchangeRate: event.fx?.exchangeRate,
          exchangeRateSource: event.fx?.exchangeRateSource || 'ECB',
        },
        fxTrueUp: {
          posted: true,
          postedAt: new Date(),
          journalEntryId: trueUpEntry._id,
          provisionalEurCents,
          actualEurCents: actual.eurAmountCents,
          deltaCents,
          actualRate: actual.exchangeRate,
          actualRateSource: actual.exchangeRateSource,
        },
      },
    });

    await this.#resolveFxExceptions(eventId, userId, `FX True-up gebucht (delta ${deltaCents} ct)`);

    await this.audit?.log({
      actor: userId,
      action: 'accrual.fx.true_up',
      resource: 'businessEvent',
      resourceId: eventId,
      meta: { deltaCents, provisionalEurCents, actualEurCents: actual.eurAmountCents },
      ip: (ctx as any).ip,
      userAgent: (ctx as any).userAgent,
    });

    return {
      eventId,
      deltaCents,
      provisionalEurCents,
      actualEurCents: actual.eurAmountCents,
      posted: true,
      entry: trueUpEntry,
      lines: createdLines,
    };
  }

  async trueUpPeriod(from: string, to: string, userId?: string, ctx: Record<string, unknown> = {}) {
    if (!from || !to) throw ApiError.badRequest('from und to sind erforderlich');
    const openFx = await this.exceptions.findMany(
      {
        exceptionType: 'FX_REVIEW',
        status: 'open',
      },
      { limit: 2000, page: 1 },
    );

    const events = await this.events.findMany(
      {
        eventDate: {
          $gte: new Date(from),
          $lte: new Date(`${to}T23:59:59.000Z`),
        },
        status: { $in: ['posted', 'matched', 'draft'] },
        'fx.exchangeRateSource': 'ECB',
        'fx.originalCurrency': { $ne: 'EUR' },
      },
      { limit: 2000, page: 1 },
    );

    const ids = new Set<string>();
    for (const ex of openFx.data || []) {
      if (ex.businessEventId) ids.add(String(ex.businessEventId));
    }
    for (const ev of events.data || []) {
      ids.add(String(ev._id));
    }

    let posted = 0;
    const skipped: Array<{ eventId: string; reason: string }> = [];
    for (const eventId of ids) {
      try {
        const result = await this.trueUpEvent(eventId, userId, ctx);
        if (result.posted) posted += 1;
        else skipped.push({ eventId, reason: 'zero_delta' });
      } catch (err: any) {
        skipped.push({ eventId, reason: err?.message || 'error' });
      }
    }
    return { posted, skipped, considered: ids.size };
  }

  async #resolveMarketplaceActual(event: any): Promise<{
    eurAmountCents: number;
    exchangeRate: number | null;
    exchangeRateDate: Date | null;
    exchangeRateSource: string;
  } | null> {
    if (
      event.fx?.exchangeRateSource === 'marketplace' &&
      event.fx?.eurAmountCents != null &&
      event.metadata?.provisionalFx?.eurAmountCents != null
    ) {
      return {
        eurAmountCents: event.fx.eurAmountCents,
        exchangeRate: event.fx.exchangeRate,
        exchangeRateDate: event.fx.exchangeRateDate,
        exchangeRateSource: 'marketplace',
      };
    }

    const txns = await this.marketplaceTxns.findMany(
      { businessEventId: event._id },
      { limit: 20, page: 1 },
    );
    const withMarket = (txns.data || []).find(
      (t: any) =>
        t.exchangeRateSource === 'marketplace' &&
        t.eurAmountCents != null &&
        Number.isFinite(t.eurAmountCents),
    );
    if (withMarket) {
      return {
        eurAmountCents: withMarket.eurAmountCents,
        exchangeRate: withMarket.exchangeRate,
        exchangeRateDate: withMarket.exchangeRateDate,
        exchangeRateSource: 'marketplace',
      };
    }

    // Fallback: same order id with marketplace FX on another txn
    if (event.marketplaceOrderId) {
      const byOrder = await this.marketplaceTxns.findMany(
        {
          marketplace: event.marketplace,
          marketplaceOrderId: event.marketplaceOrderId,
          exchangeRateSource: 'marketplace',
          eurAmountCents: { $ne: null },
        },
        { limit: 10, page: 1 },
      );
      const hit = (byOrder.data || [])[0];
      if (hit) {
        return {
          eurAmountCents: hit.eurAmountCents,
          exchangeRate: hit.exchangeRate,
          exchangeRateDate: hit.exchangeRateDate,
          exchangeRateSource: 'marketplace',
        };
      }
    }

    return null;
  }

  async #resolveFxExceptions(eventId: string, userId?: string, note?: string) {
    const open = await this.exceptions.findMany(
      {
        businessEventId: eventId,
        exceptionType: 'FX_REVIEW',
        status: 'open',
      },
      { limit: 50, page: 1 },
    );
    for (const doc of open.data || []) {
      await this.exceptions.update(doc._id, {
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedBy: userId || null,
        resolutionNote: note || 'FX True-up',
      });
    }
  }
}

export default FxTrueUpService;
