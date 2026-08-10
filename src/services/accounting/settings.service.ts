import { ApiError } from '../../utils/ApiError.js';
import {
  cloneDefaultSystemPolicy,
  type SystemPolicyConfig,
} from '../../helpers/accounting/system-policy-defaults.js';
import { toPolicyPlain } from '../../helpers/accounting/system-policies.js';

const POLICY_STRING_ARRAY_KEYS = [
  'paypalExcludeTypes',
  'marketplacePatterns',
  'bankPaypalCounterpartyPatterns',
  'bankPaypalPurposePatterns',
  'paypalBankTransferTypePatterns',
  'ownerRelatedPatterns',
  'commercialVatHints',
  'inventoryKeywords',
] as const;

function normalizeStringList(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw ApiError.badRequest('Listenfelder müssen Arrays von Zeichenketten sein');
  }
  return value
    .map((v) => String(v ?? '').trim())
    .filter(Boolean);
}

function validateRegexList(patterns: string[], field: string) {
  for (const p of patterns) {
    try {
      // eslint-disable-next-line no-new
      new RegExp(p, 'i');
    } catch {
      throw ApiError.badRequest(`Ungültiges Regex-Muster in ${field}: ${p}`);
    }
  }
}

export class SettingsService {
  constructor(deps) {
    this.settings = deps.companySettingsRepository;
    this.systemPolicies = deps.systemPolicyRepository;
    this.audit = deps.auditRepository;
    this.#policyCache = null;
    this.#policyCacheAt = 0;
  }

  #policyCache: SystemPolicyConfig | null;
  #policyCacheAt: number;

  async getCompany() {
    return this.settings.getOrCreateDefault();
  }

  async updateCompany(data, ctx = {}) {
    const doc = await this.settings.getOrCreateDefault();

    const allowed = [
      'companyName', 'taxId', 'street', 'city', 'postalCode', 'country',
      'advisorNumber', 'clientNumber', 'chartOfAccounts', 'currency',
      'defaultBankAccount', 'defaultPaypalAccount', 'clearingAccount',
      'fiscalYearStartMonth', 'blockExportIfOpen', 'blockExportIfUnbalanced',
      'allowMatchedWithoutReview',
    ];

    const update: Record<string, unknown> = {};
    for (const key of allowed) {
      if (data[key] !== undefined) update[key] = data[key];
    }

    if (!Object.keys(update).length) {
      throw ApiError.badRequest('Keine gültigen Felder zum Aktualisieren');
    }

    const updated = await this.settings.update(doc._id, update);

    await this.audit?.log({
      actor: ctx.userId,
      action: 'settings.update',
      resource: 'companySettings',
      resourceId: doc._id,
      meta: { fields: Object.keys(update) },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return updated;
  }

  invalidatePolicyCache() {
    this.#policyCache = null;
    this.#policyCacheAt = 0;
  }

  /** Cached plain config for import/rules hot path (5s TTL). */
  async getSystemPolicyConfig(): Promise<SystemPolicyConfig> {
    const now = Date.now();
    if (this.#policyCache && now - this.#policyCacheAt < 5000) {
      return this.#policyCache;
    }
    const plain = await this.systemPolicies.getPlainConfig();
    this.#policyCache = plain;
    this.#policyCacheAt = now;
    return plain;
  }

  async getSystemPolicies() {
    const doc = await this.systemPolicies.getOrCreateDefault();
    return toPolicyPlain(doc.toObject ? doc.toObject() : doc);
  }

  async updateSystemPolicies(data, ctx = {}) {
    const doc = await this.systemPolicies.getOrCreateDefault();
    const update: Record<string, unknown> = {};

    if (data.accounts !== undefined) {
      if (!data.accounts || typeof data.accounts !== 'object') {
        throw ApiError.badRequest('accounts muss ein Objekt sein');
      }
      const a = data.accounts;
      update.accounts = {
        bank: String(a.bank ?? doc.accounts?.bank ?? '1201').trim(),
        paypal: String(a.paypal ?? doc.accounts?.paypal ?? '1203').trim(),
        clearing: String(a.clearing ?? doc.accounts?.clearing ?? '1361').trim(),
        privateInventory: String(
          a.privateInventory ?? doc.accounts?.privateInventory ?? '3220',
        ).trim(),
        forbiddenCollectives: normalizeStringList(
          a.forbiddenCollectives ?? doc.accounts?.forbiddenCollectives,
        ) || ['10001', '70002'],
      };
      if (!(update.accounts as { bank: string }).bank) {
        throw ApiError.badRequest('Bankkonto ist erforderlich');
      }
    }

    if (data.enabled !== undefined) {
      if (!data.enabled || typeof data.enabled !== 'object') {
        throw ApiError.badRequest('enabled muss ein Objekt sein');
      }
      update.enabled = {
        ...(doc.enabled?.toObject ? doc.enabled.toObject() : doc.enabled || {}),
        ...data.enabled,
      };
    }

    for (const key of POLICY_STRING_ARRAY_KEYS) {
      if (data[key] !== undefined) {
        const list = normalizeStringList(data[key]);
        if (list === undefined) continue;
        if (
          key === 'marketplacePatterns' ||
          key === 'bankPaypalCounterpartyPatterns' ||
          key === 'bankPaypalPurposePatterns' ||
          key === 'paypalBankTransferTypePatterns' ||
          key === 'ownerRelatedPatterns' ||
          key === 'commercialVatHints'
        ) {
          validateRegexList(list, key);
        }
        update[key] = list;
      }
    }

    if (data.clearingBookingText !== undefined) {
      update.clearingBookingText = String(data.clearingBookingText || '').trim();
    }

    if (!Object.keys(update).length) {
      throw ApiError.badRequest('Keine gültigen Felder zum Aktualisieren');
    }

    const updated = await this.systemPolicies.update(doc._id, update);
    this.invalidatePolicyCache();

    // Keep company DATEV default accounts in sync when system accounts change
    if (update.accounts) {
      const acc = update.accounts as SystemPolicyConfig['accounts'];
      const company = await this.settings.getOrCreateDefault();
      await this.settings.update(company._id, {
        defaultBankAccount: acc.bank,
        defaultPaypalAccount: acc.paypal,
        clearingAccount: acc.clearing,
      });
    }

    await this.audit?.log({
      actor: ctx.userId,
      action: 'settings.system_policies.update',
      resource: 'systemPolicy',
      resourceId: doc._id,
      meta: { fields: Object.keys(update) },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return toPolicyPlain(updated.toObject ? updated.toObject() : updated);
  }

  async resetSystemPolicies(ctx = {}) {
    const doc = await this.systemPolicies.getOrCreateDefault();
    const defaults = cloneDefaultSystemPolicy();
    const updated = await this.systemPolicies.update(doc._id, defaults);
    this.invalidatePolicyCache();

    const company = await this.settings.getOrCreateDefault();
    await this.settings.update(company._id, {
      defaultBankAccount: defaults.accounts.bank,
      defaultPaypalAccount: defaults.accounts.paypal,
      clearingAccount: defaults.accounts.clearing,
    });

    await this.audit?.log({
      actor: ctx.userId,
      action: 'settings.system_policies.reset',
      resource: 'systemPolicy',
      resourceId: doc._id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return toPolicyPlain(updated.toObject ? updated.toObject() : updated);
  }
}

export default SettingsService;
