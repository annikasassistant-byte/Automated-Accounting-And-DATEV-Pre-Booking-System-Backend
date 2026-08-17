import { container } from '../../di/container.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

function requestContext(req) {
  return {
    userId: req.user?._id || req.user?.id,
    userName: req.user?.firstName || req.user?.email,
    ip: req.ip || req.socket?.remoteAddress,
    userAgent: req.get('user-agent'),
  };
}

export const listAccounts = asyncHandler(async (req, res) => {
  const result = await container.accountService.list(req.query);
  return ApiResponse.paginated(res, result.data, result.pagination);
});

export const createAccount = asyncHandler(async (req, res) => {
  const account = await container.accountService.create(req.body, requestContext(req));
  return ApiResponse.created(res, account);
});

export const updateAccount = asyncHandler(async (req, res) => {
  const account = await container.accountService.update(req.params.id, req.body, requestContext(req));
  return ApiResponse.ok(res, account, 'Konto aktualisiert');
});

export const deleteAccount = asyncHandler(async (req, res) => {
  const result = await container.accountService.softDelete(req.params.id, requestContext(req));
  return ApiResponse.ok(res, result, 'Konto gelöscht');
});

export const seedAccounts = asyncHandler(async (req, res) => {
  const result = await container.accountService.seedAccounts(requestContext(req));
  return ApiResponse.ok(res, result, 'Kontenrahmen importiert');
});

export const importAccountsCsv = asyncHandler(async (req, res) => {
  const content = req.file?.buffer || req.body?.content;
  const result = await container.accountService.importCsv(content, requestContext(req));
  return ApiResponse.ok(res, result, 'Konten-CSV importiert');
});

export const exportAccountsCsv = asyncHandler(async (req, res) => {
  const csv = await container.accountService.exportCsv();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="kontenrahmen.csv"');
  return res.send(csv);
});

export const accountOverview = asyncHandler(async (req, res) => {
  const includeEmpty = String(req.query.includeEmpty || '') === 'true';
  const result = await container.reconciliationService.accountTrialBalance(
    req.query.from,
    req.query.to,
    includeEmpty,
  );
  return ApiResponse.ok(res, result);
});

export const accountLedger = asyncHandler(async (req, res) => {
  const result = await container.reconciliationService.accountLedger(
    req.params.number,
    req.query.from,
    req.query.to,
  );
  return ApiResponse.ok(res, result);
});

export default {
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  seedAccounts,
  importAccountsCsv,
  exportAccountsCsv,
  accountOverview,
  accountLedger,
};
