import { Router } from 'express';
import * as reconciliationController from '../../controllers/v1/reconciliation.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';

const router = Router();

router.use(authenticate);

router.get('/summary', reconciliationController.getSummary);
router.get('/paypal-balance/:importId', reconciliationController.getPaypalBalance);

export default router;
