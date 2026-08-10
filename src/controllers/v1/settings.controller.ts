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

function toClientDatev(settings) {
  const month = settings.fiscalYearStartMonth || 1;
  const year = new Date().getFullYear();
  return {
    consultantNumber: settings.advisorNumber || '',
    clientNumber: settings.clientNumber || '',
    chartOfAccounts: settings.chartOfAccounts === '03' ? 'SKR03' : settings.chartOfAccounts || 'SKR03',
    fiscalYearStart: `${year}-${String(month).padStart(2, '0')}-01`,
    defaultExpenseAccount: settings.defaultBankAccount ? '3220' : '3220',
    defaultOffsetAccount: settings.defaultBankAccount || '1201',
    // also expose server keys for advanced UI
    advisorNumber: settings.advisorNumber || '',
    defaultBankAccount: settings.defaultBankAccount || '1201',
    defaultPaypalAccount: settings.defaultPaypalAccount || '1203',
    clearingAccount: settings.clearingAccount || '1361',
    currency: settings.currency || 'EUR',
    blockExportIfOpen: settings.blockExportIfOpen !== false,
    blockExportIfUnbalanced: settings.blockExportIfUnbalanced !== false,
    allowMatchedWithoutReview: Boolean(settings.allowMatchedWithoutReview),
  };
}

function fromClientDatev(body = {}) {
  const update = {};
  if (body.consultantNumber !== undefined) update.advisorNumber = body.consultantNumber;
  if (body.advisorNumber !== undefined) update.advisorNumber = body.advisorNumber;
  if (body.clientNumber !== undefined) update.clientNumber = body.clientNumber;
  if (body.chartOfAccounts !== undefined) {
    update.chartOfAccounts = String(body.chartOfAccounts).replace(/SKR/i, '') || '03';
  }
  if (body.fiscalYearStart !== undefined) {
    const m = String(body.fiscalYearStart).match(/-(\d{2})-/);
    update.fiscalYearStartMonth = m ? Number(m[1]) : 1;
  }
  if (body.fiscalYearStartMonth !== undefined) update.fiscalYearStartMonth = body.fiscalYearStartMonth;
  if (body.defaultOffsetAccount !== undefined) update.defaultBankAccount = body.defaultOffsetAccount;
  if (body.defaultBankAccount !== undefined) update.defaultBankAccount = body.defaultBankAccount;
  if (body.defaultPaypalAccount !== undefined) update.defaultPaypalAccount = body.defaultPaypalAccount;
  if (body.clearingAccount !== undefined) update.clearingAccount = body.clearingAccount;
  if (body.currency !== undefined) update.currency = body.currency;
  if (body.blockExportIfOpen !== undefined) update.blockExportIfOpen = body.blockExportIfOpen;
  if (body.blockExportIfUnbalanced !== undefined) {
    update.blockExportIfUnbalanced = body.blockExportIfUnbalanced;
  }
  if (body.allowMatchedWithoutReview !== undefined) {
    update.allowMatchedWithoutReview = body.allowMatchedWithoutReview;
  }
  return update;
}

function toClientCompany(settings) {
  return {
    companyName: settings.companyName || '',
    taxId: settings.taxId || '',
    street: settings.street || '',
    city: settings.city || '',
    postalCode: settings.postalCode || '',
    country: settings.country || 'DE',
  };
}

export const getCompanySettings = asyncHandler(async (_req, res) => {
  const settings = await container.settingsService.getCompany();
  return ApiResponse.ok(res, toClientCompany(settings));
});

export const updateCompanySettings = asyncHandler(async (req, res) => {
  const settings = await container.settingsService.updateCompany(req.body, requestContext(req));
  return ApiResponse.ok(res, toClientCompany(settings), 'Einstellungen aktualisiert');
});

export const getDatevSettings = asyncHandler(async (_req, res) => {
  const settings = await container.settingsService.getCompany();
  return ApiResponse.ok(res, toClientDatev(settings));
});

export const updateDatevSettings = asyncHandler(async (req, res) => {
  const mapped = fromClientDatev(req.body);
  const settings = await container.settingsService.updateCompany(mapped, requestContext(req));
  return ApiResponse.ok(res, toClientDatev(settings), 'DATEV-Einstellungen aktualisiert');
});

export const getSystemPolicies = asyncHandler(async (_req, res) => {
  const policies = await container.settingsService.getSystemPolicies();
  return ApiResponse.ok(res, policies);
});

export const updateSystemPolicies = asyncHandler(async (req, res) => {
  const policies = await container.settingsService.updateSystemPolicies(
    req.body,
    requestContext(req),
  );
  return ApiResponse.ok(res, policies, 'Systemrichtlinien aktualisiert');
});

export const resetSystemPolicies = asyncHandler(async (req, res) => {
  const policies = await container.settingsService.resetSystemPolicies(requestContext(req));
  return ApiResponse.ok(res, policies, 'Systemrichtlinien auf Standard zurückgesetzt');
});

export default {
  getCompanySettings,
  updateCompanySettings,
  getDatevSettings,
  updateDatevSettings,
  getSystemPolicies,
  updateSystemPolicies,
  resetSystemPolicies,
};
