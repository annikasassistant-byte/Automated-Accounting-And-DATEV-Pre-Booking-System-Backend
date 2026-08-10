import { ApiError } from '../../utils/ApiError.js';

export class ReconciliationService {
  constructor(deps) {
    this.transactions = deps.transactionRepository;
    this.importBatches = deps.importBatchRepository;
    this.duplicateGroups = deps.duplicateGroupRepository;
  }

  async summary(from, to) {
    const dateFilter = {};
    if (from || to) {
      dateFilter.bookingDate = {};
      if (from) dateFilter.bookingDate.$gte = new Date(from);
      if (to) dateFilter.bookingDate.$lte = new Date(to);
    }

    const bookableMatch = { ...dateFilter, bookability: 'bookable' };

    const [statusGroups, openResult, dupResult] = await Promise.all([
      this.transactions.aggregate([
        { $match: bookableMatch },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalCents: { $sum: '$amountCents' },
          },
        },
      ]),
      this.transactions.findMany(
        { ...bookableMatch, status: { $in: ['open', 'conflict'] } },
        { limit: 1, page: 1 },
      ),
      this.duplicateGroups
        ? this.duplicateGroups.findMany({ status: 'open' }, { limit: 1, page: 1 })
        : Promise.resolve({ data: [], pagination: { total: 0 } }),
    ]);

    const statusMap = {};
    let totalCount = 0;
    let importedCents = 0;
    let exportedCents = 0;
    let missingCount = 0;

    for (const group of statusGroups) {
      statusMap[group._id] = { count: group.count, totalCents: group.totalCents };
      totalCount += group.count;
      importedCents += group.totalCents;
      if (group._id === 'exported') {
        exportedCents += group.totalCents;
      } else if (!['skipped'].includes(group._id)) {
        missingCount += group.count;
      }
    }

    const difference = importedCents - exportedCents;
    const openCount = (statusMap.open?.count || 0) + (statusMap.conflict?.count || 0);
    const duplicateCount = dupResult.pagination?.total ?? dupResult.data?.length ?? 0;

    let validationStatus = 'pending';
    if (totalCount === 0) validationStatus = 'pending';
    else if (Math.abs(difference) < 1 && openCount === 0) validationStatus = 'balanced';
    else validationStatus = 'unbalanced';

    return {
      period: { from, to },
      totalCount,
      totalCents: importedCents,
      byStatus: statusMap,
      // Client UI shape
      importedAmount: importedCents / 100,
      exportedAmount: exportedCents / 100,
      difference: difference / 100,
      missingCount,
      duplicateCount,
      openCount,
      validationStatus,
      blockers: openCount
        ? [`${openCount} offene/Konflikt-Transaktionen im Zeitraum`]
        : [],
    };
  }

  async accountOverview(from, to) {
    const dateFilter = { bookability: 'bookable' };
    if (from || to) {
      dateFilter.bookingDate = {};
      if (from) dateFilter.bookingDate.$gte = new Date(from);
      if (to) dateFilter.bookingDate.$lte = new Date(to);
    }

    const pipeline = [
      {
        $match: {
          ...dateFilter,
          'booking.konto': { $ne: null },
          status: { $in: ['matched', 'reviewed', 'exported'] },
        },
      },
      {
        $group: {
          _id: '$booking.konto',
          count: { $sum: 1 },
          totalCents: { $sum: '$amountCents' },
          debit: {
            $sum: { $cond: [{ $lt: ['$amountCents', 0] }, '$amountCents', 0] },
          },
          credit: {
            $sum: { $cond: [{ $gt: ['$amountCents', 0] }, '$amountCents', 0] },
          },
        },
      },
      { $sort: { _id: 1 } },
    ];

    const accounts = await this.transactions.aggregate(pipeline);
    return {
      period: { from, to },
      accounts: accounts.map((a) => ({
        accountNumber: a._id,
        count: a.count,
        totalCents: a.totalCents,
        total: a.totalCents / 100,
        debit: a.debit / 100,
        credit: a.credit / 100,
      })),
    };
  }

  async paypalBalance(importId) {
    const batch = await this.importBatches.findById(importId);
    if (!batch) throw ApiError.notFound('Import-Batch nicht gefunden');
    if (batch.source !== 'paypal') throw ApiError.badRequest('Nur für PayPal-Imports verfügbar');

    const txResult = await this.transactions.findMany(
      { importBatchId: importId },
      { limit: 10000, page: 1, sort: 'bookingDate' },
    );

    let totalIn = 0;
    let totalOut = 0;
    let feeTotal = 0;

    for (const tx of txResult.data) {
      if (tx.amountCents > 0) totalIn += tx.amountCents;
      else totalOut += Math.abs(tx.amountCents);
      if (tx.paypal?.feeCents) feeTotal += Math.abs(tx.paypal.feeCents);
    }

    return {
      importId,
      totalIn,
      totalOut,
      feeTotal,
      net: totalIn - totalOut,
      balanceCheck: batch.balanceCheck || null,
      transactionCount: txResult.data.length,
    };
  }
}

export default ReconciliationService;
