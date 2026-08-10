import { Router } from 'express';
import * as suggestionController from '../../controllers/v1/suggestion.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize } from '../../middlewares/authorize.middleware.js';
import { ROLES } from '../../enums/roles.js';

const router = Router();

router.use(authenticate);

router.get('/', suggestionController.listSuggestions);
router.post('/:id/accept', authorize(ROLES.ADMIN), suggestionController.acceptSuggestion);
router.post('/:id/reject', authorize(ROLES.ADMIN), suggestionController.rejectSuggestion);

export default router;
