import { ApiError } from '../../utils/ApiError.js';
import { normalizePurpose } from '../../helpers/accounting/csv.util.js';

export class SuggestionService {
  constructor(deps) {
    this.suggestions = deps.ruleSuggestionRepository;
    this.rules = deps.ruleRepository;
    this.transactions = deps.transactionRepository;
    this.audit = deps.auditRepository;
  }

  async listPending(query = {}) {
    return this.suggestions.findMany(
      { status: 'pending' },
      {
        page: query.page,
        limit: query.limit,
        sort: '-confidence',
      },
    );
  }

  async accept(id, ctx = {}) {
    const suggestion = await this.suggestions.findById(id);
    if (!suggestion) throw ApiError.notFound('Vorschlag nicht gefunden');
    if (suggestion.status !== 'pending') {
      throw ApiError.badRequest('Vorschlag ist nicht mehr ausstehend');
    }

    const rule = await this.rules.create({
      name: suggestion.proposedName || `Vorschlag #${id}`,
      enabled: true,
      priority: 100,
      conditions: suggestion.proposedConditions,
      actions: {
        konto: suggestion.proposedActions?.konto || '',
        gegenkonto: suggestion.proposedActions?.gegenkonto || '',
        buKey: suggestion.proposedActions?.buKey || '',
        bookingTextTemplate: suggestion.proposedActions?.bookingTextTemplate || null,
      },
      source: 'suggested_accepted',
    });

    await this.suggestions.update(id, {
      status: 'accepted',
      acceptedRuleId: rule._id,
    });

    await this.audit?.log({
      actor: ctx.userId,
      action: 'suggestion.accept',
      resource: 'ruleSuggestion',
      resourceId: id,
      meta: { ruleId: rule._id },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return { suggestion: await this.suggestions.findById(id), rule };
  }

  async reject(id, ctx = {}) {
    const suggestion = await this.suggestions.findById(id);
    if (!suggestion) throw ApiError.notFound('Vorschlag nicht gefunden');
    if (suggestion.status !== 'pending') {
      throw ApiError.badRequest('Vorschlag ist nicht mehr ausstehend');
    }

    await this.suggestions.update(id, { status: 'rejected' });

    await this.audit?.log({
      actor: ctx.userId,
      action: 'suggestion.reject',
      resource: 'ruleSuggestion',
      resourceId: id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return { success: true };
  }

  async analyzePatterns(ctx = {}) {
    const result = await this.transactions.findMany(
      { status: { $in: ['open', 'reviewed', 'matched'] }, bookability: 'bookable' },
      { limit: 5000, page: 1 },
    );
    const txList = result.data;

    const clusters = new Map<string, { txIds: string[]; texts: string[]; booking: any }>();

    for (const tx of txList) {
      const tokens = extractKeyTokens(tx.purpose, tx.counterpartyName);
      if (!tokens.length) continue;

      // Cluster by primary keyword so similar counterparties/purposes group together
      const signature = tokens[0];
      if (!clusters.has(signature)) {
        clusters.set(signature, { txIds: [], texts: [], booking: null });
      }
      const cluster = clusters.get(signature)!;
      if (!cluster.txIds.includes(String(tx._id))) {
        cluster.txIds.push(String(tx._id));
      }
      if (cluster.texts.length < 5) {
        cluster.texts.push(`${tx.counterpartyName} — ${tx.purpose}`.slice(0, 120));
      }
      if (!cluster.booking && tx.booking?.konto) {
        cluster.booking = tx.booking;
      }
    }

    let created = 0;
    for (const [signature, cluster] of clusters) {
      // MVP: propose from 2+ similar open/reviewed/matched bookings (HITL still required)
      if (cluster.txIds.length < 2) continue;

      const existing = await this.suggestions.findOne({
        patternSignature: signature,
        status: { $in: ['pending', 'accepted'] },
      });
      if (existing) continue;

      const conditions = [
        {
          field: 'rawDescription',
          operator: 'contains',
          value: signature,
          caseSensitive: false,
        },
      ];
      const hasBooking = Boolean(cluster.booking?.konto && cluster.booking?.gegenkonto);
      await this.suggestions.create({
        derivedFromTransactionIds: cluster.txIds.slice(0, 20),
        patternSignature: signature,
        sampleTexts: cluster.texts,
        proposedConditions: conditions,
        proposedActions: hasBooking
          ? {
              konto: cluster.booking.konto,
              gegenkonto: cluster.booking.gegenkonto,
              buKey: cluster.booking.buKey || '',
              bookingTextTemplate: cluster.booking.bookingText || null,
            }
          : {
              konto: '3220',
              gegenkonto: '1201',
              buKey: '',
              bookingTextTemplate: null,
            },
        proposedName: `Muster: ${signature}`,
        confidence: Math.min(95, 40 + cluster.txIds.length * 10 + (hasBooking ? 15 : 0)),
        status: 'pending',
      });
      created++;
    }

    await this.audit?.log({
      actor: ctx.userId,
      action: 'suggestion.analyze_patterns',
      resource: 'ruleSuggestion',
      meta: { clustersFound: clusters.size, suggestionsCreated: created },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return { clustersFound: clusters.size, suggestionsCreated: created };
  }
}

function extractKeyTokens(purpose: string, counterpartyName: string): string[] {
  const combined = `${purpose || ''} ${counterpartyName || ''}`;
  const normalized = normalizePurpose(combined);
  const words = normalized.split(/\s+/).filter((w) => w.length >= 3);
  const stopwords = new Set([
    'und', 'der', 'die', 'das', 'von', 'für', 'mit', 'aus', 'ein', 'eine',
    'den', 'dem', 'des', 'auf', 'ist', 'hat', 'bei', 'nach', 'zum', 'zur',
    'the', 'and', 'for', 'from', 'with',
  ]);
  const tokens = words.filter((w) => !stopwords.has(w));
  return [...new Set(tokens)].slice(0, 5);
}

function tokensToConditions(signature: string) {
  const tokens = signature.split('|');
  return tokens.map((token) => ({
    field: 'rawDescription',
    operator: 'contains',
    value: token,
    caseSensitive: false,
  }));
}

export default SuggestionService;
