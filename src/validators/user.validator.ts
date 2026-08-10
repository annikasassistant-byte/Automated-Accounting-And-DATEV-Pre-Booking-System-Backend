import { body, param, query } from 'express-validator';
import { ROLE_LIST } from '../enums/roles.js';

export const updateProfileValidator = [
  body('firstName').optional().trim().notEmpty().isLength({ max: 100 }),
  body('lastName').optional().trim().notEmpty().isLength({ max: 100 }),
  body('phone').optional({ nullable: true }).isString().isLength({ max: 32 }),
  body('avatar').optional({ nullable: true }).isString().isLength({ max: 2048 }),
  body('notificationPreferences').optional().isObject(),
  body('notificationPreferences.emailAlerts').optional().isBoolean(),
  body('notificationPreferences.platformAnnouncements').optional().isBoolean(),
];

export const notificationPreferencesValidator = [
  body('emailAlerts').optional().isBoolean(),
  body('platformAnnouncements').optional().isBoolean(),
];

export const listUsersValidator = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('sort').optional().isString().isLength({ max: 64 }),
  query('search').optional().isString().isLength({ max: 200 }),
  query('role').optional().isIn(ROLE_LIST).withMessage(`Role must be one of: ${ROLE_LIST.join(', ')}`),
  query('isActive').optional().isIn(['true', 'false', '1', '0', true, false]),
  query('emailVerified').optional().isIn(['true', 'false', '1', '0', true, false]),
];

export const updateUserValidator = [
  param('id').isMongoId().withMessage('Invalid user id'),
  body('firstName').optional().trim().notEmpty().isLength({ max: 100 }),
  body('lastName').optional().trim().notEmpty().isLength({ max: 100 }),
  body('phone').optional({ nullable: true }).isString().isLength({ max: 32 }),
  body('avatar').optional({ nullable: true }).isString().isLength({ max: 2048 }),
  body('isActive').optional().isBoolean().toBoolean(),
  body('emailVerified').optional().isBoolean().toBoolean(),
  body('phoneVerified').optional().isBoolean().toBoolean(),
  body('role')
    .optional()
    .isIn(ROLE_LIST)
    .withMessage(`Role must be one of: ${ROLE_LIST.join(', ')}`),
  body('roleSlug')
    .optional()
    .isIn(ROLE_LIST)
    .withMessage(`Role must be one of: ${ROLE_LIST.join(', ')}`),
];

const createPasswordRule = body('password')
  .isString()
  .isLength({ min: 8, max: 128 })
  .withMessage('Password must be 8-128 characters')
  .matches(/[A-Za-z]/)
  .withMessage('Password must contain a letter')
  .matches(/[0-9]/)
  .withMessage('Password must contain a number');

export const createUserValidator = [
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  createPasswordRule,
  body('firstName')
    .trim()
    .notEmpty()
    .withMessage('First name is required')
    .isLength({ max: 100 }),
  body('lastName')
    .trim()
    .notEmpty()
    .withMessage('Last name is required')
    .isLength({ max: 100 }),
  body('phone').optional({ nullable: true }).isString().isLength({ max: 32 }),
  body('role')
    .optional()
    .isIn(ROLE_LIST)
    .withMessage(`Role must be one of: ${ROLE_LIST.join(', ')}`),
  body('roleSlug')
    .optional()
    .isIn(ROLE_LIST)
    .withMessage(`Role must be one of: ${ROLE_LIST.join(', ')}`),
  body('isActive').optional().isBoolean().toBoolean(),
  body('emailVerified').optional().isBoolean().toBoolean(),
];

export const userIdParamValidator = [param('id').isMongoId().withMessage('Invalid user id')];

export const exportUsersValidator = [
  query('format').optional().isIn(['csv', 'excel', 'xlsx', 'pdf']),
  query('search').optional().isString().isLength({ max: 200 }),
  query('limit').optional().isInt({ min: 1, max: 10000 }).toInt(),
];

export default {
  updateProfileValidator,
  notificationPreferencesValidator,
  listUsersValidator,
  updateUserValidator,
  createUserValidator,
  userIdParamValidator,
  exportUsersValidator,
};
