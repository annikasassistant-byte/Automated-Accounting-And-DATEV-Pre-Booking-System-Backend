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
  /** How conditions combine. Default AND (every). OR = any condition matches. */
  conditionLogic?: 'and' | 'or';
  conditions?: RuleCondition[];
  actions?: {
    konto: string;
    gegenkonto?: string;
    /** When true, Gegenkonto = payment account mapped to import source (bank/PayPal). */
    useMappedPaymentAccount?: boolean;
    buKey?: string;
    bookingTextTemplate?: string;
  };
  validFrom?: Date | string | null;
  validTo?: Date | string | null;
  version?: number;
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
  bookingDate?: Date | string | null;
  paypal?: { type?: string | null; subject?: string | null; note?: string | null };
};

function fieldValue(tx: TxLike, field: string): string | number {
  switch (field) {
    case 'purpose':
      return [tx.purpose, tx.article, tx.paypal?.subject, tx.paypal?.note].filter(Boolean).join(' ');
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
    case 'paypalSubject':
      return tx.paypal?.subject || '';
    case 'paypalNote':
      return tx.paypal?.note || '';
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
    case 'not_contains':
    case 'does_not_contain':
      return !h.includes(n);
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

  if (op === 'is_empty' || op === 'is_null') {
    const fv = fieldValue(tx, field);
    if (typeof fv === 'number') return false;
    return !String(fv ?? '').trim();
  }
  if (op === 'is_not_empty') {
    const fv = fieldValue(tx, field);
    if (typeof fv === 'number') return true;
    return Boolean(String(fv ?? '').trim());
  }
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
    if (op === 'not_contains' || op === 'does_not_contain') {
      return matchText(fv, String(val ?? ''), op, caseSensitive);
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

function ruleValidityActive(rule: RuleLike, onDate?: Date | string | null): boolean {
  if (!rule.validFrom && !rule.validTo) return true;
  const ref = onDate ? new Date(onDate) : new Date();
  if (Number.isNaN(ref.getTime())) return true;
  if (rule.validFrom && ref < new Date(rule.validFrom)) return false;
  if (rule.validTo) {
    const end = new Date(rule.validTo);
    end.setHours(23, 59, 59, 999);
    if (ref > end) return false;
  }
  return true;
}

export function ruleMatches(tx: TxLike, rule: RuleLike): boolean {
  if (rule.enabled === false) return false;
  if (!ruleValidityActive(rule, (tx as any).bookingDate)) return false;
  const conditions = rule.conditions || [];
  if (!conditions.length) return false;
  if (rule.conditionLogic === 'or') {
    return conditions.some((c) => conditionMatches(tx, c));
  }
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
  if (!actions?.konto) {
    return { status: 'open', matchedRuleIds: [], booking: null, confidence: null };
  }

  const useMapped = Boolean(actions.useMappedPaymentAccount);
  const gegenkonto = useMapped
    ? defaultGegenkonto(tx.source, policy)
    : actions.gegenkonto || defaultGegenkonto(tx.source, policy);

  if (!gegenkonto) {
    return { status: 'open', matchedRuleIds: [], booking: null, confidence: null };
  }
  if (
    isForbiddenCollectiveAccount(actions.konto, policy) ||
    isForbiddenCollectiveAccount(gegenkonto, policy)
  ) {
    return { status: 'open', matchedRuleIds: [], booking: null, confidence: null };
  }

  const konto = actions.konto;
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
    name: 'Wareneingang ohne Vorsteuerabzug (§25a)',
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
      bookingTextTemplate: 'Wareneingang ohne Vorsteuerabzug (§25a)',
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
