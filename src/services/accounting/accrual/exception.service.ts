import { ApiError } from '../../../utils/ApiError.js';

export class ExceptionService {
  constructor(deps: {
    accountingExceptionRepository: any;
    auditRepository?: any;
  }) {
    this.exceptions = deps.accountingExceptionRepository;
    this.audit = deps.auditRepository;
  }

  exceptions;
  audit;

  async list(query: Record<string, unknown> = {}) {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.exceptionType) filter.exceptionType = query.exceptionType;
    if (query.marketplace) filter.marketplace = query.marketplace;
    return this.exceptions.findMany(filter, {
      page: query.page,
      limit: query.limit,
      sort: query.sort || '-createdAt',
    });
  }

  async get(id: string) {
    const doc = await this.exceptions.findById(id);
    if (!doc) throw ApiError.notFound('Ausnahme nicht gefunden');
    return doc;
  }

  async create(payload: Record<string, unknown>) {
    return this.exceptions.create(payload);
  }

  async createDuplicateException(params: {
    importBatchId?: string;
    marketplace?: string | null;
    sourceRecordId: string;
    title: string;
    detail?: string;
  }) {
    return this.create({
      exceptionType: 'DUPLICATE_SOURCE_RECORD',
      status: 'open',
      importBatchId: params.importBatchId || null,
      marketplace: params.marketplace || null,
      sourceRecordId: params.sourceRecordId,
      title: params.title,
      detail: params.detail || '',
    });
  }

  async createFxReview(params: {
    businessEventId?: string;
    importBatchId?: string;
    marketplace?: string | null;
    marketplaceOrderId?: string | null;
    title: string;
    detail?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.create({
      exceptionType: 'FX_REVIEW',
      status: 'open',
      businessEventId: params.businessEventId || null,
      importBatchId: params.importBatchId || null,
      marketplace: params.marketplace || null,
      marketplaceOrderId: params.marketplaceOrderId || null,
      title: params.title,
      detail: params.detail || '',
      metadata: params.metadata || null,
    });
  }

  async resolve(id: string, userId: string, body: { status?: string; resolutionNote?: string }, ctx = {}) {
    const doc = await this.get(id);
    const status = body.status || 'resolved';
    if (!['resolved', 'dismissed'].includes(status)) {
      throw ApiError.badRequest('Ungültiger Status');
    }
    const updated = await this.exceptions.update(doc._id, {
      status,
      resolvedAt: new Date(),
      resolvedBy: userId,
      resolutionNote: body.resolutionNote || null,
    });
    await this.audit?.log({
      actor: userId,
      action: 'accrual.exception.resolve',
      resource: 'accountingException',
      resourceId: id,
      meta: { status },
      ip: (ctx as any).ip,
      userAgent: (ctx as any).userAgent,
    });
    return updated;
  }
}

export default ExceptionService;
