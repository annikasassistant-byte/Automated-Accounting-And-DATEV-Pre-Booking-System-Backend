import env from '../config/env.js';
import logger from '../config/logger.js';
import { ROLES, ROLE_LIST } from '../enums/roles.js';

/**
 * Seed a user with a string role (`admin` | `user`).
 * @param {{
 *   userRepository: import('../repositories/user.repository.js').UserRepository,
 * }} deps
 * @param {{ email?: string, password?: string, firstName?: string, lastName?: string, role?: string, roleSlug?: string }} [overrides]
 */
export async function seedAdmin(deps, overrides = {}) {
  const { userRepository } = deps;

  const role = String(overrides.role || overrides.roleSlug || ROLES.ADMIN)
    .trim()
    .toLowerCase();
  if (!ROLE_LIST.includes(role)) {
    throw new Error(`Invalid role "${role}". Expected one of: ${ROLE_LIST.join(', ')}`);
  }

  const email = (
    overrides.email ||
    process.env.ADMIN_EMAIL ||
    'admin@automatedaccounting.local'
  )
    .trim()
    .toLowerCase();
  const password = overrides.password || process.env.ADMIN_PASSWORD || 'ChangeMeAdmin123!';
  const firstName = overrides.firstName || 'System';
  const lastName = overrides.lastName || 'Admin';

  let user = await userRepository.findByEmail(email, { includeDeleted: true });
  if (user && !user.isDeleted) {
    logger.info('Seed user already exists', { email, role });
    return user;
  }

  if (user?.isDeleted) {
    user = await userRepository.model.restoreById(user._id);
    user.password = password;
    user.role = role;
    user.emailVerified = true;
    user.isActive = true;
    await user.save();
    logger.info('Seed user restored', { email, role });
    return user;
  }

  user = await userRepository.create({
    email,
    password,
    firstName,
    lastName,
    role,
    emailVerified: true,
    isActive: true,
  });

  logger.info('Seed user created', {
    email,
    role,
    note:
      env.NODE_ENV === 'production' ? 'password from env' : 'default password — change immediately',
  });

  return user;
}

export default seedAdmin;
