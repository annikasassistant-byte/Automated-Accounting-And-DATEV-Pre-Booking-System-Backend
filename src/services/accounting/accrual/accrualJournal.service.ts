import { ApiError } from '../../../utils/ApiError.js';
import { buildFeeVatExtraLines } from '../../../helpers/accounting/accrual/fee-vat.util.js';

export class AccrualJournalService {
  constructor(deps: {
    journalEntryRepository: any;
    journalLineRepository: any;
    businessEventRepository: any;
    accountingMappingService: any;
    auditRepository?: any;
  }) {
    this.entries = deps.journalEntryRepository;
    this.lines = deps.journalLineRepository;
    this.events = deps.businessEventRepository;
    this.mapping = deps.accountingMappingService;
    this.audit = deps.auditRepository;
  }

  entries;
  lines;
  events;
  mapping;
  audit;

  async list(query: Record<string, unknown> = {}) {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.from || query.to) {
      filter.postingDate = {};
      if (query.from) (filter.postingDate as any).$gte = new Date(String(query.from));
      if (query.to) (filter.postingDate as any).$lte = new Date(String(query.to));
    }
    return this.entries.findMany(filter, {
      page: query.page,
      limit: query.limit,
      sort: query.sort || '-postingDate',
    });
  }

  async get(id: string) {
    const entry = await this.entries.findById(id);
    if (!entry) throw ApiError.notFound('Journalbuchung nicht gefunden');
    const journalLines = await this.lines.findByJournalEntryId(id);
    return { entry, lines: journalLines };
  }

  async buildDraftForEvent(eventId: string) {
    const event = await this.events.findById(eventId);
    if (!event) throw ApiError.notFound('Geschäftsvorfall nicht gefunden');

    if (event.eventType === 'ORDER_CREATED' || event.eventType === 'CANCELLATION') {
      throw ApiError.badRequest(
        'ORDER_CREATED/CANCELLATION sind kein Umsatz — kein Journal (Client-Regel v5)',
      );
    }
    if (event.status === 'invoice_pending') {
      throw ApiError.badRequest('Rechnung ausstehend — kein Journal bis JTL-Rechnung vorliegt');
    }
    if (event.status === 'void') {
      throw ApiError.badRequest('Storniertes Ereignis — kein Journal');
    }

    const existing = await this.entries.findByBusinessEventId(eventId);
    if (existing) return this.get(existing._id);

    const amountCents = Math.abs(
      event.fx?.eurAmountCents ?? event.fx?.originalAmountCents ?? 0,
    );
    if (!amountCents) {
      throw ApiError.badRequest('Kein Buchungsbetrag für Geschäftsvorfall');
    }

    const { primaryAccount, contraAccount, bookable } = await this.mapping.resolveAccountsForEvent(event);
    if (bookable === false) {
      throw ApiError.badRequest('Ereignistyp ist nicht buchbar');
    }
    if (!primaryAccount || !contraAccount) {
      throw ApiError.badRequest('Clearing-Konten nicht konfiguriert — Admin-Einstellungen prüfen');
    }

    const postingDate = event.accountingDate || event.eventDate;
    const isCredit =
      (event.fx?.originalAmountCents ?? 0) < 0 ||
      event.eventType === 'FEE' ||
      event.eventType === 'REFUND';

    const clearingOnly = event.eventType === 'SETTLEMENT' || event.eventType === 'PAYOUT';
    const entry = await this.entries.create({
      businessEventId: eventId,
      postingDate,
      description: `${event.eventType}${clearingOnly ? ' (Clearing)' : ''} ${event.marketplaceOrderId || event.sourceRecordId}`,
      status: 'draft',
    });

    const bookingText = `${event.marketplace || 'accrual'} ${event.eventType}${clearingOnly ? ' clearing' : ''}`;
    const linePayload = [
      {
        journalEntryId: entry._id,
        businessEventId: eventId,
        accountNumber: primaryAccount,
        sollHaben: isCredit ? 'H' : 'S',
        amountCents,
        currency: 'EUR',
        eurAmountCents: amountCents,
        postingDate,
        bookingText,
        lineOrder: 1,
      },
      {
        journalEntryId: entry._id,
        businessEventId: eventId,
        accountNumber: contraAccount,
        sollHaben: isCredit ? 'S' : 'H',
        amountCents,
        currency: 'EUR',
        eurAmountCents: amountCents,
        postingDate,
        bookingText,
        lineOrder: 2,
      },
    ];

    const createdLines = [];
    for (const line of linePayload) {
      createdLines.push(await this.lines.create(line));
    }

    if (event.eventType === 'FEE') {
      const config = await this.mapping.clearing.getOrCreateDefault();
      const extra = buildFeeVatExtraLines({
        netCents: amountCents,
        marketplace: event.marketplace,
        override: event.feeVatTreatment,
        feeVatConfig: config.feeVat,
        clearingAccount: contraAccount,
      });
      let order = 3;
      for (const vatLine of extra.lines) {
        createdLines.push(
          await this.lines.create({
            journalEntryId: entry._id,
            businessEventId: eventId,
            accountNumber: vatLine.accountNumber,
            sollHaben: vatLine.sollHaben,
            amountCents: vatLine.amountCents,
            currency: 'EUR',
            eurAmountCents: vatLine.amountCents,
            buKey: vatLine.buKey,
            postingDate,
            bookingText: vatLine.bookingText,
            lineOrder: order++,
          }),
        );
      }
      if (extra.treatment !== 'none') {
        await this.entries.update(entry._id, {
          description: `${entry.description} [${extra.treatment} VAT ${extra.vatCents / 100} EUR]`,
        });
      }
    }

    await this.events.update(eventId, { journalEntryId: entry._id, status: 'draft' });
    return { entry, lines: createdLines };
  }

  async post(id: string, userId: string, ctx = {}) {
    const { entry, lines } = await this.get(id);
    if (entry.status === 'posted') return { entry, lines };
    if (entry.status !== 'draft') {
      throw ApiError.badRequest('Nur Entwürfe können gebucht werden');
    }

    const sumS = lines.filter((l: any) => l.sollHaben === 'S').reduce((a: number, l: any) => a + l.amountCents, 0);
    const sumH = lines.filter((l: any) => l.sollHaben === 'H').reduce((a: number, l: any) => a + l.amountCents, 0);
    if (sumS !== sumH) {
      throw ApiError.badRequest('Journal ist nicht ausgeglichen');
    }

    const updated = await this.entries.update(entry._id, { status: 'posted' });
    await this.events.update(entry.businessEventId, { status: 'posted' });

    await this.audit?.log({
      actor: userId,
      action: 'accrual.journal.post',
      resource: 'journalEntry',
      resourceId: id,
      ip: (ctx as any).ip,
      userAgent: (ctx as any).userAgent,
    });

    return { entry: updated, lines };
  }

  async previewDatev(from?: string, to?: string) {
    const filter: Record<string, unknown> = { status: 'posted' };
    if (from || to) {
      filter.postingDate = {};
      if (from) (filter.postingDate as any).$gte = new Date(from);
      if (to) (filter.postingDate as any).$lte = new Date(`${to}T23:59:59.000Z`);
    }
    const entries = await this.entries.findMany(filter, { limit: 2000, page: 1, sort: 'postingDate' });
    const rows = [];
    for (const entry of entries.data || []) {
      const journalLines = await this.lines.findByJournalEntryId(entry._id);
      for (const line of journalLines || []) {
        rows.push({
          journalEntryId: entry._id,
          postingDate: line.postingDate,
          accountNumber: line.accountNumber,
          sollHaben: line.sollHaben,
          amountCents: line.amountCents,
          bookingText: line.bookingText,
          documentReference: line.documentReference || entry.description,
          status: entry.status,
        });
      }
    }
    return {
      period: { from: from || null, to: to || null },
      rowCount: rows.length,
      rows: rows.slice(0, 500),
      note: 'Vorschau aus gebuchten Accrual-Journalzeilen. Erzeugt keinen Cash-DATEV-Stapel und sperrt keine Transaktionen.',
    };
  }
}

export default AccrualJournalService;
