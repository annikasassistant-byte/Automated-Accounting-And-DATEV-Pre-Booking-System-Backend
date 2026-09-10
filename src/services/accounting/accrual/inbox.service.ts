export class InboxService {
  constructor(deps: {
    accountingExceptionRepository: any;
    businessEventRepository: any;
    importBatchRepository: any;
  }) {
    this.exceptions = deps.accountingExceptionRepository;
    this.events = deps.businessEventRepository;
    this.imports = deps.importBatchRepository;
  }

  exceptions;
  events;
  imports;

  async getInbox() {
    const [openExceptions, pendingEvents, invoicePendingEvents, recentAccrualImports] = await Promise.all([
      this.exceptions.findMany({ status: 'open' }, { limit: 20, page: 1, sort: '-createdAt' }),
      this.events.findMany({ status: { $in: ['pending_match', 'exception', 'invoice_pending'] } }, {
        limit: 20,
        page: 1,
        sort: '-eventDate',
      }),
      this.events.findMany({ status: 'invoice_pending' }, { limit: 1, page: 1 }),
      this.imports.findMany(
        { source: { $in: ['jtl', 'marketplace_amazon', 'marketplace_backmarket', 'marketplace_refurbed'] } },
        { limit: 10, page: 1, sort: '-createdAt' },
      ),
    ]);

    const openCount = await this.exceptions.countOpen();
    const invoicePendingCount =
      invoicePendingEvents.pagination?.total ??
      invoicePendingEvents.total ??
      (invoicePendingEvents.data || []).length;

    return {
      openExceptionCount: openCount,
      openExceptions: openExceptions.data,
      pendingEvents: pendingEvents.data,
      invoicePendingCount,
      recentImports: recentAccrualImports.data,
    };
  }
}

export default InboxService;
