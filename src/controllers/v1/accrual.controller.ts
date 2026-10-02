import { container } from '../../di/container.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

function requestContext(req: any) {
  return {
    userId: req.user?._id || req.user?.id,
    userName: req.user?.firstName || req.user?.email,
    ip: req.ip || req.socket?.remoteAddress,
    userAgent: req.get('user-agent'),
  };
}

export const importJtl = asyncHandler(async (req, res) => {
  const ctx = requestContext(req);
  const file = req.file || req.body;
  const result = await container.jtlImportService.importJtl(file, ctx.userId, ctx);
  if (result.status === 'duplicate_file') {
    return ApiResponse.ok(res, result, result.message);
  }
  return ApiResponse.created(res, result);
});

export const importMarketplace = asyncHandler(async (req, res) => {
  const ctx = {
    ...requestContext(req),
    reportType: req.query?.reportType || req.body?.reportType || 'auto',
  };
  const file = req.file || req.body;
  const result = await container.marketplaceImportService.importMarketplace(
    req.params.channel,
    file,
    ctx.userId,
    ctx,
  );
  if (result.status === 'duplicate_file') {
    return ApiResponse.ok(res, result, result.message);
  }
  return ApiResponse.created(res, result);
});

export const getInbox = asyncHandler(async (req, res) => {
  const inbox = await container.inboxService.getInbox(req.query);
  return ApiResponse.ok(res, inbox);
});

export const listEvents = asyncHandler(async (req, res) => {
  const result = await container.businessEventService.list(req.query);
  return ApiResponse.paginated(res, result.data, result.pagination);
});

export const getEvent = asyncHandler(async (req, res) => {
  const event = await container.businessEventService.get(req.params.id);
  return ApiResponse.ok(res, event);
});

export const patchEvent = asyncHandler(async (req, res) => {
  const updated = await container.businessEventService.patch(req.params.id, req.body);
  return ApiResponse.ok(res, updated, 'Geschäftsvorfall aktualisiert');
});

export const listExceptions = asyncHandler(async (req, res) => {
  const result = await container.exceptionService.list(req.query);
  return ApiResponse.paginated(res, result.data, result.pagination);
});

export const patchException = asyncHandler(async (req, res) => {
  const ctx = requestContext(req);
  const updated = await container.exceptionService.resolve(req.params.id, ctx.userId, req.body, ctx);
  return ApiResponse.ok(res, updated, 'Ausnahme aktualisiert');
});

export const bulkResolveExceptions = asyncHandler(async (req, res) => {
  const ctx = requestContext(req);
  const { ids, status, note } = req.body || {};
  const result = await container.exceptionService.bulkResolve(
    ids,
    status,
    ctx.userId,
    note || req.body?.resolutionNote,
    ctx,
  );
  return ApiResponse.ok(res, result, 'Ausnahmen aktualisiert');
});

export const getClearingConfig = asyncHandler(async (req, res) => {
  const config = await container.clearingService.getConfig();
  return ApiResponse.ok(res, config);
});

export const getMarketplaceClearing = asyncHandler(async (req, res) => {
  const data = await container.clearingService.getMarketplaceAccounts(req.params.marketplace);
  return ApiResponse.ok(res, data);
});

export const patchClearingConfig = asyncHandler(async (req, res) => {
  const ctx = requestContext(req);
  const updated = await container.clearingService.updateConfig(req.body, ctx.userId, ctx);
  return ApiResponse.ok(res, updated, 'Clearing-Konfiguration gespeichert');
});

export const listMarketplaceReconciliation = asyncHandler(async (req, res) => {
  const result = await container.payoutReconciliationService.list(req.query);
  return ApiResponse.paginated(res, result.data, {
    ...result.pagination,
    overview: result.overview,
  });
});

export const matchMarketplacePayout = asyncHandler(async (req, res) => {
  const ctx = requestContext(req);
  const { payoutEventId, transactionId } = req.body;
  const result = await container.payoutReconciliationService.manualMatch(
    payoutEventId,
    transactionId,
    ctx.userId,
  );
  return ApiResponse.ok(res, result, 'Payout zugeordnet');
});

export const listJournal = asyncHandler(async (req, res) => {
  const result = await container.accrualJournalService.list(req.query);
  return ApiResponse.paginated(res, result.data, result.pagination);
});

export const getJournal = asyncHandler(async (req, res) => {
  const data = await container.accrualJournalService.get(req.params.id);
  return ApiResponse.ok(res, data);
});

export const buildJournalDraft = asyncHandler(async (req, res) => {
  const data = await container.accrualJournalService.buildDraftForEvent(req.params.eventId);
  return ApiResponse.created(res, data);
});

export const postJournal = asyncHandler(async (req, res) => {
  const ctx = requestContext(req);
  const data = await container.accrualJournalService.post(req.params.id, ctx.userId, ctx);
  return ApiResponse.ok(res, data, 'Journal gebucht');
});

export const bulkBuildJournal = asyncHandler(async (req, res) => {
  const { from, to } = req.body || {};
  const data = await container.accrualJournalService.bulkBuild(from, to);
  return ApiResponse.ok(res, data, 'Journal-Entwürfe erstellt');
});

export const bulkPostJournal = asyncHandler(async (req, res) => {
  const ctx = requestContext(req);
  const { from, to } = req.body || {};
  const data = await container.accrualJournalService.bulkPost(from, to, ctx.userId, ctx);
  return ApiResponse.ok(res, data, 'Journalbuchungen durchgeführt');
});

export const listTaxCodes = asyncHandler(async (req, res) => {
  const codes = await container.accountingMappingService.listTaxCodes();
  return ApiResponse.ok(res, codes);
});

export const upsertTaxCode = asyncHandler(async (req, res) => {
  const doc = await container.accountingMappingService.upsertTaxCode(req.body);
  return ApiResponse.ok(res, doc, 'Steuerschlüssel gespeichert');
});

export const getAccrualOverview = asyncHandler(async (req, res) => {
  const data = await container.accrualReportService.overview(
    req.query.from as string | undefined,
    req.query.to as string | undefined,
  );
  return ApiResponse.ok(res, data);
});

export const getPeriodCoverage = asyncHandler(async (req, res) => {
  const data = await container.accrualReportService.periodCoverage(
    req.query.from as string | undefined,
    req.query.to as string | undefined,
  );
  return ApiResponse.ok(res, data);
});

export const getAmazonJtlAbgleich = asyncHandler(async (req, res) => {
  const data = await container.accrualReportService.amazonJtlAbgleich(
    req.query.from as string | undefined,
    req.query.to as string | undefined,
  );
  return ApiResponse.ok(res, data);
});

export const previewJournalDatev = asyncHandler(async (req, res) => {
  const data = await container.accrualJournalService.previewDatev(
    req.query.from as string | undefined,
    req.query.to as string | undefined,
  );
  return ApiResponse.ok(res, data);
});

export const previewFeeVat = asyncHandler(async (req, res) => {
  const data = await container.feeVatService.previewMonth(
    req.query.from as string | undefined,
    req.query.to as string | undefined,
  );
  return ApiResponse.ok(res, data);
});

export const fxTrueUpEvent = asyncHandler(async (req, res) => {
  const ctx = requestContext(req);
  const data = await container.fxTrueUpService.trueUpEvent(req.params.eventId, ctx.userId, ctx);
  return ApiResponse.ok(res, data, 'FX True-up');
});

export const fxTrueUpPeriod = asyncHandler(async (req, res) => {
  const ctx = requestContext(req);
  const { from, to } = req.body || {};
  const data = await container.fxTrueUpService.trueUpPeriod(from, to, ctx.userId, ctx);
  return ApiResponse.ok(res, data, 'FX True-up Periode');
});

export const previewAccrualDatev = asyncHandler(async (req, res) => {
  const { from, to } = req.body || {};
  const data = await container.accrualDatevExportService.preview(from, to);
  return ApiResponse.ok(res, data);
});

export const validateAccrualDatev = asyncHandler(async (req, res) => {
  const { from, to } = req.body || {};
  const data = await container.accrualDatevExportService.validate(from, to);
  return ApiResponse.ok(res, data);
});

export const createAccrualDatev = asyncHandler(async (req, res) => {
  const ctx = requestContext(req);
  const { from, to } = req.body || {};
  const job = await container.accrualDatevExportService.create(from, to, ctx.userId, ctx);
  return ApiResponse.created(res, job, 'Accrual-DATEV-Export erstellt');
});

export const listAccrualDatevJobs = asyncHandler(async (req, res) => {
  const result = await container.accrualDatevExportService.listJobs(req.query);
  return ApiResponse.paginated(res, result.data, result.pagination);
});

export const downloadAccrualDatev = asyncHandler(async (req, res) => {
  const download = await container.accrualDatevExportService.getDownload(req.params.jobId);
  res.setHeader('Content-Type', 'text/csv; charset=cp1252');
  res.setHeader('Content-Disposition', `attachment; filename="${download.fileName}"`);
  return res.send(download.content);
});

export default {
  importJtl,
  importMarketplace,
  getInbox,
  listEvents,
  getEvent,
  listExceptions,
  patchException,
  bulkResolveExceptions,
  getClearingConfig,
  getMarketplaceClearing,
  patchClearingConfig,
  listMarketplaceReconciliation,
  matchMarketplacePayout,
  listJournal,
  getJournal,
  buildJournalDraft,
  postJournal,
  bulkBuildJournal,
  bulkPostJournal,
  listTaxCodes,
  upsertTaxCode,
  getAccrualOverview,
  getPeriodCoverage,
  getAmazonJtlAbgleich,
  previewJournalDatev,
  previewFeeVat,
  patchEvent,
  fxTrueUpEvent,
  fxTrueUpPeriod,
  previewAccrualDatev,
  validateAccrualDatev,
  createAccrualDatev,
  listAccrualDatevJobs,
  downloadAccrualDatev,
};
