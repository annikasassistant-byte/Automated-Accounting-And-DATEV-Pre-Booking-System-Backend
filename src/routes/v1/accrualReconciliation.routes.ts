import { Router } from 'express';
import * as accrualController from '../../controllers/v1/accrual.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { uploadSingleMemory, requireFile } from '../../middlewares/upload.middleware.js';

const router = Router();

router.use(authenticate);

router.get('/marketplace', accrualController.listMarketplaceReconciliation);
router.post('/marketplace/match', accrualController.matchMarketplacePayout);

export default router;
