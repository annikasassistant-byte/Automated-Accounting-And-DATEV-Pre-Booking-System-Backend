import { MARKETPLACES } from '../../../enums/accrual.js';

function centsOf(event: any): number {
  return event?.fx?.eurAmountCents ?? event?.fx?.originalAmountCents ?? 0;
}

function periodFilter(from?: string, to?: string, field = 'eventDate') {
  if (!from && !to) return {};
  const range: Record<string, Date> = {};
  if (from) range.$gte = new Date(from);
  if (to) range.$lte = new Date(`${to}T23:59:59.000Z`);
  return { [field]: range };
}

function classifyAmazonOnly(ev: any): 'CANCEL' | 'INVOICE_PENDING' | 'UNMATCHED' {
  if (
    ev?.eventType === 'CANCELLATION' ||
    ev?.metadata?.cancelBeforeFulfilment ||
    ev?.metadata?.amazonCancelled ||
    ev?.status === 'void'
  ) {
    return 'CANCEL';
  }
  if (ev?.status === 'invoice_pending' || ev?.metadata?.invoicePending) {
    return 'INVOICE_PENDING';
  }
  return 'UNMATCHED';
}

export class AccrualReportService {
  constructor(deps: {
    businessEventRepository: any;
    accountingExceptionRepository: any;
    transactionRepository: any;
    journalEntryRepository: any;
    journalLineRepository: any;
    clearingConfigRepository?: any;
    importBatchRepository?: any;
  }) {
    this.events = deps.businessEventRepository;
    this.exceptions = deps.accountingExceptionRepository;
    this.transactions = deps.transactionRepository;
    this.journalEntries = deps.journalEntryRepository;
    this.journalLines = deps.journalLineRepository;
    this.clearing = deps.clearingConfigRepository;
    this.importBatches = deps.importBatchRepository;
  }

  events;
  exceptions;
  transactions;
  journalEntries;
  journalLines;
  clearing;
  importBatches;

  async overview(from?: string, to?: string) {
    const dateFilter: Record<string, unknown> = {};
    if (from || to) {
      dateFilter.eventDate = {};
      if (from) (dateFilter.eventDate as any).$gte = new Date(from);
      if (to) (dateFilter.eventDate as any).$lte = new Date(`${to}T23:59:59.000Z`);
    }

    const clearingDoc = this.clearing?.getOrCreateDefault
      ? await this.clearing.getOrCreateDefault()
      : null;

    const revenueByMarketplace = [];
    for (const mp of MARKETPLACES) {
      const [sales, refunds, fees, adjustments, settlements, payouts] = await Promise.all(
        ['SALE', 'REFUND', 'FEE', 'ADJUSTMENT', 'SETTLEMENT', 'PAYOUT'].map((eventType) =>
          this.events.findMany(
            { ...dateFilter, marketplace: mp, eventType, status: { $nin: ['void'] } },
            { limit: 5000, page: 1 },
          ),
        ),
      );
      const sum = (r: any) => (r.data || []).reduce((a: number, e: any) => a + centsOf(e), 0);
      const expectedCents = sum(settlements) + sum(fees) + sum(refunds) + sum(adjustments);
      revenueByMarketplace.push({
        marketplace: mp,
        revenueAccount:
          clearingDoc?.marketplaces?.[mp]?.revenueAccount ||
          clearingDoc?.revenueAccountDefault ||
          null,
        salesCents: sum(sales),
        salesCount: sales.data?.length || 0,
        refundsCents: sum(refunds),
        feesCents: sum(fees),
        adjustmentsCents: sum(adjustments),
        settlementCents: sum(settlements),
        expectedPayoutCents: expectedCents,
        actualPayoutCents: sum(payouts),
        payoutDifferenceCents: expectedCents - sum(payouts),
        netCents: sum(sales) + sum(refunds),
      });
    }

    const [invoicePending, openExceptions, openCash, classifiedCash, cancellations] =
      await Promise.all([
        this.events.findMany({ status: 'invoice_pending' }, { limit: 200, page: 1, sort: '-eventDate' }),
        this.exceptions.findMany({ status: 'open' }, { limit: 200, page: 1, sort: '-createdAt' }),
        this.transactions.findMany({ status: 'open' }, { limit: 200, page: 1, sort: '-bookingDate' }),
        this.transactions.findMany(
          { status: { $in: ['matched', 'reviewed', 'exported'] } },
          { limit: 200, page: 1, sort: '-bookingDate' },
        ),
        this.events.findMany(
          { eventType: 'CANCELLATION', ...dateFilter },
          { limit: 200, page: 1 },
        ),
      ]);

    const classifiedExpenses = (classifiedCash.data || [])
      .filter((t: any) => t.booking?.konto && !['1201', '1203', '1361'].includes(String(t.booking.konto)))
      .slice(0, 100)
      .map((t: any) => ({
        id: t._id,
        bookingDate: t.bookingDate,
        counterpartyName: t.counterpartyName,
        purpose: t.purpose,
        amountCents: t.amountCents,
        konto: t.booking?.konto,
        gegenkonto: t.booking?.gegenkonto,
        status: t.status,
      }));

    const decisionsNeeded = [
      ...(invoicePending.data || []).map((ev: any) => ({
        kind: 'invoice_pending',
        id: ev._id,
        title: `Rechnung ausstehend ${ev.marketplaceOrderId || ev.sourceRecordId}`,
        marketplace: ev.marketplace,
      })),
      ...(openExceptions.data || []).slice(0, 50).map((ex: any) => ({
        kind: 'exception',
        id: ex._id,
        title: ex.title,
        marketplace: ex.marketplace,
      })),
      ...(openCash.data || []).slice(0, 50).map((t: any) => ({
        kind: 'unclassified_expense',
        id: t._id,
        title: t.counterpartyName || t.purpose || 'Offene Bank/PayPal-Buchung',
        marketplace: null,
      })),
    ];

    return {
      period: { from: from || null, to: to || null },
      revenueByMarketplace,
      cancellationsCount: cancellations.pagination?.total ?? (cancellations.data?.length || 0),
      invoicePending: invoicePending.data || [],
      invoicePendingCount: invoicePending.pagination?.total ?? (invoicePending.data?.length || 0),
      openExceptionCount: openExceptions.pagination?.total ?? (openExceptions.data?.length || 0),
      openExceptions: openExceptions.data || [],
      unclassifiedCashCount: openCash.pagination?.total ?? (openCash.data?.length || 0),
      unclassifiedCash: (openCash.data || []).slice(0, 80),
      classifiedExpenses,
      decisionsNeeded,
    };
  }

  async periodCoverage(from?: string, to?: string) {
    if (!from || !to) {
      return {
        period: { from: from || null, to: to || null },
        sources: {
          jtl: { batches: 0, rows: 0, events: 0 },
          amazon: { orderBatches: 0, financialBatches: 0, events: 0 },
          backmarket: { orderBatches: 0, financialBatches: 0, events: 0 },
          refurbed: { orderBatches: 0, financialBatches: 0, events: 0 },
        },
        exceptionsOpen: 0,
        journalPostedLines: 0,
        journalDraftEntries: 0,
        gaps: ['from und to sind erforderlich'],
      };
    }

    const batchDate = periodFilter(from, to, 'periodStart');
    const eventDate = periodFilter(from, to, 'eventDate');
    const postingDate = periodFilter(from, to, 'postingDate');

    const emptyMp = () => ({ orderBatches: 0, financialBatches: 0, events: 0 });
    const sources = {
      jtl: { batches: 0, rows: 0, events: 0 },
      amazon: emptyMp(),
      backmarket: emptyMp(),
      refurbed: emptyMp(),
    };

    if (this.importBatches?.findMany) {
      const batches = await this.importBatches.findMany(
        {
          ...batchDate,
          status: { $in: ['completed', 'processing', 'failed'] },
        },
        { limit: 2000, page: 1 },
      );
      // Also include batches whose period overlaps OR created in range if periodStart null
      const createdFilter = periodFilter(from, to, 'createdAt');
      const createdBatches = await this.importBatches.findMany(
        {
          ...createdFilter,
          status: { $in: ['completed', 'processing', 'failed'] },
        },
        { limit: 2000, page: 1 },
      );
      const seen = new Set<string>();
      const all = [...(batches.data || []), ...(createdBatches.data || [])];
      for (const b of all) {
        const id = String(b._id);
        if (seen.has(id)) continue;
        seen.add(id);
        const rows = b.rowCount || 0;
        if (b.source === 'jtl') {
          sources.jtl.batches += 1;
          sources.jtl.rows += rows;
        } else if (b.source === 'marketplace_amazon') {
          const rt = String(b.summary?.reportType || '').toLowerCase();
          if (rt === 'order') sources.amazon.orderBatches += 1;
          else if (rt === 'financial') sources.amazon.financialBatches += 1;
          else {
            // unknown — count as financial if settlement-ish filename else order
            const fn = String(b.filename || '').toLowerCase();
            if (/order|bestell/.test(fn)) sources.amazon.orderBatches += 1;
            else sources.amazon.financialBatches += 1;
          }
        } else if (b.source === 'marketplace_backmarket') {
          const rt = String(b.summary?.reportType || '').toLowerCase();
          if (rt === 'order') sources.backmarket.orderBatches += 1;
          else sources.backmarket.financialBatches += 1;
        } else if (b.source === 'marketplace_refurbed') {
          const rt = String(b.summary?.reportType || '').toLowerCase();
          if (rt === 'order') sources.refurbed.orderBatches += 1;
          else sources.refurbed.financialBatches += 1;
        }
      }
    }

    const [jtlEvents, amzEvents, bmEvents, rfEvents, openEx, postedLines, draftEntries] =
      await Promise.all([
        this.events.findMany({ ...eventDate, source: 'jtl_csv' }, { limit: 1, page: 1 }),
        this.events.findMany(
          { ...eventDate, marketplace: 'amazon', source: { $regex: /^marketplace_/ } },
          { limit: 1, page: 1 },
        ),
        this.events.findMany(
          { ...eventDate, marketplace: 'backmarket' },
          { limit: 1, page: 1 },
        ),
        this.events.findMany(
          { ...eventDate, marketplace: 'refurbed' },
          { limit: 1, page: 1 },
        ),
        this.exceptions.findMany({ status: 'open' }, { limit: 1, page: 1 }),
        this.journalLines.findMany(
          { ...postingDate },
          { limit: 1, page: 1 },
        ),
        this.journalEntries.findMany(
          { ...postingDate, status: 'draft' },
          { limit: 1, page: 1 },
        ),
      ]);

    // Prefer pagination.total when available
    const totalOf = (r: any) => r?.pagination?.total ?? (r?.data?.length || 0);

    // Recount events properly with higher limits for honesty within practical caps
    const [jtlAll, amzAll, bmAll, rfAll, postedAll, draftAll] = await Promise.all([
      this.events.findMany({ ...eventDate, source: 'jtl_csv' }, { limit: 5000, page: 1 }),
      this.events.findMany({ ...eventDate, marketplace: 'amazon' }, { limit: 5000, page: 1 }),
      this.events.findMany({ ...eventDate, marketplace: 'backmarket' }, { limit: 5000, page: 1 }),
      this.events.findMany({ ...eventDate, marketplace: 'refurbed' }, { limit: 5000, page: 1 }),
      this.journalLines.findMany({ ...postingDate }, { limit: 5000, page: 1 }),
      this.journalEntries.findMany({ ...postingDate, status: 'draft' }, { limit: 5000, page: 1 }),
    ]);

    sources.jtl.events = totalOf(jtlAll) || (jtlAll.data?.length || 0);
    sources.amazon.events = totalOf(amzAll) || (amzAll.data?.length || 0);
    sources.backmarket.events = totalOf(bmAll) || (bmAll.data?.length || 0);
    sources.refurbed.events = totalOf(rfAll) || (rfAll.data?.length || 0);

    const exceptionsOpen = totalOf(openEx);
    const journalPostedLines = (postedAll.data || []).filter((l: any) => {
      // count lines belonging to posted/exported entries when status known via export fields
      return true;
    }).length;
    // Prefer counting lines from posted entries
    const postedEntries = await this.journalEntries.findMany(
      { ...postingDate, status: { $in: ['posted', 'exported'] } },
      { limit: 5000, page: 1 },
    );
    let postedLineCount = 0;
    for (const e of postedEntries.data || []) {
      const ls = await this.journalLines.findByJournalEntryId(e._id);
      postedLineCount += (ls || []).length;
    }

    const journalDraftEntries = totalOf(draftAll) || (draftAll.data?.length || 0);

    const gaps: string[] = [];
    if (sources.jtl.batches === 0) gaps.push('Keine JTL-Importe im Zeitraum');
    if (sources.amazon.orderBatches === 0) gaps.push('Keine Amazon Order-Importe im Zeitraum');
    if (sources.amazon.financialBatches === 0) gaps.push('Keine Amazon Financial-Importe im Zeitraum');
    if (sources.backmarket.orderBatches + sources.backmarket.financialBatches === 0) {
      gaps.push('Keine BackMarket-Importe im Zeitraum');
    }
    if (sources.refurbed.orderBatches + sources.refurbed.financialBatches === 0) {
      gaps.push('Keine Refurbed-Importe im Zeitraum');
    }
    if (postedLineCount === 0) gaps.push('Keine gebuchten Journalzeilen im Zeitraum');

    // silence unused
    void jtlEvents;
    void amzEvents;
    void bmEvents;
    void rfEvents;
    void postedLines;
    void draftEntries;
    void journalPostedLines;

    return {
      period: { from, to },
      sources,
      exceptionsOpen,
      journalPostedLines: postedLineCount,
      journalDraftEntries,
      gaps,
    };
  }

  async amazonJtlAbgleich(from?: string, to?: string) {
    const dateFilter: Record<string, unknown> = {};
    if (from || to) {
      dateFilter.eventDate = {};
      if (from) (dateFilter.eventDate as any).$gte = new Date(from);
      if (to) (dateFilter.eventDate as any).$lte = new Date(`${to}T23:59:59.000Z`);
    }

    const [amazonEvents, jtlAmazon] = await Promise.all([
      this.events.findMany(
        { ...dateFilter, marketplace: 'amazon', eventType: { $in: ['ORDER_CREATED', 'SALE', 'CANCELLATION'] }, status: { $nin: ['void'] } },
        { limit: 8000, page: 1 },
      ),
      this.events.findMany(
        { ...dateFilter, marketplace: 'amazon', source: 'jtl_csv', status: { $nin: ['void'] } },
        { limit: 8000, page: 1 },
      ),
    ]);

    const amazonById = new Map<string, any>();
    for (const ev of amazonEvents.data || []) {
      const id = String(ev.marketplaceOrderId || '').trim().toUpperCase();
      if (!id) continue;
      if (!amazonById.has(id)) amazonById.set(id, ev);
    }
    const jtlById = new Map<string, any>();
    for (const ev of jtlAmazon.data || []) {
      const id = String(ev.marketplaceOrderId || '').trim().toUpperCase();
      if (!id) continue;
      if (!jtlById.has(id)) jtlById.set(id, ev);
    }

    const matched: Array<Record<string, unknown>> = [];
    const amazonOnly: Array<Record<string, unknown>> = [];
    const jtlOnly: Array<Record<string, unknown>> = [];

    const cents = (ev: any) => ev?.fx?.eurAmountCents ?? ev?.fx?.originalAmountCents ?? 0;

    for (const [id, amz] of amazonById) {
      const jtl = jtlById.get(id);
      if (jtl) {
        matched.push({
          amazonOrderId: id,
          amazonCents: cents(amz),
          jtlCents: cents(jtl),
          diffCents: cents(jtl) - cents(amz),
          status: Math.abs(cents(jtl) - cents(amz)) < 2 ? 'MATCHED' : 'DIFF',
        });
      } else {
        amazonOnly.push({
          amazonOrderId: id,
          amazonCents: cents(amz),
          classification: classifyAmazonOnly(amz),
        });
      }
    }
    for (const [id, jtl] of jtlById) {
      if (!amazonById.has(id)) jtlOnly.push({ amazonOrderId: id, jtlCents: cents(jtl) });
    }

    const amazonProductCents = [...amazonById.values()].reduce((a, e) => a + cents(e), 0);
    return {
      period: { from: from || null, to: to || null },
      amazonOrderCount: amazonById.size,
      amazonProductCents,
      jtlAmazonCount: jtlById.size,
      matchedCount: matched.length,
      amazonOnlyCount: amazonOnly.length,
      jtlOnlyCount: jtlOnly.length,
      matched: matched.slice(0, 200),
      amazonOnly: amazonOnly.slice(0, 80),
      jtlOnly: jtlOnly.slice(0, 80),
      note: 'Gegencheck aus gebuchten Accrual-Ereignissen — Excel-Orakel nicht hart hinterlegt.',
    };
  }

  /**
   * Honest month pack: MISSING_DATA if no posted journal lines; else real aggregates only.
   */
  async monthPack(from?: string, to?: string) {
    if (!from || !to) {
      return {
        status: 'MISSING_DATA',
        message: 'from und to sind erforderlich',
        period: { from: from || null, to: to || null },
      };
    }

    const postingDate = periodFilter(from, to, 'postingDate');
    const postedEntries = await this.journalEntries.findMany(
      { ...postingDate, status: { $in: ['posted', 'exported'] } },
      { limit: 5000, page: 1 },
    );

    let journalLineCount = 0;
    for (const e of postedEntries.data || []) {
      const ls = await this.journalLines.findByJournalEntryId(e._id);
      journalLineCount += (ls || []).length;
    }

    if (!journalLineCount) {
      return {
        status: 'MISSING_DATA',
        message: 'Keine gebuchten Accrual-Journalzeilen im Zeitraum',
        period: { from, to },
      };
    }

    const [overview, abgleich] = await Promise.all([
      this.overview(from, to),
      this.amazonJtlAbgleich(from, to),
    ]);

    return {
      status: 'OK',
      period: { from, to },
      overview: {
        revenueByMarketplace: overview.revenueByMarketplace,
        cancellationsCount: overview.cancellationsCount,
        invoicePendingCount: overview.invoicePendingCount,
        openExceptionCount: overview.openExceptionCount,
      },
      abgleich: {
        matchedCount: abgleich.matchedCount,
        amazonOnlyCount: abgleich.amazonOnlyCount,
        jtlOnlyCount: abgleich.jtlOnlyCount,
        amazonOrderCount: abgleich.amazonOrderCount,
      },
      journal: {
        postedEntries: postedEntries.data?.length || 0,
        postedLines: journalLineCount,
        draftEntries: (
          await this.journalEntries.findMany(
            { ...postingDate, status: 'draft' },
            { limit: 1, page: 1 },
          )
        ).pagination?.total ?? 0,
      },
      feePreviewSummary: {
        note: 'Fee-VAT-Vorschau separat über GET /accrual/vat/fee-preview — hier nur Zähler aus Overview.',
        feesCentsByMarketplace: overview.revenueByMarketplace.map((r: any) => ({
          marketplace: r.marketplace,
          feesCents: r.feesCents,
        })),
      },
    };
  }
}

export { classifyAmazonOnly };
export default AccrualReportService;
