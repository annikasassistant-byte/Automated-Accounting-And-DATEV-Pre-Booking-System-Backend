import {
  defaultGegenkonto,
  isForbiddenCollectiveAccount,
  type SystemPolicyConfig,
} from './system-policies.js';
import { DEFAULT_SYSTEM_POLICY } from './system-policy-defaults.js';

export type RuleCondition = {
  field: string;
  operator: string;
  value?: unknown;
  caseSensitive?: boolean;
};

export type RuleLike = {
  _id?: { toString(): string };
  id?: string;
  name?: string;
  enabled?: boolean;
  priority?: number;
  conditions?: RuleCondition[];
  actions?: {
    konto: string;
    gegenkonto: string;
    buKey?: string;
    bookingTextTemplate?: string;
  };
};

export type TxLike = {
  source: 'bank' | 'paypal';
  amountCents: number;
  counterpartyName?: string;
  counterpartyIban?: string | null;
  counterpartyEmail?: string | null;
  purpose?: string;
  article?: string | null;
  rawDescription?: string;
  paypal?: { type?: string | null };
};

function fieldValue(tx: TxLike, field: string): string | number {
  switch (field) {
    case 'purpose':
      return tx.purpose || '';
    case 'counterpartyName':
      return tx.counterpartyName || '';
    case 'counterpartyIban':
      return tx.counterpartyIban || '';
    case 'counterpartyEmail':
      return tx.counterpartyEmail || '';
    case 'amountCents':
      return tx.amountCents;
    case 'source':
      return tx.source;
    case 'txnType':
      return tx.paypal?.type || '';
    case 'direction':
      return tx.amountCents < 0 ? 'out' : 'in';
    case 'rawDescription':
      return tx.rawDescription || '';
    case 'article':
      return tx.article || '';
    default:
      return '';
  }
}

function matchText(hay: string, needle: string, operator: string, caseSensitive: boolean): boolean {
  const h = caseSensitive ? hay : hay.toLowerCase();
  const n = caseSensitive ? needle : needle.toLowerCase();
  switch (operator) {
    case 'contains':
      return h.includes(n);
    case 'starts_with':
      return h.startsWith(n);
    case 'ends_with':
      return h.endsWith(n);
    case 'exact':
    case 'eq':
      return h.trim() === n.trim();
    case 'regex':
      try {
        return new RegExp(needle, caseSensitive ? '' : 'i').test(hay);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

export function conditionMatches(tx: TxLike, cond: RuleCondition): boolean {
  const caseSensitive = Boolean(cond.caseSensitive);
  const field = cond.field;
  const op = cond.operator;
  const val = cond.value;

  if (op === 'is_negative') return tx.amountCents < 0;
  if (op === 'is_positive') return tx.amountCents > 0;

  if (field === 'amountCents') {
    const amount = tx.amountCents;
    if (op === 'eq') return amount === Number(val);
    if (op === 'lt') return amount < Number(val);
    if (op === 'lte') return amount <= Number(val);
    if (op === 'gt') return amount > Number(val);
    if (op === 'gte') return amount >= Number(val);
    if (op === 'between' && Array.isArray(val) && val.length === 2) {
      return amount >= Number(val[0]) && amount <= Number(val[1]);
    }
    return false;
  }

  if (field === 'source' || field === 'direction' || field === 'txnType') {
    const fv = String(fieldValue(tx, field));
    if (op === 'any_of' && Array.isArray(val)) {
      return val.map(String).some((v) => matchText(fv, v, 'exact', caseSensitive));
    }
    return matchText(fv, String(val ?? ''), op === 'eq' ? 'exact' : op, caseSensitive);
  }

  const text = String(fieldValue(tx, field));
  if (op === 'any_of' && Array.isArray(val)) {
    return val.map(String).some((v) => matchText(text, v, 'contains', caseSensitive));
  }
  if (op === 'all_of' && Array.isArray(val)) {
    return val.map(String).every((v) => matchText(text, v, 'contains', caseSensitive));
  }
  return matchText(text, String(val ?? ''), op, caseSensitive);
}

export function ruleMatches(tx: TxLike, rule: RuleLike): boolean {
  if (rule.enabled === false) return false;
  const conditions = rule.conditions || [];
  if (!conditions.length) return false;
  return conditions.every((c) => conditionMatches(tx, c));
}

export type RuleEngineResult =
  | { status: 'open'; matchedRuleIds: []; booking: null; confidence: null }
  | {
      status: 'matched';
      matchedRuleIds: string[];
      booking: {
        konto: string;
        gegenkonto: string;
        buKey: string;
        bookingText: string;
        sollHaben: 'S' | 'H';
      };
      confidence: number;
    }
  | {
      status: 'conflict';
      matchedRuleIds: string[];
      booking: null;
      confidence: null;
    };

/**
 * Human rule engine:
 * - 0 matches → open
 * - 1 match → matched
 * - ≥2 matches → conflict (never auto-pick) — priority is NOT used to break multi-match
 */
export function applyHumanRules(
  tx: TxLike,
  rules: RuleLike[],
  policy?: SystemPolicyConfig | null,
): RuleEngineResult {
  const enabled = rules.filter((r) => r.enabled !== false);
  const matched = enabled.filter((r) => ruleMatches(tx, r));

  if (matched.length === 0) {
    return { status: 'open', matchedRuleIds: [], booking: null, confidence: null };
  }

  if (matched.length >= 2) {
    return {
      status: 'conflict',
      matchedRuleIds: matched.map((r) => String(r._id || r.id)),
      booking: null,
      confidence: null,
    };
  }

  const rule = matched[0];
  const actions = rule.actions;
  if (!actions?.konto || !actions?.gegenkonto) {
    return { status: 'open', matchedRuleIds: [], booking: null, confidence: null };
  }
  if (
    isForbiddenCollectiveAccount(actions.konto, policy) ||
    isForbiddenCollectiveAccount(actions.gegenkonto, policy)
  ) {
    return { status: 'open', matchedRuleIds: [], booking: null, confidence: null };
  }

  const konto = actions.konto;
  const gegenkonto = actions.gegenkonto || defaultGegenkonto(tx.source, policy);
  const buKey = actions.buKey ?? '';
  const bookingText =
    actions.bookingTextTemplate ||
    [tx.counterpartyName, tx.purpose].filter(Boolean).join(' — ').slice(0, 60);

  return {
    status: 'matched',
    matchedRuleIds: [String(rule._id || rule.id)],
    booking: {
      konto,
      gegenkonto,
      buKey,
      bookingText,
      sollHaben: tx.amountCents < 0 ? 'S' : 'H',
    },
    confidence: 95,
  };
}

export function inventorySeedRule(policy?: SystemPolicyConfig | null) {
  const cfg = policy || DEFAULT_SYSTEM_POLICY;
  return {
    name: 'Private Wareneinkäufe (Inventar)',
    enabled: true,
    priority: 50,
    source: 'seed' as const,
    conditions: [
      {
        field: 'rawDescription',
        operator: 'any_of',
        value: [...cfg.inventoryKeywords],
        caseSensitive: false,
      },
      { field: 'amountCents', operator: 'is_negative', value: null },
    ],
    actions: {
      konto: cfg.accounts.privateInventory,
      gegenkonto: cfg.accounts.bank,
      buKey: '',
      bookingTextTemplate: 'Privater Wareneinkauf',
    },
  };
}

/**
 * Note: inventory seed uses a single gegenkonto; import pipeline should
 * rewrite gegenkonto to bank/paypal by source when applying S15.
 */
export function adjustInventoryGegenkonto(
  booking: { konto: string; gegenkonto: string; buKey?: string },
  source: 'bank' | 'paypal',
  policy?: SystemPolicyConfig | null,
) {
  const cfg = policy || DEFAULT_SYSTEM_POLICY;
  if (!cfg.enabled.s15Inventory) return booking;
  if (booking.konto === cfg.accounts.privateInventory) {
    return {
      ...booking,
      gegenkonto: defaultGegenkonto(source, cfg),
      buKey: '',
    };
  }
  return booking;
}
