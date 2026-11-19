import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { AppNotification, CareRequest, NotificationChannel, NotificationEvent } from '../../shared/types.js';
import { db, findUser, id, now, save } from './db.js';
import { verifyToken } from './auth.js';

let io: Server | undefined;

export function initRealtime(server: HttpServer) {
  io = new Server(server, { cors: { origin: '*' } });
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    const payload = token ? verifyToken(token) : null;
    if (!payload) return next(new Error('unauthorized'));
    socket.data.user = payload;
    next();
  });
  io.on('connection', (socket) => {
    const { sub, role } = socket.data.user as { sub: string; role: string };
    socket.join(`user:${sub}`);
    if (role === 'admin') socket.join('admins');
  });
  return io;
}

/** Envoie la mise à jour d'une demande à toutes les parties concernées. */
export function broadcastRequest(r: CareRequest) {
  if (!io) return;
  io.to(`user:${r.patientId}`).to('admins').emit('request:update', r);
  if (r.nurseId) io.to(`user:${r.nurseId}`).emit('request:update', r);
}

/** Offre une nouvelle demande à des infirmiers ciblés. */
export function offerToNurses(r: CareRequest, nurseIds: string[]) {
  if (!io) return;
  for (const nid of nurseIds) io.to(`user:${nid}`).emit('offer:new', r);
}

/** Retire une offre (acceptée par un autre infirmier, annulée...). */
export function withdrawOffer(requestId: string) {
  io?.emit('offer:withdrawn', { requestId });
}

export function emitTo(userId: string, event: string, payload: unknown) {
  io?.to(userId === 'admin' ? 'admins' : `user:${userId}`).emit(event, payload);
}

/**
 * Crée une notification (persistée) et la pousse en temps réel.
 * Le canal SMS est simulé : il est journalisé côté serveur.
 * userId = 'admin' pour notifier le back-office.
 */
export function notify(
  userId: string,
  event: NotificationEvent,
  title: string,
  body: string,
  channels: NotificationChannel[],
  requestId?: string,
) {
  const n: AppNotification = { id: id(), userId, event, title, body, channels, requestId, read: false, createdAt: now() };
  db.notifications.unshift(n);
  if (db.notifications.length > 2000) db.notifications.length = 2000;
  save();
  emitTo(userId, 'notification', n);
  if (channels.includes('sms')) {
    const phone = userId === 'admin' ? 'back-office' : findUser(userId)?.phone;
    console.log(`[sms] → ${phone ?? userId}: ${title} — ${body}`);
  }
  return n;
}
