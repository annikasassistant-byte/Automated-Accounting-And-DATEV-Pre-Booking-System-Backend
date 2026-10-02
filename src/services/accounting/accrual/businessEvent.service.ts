import { ApiError } from '../../../utils/ApiError.js';

export class BusinessEventService {
  constructor(deps: { businessEventRepository: any }) {
    this.events = deps.businessEventRepository;
  }

  events;

  async list(query: Record<string, unknown> = {}) {
    const filter: Record<string, unknown> = {};
    if (query.eventType) filter.eventType = query.eventType;
    if (query.marketplace) filter.marketplace = query.marketplace;
    if (query.source) filter.source = query.source;
    if (query.status) filter.status = query.status;
    if (query.matchStatus) filter.matchStatus = query.matchStatus;
    if (query.marketplaceOrderId) {
      filter.marketplaceOrderId = {
        $regex: String(query.marketplaceOrderId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        $options: 'i',
      };
    }
    if (query.q) {
      const q = String(query.q).trim();
      if (q) {
        filter.$or = [
          { marketplaceOrderId: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
          { sourceRecordId: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
          { jtlInvoiceNumber: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        ];
      }
    }
    if (query.from || query.to) {
      filter.eventDate = {};
      if (query.from) (filter.eventDate as any).$gte = new Date(String(query.from));
      if (query.to) (filter.eventDate as any).$lte = new Date(`${String(query.to).slice(0, 10)}T23:59:59.000Z`);
    }
    return this.events.findMany(filter, {
      page: query.page,
      limit: query.limit,
      sort: query.sort || '-eventDate',
    });
  }

  async get(id: string) {
    const doc = await this.events.findById(id);
    if (!doc) throw ApiError.notFound('Geschäftsvorfall nicht gefunden');
    return doc;
  }

  async patch(id: string, body: Record<string, unknown>) {
    const doc = await this.get(id);
    const allowed = ['feeVatTreatment'];
    const update: Record<string, unknown> = {};
    if (body.feeVatTreatment !== undefined) {
      const v = String(body.feeVatTreatment);
      if (!['auto', 'reverse_charge_13b', 'input_vat_de', 'none'].includes(v)) {
        throw ApiError.badRequest('Ungültige USt-Behandlung für Gebühren');
      }
      update.feeVatTreatment = v;
    }
    if (!Object.keys(update).length) {
      throw ApiError.badRequest(`Nur ${allowed.join(', ')} sind änderbar`);
    }
    return this.events.update(doc._id, update);
  }
}

export default BusinessEventService;
