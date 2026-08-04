import { SOCKET_EVENTS } from './events.js';

/** @type {import('socket.io').Server|null} */
let ioInstance = null;

export function setSocketIo(io) {
  ioInstance = io;
}

export function getSocketIo() {
  return ioInstance;
}

export function emitToUser(userId, event, payload) {
  if (!ioInstance || !userId) return;
  ioInstance.to(`user:${userId}`).emit(event, payload);
}

export function emitToAdmins(event, payload) {
  if (!ioInstance) return;
  ioInstance.to('role:admin').emit(event, payload);
}

export function emitUserUpdated(userId, payload) {
  emitToUser(userId, SOCKET_EVENTS.USER_UPDATED, payload);
}

export function emitForceLogout(userId, payload = {}) {
  emitToUser(userId, SOCKET_EVENTS.FORCE_LOGOUT, payload);
}

export function emitNotification(userId, payload) {
  emitToUser(userId, SOCKET_EVENTS.NOTIFICATION, payload);
}

export default {
  setSocketIo,
  getSocketIo,
  emitToUser,
  emitToAdmins,
  emitUserUpdated,
  emitForceLogout,
  emitNotification,
};
