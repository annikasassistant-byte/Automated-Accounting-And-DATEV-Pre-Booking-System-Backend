import { MARKETPLACES } from '../../../enums/accrual.js';

function centsOf(event: any): number {
  return event?.fx?.eurAmountCents ?? event?.fx?.originalAmountCents ?? 0;
}

const MP_REVENUE: Record<string, string> = {
  amazon: '81971',
  refurbed: '81972',
  backmarket: '81973',
};

export class AccrualReportService {
  constructor(deps: {
    businessEventRepository: any;
    accountingExceptionRepository: any;
    transactionRepository: any;
    journalEntryRepository: any;
    journalLineRepository: any;
  }) {
    this.events = deps.businessEventRepository;
    this.exceptions = deps.accountingExceptionRepository;
    this.transactions = deps.transactionRepository;
    this.journalEntries = deps.journalEntryRepository;
    this.journalLines = deps.journalLineRepository;
  }

  events;
  exceptions;
  transactions;
  journalEntries;
  journalLines;

  async overview(from?: string, to?: string) {
    const dateFilter: Record<string, unknown> = {};
    if (from || to) {
      dateFilter.eventDate = {};
      if (from) (dateFilter.eventDate as any).$gte = new Date(from);
      if (to) (dateFilter.eventDate as any).$lte = new Date(`${to}T23:59:59.000Z`);
    }

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
        revenueAccount: MP_REVENUE[mp],
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
}

export default AccrualReportService;
