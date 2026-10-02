import { ApiError } from '../../../utils/ApiError.js';
import { MARKETPLACES } from '../../../enums/accrual.js';

function centsOf(event: any): number {
  return event?.fx?.eurAmountCents ?? event?.fx?.originalAmountCents ?? 0;
}

export class PayoutReconciliationService {
  constructor(deps: {
    businessEventRepository: any;
    transactionRepository: any;
    marketplaceTxnRepository: any;
  }) {
    this.events = deps.businessEventRepository;
    this.transactions = deps.transactionRepository;
    this.marketplaceTxns = deps.marketplaceTxnRepository;
  }

  events;
  transactions;
  marketplaceTxns;

  async expectedVsActual(marketplace?: string, from?: string, to?: string) {
    const channels = marketplace ? [marketplace] : [...MARKETPLACES];
    const summaries = [];
    const dateFilter: Record<string, unknown> = {};
    if (from || to) {
      dateFilter.eventDate = {};
      if (from) (dateFilter.eventDate as any).$gte = new Date(String(from));
      if (to) {
        (dateFilter.eventDate as any).$lte = new Date(`${String(to).slice(0, 10)}T23:59:59.000Z`);
      }
    }

    for (const mp of channels) {
      const base = { marketplace: mp, status: { $ne: 'void' }, ...dateFilter };
      const [sales, refunds, fees, adjustments, settlements, payouts] = await Promise.all(
        ['SALE', 'REFUND', 'FEE', 'ADJUSTMENT', 'SETTLEMENT', 'PAYOUT'].map((eventType) =>
          this.events.findMany({ ...base, eventType }, {
            limit: 5000,
            page: 1,
          }),
        ),
      );

      const sum = (result: any) =>
        (result.data || []).reduce((acc: number, ev: any) => acc + centsOf(ev), 0);

      const deferredReleased = (payouts.data || []).filter((ev: any) =>
        /deferred_payout_released/i.test(String(ev.metadata?.txnSubtype || ev.sourceRecordId || '')),
      );
      const deferredRetained = (payouts.data || []).filter((ev: any) =>
        /deferred_payout_retained/i.test(String(ev.metadata?.txnSubtype || ev.sourceRecordId || '')),
      );

      const expectedFromClearing = sum(settlements) + sum(fees) + sum(refunds) + sum(adjustments);
      const expectedFromSalesNet = sum(sales) + sum(refunds) + sum(fees) + sum(adjustments);
      const expectedCents = expectedFromClearing || expectedFromSalesNet;
      const actualPayoutCents = sum(payouts);
      const differenceCents = expectedCents - actualPayoutCents;
      const hasAnyData =
        (sales.data?.length || 0) +
          (refunds.data?.length || 0) +
          (fees.data?.length || 0) +
          (settlements.data?.length || 0) +
          (payouts.data?.length || 0) >
        0;

      let dataStatus: 'no_data' | 'zero' | 'open' | 'reconciled' = 'no_data';
      if (!hasAnyData) dataStatus = 'no_data';
      else if (Math.abs(differenceCents) < 1 && actualPayoutCents !== 0) dataStatus = 'reconciled';
      else if (expectedCents === 0 && actualPayoutCents === 0) dataStatus = 'zero';
      else dataStatus = 'open';

      summaries.push({
        marketplace: mp,
        periodFrom: from || null,
        periodTo: to || null,
        salesCents: sum(sales),
        refundsCents: sum(refunds),
        feesCents: sum(fees),
        adjustmentsCents: sum(adjustments),
        settlementCents: sum(settlements),
        expectedCents,
        actualPayoutCents,
        differenceCents,
        payoutCount: payouts.data?.length || 0,
        salesCount: sales.data?.length || 0,
        settlementCount: settlements.data?.length || 0,
        deferredReleasedCount: deferredReleased.length,
        deferredRetainedCount: deferredRetained.length,
        dataStatus,
        components: {
          settlements: sum(settlements),
          fees: sum(fees),
          refunds: sum(refunds),
          adjustments: sum(adjustments),
          salesNetFallback: expectedFromClearing ? null : sum(sales) + sum(refunds),
        },
        note:
          'Payouts are clearing, not revenue. deferred_payout_* = retained-balance movements, not always external cash. No 1:1 order↔payout match.',
      });
    }

    return { summaries, periodFrom: from || null, periodTo: to || null };
  }

  async list(query: Record<string, unknown> = {}) {
    const from = query.from ? String(query.from) : undefined;
    const to = query.to ? String(query.to) : undefined;
    const overview = await this.expectedVsActual(
      query.marketplace ? String(query.marketplace) : undefined,
      from,
      to,
    );

    const filter: Record<string, unknown> = { eventType: 'PAYOUT' };
    if (query.marketplace) filter.marketplace = query.marketplace;
    if (query.status) filter.status = query.status;
    if (from || to) {
      filter.eventDate = {};
      if (from) (filter.eventDate as any).$gte = new Date(from);
      if (to) (filter.eventDate as any).$lte = new Date(`${to.slice(0, 10)}T23:59:59.000Z`);
    }

    const payouts = await this.events.findMany(filter, {
      page: query.page,
      limit: query.limit,
      sort: '-eventDate',
    });

    const enriched = [];
    for (const payout of payouts.data) {
      const amountCents = centsOf(payout);
      const subtype = String(payout.metadata?.txnSubtype || payout.eventSubtype || '');
      const isDeferred = /deferred_payout/i.test(subtype) || /deferred_payout/i.test(String(payout.sourceRecordId || ''));
      const candidates = await this.transactions.findMany(
        {
          amountCents: { $gte: amountCents - 100, $lte: amountCents + 100 },
          source: { $in: ['bank', 'paypal'] },
        },
        { limit: 5, page: 1, sort: '-bookingDate' },
      );
      enriched.push({
        payout,
        candidateTransactions: candidates.data,
        reconStatus: payout.metadata?.linkedTransactionId ? 'MATCHED' : 'UNMATCHED',
        classification: isDeferred
          ? /released/i.test(subtype)
            ? 'deferred_payout_released'
            : 'deferred_payout_retained'
          : 'external_payout_candidate',
        expectedCents:
          overview.summaries.find((s) => s.marketplace === payout.marketplace)?.expectedCents ?? null,
      });
    }

    return { data: enriched, pagination: payouts.pagination, overview };
  }

  async manualMatch(payoutEventId: string, transactionId: string, userId: string) {
    const payout = await this.events.findById(payoutEventId);
    if (!payout || payout.eventType !== 'PAYOUT') {
      throw ApiError.notFound('Payout-Geschäftsvorfall nicht gefunden');
    }
    const tx = await this.transactions.findById(transactionId);
    if (!tx) throw ApiError.notFound('Transaktion nicht gefunden');

    const updated = await this.events.update(payoutEventId, {
      status: 'matched',
      matchStatus: 'MATCHED',
      metadata: {
        ...(payout.metadata || {}),
        linkedTransactionId: transactionId,
        matchedBy: userId,
        matchedAt: new Date().toISOString(),
      },
    });

    return { payout: updated, transaction: tx };
  }
}

export default PayoutReconciliationService;
