import { Router } from 'express';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import healthRoutes from './health.routes.js';
import accountRoutes from './account.routes.js';
import importRoutes from './import.routes.js';
import transactionRoutes from './transaction.routes.js';
import ruleRoutes from './rule.routes.js';
import suggestionRoutes from './suggestion.routes.js';
import patternRoutes from './pattern.routes.js';
import datevExportRoutes from './datevExport.routes.js';
import reconciliationRoutes from './reconciliation.routes.js';
import duplicateRoutes from './duplicate.routes.js';
import settingsRoutes from './settings.routes.js';
import reportRoutes from './report.routes.js';
import accrualRoutes from './accrual.routes.js';
import accrualReconciliationRoutes from './accrualReconciliation.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/accounts', accountRoutes);
router.use('/imports', importRoutes);
router.use('/transactions', transactionRoutes);
router.use('/rules', ruleRoutes);
router.use('/rule-suggestions', suggestionRoutes);
router.use('/patterns', patternRoutes);
router.use('/exports', datevExportRoutes);
router.use('/reconciliation', reconciliationRoutes);
router.use('/duplicates', duplicateRoutes);
router.use('/settings', settingsRoutes);
router.use('/reports', reportRoutes);
router.use('/accrual', accrualRoutes);
router.use('/reconciliation/marketplace', accrualReconciliationRoutes);

export default router;
