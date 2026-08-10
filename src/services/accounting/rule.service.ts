import { ApiError } from '../../utils/ApiError.js';
import { inventorySeedRule, ruleMatches } from '../../helpers/accounting/rule-engine.js';

export class RuleService {
  constructor(deps) {
    this.rules = deps.ruleRepository;
    this.transactions = deps.transactionRepository;
    this.audit = deps.auditRepository;
    this.settings = deps.settingsService;
  }

  async list(query = {}) {
    const filter: Record<string, unknown> = {};
    if (query.enabled !== undefined) filter.enabled = query.enabled;
    if (query.source) filter.source = query.source;
    return this.rules.findMany(filter, {
      page: query.page,
      limit: query.limit,
      sort: query.sort || 'priority',
      search: query.search,
      searchFields: ['name'],
    });
  }

  async getById(id) {
    const rule = await this.rules.findById(id);
    if (!rule) throw ApiError.notFound('Regel nicht gefunden');
    return rule;
  }

  async create(data, ctx = {}) {
    if (!data.name) throw ApiError.badRequest('Regelname ist erforderlich');

    // Normalize flat UI fields → actions object
    const actions = data.actions || {
      konto: data.konto || data.expenseAccountId,
      gegenkonto: data.gegenkonto || data.offsetAccountId,
      buKey: data.buKey ?? '',
      bookingTextTemplate: data.bookingTextTemplate || null,
    };

    let conditions = data.conditions;
    if ((!conditions || !conditions.length) && Array.isArray(data.keywords) && data.keywords.length) {
      const op = data.matchMode === 'starts_with' || data.matchMode === 'ends_with' || data.matchMode === 'exact' || data.matchMode === 'regex'
        ? data.matchMode
        : 'any_of';
      conditions = [
        {
          field: 'rawDescription',
          operator: op === 'any_of' ? 'any_of' : op,
          value: op === 'any_of' ? data.keywords : data.keywords[0],
          caseSensitive: Boolean(data.caseSensitive),
        },
      ];
    }

    if (!conditions?.length) throw ApiError.badRequest('Mindestens eine Bedingung erforderlich');
    if (!actions?.konto || !actions?.gegenkonto) {
      throw ApiError.badRequest('Konto und Gegenkonto sind erforderlich');
    }

    const rule = await this.rules.create({
      name: data.name,
      enabled: data.enabled !== false,
      priority: data.priority ?? 100,
      conditions,
      actions,
      source: data.source || 'manual',
    });

    await this.audit?.log({
      actor: ctx.userId,
      action: 'rule.create',
      resource: 'rule',
      resourceId: rule._id,
      meta: { name: data.name },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return rule;
  }

  async update(id, data, ctx = {}) {
    const rule = await this.rules.findById(id);
    if (!rule) throw ApiError.notFound('Regel nicht gefunden');

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.conditions !== undefined) updateData.conditions = data.conditions;
    if (data.actions !== undefined) updateData.actions = data.actions;

    const updated = await this.rules.update(id, updateData);

    await this.audit?.log({
      actor: ctx.userId,
      action: 'rule.update',
      resource: 'rule',
      resourceId: id,
      meta: { fields: Object.keys(updateData) },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return updated;
  }

  async remove(id, ctx = {}) {
    const rule = await this.rules.findById(id);
    if (!rule) throw ApiError.notFound('Regel nicht gefunden');

    await this.rules.softDelete(id, ctx.userId);

    await this.audit?.log({
      actor: ctx.userId,
      action: 'rule.delete',
      resource: 'rule',
      resourceId: id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return { success: true };
  }

  async enable(id, ctx = {}) {
    return this.update(id, { enabled: true }, ctx);
  }

  async disable(id, ctx = {}) {
    return this.update(id, { enabled: false }, ctx);
  }

  async seedOptional(ctx = {}) {
    const policy = this.settings?.getSystemPolicyConfig
      ? await this.settings.getSystemPolicyConfig()
      : null;
    const seedData = inventorySeedRule(policy);
    const existing = await this.rules.findOne({ name: seedData.name, source: 'seed' });
    if (existing) return existing;

    const rule = await this.rules.create(seedData);

    await this.audit?.log({
      actor: ctx.userId,
      action: 'rule.seed_optional',
      resource: 'rule',
      resourceId: rule._id,
      meta: { name: seedData.name },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return rule;
  }

  async testDryRun(input, ctx = {}) {
    let rule;
    if (input.ruleId) {
      rule = await this.rules.findById(input.ruleId);
      if (!rule) throw ApiError.notFound('Regel nicht gefunden');
    } else if (Array.isArray(input.conditions) && input.conditions.length) {
      // Match preview is conditions-only; actions optional (not used by ruleMatches)
      rule = {
        enabled: true,
        conditions: input.conditions,
        actions: input.actions || {},
      };
    } else {
      throw ApiError.badRequest('ruleId oder conditions erforderlich');
    }

    const filter: Record<string, unknown> = {};
    if (input.status) filter.status = input.status;
    if (input.source) filter.source = input.source;
    if (input.from || input.to) {
      filter.bookingDate = {};
      if (input.from) (filter.bookingDate as any).$gte = new Date(input.from);
      if (input.to) (filter.bookingDate as any).$lte = new Date(input.to);
    }

    const result = await this.transactions.findMany(filter, { limit: 5000, page: 1 });
    const txList = result.data;

    const matches: any[] = [];
    for (const tx of txList) {
      if (ruleMatches(tx, rule)) {
        matches.push({
          _id: tx._id,
          bookingDate: tx.bookingDate,
          amountCents: tx.amountCents,
          counterpartyName: tx.counterpartyName,
          purpose: tx.purpose,
          status: tx.status,
        });
      }
    }

    return {
      matchCount: matches.length,
      totalScanned: txList.length,
      samples: matches.slice(0, 20),
    };
  }
}

export default RuleService;
