import { Router } from 'express';
import * as transactionController from '../../controllers/v1/transaction.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize } from '../../middlewares/authorize.middleware.js';
import { ROLES } from '../../enums/roles.js';

const router = Router();

router.use(authenticate);

router.get('/', transactionController.listTransactions);
router.get('/open', transactionController.listOpen);
router.get('/conflicts', transactionController.listConflicts);
router.get('/:id', transactionController.getTransaction);
router.post('/apply-rules', transactionController.applyRules);
router.post('/:id/assign', transactionController.assignTransaction);
router.post('/bulk-assign', transactionController.bulkAssign);
router.post('/:id/status', transactionController.setTransactionStatus);
router.post('/bulk-status', transactionController.bulkStatus);
router.post(
  '/:id/create-rule',
  authorize(ROLES.ADMIN),
  transactionController.createRuleFromTransaction,
);

export default router;