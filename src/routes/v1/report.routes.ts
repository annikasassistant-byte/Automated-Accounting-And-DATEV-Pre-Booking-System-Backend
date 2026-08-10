import { Router } from 'express';
import { container } from '../../di/container.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/auth.middleware.js';

const router = Router();

router.use(authenticate);

router.get(
  '/account-totals',
  asyncHandler(async (req, res) => {
    const result = await container.reconciliationService.accountOverview(
      req.query.from as string,
      req.query.to as string,
    );
    return ApiResponse.ok(res, result);
  }),
);

router.get(
  '/status-breakdown',
  asyncHandler(async (req, res) => {
    const result = await container.reconciliationService.summary(
      req.query.from as string,
      req.query.to as string,
    );
    return ApiResponse.ok(res, result);
  }),
);

export default router;
