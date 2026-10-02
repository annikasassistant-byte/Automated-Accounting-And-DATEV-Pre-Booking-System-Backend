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

  async getInbox(query: Record<string, unknown> = {}) {
    const from = query.from ? String(query.from) : undefined;
    const to = query.to ? String(query.to) : undefined;
    const dateFilter: Record<string, unknown> = {};
    if (from || to) {
      dateFilter.createdAt = {};
      if (from) (dateFilter.createdAt as any).$gte = new Date(from);
      if (to) (dateFilter.createdAt as any).$lte = new Date(`${to.slice(0, 10)}T23:59:59.000Z`);
    }
    const eventDateFilter: Record<string, unknown> = {};
    if (from || to) {
      eventDateFilter.eventDate = {};
      if (from) (eventDateFilter.eventDate as any).$gte = new Date(from);
      if (to) (eventDateFilter.eventDate as any).$lte = new Date(`${to.slice(0, 10)}T23:59:59.000Z`);
    }

    const [openExceptions, pendingEvents, invoicePendingEvents, recentAccrualImports] = await Promise.all([
      this.exceptions.findMany({ status: 'open', ...dateFilter }, { limit: 100, page: 1, sort: '-createdAt' }),
      this.events.findMany(
        { status: { $in: ['pending_match', 'exception', 'invoice_pending'] }, ...eventDateFilter },
        {
          limit: 100,
          page: 1,
          sort: '-eventDate',
        },
      ),
      this.events.findMany({ status: 'invoice_pending', ...eventDateFilter }, { limit: 1, page: 1 }),
      this.imports.findMany(
        { source: { $in: ['jtl', 'marketplace_amazon', 'marketplace_backmarket', 'marketplace_refurbed'] } },
        { limit: 20, page: 1, sort: '-createdAt' },
      ),
    ]);

    const openCount = openExceptions.pagination?.total ?? (openExceptions.data || []).length;
    const invoicePendingCount =
      invoicePendingEvents.pagination?.total ??
      invoicePendingEvents.total ??
      (invoicePendingEvents.data || []).length;

    // Consolidate repeated exception titles
    const byTitle = new Map<string, { title: string; count: number; ids: string[]; sample: any }>();
    for (const ex of openExceptions.data || []) {
      const title = String(ex.title || ex.message || ex.type || 'Ausnahme');
      const cur = byTitle.get(title) || { title, count: 0, ids: [], sample: ex };
      cur.count += 1;
      cur.ids.push(ex._id);
      byTitle.set(title, cur);
    }

    return {
      openExceptionCount: openCount,
      openExceptions: openExceptions.data,
      consolidatedExceptions: Array.from(byTitle.values()).sort((a, b) => b.count - a.count),
      pendingEvents: pendingEvents.data,
      pendingEventsListed: (pendingEvents.data || []).length,
      pendingEventsTotal:
        pendingEvents.pagination?.total ?? (pendingEvents.data || []).length,
      invoicePendingCount,
      recentImports: recentAccrualImports.data,
      periodFrom: from || null,
      periodTo: to || null,
      listNote:
        'Zähler können paginiert sein. Zugeordnet ≠ gebucht — Journal-Entwurf/Buchen ist Admin-Schritt.',
      julyOpsSteps: [
        '1. JTL + Marktplatz-Reports für den Monat importieren',
        '2. Posteingang: Ausnahmen + Rechnung ausstehend prüfen',
        '3. Geschäftsvorfälle: matched Events → Journal-Entwürfe erzeugen',
        '4. Accrual-Journal: Entwürfe buchen',
        '5. Accrual-DATEV Vorschau/Export (sperrt nur JournalLines)',
        '6. Späte Belege: erneut importieren → Matching aktualisiert invoice_pending',
      ],
    };
  }
}

export default InboxService;
