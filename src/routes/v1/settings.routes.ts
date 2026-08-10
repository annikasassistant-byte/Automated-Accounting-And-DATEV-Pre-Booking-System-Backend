import { Router } from 'express';
import * as settingsController from '../../controllers/v1/settings.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize } from '../../middlewares/authorize.middleware.js';
import { ROLES } from '../../enums/roles.js';

const router = Router();

router.use(authenticate);

router.get('/company', settingsController.getCompanySettings);
router.patch('/company', authorize(ROLES.ADMIN), settingsController.updateCompanySettings);
router.get('/datev', settingsController.getDatevSettings);
router.patch('/datev', authorize(ROLES.ADMIN), settingsController.updateDatevSettings);
router.get('/system-policies', settingsController.getSystemPolicies);
router.patch('/system-policies', authorize(ROLES.ADMIN), settingsController.updateSystemPolicies);
router.post(
  '/system-policies/reset',
  authorize(ROLES.ADMIN),
  settingsController.resetSystemPolicies,
);

export default router;
