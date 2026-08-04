import env from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { ROLES } from '../enums/roles.js';
import { seedAdmin } from '../seeders/admin.seeder.js';
import type { UserRepository } from '../repositories/user.repository.js';

export interface CreatePlatformAdminInput {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  force?: boolean;
  roleSlug?: string;
}

export interface CreatePlatformAdminDeps {
  userRepository: UserRepository;
}

export interface CreatePlatformAdminResult {
  user: Record<string, unknown>;
  created: boolean;
  forceUpdated: boolean;
}

const DEFAULT_PASSWORD = 'ChangeMeAdmin123!';

function sanitizeUser(
  user: Record<string, unknown> | { toObject?: () => Record<string, unknown> },
) {
  const obj =
    user && typeof (user as { toObject?: () => Record<string, unknown> }).toObject === 'function'
      ? (user as { toObject: () => Record<string, unknown> }).toObject({ virtuals: true })
      : { ...(user as Record<string, unknown>) };
  delete obj.password;
  delete obj.twoFactorSecret;
  delete obj.emailVerificationToken;
  delete obj.passwordResetToken;
  return obj;
}

/**
 * Create or restore a platform admin user with string role `admin`.
 */
export async function createPlatformAdmin(
  deps: CreatePlatformAdminDeps,
  input: CreatePlatformAdminInput,
): Promise<CreatePlatformAdminResult> {
  const email = String(input.email || '')
    .trim()
    .toLowerCase();
  const password = String(input.password || '');
  const firstName = String(input.firstName || 'System').trim();
  const lastName = String(input.lastName || 'Admin').trim();
  const force = Boolean(input.force);
  const roleSlug = input.roleSlug || ROLES.ADMIN;

  if (!email || !password) {
    throw ApiError.badRequest('email and password are required');
  }
  if (password.length < 8) {
    throw ApiError.badRequest('Password must be at least 8 characters');
  }
  if (env.NODE_ENV === 'production' && password === DEFAULT_PASSWORD) {
    throw ApiError.badRequest('Refusing to create admin with default password in production');
  }
  if (roleSlug !== ROLES.ADMIN && roleSlug !== ROLES.USER) {
    throw ApiError.badRequest(`Role must be '${ROLES.ADMIN}' or '${ROLES.USER}'`);
  }

  const existingBefore = await deps.userRepository.findByEmail(email, { includeDeleted: true });
  const created = !existingBefore || existingBefore.isDeleted;

  let admin = await seedAdmin(
    { userRepository: deps.userRepository },
    { email, password, firstName, lastName, role: roleSlug },
  );

  let forceUpdated = false;
  if (force) {
    const user = await deps.userRepository.findByEmailForAuth(email);
    if (user) {
      user.password = password;
      user.firstName = firstName;
      user.lastName = lastName;
      user.role = roleSlug;
      user.emailVerified = true;
      user.isActive = true;
      await user.save();
      admin = user;
      forceUpdated = true;
    }
  }

  const populated = await deps.userRepository.findByIdWithRole(admin._id);

  return {
    user: sanitizeUser((populated || admin) as Record<string, unknown>),
    created,
    forceUpdated,
  };
}
