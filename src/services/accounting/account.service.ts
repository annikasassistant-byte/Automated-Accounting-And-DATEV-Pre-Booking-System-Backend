import { ApiError } from '../../utils/ApiError.js';
import { getUniqueSeedAccounts } from '../../data/skr03-accounts.js';
import { parseCsv, detectDelimiter } from '../../helpers/accounting/csv.util.js';
import { DEFAULT_SYSTEM_POLICY } from '../../helpers/accounting/system-policy-defaults.js';
import Transaction from '../../models/accounting/transaction.model.js';
import Rule from '../../models/accounting/rule.model.js';
import SystemPolicy from '../../models/accounting/systemPolicy.model.js';

export class AccountService {
  constructor(deps) {
    this.accounts = deps.accountRepository;
    this.audit = deps.auditRepository;
  }

  async list(query = {}) {
    const filter: Record<string, unknown> = {};
    if (query.type) filter.type = query.type;
    if (query.active !== undefined) filter.active = query.active;
    return this.accounts.findMany(filter, {
      page: query.page,
      limit: query.limit || 500,
      sort: query.sort || 'number',
      search: query.search,
      searchFields: ['number', 'name'],
    });
  }

  async create(data, ctx = {}) {
    const existing = await this.accounts.findByNumber(data.number);
    if (existing) throw ApiError.conflict(`Konto ${data.number} existiert bereits`);

    const account = await this.accounts.create({
      number: data.number,
      name: data.name,
      type: data.type || 'other',
      notes: data.notes || null,
      active: data.active !== false,
      isSystemProtected: data.isSystemProtected || false,
    });

    await this.audit?.log({
      actor: ctx.userId,
      action: 'account.create',
      resource: 'account',
      resourceId: account._id,
      meta: { number: data.number },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return account;
  }

  async update(id, data, ctx = {}) {
    const account = await this.accounts.findById(id);
    if (!account) throw ApiError.notFound('Konto nicht gefunden');

    const nextNumber = data.number !== undefined ? String(data.number).trim() : account.number;
    if (nextNumber && nextNumber !== account.number) {
      const clash = await this.accounts.findByNumber(nextNumber);
      if (clash && String(clash._id) !== String(account._id)) {
        throw ApiError.conflict(`Konto ${nextNumber} existiert bereits`);
      }
    }

    const updated = await this.accounts.update(id, data);
    if (!updated) throw ApiError.notFound('Konto nicht gefunden');

    if (nextNumber && nextNumber !== account.number) {
      await this.remapKontoNumber(account.number, nextNumber);
    }

    await this.audit?.log({
      actor: ctx.userId,
      action: 'account.update',
      resource: 'account',
      resourceId: id,
      meta: { fields: Object.keys(data) },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return updated;
  }

  async softDelete(id, ctx = {}) {
    const account = await this.accounts.findById(id);
    if (!account) throw ApiError.notFound('Konto nicht gefunden');
    if (account.isSystemProtected) {
      throw ApiError.forbidden('Systemkonto kann nicht gelöscht werden');
    }

    await this.accounts.softDelete(id, ctx.userId);

    await this.audit?.log({
      actor: ctx.userId,
      action: 'account.delete',
      resource: 'account',
      resourceId: id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return { success: true };
  }

  async remapKontoNumber(fromNumber, toNumber) {
    if (!fromNumber || !toNumber || fromNumber === toNumber) return;
    const policy = await SystemPolicy.findOne({ singletonKey: 'default' });
    if (policy?.accounts) {
      const accounts = policy.accounts.toObject ? policy.accounts.toObject() : { ...policy.accounts };
      let changed = false;
      for (const key of ['bank', 'paypal', 'clearing', 'privateInventory']) {
        if (accounts[key] === fromNumber) {
          accounts[key] = toNumber;
          changed = true;
        }
      }
      if (changed) {
        policy.accounts = accounts;
        await policy.save();
      }
    }
    await Rule.updateMany(
      { 'actions.konto': fromNumber, isDeleted: { $ne: true } },
      { $set: { 'actions.konto': toNumber } },
    );
    await Rule.updateMany(
      { 'actions.gegenkonto': fromNumber, isDeleted: { $ne: true } },
      { $set: { 'actions.gegenkonto': toNumber } },
    );
    await Transaction.updateMany(
      {
        'booking.konto': fromNumber,
        status: { $ne: 'exported' },
        isDeleted: { $ne: true },
      },
      { $set: { 'booking.konto': toNumber } },
    );
  }

  async migrateLegacyInventoryKonto() {
    const legacy = await this.accounts.findByNumber('3220');
    const target = await this.accounts.findByNumber('3349');
    if (legacy && !target) {
      await this.accounts.update(legacy._id, {
        number: '3349',
        name: 'Wareneingang ohne Vorsteuerabzug',
        type: 'expense',
        isSystemProtected: true,
        notes:
          'Private seller purchases — no input VAT (empty BU). Identify for §25a overall-margin. Migrated from 3220.',
        active: true,
      });
      await this.remapKontoNumber('3220', '3349');
    } else if (legacy && target && String(legacy._id) !== String(target._id)) {
      await this.accounts.update(legacy._id, { active: false });
      await this.remapKontoNumber('3220', '3349');
    }
  }

  async seedAccounts(ctx = {}) {
    await this.migrateLegacyInventoryKonto();
    const seeds = getUniqueSeedAccounts();
    let created = 0;
    let updated = 0;

    for (const seed of seeds) {
      const existing = await this.accounts.findByNumber(seed.number);
      if (existing) {
        await this.accounts.update(existing._id, {
          name: seed.name,
          type: seed.type,
          isSystemProtected: seed.isSystemProtected || false,
          notes: seed.notes || existing.notes || null,
        });
        updated++;
      } else {
        await this.accounts.create({
          number: seed.number,
          name: seed.name,
          type: seed.type,
          isSystemProtected: seed.isSystemProtected || false,
          notes: seed.notes || null,
          active: true,
        });
        created++;
      }
    }

    await this.audit?.log({
      actor: ctx.userId,
      action: 'account.seed',
      resource: 'account',
      meta: { created, updated, total: seeds.length },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return { created, updated, total: seeds.length };
  }

  async importCsv(content, ctx = {}) {
    const text = Buffer.isBuffer(content) ? content.toString('utf-8') : String(content);
    const delim = detectDelimiter(text);
    const table = parseCsv(text, delim);

    if (table.length < 2) throw ApiError.badRequest('CSV-Datei leer oder ungültig');

    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (let i = 1; i < table.length; i++) {
      const cols = table[i];
      const number = (cols[0] || '').trim();
      const name = (cols[1] || '').trim();
      const type = (cols[2] || 'other').trim();
      const notes = (cols[3] || '').trim() || null;

      if (!number || !name) {
        errors.push(`Zeile ${i + 1}: Nummer oder Name fehlt`);
        continue;
      }

      const existing = await this.accounts.findByNumber(number);
      if (existing) {
        if (!existing.isSystemProtected) {
          await this.accounts.update(existing._id, { name, type, notes });
          updated++;
        }
      } else {
        await this.accounts.create({ number, name, type, notes, active: true });
        created++;
      }
    }

    await this.audit?.log({
      actor: ctx.userId,
      action: 'account.import_csv',
      resource: 'account',
      meta: { created, updated, errors: errors.length },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return { created, updated, errors };
  }

  async exportCsv() {
    const result = await this.accounts.findMany({}, { limit: 5000, page: 1, sort: 'number' });
    const header = 'Nummer;Name;Typ;Notizen';
    const lines = result.data.map(
      (a) => `${a.number};${a.name};${a.type};${a.notes || ''}`,
    );
    return `${header}\n${lines.join('\n')}`;
  }
}

export default AccountService;
