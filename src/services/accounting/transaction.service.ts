import { ApiError } from '../../utils/ApiError.js';
import {
  applyHumanRules,
  adjustInventoryGegenkonto,
} from '../../helpers/accounting/rule-engine.js';
import {
  detectBankPaypalClearing,
  detectMarketplacePark,
  detectManualParkPolicies,
} from '../../helpers/accounting/system-policies.js';

export class TransactionService {
  constructor(deps) {
    this.transactions = deps.transactionRepository;
    this.rules = deps.ruleRepository;
    this.audit = deps.auditRepository;
    this.settings = deps.settingsService;
  }

  async #policy() {
    if (this.settings?.getSystemPolicyConfig) {
      return this.settings.getSystemPolicyConfig();
    }
    return null;
  }

  async list(query = {}) {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.source) filter.source = query.source;
    if (query.importId) filter.importBatchId = query.importId;
    if (query.konto) filter['booking.konto'] = query.konto;
    if (query.isDuplicate !== undefined) filter.isDuplicate = query.isDuplicate;

    const includeSkipped =
      query.includeSkipped === true ||
      query.includeSkipped === 'true' ||
      query.includeSkipped === '1' ||
      query.status === 'skipped';
    if (query.bookability) {
      filter.bookability = query.bookability;
    } else if (!includeSkipped) {
      filter.bookability = { $nin: ['skipped', 'balance_only'] };
    }

    if (query.from || query.to) {
      filter.bookingDate = {};
      if (query.from) (filter.bookingDate as any).$gte = new Date(query.from);
      if (query.to) (filter.bookingDate as any).$lte = new Date(query.to);
    }

    return this.transactions.findMany(filter, {
      page: query.page,
      limit: query.limit,
      sort: query.sort || '-bookingDate',
      search: query.search,
        searchFields: ['counterpartyName', 'purpose', 'rawDescription', 'article'],
    });
  }

  async getById(id) {
    const tx = await this.transactions.findById(id);
    if (!tx) throw ApiError.notFound('Transaktion nicht gefunden');
    return tx;
  }

  async listOpen(query = {}) {
    return this.list({ ...query, status: 'open' });
  }

  async listConflicts(query = {}) {
    return this.list({ ...query, status: 'conflict' });
  }

  async applyRules(ids, ctx = {}) {
    const enabledRules = await this.rules.findEnabled();
    const policy = await this.#policy();

    let filter: Record<string, unknown>;
    if (ids?.length) {
      filter = { _id: { $in: ids } };
    } else {
      filter = { status: { $in: ['open', 'imported', 'conflict', 'matched', 'suggested'] } };
    }

    const result = await this.transactions.findMany(filter, { limit: 5000, page: 1 });
    const txList = result.data;

    let matched = 0;
    let conflict = 0;
    let open = 0;
    let skipped = 0;

    for (const tx of txList) {
      if (tx.status === 'exported' || tx.status === 'reviewed') {
        skipped++;
        continue;
      }
      if (tx.bookability === 'skipped') {
        skipped++;
        continue;
      }
      // Never rewrite locked system clearing bookings
      if (tx.systemMatched && tx.systemRuleId === 'S5_BANK_PAYPAL_CLEARING') {
        matched++;
        continue;
      }

      const txLike = {
        source: tx.source,
        amountCents: tx.amountCents,
        counterpartyName: tx.counterpartyName || '',
        counterpartyIban: tx.counterpartyIban || null,
        counterpartyEmail: tx.counterpartyEmail || null,
        purpose: tx.purpose || '',
        article: tx.article || null,
        rawDescription: tx.rawDescription || '',
        paypal: tx.paypal || undefined,
      };

      const clearingResult = detectBankPaypalClearing({
        source: tx.source,
        counterpartyName: txLike.counterpartyName,
        purpose: txLike.purpose,
        rawDescription: txLike.rawDescription,
        amountCents: txLike.amountCents,
        paypalType: tx.paypal?.type || null,
      }, policy);
      if (clearingResult.matched) {
        await this.transactions.update(tx._id, {
          status: 'matched',
          systemMatched: true,
          systemRuleId: clearingResult.systemRuleId,
          matchedRuleIds: [],
          booking: {
            konto: clearingResult.konto,
            gegenkonto: clearingResult.gegenkonto,
            buKey: clearingResult.buKey,
            bookingText: clearingResult.bookingText,
            sollHaben: clearingResult.sollHaben,
          },
          $push: {
            history: {
              action: 'system_matched_reapply',
              status: 'matched',
              actorLabel: 'System',
              note: clearingResult.note,
            },
          },
        });
        matched++;
        continue;
      }

      const marketplaceResult = detectMarketplacePark(txLike, policy);
      if (!marketplaceResult.matched && marketplaceResult.parkOpen) {
        await this.transactions.update(tx._id, {
          status: 'open',
          systemMatched: false,
          matchedRuleIds: [],
          booking: {},
          $push: {
            history: {
              action: 'marketplace_parked_reapply',
              status: 'open',
              actorLabel: 'System',
              note: marketplaceResult.reason,
            },
          },
        });
        open++;
        continue;
      }

      const manualPark = detectManualParkPolicies(txLike, policy);
      if (!manualPark.matched && manualPark.parkOpen) {
        await this.transactions.update(tx._id, {
          status: 'open',
          systemMatched: false,
          matchedRuleIds: [],
          booking: {},
          $push: {
            history: {
              action: 'system_parked_reapply',
              status: 'open',
              actorLabel: 'System',
              note: manualPark.reason,
            },
          },
        });
        open++;
        continue;
      }

      if (!enabledRules.length) {
        if (tx.status !== 'open') {
          await this.transactions.update(tx._id, { status: 'open', booking: {}, matchedRuleIds: [] });
        }
        open++;
        continue;
      }

      const ruleResult = applyHumanRules(txLike, enabledRules, policy);

      if (ruleResult.status === 'matched' && ruleResult.booking) {
        const booking = adjustInventoryGegenkonto(ruleResult.booking, tx.source, policy);
        await this.transactions.update(tx._id, {
          status: 'matched',
          systemMatched: false,
          matchedRuleIds: ruleResult.matchedRuleIds,
          booking,
          confidence: ruleResult.confidence,
          $push: {
            history: {
              action: 'rule_reapplied',
              status: 'matched',
              actorLabel: 'System',
              note: `Regel-Match (re-apply): ${ruleResult.matchedRuleIds.join(', ')}`,
            },
          },
        });
        matched++;
      } else if (ruleResult.status === 'conflict') {
        await this.transactions.update(tx._id, {
          status: 'conflict',
          systemMatched: false,
          matchedRuleIds: ruleResult.matchedRuleIds,
          booking: {},
          $push: {
            history: {
              action: 'rule_conflict_reapply',
              status: 'conflict',
              actorLabel: 'System',
              note: `Regelkonflikt (re-apply): ${ruleResult.matchedRuleIds.length} Regeln`,
            },
          },
        });
        conflict++;
      } else {
        await this.transactions.update(tx._id, {
          status: 'open',
          systemMatched: false,
          matchedRuleIds: [],
          booking: {},
          $push: {
            history: {
              action: 'no_match_reapply',
              status: 'open',
              actorLabel: 'System',
              note: 'Keine passende Regel bei erneutem Anwenden',
            },
          },
        });
        open++;
      }
    }

    await this.audit?.log({
      actor: ctx.userId,
      action: 'transaction.apply_rules',
      resource: 'transaction',
      meta: { processed: txList.length, matched, conflict, open, skipped },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return { processed: txList.length, matched, conflict, open, skipped };
  }

  async assign(id, data, ctx = {}) {
    const tx = await this.transactions.findById(id);
    if (!tx) throw ApiError.notFound('Transaktion nicht gefunden');
    if (tx.status === 'exported') throw ApiError.forbidden('Exportierte Transaktion kann nicht geändert werden');

    const booking = {
      konto: data.konto,
      gegenkonto: data.gegenkonto,
      buKey: data.buKey || '',
      bookingText: data.bookingText || '',
      sollHaben: tx.amountCents < 0 ? 'S' : 'H',
    };

    const updated = await this.transactions.update(id, {
      status: 'reviewed',
      booking,
      $push: {
        history: {
          action: 'manual_assign',
          status: 'reviewed',
          actor: ctx.userId,
          actorLabel: ctx.userName || 'User',
          note: `Manuell zugewiesen: ${booking.konto} / ${booking.gegenkonto}`,
        },
      },
    });

    await this.audit?.log({
      actor: ctx.userId,
      action: 'transaction.assign',
      resource: 'transaction',
      resourceId: id,
      meta: { konto: data.konto, gegenkonto: data.gegenkonto },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return updated;
  }

  async bulkAssign(items, ctx = {}) {
    const results: any[] = [];
    for (const item of items) {
      const result = await this.assign(item.id, item, ctx);
      results.push(result);
    }
    return results;
  }

  async setStatus(id, status, ctx = {}) {
    const tx = await this.transactions.findById(id);
    if (!tx) throw ApiError.notFound('Transaktion nicht gefunden');
    if (tx.status === 'exported') throw ApiError.forbidden('Exportierte Transaktion kann nicht geändert werden');

    const validStatuses = ['open', 'reviewed', 'matched', 'conflict', 'skipped'];
    if (!validStatuses.includes(status)) {
      throw ApiError.badRequest(`Ungültiger Status: ${status}`);
    }

    const updated = await this.transactions.update(id, {
      status,
      $push: {
        history: {
          action: 'status_change',
          status,
          actor: ctx.userId,
          actorLabel: ctx.userName || 'User',
          note: `Status geändert zu: ${status}`,
        },
      },
    });

    await this.audit?.log({
      actor: ctx.userId,
      action: 'transaction.set_status',
      resource: 'transaction',
      resourceId: id,
      meta: { status },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return updated;
  }

  async bulkStatus(ids, status, ctx = {}) {
    const results: any[] = [];
    for (const id of ids) {
      const result = await this.setStatus(id, status, ctx);
      results.push(result);
    }
    return results;
  }
}

export default TransactionService;
