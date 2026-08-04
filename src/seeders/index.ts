import { container } from '../di/container.js';
import logger from '../config/logger.js';
import { ROLES } from '../enums/roles.js';
import { seedAdmin } from './admin.seeder.js';

/**
 * Run auth-only seeders: platform admin + demo user.
 * @param {{ container?: import('../di/container.js').Container, admin?: object, user?: object }} [options]
 */
export async function runSeeders(options = {}) {
  const c = options.container || container;

  logger.info('Starting database seeders');

  const admin = await seedAdmin(
    { userRepository: c.userRepository },
    {
      email: 'admin@automatedaccounting.local',
      password: 'ChangeMeAdmin123!',
      firstName: 'System',
      lastName: 'Admin',
      role: ROLES.ADMIN,
      ...options.admin,
    },
  );

  const demoUser = await seedAdmin(
    { userRepository: c.userRepository },
    {
      email: 'user@automatedaccounting.local',
      password: 'ChangeMeUser123!',
      firstName: 'Demo',
      lastName: 'User',
      role: ROLES.USER,
      ...options.user,
    },
  );

  logger.info('Seeders completed', {
    admin: admin.email,
    user: demoUser.email,
  });

  return { admin, user: demoUser };
}

export { seedAdmin };
export default runSeeders;
