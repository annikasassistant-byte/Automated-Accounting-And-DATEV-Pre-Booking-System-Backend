import { ApiError } from '../../utils/ApiError.js';
import { sideForAccount, sidesForPayment } from '../../helpers/accounting/ledger-sides.js';

function bookingDateFilter(from, to) {
  if (!from && !to) return {};
  const bookingDate = {};
  if (from) bookingDate['$gte'] = new Date(from);
  if (to) {
    const end = new Date(to);
    if (typeof to === 'string' && !to.includes('T')) {
      end.setUTCHours(23, 59, 59, 999);
    }
    bookingDate['$lte'] = end;
  }
  return { bookingDate };
}

export class ReconciliationService {
  constructor(deps) {
    this.transactions = deps.transactionRepository;
    this.importBatches = deps.importBatchRepository;
    this.duplicateGroups = deps.duplicateGroupRepository;
    this.accounts = deps.accountRepository || null;
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

  /**
   * DATEV-style trial balance: each payment hits konto AND gegenkonto (Soll/Haben).
   * Opening balance is 0 for MVP.
   */
  async accountTrialBalance(from, to, includeEmpty = false) {
    const dateFilter = bookingDateFilter(from, to);
    const grouped = await this.transactions.aggregate([
      {
        $match: {
          ...dateFilter,
          bookability: 'bookable',
          status: { $nin: ['skipped'] },
          'booking.konto': { $nin: [null, ''] },
          'booking.gegenkonto': { $nin: [null, ''] },
        },
      },
      {
        $addFields: {
          absCents: { $abs: { $ifNull: ['$amountCents', 0] } },
          kontoSide: {
            $cond: [
              { $in: ['$booking.sollHaben', ['S', 'H']] },
              '$booking.sollHaben',
              { $cond: [{ $lt: ['$amountCents', 0] }, 'S', 'H'] },
            ],
          },
        },
      },
      {
        $addFields: {
          gegenkontoSide: { $cond: [{ $eq: ['$kontoSide', 'S'] }, 'H', 'S'] },
        },
      },
      {
        $project: {
          sides: [
            {
              number: { $toString: '$booking.konto' },
              side: '$kontoSide',
              cents: '$absCents',
              at: '$bookingDate',
            },
            {
              number: { $toString: '$booking.gegenkonto' },
              side: '$gegenkontoSide',
              cents: '$absCents',
              at: '$bookingDate',
            },
          ],
        },
      },
      { $unwind: '$sides' },
      { $match: { 'sides.number': { $nin: [null, '', 'null'] } } },
      {
        $group: {
          _id: '$sides.number',
          debitCents: { $sum: { $cond: [{ $eq: ['$sides.side', 'S'] }, '$sides.cents', 0] } },
          creditCents: { $sum: { $cond: [{ $eq: ['$sides.side', 'H'] }, '$sides.cents', 0] } },
          count: { $sum: 1 },
          lastBookingDate: { $max: '$sides.at' },
        },
      },
    ]);

    const totals = new Map();
    for (const row of grouped) {
      totals.set(String(row._id), {
        debitCents: row.debitCents || 0,
        creditCents: row.creditCents || 0,
        count: row.count || 0,
        lastBookingDate: row.lastBookingDate || null,
      });
    }

    const names = new Map();
    if (this.accounts) {
      const listed = await this.accounts.listAll(false);
      for (const acc of listed.data || []) {
        names.set(String(acc.number), acc.name || '');
        if (includeEmpty && !totals.has(String(acc.number))) {
          totals.set(String(acc.number), {
            debitCents: 0,
            creditCents: 0,
            count: 0,
            lastBookingDate: null,
          });
        }
      }
    }

    const accounts = [...totals.entries()]
      .sort(([a], [b]) => String(a).localeCompare(String(b), 'de', { numeric: true }))
      .map(([accountNumber, row]) => ({
        accountNumber,
        accountName: names.get(accountNumber) || '',
        debit: row.debitCents / 100,
        credit: row.creditCents / 100,
        balance: (row.debitCents - row.creditCents) / 100,
        count: row.count,
        lastBookingDate: row.lastBookingDate,
      }));

    return { period: { from, to }, accounts };
  }

  async accountLedger(number, from, to) {
    const accountNumber = String(number || '').trim();
    if (!accountNumber) throw ApiError.badRequest('Kontonummer fehlt');

    const dateFilter = bookingDateFilter(from, to);
    const result = await this.transactions.findMany(
      {
        ...dateFilter,
        bookability: 'bookable',
        status: { $nin: ['skipped'] },
        $or: [{ 'booking.konto': accountNumber }, { 'booking.gegenkonto': accountNumber }],
      },
      { limit: 10000, page: 1, sort: 'bookingDate' },
    );

    let debitCents = 0;
    let creditCents = 0;
    const lines = [];

    for (const tx of result.data) {
      const sides = sidesForPayment(tx);
      if (!sides) continue;
      const hit = sideForAccount(sides, accountNumber);
      if (!hit) continue;
      if (hit.side === 'S') debitCents += sides.amountCents;
      else creditCents += sides.amountCents;
      const paymentDate = tx.valueDate || tx.bookingDate;
      lines.push({
        transactionId: String(tx._id),
        bookingDate: tx.bookingDate,
        paymentDate,
        amountCents: sides.amountCents,
        side: hit.side,
        contraAccount: hit.contraAccount,
        purpose: tx.purpose || tx.article || '',
        source: tx.source,
        status: tx.status,
      });
    }

    let accountName = '';
    if (this.accounts) {
      const acc = await this.accounts.findByNumber(accountNumber);
      accountName = acc?.name || '';
    }

    return {
      period: { from, to },
      accountNumber,
      accountName,
      debit: debitCents / 100,
      credit: creditCents / 100,
      balance: (debitCents - creditCents) / 100,
      lines,
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
