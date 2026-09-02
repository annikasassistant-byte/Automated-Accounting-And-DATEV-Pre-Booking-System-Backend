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
    const [openExceptions, pendingEvents, recentAccrualImports] = await Promise.all([
      this.exceptions.findMany({ status: 'open' }, { limit: 20, page: 1, sort: '-createdAt' }),
      this.events.findMany({ status: { $in: ['pending_match', 'exception'] } }, {
        limit: 20,
        page: 1,
        sort: '-eventDate',
      }),
      this.imports.findMany(
        { source: { $in: ['jtl', 'marketplace_amazon', 'marketplace_backmarket', 'marketplace_refurbed'] } },
        { limit: 10, page: 1, sort: '-createdAt' },
      ),
    ]);

    const openCount = await this.exceptions.countOpen();

    return {
      openExceptionCount: openCount,
      openExceptions: openExceptions.data,
      pendingEvents: pendingEvents.data,
      recentImports: recentAccrualImports.data,
    };
  }
}

export default InboxService;
