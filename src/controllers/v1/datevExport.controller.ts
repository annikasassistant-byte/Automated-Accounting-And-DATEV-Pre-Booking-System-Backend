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

export const previewExport = asyncHandler(async (req, res) => {
  const { periodType, from, to } = req.body;
  const result = await container.datevExportService.preview(periodType || 'custom', from, to);
  return ApiResponse.ok(res, result);
});

export const validateExport = asyncHandler(async (req, res) => {
  const { periodType, from, to } = req.body;
  const result = await container.datevExportService.validate(periodType || 'custom', from, to);
  return ApiResponse.ok(res, result);
});

export const createExport = asyncHandler(async (req, res) => {
  const ctx = requestContext(req);
  const { periodType, from, to } = req.body;
  const batch = await container.datevExportService.createExport(
    periodType || 'custom', from, to, ctx.userId, ctx,
  );
  return ApiResponse.created(res, batch);
});

export const listExports = asyncHandler(async (req, res) => {
  const result = await container.datevExportService.listExports(req.query);
  return ApiResponse.paginated(res, result.data, result.pagination);
});

export const downloadExport = asyncHandler(async (req, res) => {
  const download = await container.datevExportService.getDownload(req.params.id);
  res.setHeader('Content-Type', 'text/csv; charset=cp1252');
  res.setHeader('Content-Disposition', `attachment; filename="${download.fileName}"`);
  return res.send(download.content);
});

export default {
  previewExport,
  validateExport,
  createExport,
  listExports,
  downloadExport,
};
