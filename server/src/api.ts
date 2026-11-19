import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import type { CareRequest, Incident, PaymentMethod, RequestStatus, Service } from '../../shared/types.js';
import { ACTIVE_STATUSES, PAYMENT_LABELS, formatFCFA } from '../../shared/types.js';
import {
  db,
  distanceKm,
  etaFromKm,
  findNurse,
  findUser,
  id,
  now,
  nurses,
  publicUser,
  reset,
  save,
  type StoredNurse,
} from './db.js';
import { checkOtp, issueOtp, normalizePhone, requireAuth, signToken } from './auth.js';
import { broadcastRequest, notify, offerToNurses, withdrawOffer } from './realtime.js';

export const api = Router();

// Petites aides ------------------------------------------------------------
const bad = (res: Response, msg: string, code = 400) => res.status(code).json({ error: msg });
const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN);
const findRequest = (rid: unknown) => db.requests.find((r) => r.id === rid);
const BUSY: RequestStatus[] = ['assigned', 'en_route', 'in_progress'];
const isBusy = (nurseId: string) => db.requests.some((r) => r.nurseId === nurseId && BUSY.includes(r.status));

function eligibleNurses(r: CareRequest): StoredNurse[] {
  return nurses().filter(
    (n) =>
      n.verification === 'verified' &&
      n.available &&
      !isBusy(n.id) &&
      !r.declinedBy.includes(n.id) &&
      n.lat != null &&
      n.lng != null &&
      distanceKm(n.lat, n.lng, r.lat, r.lng) <= db.settings.searchRadiusKm,
  );
}

/** Vue d'une demande adaptée à un infirmier qui ne l'a pas encore acceptée. */
function offerView(r: CareRequest, nurse?: StoredNurse) {
  const km = nurse?.lat != null && nurse.lng != null ? distanceKm(nurse.lat, nurse.lng, r.lat, r.lng) : undefined;
  return {
    ...r,
    patientPhone: undefined,
    messages: [],
    distanceKm: km != null ? Math.round(km * 10) / 10 : undefined,
    etaMin: km != null ? etaFromKm(km) : undefined,
    nurseShare: Math.round(r.total * (1 - db.settings.commissionRate)),
  };
}

function canSee(req: Request, r: CareRequest) {
  const a = req.auth!;
  if (a.role === 'admin') return true;
  if (a.role === 'patient') return r.patientId === a.sub;
  return r.nurseId === a.sub || (r.status === 'searching' && !r.declinedBy.includes(a.sub));
}

function assignNurse(r: CareRequest, nurse: StoredNurse, byAdmin = false) {
  r.status = 'assigned';
  r.nurseId = nurse.id;
  r.nurseName = nurse.name;
  r.nursePhone = nurse.phone;
  r.nurseRating = nurse.rating;
  r.nurseLat = nurse.lat;
  r.nurseLng = nurse.lng;
  r.etaMin = nurse.lat != null && nurse.lng != null ? etaFromKm(distanceKm(nurse.lat, nurse.lng, r.lat, r.lng)) : 20;
  r.assignedAt = now();
  r.assignedByAdmin = byAdmin;
  save();
  withdrawOffer(r.id);
  broadcastRequest(r);
  notify(r.patientId, 'request_accepted', 'Infirmier trouvé', `${nurse.name} a accepté votre demande — arrivée estimée dans ${r.etaMin} min.`, ['push', 'sms'], r.id);
  notify('admin', 'request_accepted', `${r.code} assignée`, `${nurse.name} prend en charge ${r.serviceName} pour ${r.patientName}${byAdmin ? ' (assignation manuelle)' : ''}.`, ['realtime'], r.id);
  if (byAdmin) notify(nurse.id, 'request_accepted', 'Nouvelle intervention assignée', `La coordination vous a assigné ${r.serviceName} — ${r.address}.`, ['push', 'sms'], r.id);
}

// --- Démo ------------------------------------------------------------------
api.get('/health', (_req, res) => res.json({ ok: true, name: 'Kulawa API', time: now() }));

api.post('/demo/reset', (_req, res) => {
  if (process.env.NODE_ENV === 'production' && process.env.KULAWA_ALLOW_RESET !== '1') return bad(res, 'Désactivé', 403);
  reset();
  res.json({ ok: true });
});

// --- Authentification --------------------------------------------------------
api.post('/auth/patient/otp', (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (phone.replace(/\D/g, '').length < 8) return bad(res, 'Numéro de téléphone invalide.');
  const code = issueOtp(phone);
  const exists = db.users.some((u) => u.role === 'patient' && u.phone === phone);
  res.json({ ok: true, phone, isNew: !exists, devCode: process.env.NODE_ENV === 'production' ? undefined : code });
});

api.post('/auth/patient/verify', (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const result = checkOtp(phone, str(req.body?.code, 10));
  if (result === 'expired') return bad(res, 'Code expiré, demandez un nouveau code.');
  if (result === 'invalid') return bad(res, 'Code incorrect.');
  let user = db.users.find((u) => u.role === 'patient' && u.phone === phone);
  if (!user) {
    user = { id: id(), role: 'patient', name: str(req.body?.name, 80) || 'Patient', phone, createdAt: now() };
    db.users.push(user);
    save();
  }
  res.json({ token: signToken(user.id, 'patient'), user: publicUser(user) });
});

api.post('/auth/nurse/login', (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const nurse = nurses().find((n) => n.phone === phone);
  if (!nurse || !nurse.passwordHash || !bcrypt.compareSync(String(req.body?.password ?? ''), nurse.passwordHash))
    return bad(res, 'Identifiants incorrects.', 401);
  res.json({ token: signToken(nurse.id, 'nurse'), user: publicUser(nurse) });
});

api.post('/auth/nurse/register', (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const name = str(req.body?.name, 80);
  const password = String(req.body?.password ?? '');
  if (!name || phone.length < 8) return bad(res, 'Nom et téléphone requis.');
  if (password.length < 6) return bad(res, 'Le mot de passe doit contenir au moins 6 caractères.');
  if (nurses().some((n) => n.phone === phone)) return bad(res, 'Un compte existe déjà avec ce numéro.');
  const nurse: StoredNurse = {
    id: id(),
    role: 'nurse',
    name,
    phone,
    passwordHash: bcrypt.hashSync(password, 8),
    createdAt: now(),
    verification: 'pending',
    diplomaNumber: str(req.body?.diplomaNumber, 40),
    ordreNumber: str(req.body?.ordreNumber, 40),
    available: false,
    rating: 0,
    ratingCount: 0,
    documents: { contract: 'submitted', insurance: 'missing', diploma: 'submitted' },
  };
  db.users.push(nurse);
  save();
  notify('admin', 'nurse_validated', 'Nouvelle candidature infirmier', `${name} (${phone}) attend la vérification de son diplôme.`, ['realtime']);
  res.json({ token: signToken(nurse.id, 'nurse'), user: publicUser(nurse) });
});

api.post('/auth/admin/login', (req, res) => {
  const email = str(req.body?.email, 120).toLowerCase();
  const admin = db.users.find((u) => u.role === 'admin' && u.email === email);
  if (!admin || !('passwordHash' in admin) || !admin.passwordHash || !bcrypt.compareSync(String(req.body?.password ?? ''), admin.passwordHash))
    return bad(res, 'Identifiants incorrects.', 401);
  res.json({ token: signToken(admin.id, 'admin'), user: publicUser(admin) });
});

api.get('/me', requireAuth(), (req, res) => {
  const u = findUser(req.auth!.sub);
  if (!u) return bad(res, 'Compte introuvable.', 401);
  res.json(publicUser(u));
});

api.patch('/me', requireAuth(), (req, res) => {
  const u = findUser(req.auth!.sub);
  if (!u) return bad(res, 'Compte introuvable.', 401);
  if (req.body?.name) u.name = str(req.body.name, 80);
  if (req.body?.address != null) u.address = str(req.body.address, 200);
  save();
  res.json(publicUser(u));
});

// --- Services --------------------------------------------------------------
api.get('/services', (_req, res) =>
  res.json({ services: db.services.filter((s) => s.active), travelFee: db.settings.travelFee }),
);

// --- Demandes de soin --------------------------------------------------------
api.post('/requests', requireAuth('patient'), (req, res) => {
  const patient = findUser(req.auth!.sub)!;
  const service = db.services.find((s) => s.id === req.body?.serviceId && s.active);
  if (!service) return bad(res, 'Service introuvable.');
  const lat = num(req.body?.lat);
  const lng = num(req.body?.lng);
  const address = str(req.body?.address, 200);
  if (!address) return bad(res, 'Adresse requise.');
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return bad(res, 'Position invalide.');
  if (db.requests.some((r) => r.patientId === patient.id && ACTIVE_STATUSES.includes(r.status) && r.status !== 'paid'))
    return bad(res, 'Vous avez déjà une demande en cours.');

  db.counters.request++;
  const r: CareRequest = {
    id: id(),
    code: `KL-${String(db.counters.request).padStart(4, '0')}`,
    patientId: patient.id,
    patientName: patient.name,
    patientPhone: patient.phone,
    serviceId: service.id,
    serviceName: service.name,
    address,
    lat,
    lng,
    notes: str(req.body?.notes, 500) || undefined,
    price: service.price,
    travelFee: db.settings.travelFee,
    total: service.price + db.settings.travelFee,
    status: 'searching',
    declinedBy: [],
    messages: [],
    createdAt: now(),
  };
  db.requests.unshift(r);
  if (address && !patient.address) patient.address = address;
  save();

  // ① Notification temps réel des infirmiers à proximité + file du back-office
  const targets = eligibleNurses(r);
  for (const n of targets) {
    notify(n.id, 'request_created', `Nouvelle demande : ${r.serviceName}`, `${r.address} — ${formatFCFA(Math.round(r.total * (1 - db.settings.commissionRate)))} pour vous.`, ['push'], r.id);
  }
  offerToNurses(r, targets.map((n) => n.id));
  notify('admin', 'request_created', `Nouvelle demande ${r.code}`, `${r.patientName} — ${r.serviceName}, ${r.address}. ${targets.length} infirmier(s) notifié(s).`, ['realtime'], r.id);
  broadcastRequest(r);
  res.status(201).json(r);
});

api.get('/requests/mine', requireAuth('patient', 'nurse'), (req, res) => {
  const a = req.auth!;
  const list = db.requests.filter((r) => (a.role === 'patient' ? r.patientId === a.sub : r.nurseId === a.sub));
  res.json(list);
});

api.get('/requests/:id', requireAuth(), (req, res) => {
  const r = findRequest(req.params.id);
  if (!r || !canSee(req, r)) return bad(res, 'Demande introuvable.', 404);
  if (req.auth!.role === 'nurse' && r.nurseId !== req.auth!.sub) return res.json(offerView(r, findNurse(req.auth!.sub)));
  res.json(r);
});

api.post('/requests/:id/cancel', requireAuth('patient', 'admin'), (req, res) => {
  const r = findRequest(req.params.id);
  if (!r || !canSee(req, r)) return bad(res, 'Demande introuvable.', 404);
  if (!['searching', 'assigned', 'en_route'].includes(r.status)) return bad(res, 'Cette demande ne peut plus être annulée.');
  r.status = 'cancelled';
  r.cancelledAt = now();
  save();
  withdrawOffer(r.id);
  broadcastRequest(r);
  if (r.nurseId) notify(r.nurseId, 'message', 'Demande annulée', `${r.code} — ${r.serviceName} a été annulée.`, ['push'], r.id);
  notify('admin', 'message', `${r.code} annulée`, `Annulée par ${req.auth!.role === 'admin' ? 'la coordination' : 'le patient'}.`, ['realtime'], r.id);
  res.json(r);
});

api.post('/requests/:id/accept', requireAuth('nurse'), (req, res) => {
  const r = findRequest(req.params.id);
  const nurse = findNurse(req.auth!.sub)!;
  if (!r) return bad(res, 'Demande introuvable.', 404);
  if (nurse.verification !== 'verified') return bad(res, 'Votre compte doit être vérifié par Kulawa.', 403);
  if (r.status !== 'searching') return bad(res, 'Cette demande a déjà été prise en charge.', 409);
  if (isBusy(nurse.id)) return bad(res, 'Terminez votre intervention en cours avant d’en accepter une autre.', 409);
  assignNurse(r, nurse);
  res.json(r);
});

api.post('/requests/:id/decline', requireAuth('nurse'), (req, res) => {
  const r = findRequest(req.params.id);
  if (!r) return bad(res, 'Demande introuvable.', 404);
  if (!r.declinedBy.includes(req.auth!.sub)) r.declinedBy.push(req.auth!.sub);
  save();
  res.json({ ok: true });
});

function nurseRequest(req: Request, res: Response) {
  const r = findRequest(req.params.id as string);
  if (!r || r.nurseId !== req.auth!.sub) {
    bad(res, 'Intervention introuvable.', 404);
    return undefined;
  }
  return r;
}

api.post('/requests/:id/status', requireAuth('nurse'), (req, res) => {
  const r = nurseRequest(req, res);
  if (!r) return;
  const next = req.body?.status as RequestStatus;
  const allowed: Partial<Record<RequestStatus, RequestStatus[]>> = { assigned: ['en_route', 'in_progress'], en_route: ['in_progress'] };
  if (!allowed[r.status]?.includes(next)) return bad(res, 'Transition de statut invalide.');
  r.status = next;
  if (next === 'in_progress') {
    r.startedAt = now();
    r.etaMin = 0;
    notify(r.patientId, 'nurse_en_route', 'Votre infirmier est arrivé', `${r.nurseName} commence l’intervention.`, ['realtime'], r.id);
  } else {
    notify(r.patientId, 'nurse_en_route', 'Infirmier en route', `${r.nurseName} est en route — arrivée estimée dans ${r.etaMin ?? '?'} min.`, ['realtime'], r.id);
  }
  save();
  broadcastRequest(r);
  res.json(r);
});

api.post('/requests/:id/location', requireAuth('nurse'), (req, res) => {
  const r = nurseRequest(req, res);
  if (!r) return;
  const lat = num(req.body?.lat);
  const lng = num(req.body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return bad(res, 'Position invalide.');
  r.nurseLat = lat;
  r.nurseLng = lng;
  r.etaMin = etaFromKm(distanceKm(lat, lng, r.lat, r.lng)) - 3;
  if (r.etaMin < 1) r.etaMin = 1;
  const nurse = findNurse(r.nurseId);
  if (nurse) Object.assign(nurse, { lat, lng });
  save();
  broadcastRequest(r);
  res.json(r);
});

api.post('/requests/:id/report', requireAuth('nurse'), (req, res) => {
  const r = nurseRequest(req, res);
  if (!r) return;
  if (r.status !== 'in_progress') return bad(res, 'L’intervention n’est pas en cours.');
  const acts = str(req.body?.acts, 1000);
  if (!acts) return bad(res, 'Décrivez les actes réalisés.');
  r.report = {
    acts,
    bloodPressure: str(req.body?.bloodPressure, 20) || undefined,
    temperature: str(req.body?.temperature, 20) || undefined,
    glycemia: str(req.body?.glycemia, 20) || undefined,
    observations: str(req.body?.observations, 1000) || undefined,
    recommendations: str(req.body?.recommendations, 1000) || undefined,
    submittedAt: now(),
  };
  r.status = 'awaiting_payment';
  r.completedAt = now();
  save();
  broadcastRequest(r);
  notify(r.patientId, 'intervention_completed', 'Intervention terminée', `Montant à régler : ${formatFCFA(r.total)}. Consultez le compte-rendu.`, ['push'], r.id);
  res.json(r);
});

api.post('/requests/:id/pay', requireAuth('patient'), (req, res) => {
  const r = findRequest(req.params.id);
  if (!r || r.patientId !== req.auth!.sub) return bad(res, 'Demande introuvable.', 404);
  if (r.status !== 'awaiting_payment') return bad(res, 'Aucun paiement attendu pour cette demande.');
  const method = req.body?.method as PaymentMethod;
  if (!PAYMENT_LABELS[method]) return bad(res, 'Moyen de paiement invalide.');
  const phone = method === 'cash' ? undefined : normalizePhone(req.body?.phone);
  if (method !== 'cash' && (!phone || phone.replace(/\D/g, '').length < 8)) return bad(res, 'Numéro mobile money invalide.');
  // Intégration opérateur simulée — à remplacer par l'API de l'agrégateur.
  const commission = Math.round(r.total * db.settings.commissionRate);
  r.payment = {
    method,
    phone,
    amount: r.total,
    commission,
    nurseShare: r.total - commission,
    reference: `${method.toUpperCase().slice(0, 3)}-${Date.now().toString(36).toUpperCase()}`,
    paidAt: now(),
  };
  r.status = 'paid';
  save();
  broadcastRequest(r);
  // ③ Paiement confirmé → infirmier + back-office (transaction & commission)
  notify(r.nurseId!, 'payment_confirmed', 'Paiement reçu', `${r.patientName} a réglé ${formatFCFA(r.total)} — votre part : ${formatFCFA(r.payment.nurseShare)}.`, ['push'], r.id);
  notify('admin', 'payment_confirmed', `Transaction ${r.payment.reference}`, `${r.code} : ${formatFCFA(r.total)} via ${PAYMENT_LABELS[method]} — commission ${formatFCFA(commission)}.`, ['realtime'], r.id);
  notify(r.patientId, 'payment_confirmed', 'Reçu de paiement', `Paiement de ${formatFCFA(r.total)} confirmé (réf. ${r.payment.reference}).`, ['push'], r.id);
  res.json(r);
});

api.post('/requests/:id/rate', requireAuth('patient'), (req, res) => {
  const r = findRequest(req.params.id);
  if (!r || r.patientId !== req.auth!.sub) return bad(res, 'Demande introuvable.', 404);
  if (r.status !== 'paid') return bad(res, 'Évaluation impossible pour cette demande.');
  const stars = Math.round(num(req.body?.stars));
  if (!(stars >= 1 && stars <= 5)) return bad(res, 'Note entre 1 et 5 étoiles.');
  r.rating = { stars, comment: str(req.body?.comment, 500) || undefined, at: now() };
  r.status = 'rated';
  const nurse = findNurse(r.nurseId);
  if (nurse) {
    nurse.rating = Math.round(((nurse.rating * nurse.ratingCount + stars) / (nurse.ratingCount + 1)) * 100) / 100;
    nurse.ratingCount++;
  }
  save();
  broadcastRequest(r);
  // ④ Évaluation → note & gains côté infirmier + back-office
  notify(r.nurseId!, 'rating_sent', `Nouvelle évaluation : ${'★'.repeat(stars)}`, r.rating.comment ?? `${r.patientName} vous a attribué ${stars}/5.`, ['realtime'], r.id);
  notify('admin', 'rating_sent', `${r.code} évaluée ${stars}/5`, `${r.nurseName} — ${r.rating.comment ?? 'sans commentaire'}`, ['realtime'], r.id);
  res.json(r);
});

api.post('/requests/:id/messages', requireAuth('patient', 'nurse'), (req, res) => {
  const r = findRequest(req.params.id);
  if (!r || (r.patientId !== req.auth!.sub && r.nurseId !== req.auth!.sub)) return bad(res, 'Demande introuvable.', 404);
  const text = str(req.body?.text, 500);
  if (!text) return bad(res, 'Message vide.');
  const from = req.auth!.role;
  r.messages.push({ id: id(), from, text, at: now() });
  save();
  broadcastRequest(r);
  const to = from === 'patient' ? r.nurseId : r.patientId;
  if (to) notify(to, 'message', from === 'patient' ? r.patientName : (r.nurseName ?? 'Infirmier'), text, ['push'], r.id);
  res.json(r);
});

// --- Incidents ----------------------------------------------------------------
api.post('/incidents', requireAuth('patient', 'nurse'), (req, res) => {
  const user = findUser(req.auth!.sub)!;
  const r = req.body?.requestId ? findRequest(req.body.requestId) : undefined;
  if (r && r.patientId !== user.id && r.nurseId !== user.id) return bad(res, 'Demande introuvable.', 404);
  const categories: Incident['category'][] = ['retard', 'comportement', 'paiement', 'medical', 'autre'];
  const category = categories.includes(req.body?.category) ? req.body.category : 'autre';
  const description = str(req.body?.description, 1000);
  if (!description) return bad(res, 'Décrivez l’incident.');
  const inc: Incident = {
    id: id(),
    requestId: r?.id,
    requestCode: r?.code,
    reporterId: user.id,
    reporterRole: user.role,
    reporterName: user.name,
    category,
    description,
    status: 'open',
    createdAt: now(),
  };
  db.incidents.unshift(inc);
  save();
  notify('admin', 'incident_reported', `⚠ Incident signalé${r ? ` — ${r.code}` : ''}`, `${user.name} (${user.role === 'patient' ? 'patient' : 'infirmier'}) : ${description}`, ['alert'], r?.id);
  res.status(201).json(inc);
});

api.get('/incidents/mine', requireAuth('patient', 'nurse'), (req, res) =>
  res.json(db.incidents.filter((i) => i.reporterId === req.auth!.sub)),
);

// --- Notifications ------------------------------------------------------------
api.get('/notifications', requireAuth(), (req, res) => {
  const uid = req.auth!.role === 'admin' ? 'admin' : req.auth!.sub;
  res.json(db.notifications.filter((n) => n.userId === uid).slice(0, 100));
});

api.post('/notifications/read', requireAuth(), (req, res) => {
  const uid = req.auth!.role === 'admin' ? 'admin' : req.auth!.sub;
  for (const n of db.notifications) if (n.userId === uid) n.read = true;
  save();
  res.json({ ok: true });
});

// --- Espace infirmier -----------------------------------------------------------
api.post('/nurse/availability', requireAuth('nurse'), (req, res) => {
  const nurse = findNurse(req.auth!.sub)!;
  const available = Boolean(req.body?.available);
  if (available && nurse.verification !== 'verified') return bad(res, 'Votre compte est en cours de vérification par Kulawa.', 403);
  nurse.available = available;
  const lat = num(req.body?.lat);
  const lng = num(req.body?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) Object.assign(nurse, { lat, lng });
  save();
  notify('admin', 'message', `${nurse.name} ${available ? 'disponible' : 'hors ligne'}`, available ? 'Prêt(e) à recevoir des demandes.' : 'Ne reçoit plus de demandes.', ['realtime']);
  res.json(publicUser(nurse));
});

api.get('/nurse/offers', requireAuth('nurse'), (req, res) => {
  const nurse = findNurse(req.auth!.sub)!;
  if (!nurse.available || nurse.verification !== 'verified') return res.json([]);
  const list = db.requests.filter((r) => r.status === 'searching' && eligibleNurses(r).some((n) => n.id === nurse.id));
  res.json(list.map((r) => offerView(r, nurse)));
});

api.get('/nurse/earnings', requireAuth('nurse'), (req, res) => {
  const nurse = findNurse(req.auth!.sub)!;
  const mine = db.requests.filter((r) => r.nurseId === nurse.id && r.payment);
  const since = (days: number) => Date.now() - days * 86400_000;
  const sum = (list: CareRequest[]) => list.reduce((s, r) => s + (r.payment?.nurseShare ?? 0), 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  res.json({
    today: sum(mine.filter((r) => new Date(r.payment!.paidAt) >= today)),
    week: sum(mine.filter((r) => new Date(r.payment!.paidAt).getTime() >= since(7))),
    month: sum(mine.filter((r) => new Date(r.payment!.paidAt).getTime() >= since(30))),
    total: sum(mine),
    count: mine.length,
    rating: nurse.rating,
    ratingCount: nurse.ratingCount,
    recent: mine.slice(0, 20).map((r) => ({
      id: r.id,
      code: r.code,
      serviceName: r.serviceName,
      patientName: r.patientName,
      amount: r.payment!.nurseShare,
      paidAt: r.payment!.paidAt,
      rating: r.rating,
    })),
  });
});

// --- Back-office --------------------------------------------------------------
const admin = Router();
admin.use(requireAuth('admin'));

admin.get('/dashboard', (_req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todays = db.requests.filter((r) => new Date(r.createdAt) >= today);
  const paid = db.requests.filter((r) => r.payment);
  const paidToday = paid.filter((r) => new Date(r.payment!.paidAt) >= today);
  const rated = db.requests.filter((r) => r.rating);
  const allNurses = nurses();
  const byService = db.services.map((s) => ({ name: s.name, count: db.requests.filter((r) => r.serviceId === s.id).length }));
  const days = [...Array(7)].map((_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (6 - i));
    const end = new Date(d);
    end.setDate(end.getDate() + 1);
    const list = paid.filter((r) => new Date(r.payment!.paidAt) >= d && new Date(r.payment!.paidAt) < end);
    return { day: d.toISOString().slice(0, 10), revenue: list.reduce((s, r) => s + r.total, 0), count: list.length };
  });
  res.json({
    requestsToday: todays.length,
    searching: db.requests.filter((r) => r.status === 'searching').length,
    active: db.requests.filter((r) => BUSY.includes(r.status) || r.status === 'awaiting_payment').length,
    completedToday: paidToday.length,
    revenueToday: paidToday.reduce((s, r) => s + r.total, 0),
    commissionToday: paidToday.reduce((s, r) => s + r.payment!.commission, 0),
    revenueTotal: paid.reduce((s, r) => s + r.total, 0),
    commissionTotal: paid.reduce((s, r) => s + r.payment!.commission, 0),
    nursesOnline: allNurses.filter((n) => n.available).length,
    nursesVerified: allNurses.filter((n) => n.verification === 'verified').length,
    nursesPending: allNurses.filter((n) => n.verification === 'pending').length,
    patients: db.users.filter((u) => u.role === 'patient').length,
    avgRating: rated.length ? Math.round((rated.reduce((s, r) => s + r.rating!.stars, 0) / rated.length) * 10) / 10 : null,
    openIncidents: db.incidents.filter((i) => i.status !== 'resolved').length,
    byService,
    days,
    recent: db.requests.slice(0, 8),
  });
});

admin.get('/requests', (req, res) => {
  const status = req.query.status as string | undefined;
  const statuses = status ? status.split(',') : undefined;
  res.json(db.requests.filter((r) => !statuses || statuses.includes(r.status)));
});

admin.get('/requests/:id/candidates', (req, res) => {
  const r = findRequest(req.params.id);
  if (!r) return bad(res, 'Demande introuvable.', 404);
  const list = nurses()
    .filter((n) => n.verification === 'verified')
    .map((n) => {
      const km = n.lat != null && n.lng != null ? distanceKm(n.lat, n.lng, r.lat, r.lng) : undefined;
      return { ...publicUser(n), distanceKm: km != null ? Math.round(km * 10) / 10 : null, busy: isBusy(n.id), declined: r.declinedBy.includes(n.id) };
    })
    .sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
  res.json(list);
});

admin.post('/requests/:id/assign', (req, res) => {
  const r = findRequest(req.params.id);
  const nurse = findNurse(req.body?.nurseId);
  if (!r || !nurse) return bad(res, 'Demande ou infirmier introuvable.', 404);
  if (r.status !== 'searching') return bad(res, 'Cette demande n’est plus en attente.', 409);
  if (nurse.verification !== 'verified') return bad(res, 'Infirmier non vérifié.');
  if (isBusy(nurse.id)) return bad(res, 'Cet infirmier est déjà en intervention.', 409);
  assignNurse(r, nurse, true);
  res.json(r);
});

admin.get('/transactions', (_req, res) => {
  res.json(
    db.requests
      .filter((r) => r.payment)
      .map((r) => ({ requestId: r.id, code: r.code, patientName: r.patientName, nurseName: r.nurseName, serviceName: r.serviceName, ...r.payment! }))
      .sort((a, b) => b.paidAt.localeCompare(a.paidAt)),
  );
});

admin.get('/transactions.csv', (_req, res) => {
  const rows = db.requests.filter((r) => r.payment);
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['Référence', 'Demande', 'Date', 'Patient', 'Infirmier', 'Service', 'Moyen', 'Montant', 'Commission', 'Part infirmier'];
  const lines = rows.map((r) =>
    [r.payment!.reference, r.code, r.payment!.paidAt, r.patientName, r.nurseName, r.serviceName, PAYMENT_LABELS[r.payment!.method], r.payment!.amount, r.payment!.commission, r.payment!.nurseShare]
      .map(esc)
      .join(';'),
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="kulawa-transactions.csv"');
  res.send('﻿' + [header.map(esc).join(';'), ...lines].join('\n'));
});

admin.get('/incidents', (_req, res) => res.json(db.incidents));

admin.patch('/incidents/:id', (req, res) => {
  const inc = db.incidents.find((i) => i.id === req.params.id);
  if (!inc) return bad(res, 'Incident introuvable.', 404);
  if (['open', 'in_review', 'resolved'].includes(req.body?.status)) inc.status = req.body.status;
  if (req.body?.resolution != null) inc.resolution = str(req.body.resolution, 1000);
  save();
  if (inc.status === 'resolved')
    notify(inc.reporterId, 'message', 'Incident traité', inc.resolution || 'Votre signalement a été traité par la coordination Kulawa.', ['push'], inc.requestId);
  res.json(inc);
});

admin.get('/ratings', (_req, res) =>
  res.json(
    db.requests
      .filter((r) => r.rating)
      .map((r) => ({ requestId: r.id, code: r.code, nurseName: r.nurseName, patientName: r.patientName, serviceName: r.serviceName, ...r.rating! })),
  ),
);

admin.get('/nurses', (_req, res) =>
  res.json(
    nurses().map((n) => ({
      ...publicUser(n),
      busy: isBusy(n.id),
      interventions: db.requests.filter((r) => r.nurseId === n.id && r.payment).length,
      earnings: db.requests.filter((r) => r.nurseId === n.id && r.payment).reduce((s, r) => s + r.payment!.nurseShare, 0),
    })),
  ),
);

admin.post('/nurses/:id/verify', (req, res) => {
  const nurse = findNurse(req.params.id);
  if (!nurse) return bad(res, 'Infirmier introuvable.', 404);
  const decision = req.body?.decision === 'reject' ? 'rejected' : 'verified';
  nurse.verification = decision;
  if (decision === 'verified') nurse.documents = { contract: 'validated', insurance: 'validated', diploma: 'validated' };
  else nurse.available = false;
  save();
  notify(
    nurse.id,
    'nurse_validated',
    decision === 'verified' ? 'Candidature validée 🎉' : 'Candidature refusée',
    decision === 'verified'
      ? 'Bienvenue chez Kulawa ! Activez votre disponibilité pour recevoir des demandes.'
      : 'Votre dossier n’a pas pu être validé. Contactez la coordination Kulawa.',
    ['push', 'sms'],
  );
  res.json(publicUser(nurse));
});

admin.get('/patients', (_req, res) =>
  res.json(
    db.users
      .filter((u) => u.role === 'patient')
      .map((u) => ({
        ...publicUser(u),
        requests: db.requests.filter((r) => r.patientId === u.id).length,
        spent: db.requests.filter((r) => r.patientId === u.id && r.payment).reduce((s, r) => s + r.total, 0),
      })),
  ),
);

admin.get('/settings', (_req, res) => res.json({ settings: db.settings, services: db.services }));

admin.put('/settings', (req, res) => {
  const rate = num(req.body?.commissionRate);
  const fee = num(req.body?.travelFee);
  const radius = num(req.body?.searchRadiusKm);
  if (Number.isFinite(rate) && rate >= 0 && rate <= 0.5) db.settings.commissionRate = rate;
  if (Number.isFinite(fee) && fee >= 0) db.settings.travelFee = Math.round(fee);
  if (Number.isFinite(radius) && radius > 0 && radius <= 100) db.settings.searchRadiusKm = radius;
  save();
  res.json(db.settings);
});

admin.put('/services/:id', (req, res) => {
  let s = db.services.find((x) => x.id === req.params.id);
  if (!s) {
    s = { id: String(req.params.id), name: '', description: '', price: 0, durationMin: 30, icon: '🩺', active: true } as Service;
    db.services.push(s);
  }
  if (req.body?.name) s.name = str(req.body.name, 80);
  if (req.body?.description != null) s.description = str(req.body.description, 300);
  if (req.body?.icon) s.icon = str(req.body.icon, 8);
  const price = num(req.body?.price);
  if (Number.isFinite(price) && price >= 0) s.price = Math.round(price);
  const dur = num(req.body?.durationMin);
  if (Number.isFinite(dur) && dur > 0) s.durationMin = Math.round(dur);
  if (typeof req.body?.active === 'boolean') s.active = req.body.active;
  save();
  res.json(s);
});

admin.get('/notifications/log', (_req, res) => res.json(db.notifications.slice(0, 300)));

api.use('/admin', admin);
