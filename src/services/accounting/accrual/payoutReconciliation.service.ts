import { ApiError } from '../../../utils/ApiError.js';

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

  async list(query: Record<string, unknown> = {}) {
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
      const amountCents = payout.fx?.eurAmountCents ?? payout.fx?.originalAmountCents ?? 0;
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
      });
    }

    return { data: enriched, pagination: payouts.pagination };
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
