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
    if (query.status) filter.status = query.status;
    if (query.matchStatus) filter.matchStatus = query.matchStatus;
    if (query.marketplaceOrderId) filter.marketplaceOrderId = query.marketplaceOrderId;
    if (query.from || query.to) {
      filter.eventDate = {};
      if (query.from) (filter.eventDate as any).$gte = new Date(String(query.from));
      if (query.to) (filter.eventDate as any).$lte = new Date(String(query.to));
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
}

export default BusinessEventService;
