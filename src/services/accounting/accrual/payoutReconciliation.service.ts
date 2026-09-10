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

  async expectedVsActual(marketplace?: string) {
    const channels = marketplace ? [marketplace] : [...MARKETPLACES];
    const summaries = [];

    for (const mp of channels) {
      const [sales, refunds, fees, adjustments, settlements, payouts] = await Promise.all(
        ['SALE', 'REFUND', 'FEE', 'ADJUSTMENT', 'SETTLEMENT', 'PAYOUT'].map((eventType) =>
          this.events.findMany({ marketplace: mp, eventType, status: { $ne: 'void' } }, {
            limit: 5000,
            page: 1,
          }),
        ),
      );

      const sum = (result: any) =>
        (result.data || []).reduce((acc: number, ev: any) => acc + centsOf(ev), 0);

      const expectedFromClearing = sum(settlements) + sum(fees) + sum(refunds) + sum(adjustments);
      const expectedFromSalesNet = sum(sales) + sum(refunds) + sum(fees) + sum(adjustments);
      const expectedCents = expectedFromClearing || expectedFromSalesNet;
      const actualPayoutCents = sum(payouts);
      const differenceCents = expectedCents - actualPayoutCents;

      summaries.push({
        marketplace: mp,
        salesCents: sum(sales),
        refundsCents: sum(refunds),
        feesCents: sum(fees),
        adjustmentsCents: sum(adjustments),
        settlementCents: sum(settlements),
        expectedCents,
        actualPayoutCents,
        differenceCents,
        payoutCount: payouts.data?.length || 0,
        note: 'Payouts are clearing, not revenue. No 1:1 order↔payout match.',
      });
    }

    return { summaries };
  }

  async list(query: Record<string, unknown> = {}) {
    const overview = await this.expectedVsActual(
      query.marketplace ? String(query.marketplace) : undefined,
    );

    const filter: Record<string, unknown> = { eventType: 'PAYOUT' };
    if (query.marketplace) filter.marketplace = query.marketplace;
    if (query.status) filter.status = query.status;

    const payouts = await this.events.findMany(filter, {
      page: query.page,
      limit: query.limit,
      sort: '-eventDate',
    });

    const enriched = [];
    for (const payout of payouts.data) {
      const amountCents = centsOf(payout);
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
