import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import type {
  AdminBroadcast,
  AppNotification,
  DocKey,
  CareRequest,
  Incident,
  NurseProfile,
  Service,
  Settings,
  User,
} from '../../shared/types.js';

export interface StoredUser extends User {
  passwordHash?: string;
}
/** docFiles : nom du fichier sur disque pour chaque pièce (jamais exposé au client). */
export type StoredNurse = NurseProfile & { passwordHash?: string; docFiles?: Partial<Record<DocKey, string>> };

export interface Database {
  users: (StoredUser | StoredNurse)[];
  services: Service[];
  requests: CareRequest[];
  incidents: Incident[];
  notifications: AppNotification[];
  broadcasts: AdminBroadcast[];
  settings: Settings;
  counters: { request: number };
}

const DATA_DIR = process.env.KULAWA_DATA_DIR ?? path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

function seed(): Database {
  const t = now();
  const hash = (p: string) => bcrypt.hashSync(p, 8);
  const nurse = (
    name: string,
    phone: string,
    lat: number,
    lng: number,
    verification: NurseProfile['verification'],
    rating: number,
    ratingCount: number,
  ): StoredNurse => ({
    id: id(),
    role: 'nurse',
    name,
    phone,
    passwordHash: hash('kulawa123'),
    createdAt: t,
    verification,
    diplomaNumber: `DE-${Math.floor(10000 + Math.random() * 89999)}`,
    ordreNumber: `ONI-NE-${Math.floor(1000 + Math.random() * 8999)}`,
    available: false,
    lat,
    lng,
    rating,
    ratingCount,
    documents:
      verification === 'verified'
        ? Object.fromEntries((['diploma', 'ordre', 'insurance', 'contract', 'identity'] as const).map((k) => [k, { status: 'validated', reviewedAt: t }]))
        : {},
  });

  return {
    users: [
      { id: id(), role: 'admin', name: 'Coordination Kulawa', email: 'admin@kulawa.ne', passwordHash: hash('admin123'), createdAt: t },
      nurse('Aïchatou Moussa', '+22790000001', 13.5137, 2.1098, 'verified', 4.8, 32),
      nurse('Ibrahim Abdou', '+22790000002', 13.5302, 2.0915, 'verified', 4.6, 18),
      nurse('Mariama Issoufou', '+22790000003', 13.4982, 2.1301, 'verified', 4.9, 51),
      nurse('Souleymane Garba', '+22790000004', 13.5211, 2.1187, 'pending', 0, 0),
      { id: id(), role: 'patient', name: 'Hadiza Oumarou', phone: '+22796000001', address: 'Quartier Plateau, Niamey', createdAt: t },
    ],
    services: [
      { id: 'injection', name: 'Injection', description: 'Injection intramusculaire, sous-cutanée ou intraveineuse sur ordonnance.', price: 3000, durationMin: 20, icon: '💉', active: true },
      { id: 'pansement', name: 'Pansement', description: 'Réfection de pansement simple ou complexe, soin de plaie.', price: 4000, durationMin: 30, icon: '🩹', active: true },
      { id: 'perfusion', name: 'Perfusion', description: 'Pose et surveillance de perfusion à domicile.', price: 10000, durationMin: 90, icon: '💧', active: true },
      { id: 'constantes', name: 'Prise de constantes', description: 'Tension, température, glycémie, saturation.', price: 2500, durationMin: 15, icon: '🩺', active: true },
      { id: 'prelevement', name: 'Prélèvement sanguin', description: 'Prise de sang à domicile, dépôt au laboratoire.', price: 5000, durationMin: 20, icon: '🧪', active: true },
      { id: 'post-op', name: 'Soins post-opératoires', description: 'Suivi après chirurgie : surveillance, ablation de fils, drains.', price: 8000, durationMin: 45, icon: '🏥', active: true },
      { id: 'hygiene', name: 'Soins d’hygiène', description: 'Toilette et soins de confort pour personne dépendante.', price: 6000, durationMin: 60, icon: '🛁', active: true },
      { id: 'diabete', name: 'Suivi diabète', description: 'Contrôle glycémique, injection d’insuline, éducation.', price: 4000, durationMin: 25, icon: '📈', active: true },
    ],
    requests: [],
    incidents: [],
    notifications: [],
    broadcasts: [],
    settings: { commissionRate: 0.15, travelFee: 1000, searchRadiusKm: 15 },
    counters: { request: 0 },
  };
}

/** Met à niveau une base créée par une version précédente. */
function migrate(d: Database): Database {
  d.broadcasts ??= [];
  for (const u of d.users) {
    if (u.role !== 'nurse') continue;
    const n = u as StoredNurse;
    const docs = (n.documents ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(docs)) if (typeof v === 'string') docs[k] = { status: v };
    n.documents = docs as StoredNurse['documents'];
  }
  return d;
}

function load(): Database {
  try {
    if (fs.existsSync(DB_FILE)) return migrate(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) as Database);
  } catch (e) {
    console.error('[db] lecture impossible, réinitialisation', e);
  }
  const db = seed();
  persistNow(db);
  return db;
}

function persistNow(data: Database) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export const db: Database = load();

let timer: NodeJS.Timeout | undefined;
export function save() {
  clearTimeout(timer);
  timer = setTimeout(() => persistNow(db), 200);
}

export function reset() {
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
  Object.assign(db, seed());
  persistNow(db);
}

export const findUser = (uid?: unknown) => db.users.find((u) => u.id === uid);
export const nurses = () => db.users.filter((u): u is StoredNurse => u.role === 'nurse');
export const findNurse = (uid?: unknown) => nurses().find((n) => n.id === uid);

export function publicUser<T extends { passwordHash?: string; docFiles?: unknown }>(u: T): Omit<T, 'passwordHash' | 'docFiles'> {
  const { passwordHash: _ignored, docFiles: _files, ...rest } = u;
  return rest;
}

export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Estimation simple : ~25 km/h en ville + 3 min de préparation. */
export const etaFromKm = (km: number) => Math.max(3, Math.round((km / 25) * 60 + 3));
