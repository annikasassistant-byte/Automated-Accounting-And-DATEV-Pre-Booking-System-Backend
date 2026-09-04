import { Router } from 'express';
import * as accrualController from '../../controllers/v1/accrual.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';

const router = Router();

router.use(authenticate);

// Mounted at /api/v1/reconciliation/marketplace → GET /  and POST /match
router.get('/', accrualController.listMarketplaceReconciliation);
router.post('/match', accrualController.matchMarketplacePayout);

export default router;
