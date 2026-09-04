import { ApiError } from '../../../utils/ApiError.js';

export class ClearingService {
  constructor(deps: { clearingConfigRepository: any; auditRepository?: any }) {
    this.config = deps.clearingConfigRepository;
    this.audit = deps.auditRepository;
  }

  config;
  audit;

  async getConfig() {
    return this.config.getOrCreateDefault();
  }

  async getMarketplaceAccounts(marketplace: string) {
    const doc = await this.getConfig();
    const accounts = doc.marketplaces?.[marketplace];
    if (!accounts) throw ApiError.notFound(`Keine Clearing-Konten für ${marketplace}`);
    return { marketplace, accounts, revenueAccountDefault: doc.revenueAccountDefault, fxPolicyNote: doc.fxPolicyNote };
  }

  async updateConfig(body: Record<string, unknown>, userId: string, ctx = {}) {
    const doc = await this.getConfig();
    const patch: Record<string, unknown> = {};
    if (body.revenueAccountDefault !== undefined) patch.revenueAccountDefault = body.revenueAccountDefault;
    if (body.fxPolicyNote !== undefined) patch.fxPolicyNote = body.fxPolicyNote;
    if (body.provisionalFxEnabled !== undefined) patch.provisionalFxEnabled = body.provisionalFxEnabled;
    if (body.marketplaces) patch.marketplaces = { ...doc.marketplaces, ...(body.marketplaces as object) };
    const updated = await this.config.update(doc._id, patch);
    await this.audit?.log({
      actor: userId,
      action: 'accrual.clearing.update',
      resource: 'clearingConfig',
      resourceId: doc._id,
      ip: (ctx as any).ip,
      userAgent: (ctx as any).userAgent,
    });
    return updated;
  }
}

export default ClearingService;
