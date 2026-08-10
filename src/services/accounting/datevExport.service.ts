import { ApiError } from '../../utils/ApiError.js';
import {
  buildDatevExtf,
  validateDatevRows,
  type DatevBookingRow,
} from '../../helpers/accounting/datev-writer.js';

export class DatevExportService {
  constructor(deps) {
    this.exportBatches = deps.exportBatchRepository;
    this.exportItems = deps.exportItemRepository;
    this.transactions = deps.transactionRepository;
    this.companySettings = deps.companySettingsRepository;
    this.policySettings = deps.settingsService;
    this.audit = deps.auditRepository;
  }

  async #forbiddenCollectives() {
    if (this.policySettings?.getSystemPolicyConfig) {
      const policy = await this.policySettings.getSystemPolicyConfig();
      if (policy?.enabled?.s12ForbiddenCollectives === false) return [];
      return policy?.accounts?.forbiddenCollectives || ['10001', '70002'];
    }
    return ['10001', '70002'];
  }

  async preview(periodType, from, to) {
    const { txList, settings } = await this.#gatherExportable(from, to);
    const rows = this.#toDatevRows(txList);
    const validation = validateDatevRows(rows, await this.#forbiddenCollectives());

    return {
      rowCount: rows.length,
      periodType,
      from,
      to,
      validation,
      samples: rows.slice(0, 20),
      settings: {
        advisorNumber: settings.advisorNumber,
        clientNumber: settings.clientNumber,
        allowMatchedWithoutReview: settings.allowMatchedWithoutReview,
        blockExportIfOpen: settings.blockExportIfOpen,
      },
    };
  }

  async validate(periodType, from, to) {
    const { txList, settings } = await this.#gatherExportable(from, to);

    if (settings.blockExportIfOpen) {
      const openFilter = {
        bookingDate: { $gte: new Date(from), $lte: new Date(to) },
        status: { $in: ['open', 'conflict'] },
        bookability: 'bookable',
      };
      const openResult = await this.transactions.findMany(openFilter, { limit: 1, page: 1 });
      if (openResult.data.length > 0) {
        throw ApiError.badRequest(
          'Es gibt noch offene/konfliktbehaftete Transaktionen im Zeitraum. Export blockiert (Einstellung: blockExportIfOpen).',
        );
      }
    }

    const rows = this.#toDatevRows(txList);
    const validation = validateDatevRows(rows, await this.#forbiddenCollectives());

    return {
      valid: validation.errors.length === 0,
      rowCount: rows.length,
      validation,
    };
  }

  async createExport(periodType, from, to, userId, ctx = {}) {
    const { txList, settings } = await this.#gatherExportable(from, to);

    if (!txList.length) throw ApiError.badRequest('Keine exportierbaren Transaktionen im Zeitraum');

    if (settings.blockExportIfOpen) {
      const openFilter = {
        bookingDate: { $gte: new Date(from), $lte: new Date(to) },
        status: { $in: ['open', 'conflict'] },
        bookability: 'bookable',
      };
      const openResult = await this.transactions.findMany(openFilter, { limit: 1, page: 1 });
      if (openResult.data.length > 0) {
        throw ApiError.badRequest(
          'Offene/Konflikttransaktionen im Zeitraum — Export blockiert.',
        );
      }
    }

    const rows = this.#toDatevRows(txList);
    const validation = validateDatevRows(rows, await this.#forbiddenCollectives());
    if (validation.errors.length > 0) {
      throw ApiError.badRequest('DATEV-Validierung fehlgeschlagen', validation.errors);
    }

    const extf = buildDatevExtf(rows, {
      advisorNumber: settings.advisorNumber || '',
      clientNumber: settings.clientNumber || '',
      periodStart: new Date(from),
      periodEnd: new Date(to),
    });

    const totalsByAccount: Record<string, number> = {};
    for (const r of rows) {
      totalsByAccount[r.konto] = (totalsByAccount[r.konto] || 0) + Math.abs(r.amountCents);
      totalsByAccount[r.gegenkonto] = (totalsByAccount[r.gegenkonto] || 0) + Math.abs(r.amountCents);
    }

    const exportBatch = await this.exportBatches.create({
      periodType,
      periodStart: new Date(from),
      periodEnd: new Date(to),
      fileName: extf.fileName,
      fileHash: extf.fileHash,
      fileContent: extf.content,
      encoding: 'cp1252',
      rowCount: extf.rowCount,
      checksum: extf.fileHash,
      totalsByAccount,
      validationResults: { errors: [], warnings: validation.warnings, passed: true },
      transactionIds: txList.map((t) => t._id),
      createdByUser: userId,
    });

    for (const tx of txList) {
      await this.exportItems.create({
        exportBatchId: exportBatch._id,
        transactionId: tx._id,
      });

      await this.transactions.update(tx._id, {
        status: 'exported',
        exportedInBatchId: exportBatch._id,
        $push: {
          history: {
            action: 'exported',
            status: 'exported',
            actor: userId,
            actorLabel: 'User',
            note: `DATEV-Export: ${extf.fileName}`,
          },
        },
      });
    }

    await this.audit?.log({
      actor: userId,
      action: 'export.create',
      resource: 'exportBatch',
      resourceId: exportBatch._id,
      meta: { fileName: extf.fileName, rowCount: extf.rowCount, periodType },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return exportBatch;
  }

  async listExports(query = {}) {
    return this.exportBatches.findMany({}, {
      page: query.page,
      limit: query.limit,
      sort: query.sort || '-createdAt',
    });
  }

  async getDownload(id) {
    const batch = await this.exportBatches.findById(id);
    if (!batch) throw ApiError.notFound('Export-Batch nicht gefunden');
    if (!batch.fileContent) throw ApiError.notFound('Export-Inhalt nicht verfügbar');

    return {
      content: batch.fileContent,
      fileName: batch.fileName,
      encoding: batch.encoding || 'cp1252',
    };
  }

  async #gatherExportable(from, to) {
    const settings = await this.companySettings.getOrCreateDefault();

    const statusFilter = ['reviewed'];
    if (settings.allowMatchedWithoutReview) statusFilter.push('matched');

    const filter = {
      bookingDate: { $gte: new Date(from), $lte: new Date(to) },
      status: { $in: statusFilter },
      bookability: 'bookable',
      exportedInBatchId: null,
    };

    const result = await this.transactions.findMany(filter, { limit: 10000, page: 1, sort: 'bookingDate' });
    return { txList: result.data, settings };
  }

  #toDatevRows(txList): DatevBookingRow[] {
    return txList
      .filter((tx) => tx.booking?.konto && tx.booking?.gegenkonto)
      .map((tx) => ({
        amountCents: tx.amountCents,
        sollHaben: tx.booking.sollHaben || (tx.amountCents < 0 ? 'S' : 'H'),
        konto: tx.booking.konto,
        gegenkonto: tx.booking.gegenkonto,
        buKey: tx.booking.buKey || '',
        belegdatum: tx.bookingDate,
        belegfeld1:
          tx.paypal?.transactionCode ||
          tx.bank?.customerRef ||
          tx.fingerprint?.slice(0, 12) ||
          '',
        buchungstext: (tx.booking.bookingText || tx.purpose || '').slice(0, 60),
      }));
  }
}

export default DatevExportService;
