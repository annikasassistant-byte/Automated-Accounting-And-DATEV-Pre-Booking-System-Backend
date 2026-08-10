import { container } from '../../di/container.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

export const getSummary = asyncHandler(async (req, res) => {
  const result = await container.reconciliationService.summary(req.query.from, req.query.to);
  return ApiResponse.ok(res, result);
});

export const getPaypalBalance = asyncHandler(async (req, res) => {
  const result = await container.reconciliationService.paypalBalance(req.params.importId);
  return ApiResponse.ok(res, result);
});

export default {
  getSummary,
  getPaypalBalance,
};
