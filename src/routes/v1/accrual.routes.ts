import { Router } from 'express';
import * as accrualController from '../../controllers/v1/accrual.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize } from '../../middlewares/authorize.middleware.js';
import { ROLES } from '../../enums/roles.js';

const router = Router();

router.use(authenticate);

router.get('/inbox', accrualController.getInbox);

router.get('/period-coverage', accrualController.getPeriodCoverage);

router.get('/events', accrualController.listEvents);
router.get('/events/:id', accrualController.getEvent);
router.patch('/events/:id', authorize(ROLES.ADMIN), accrualController.patchEvent);

router.get('/exceptions', accrualController.listExceptions);
router.patch('/exceptions/:id', accrualController.patchException);
router.post(
  '/exceptions/bulk-resolve',
  authorize(ROLES.ADMIN),
  accrualController.bulkResolveExceptions,
);

router.get('/clearing', accrualController.getClearingConfig);
router.get('/clearing/:marketplace', accrualController.getMarketplaceClearing);
router.patch('/clearing', authorize(ROLES.ADMIN), accrualController.patchClearingConfig);

router.get('/vat/fee-preview', accrualController.previewFeeVat);

router.get('/journal', accrualController.listJournal);
router.get('/journal/datev-preview', accrualController.previewJournalDatev);
router.post('/journal/bulk-build', authorize(ROLES.ADMIN), accrualController.bulkBuildJournal);
router.post('/journal/bulk-post', authorize(ROLES.ADMIN), accrualController.bulkPostJournal);
router.get('/journal/:id', accrualController.getJournal);
router.post('/journal/build/:eventId', authorize(ROLES.ADMIN), accrualController.buildJournalDraft);
router.post('/journal/:id/post', authorize(ROLES.ADMIN), accrualController.postJournal);

router.post('/fx-true-up/period', authorize(ROLES.ADMIN), accrualController.fxTrueUpPeriod);
router.post('/fx-true-up/:eventId', authorize(ROLES.ADMIN), accrualController.fxTrueUpEvent);

router.post('/datev/preview', authorize(ROLES.ADMIN), accrualController.previewAccrualDatev);
router.post('/datev/validate', authorize(ROLES.ADMIN), accrualController.validateAccrualDatev);
router.post('/datev/create', authorize(ROLES.ADMIN), accrualController.createAccrualDatev);
router.get('/datev/jobs', accrualController.listAccrualDatevJobs);
router.get('/datev/:jobId/download', accrualController.downloadAccrualDatev);

router.get('/tax-codes', accrualController.listTaxCodes);
router.post('/tax-codes', authorize(ROLES.ADMIN), accrualController.upsertTaxCode);

export default router;
