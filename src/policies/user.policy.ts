import { ROLES } from '../enums/roles.js';

function actorId(actor: any) {
  return String(actor?.id || actor?._id || actor || '');
}

function targetId(target: any) {
  return String(target?.id || target?._id || target || '');
}

function roleSlug(actor: any): string | null {
  if (!actor) return null;
  if (typeof actor.role === 'string') return actor.role;
  return actor.role?.slug || null;
}

function isAdmin(actor: any) {
  return roleSlug(actor) === ROLES.ADMIN;
}

/**
 * @param {object} actor - authenticated user
 * @param {object|null} target - target user document (null when listing)
 * @param {{ list?: boolean }} [options]
 */
export function canViewUser(actor: any, target: any = null, options: { list?: boolean } = {}) {
  if (!actor) return false;
  if (isAdmin(actor)) return true;
  if (options.list) return false;
  if (target && actorId(actor) === targetId(target)) return true;
  return false;
}

export function canUpdateUser(actor: any, target: any) {
  if (!actor || !target) return false;
  if (isAdmin(actor)) return true;
  return actorId(actor) === targetId(target);
}

export function canDeleteUser(actor: any, target: any) {
  if (!actor || !target) return false;
  if (isAdmin(actor)) return true;
  return false;
}

export const userPolicy = {
  canView: canViewUser,
  canUpdate: canUpdateUser,
  canDelete: canDeleteUser,
};

export default userPolicy;
