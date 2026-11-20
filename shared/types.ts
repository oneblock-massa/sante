// Types et constantes partagés entre le serveur, l'application web et l'application mobile.

/** Version affichée dans les applications : permet de vérifier qu'on utilise la dernière mise à jour. */
export const APP_VERSION = '1.2 — documents & messages';

export type Role = 'patient' | 'nurse' | 'admin';

export interface User {
  id: string;
  role: Role;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  createdAt: string;
}

export interface NurseProfile extends User {
  role: 'nurse';
  verification: 'pending' | 'verified' | 'rejected';
  diplomaNumber: string;
  ordreNumber: string;
  available: boolean;
  lat?: number;
  lng?: number;
  rating: number;
  ratingCount: number;
  documents: Partial<Record<DocKey, NurseDocument>>;
}

export type DocStatus = 'missing' | 'submitted' | 'validated' | 'rejected';
export type DocKey = 'diploma' | 'ordre' | 'insurance' | 'contract' | 'identity';

export interface NurseDocument {
  status: DocStatus;
  fileName?: string;
  mime?: string;
  size?: number;
  uploadedAt?: string;
  reviewNote?: string; // motif de refus / commentaire de la coordination
  reviewedAt?: string;
}

/** Pièces demandées à chaque infirmier partenaire. */
export const DOC_LIST: { key: DocKey; label: string; hint: string }[] = [
  { key: 'diploma', label: 'Diplôme d\u2019État d\u2019infirmier', hint: 'Copie lisible du diplôme' },
  { key: 'ordre', label: 'Attestation d\u2019inscription à l\u2019Ordre', hint: 'Attestation de l\u2019année en cours' },
  { key: 'insurance', label: 'Attestation d\u2019assurance RC Pro', hint: 'Responsabilité civile professionnelle en cours de validité' },
  { key: 'contract', label: 'Contrat de partenariat signé', hint: 'Contrat Kulawa signé et paraphé' },
  { key: 'identity', label: 'Pièce d\u2019identité', hint: 'CNI ou passeport en cours de validité' },
];

export const DOC_STATUS_LABELS: Record<DocStatus, string> = {
  missing: 'À fournir',
  submitted: 'En vérification',
  validated: 'Validé',
  rejected: 'Refusé — à renvoyer',
};

export const docOf = (n: Pick<NurseProfile, 'documents'>, key: DocKey): NurseDocument => n.documents?.[key] ?? { status: 'missing' };

/** Message envoyé par la coordination à un ou plusieurs infirmiers. */
export interface AdminBroadcast {
  id: string;
  title: string;
  body: string;
  target: 'all' | 'selected';
  recipientIds: string[];
  recipientNames: string[];
  sms: boolean;
  createdAt: string;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  price: number; // en FCFA
  durationMin: number;
  icon: string;
  active: boolean;
}

export type RequestStatus =
  | 'searching' // envoyée, recherche d'un infirmier
  | 'assigned' // infirmier trouvé
  | 'en_route' // infirmier en route
  | 'in_progress' // intervention en cours
  | 'awaiting_payment' // compte-rendu envoyé, en attente de paiement
  | 'paid' // payée, en attente d'évaluation
  | 'rated' // évaluée — terminée
  | 'cancelled';

export interface CareReport {
  acts: string;
  bloodPressure?: string;
  temperature?: string;
  glycemia?: string;
  observations?: string;
  recommendations?: string;
  submittedAt: string;
}

export type PaymentMethod = 'airtel' | 'moov' | 'zamani' | 'cash';

export interface Payment {
  method: PaymentMethod;
  phone?: string;
  amount: number;
  commission: number;
  nurseShare: number;
  reference: string;
  paidAt: string;
}

export interface Message {
  id: string;
  from: Role;
  text: string;
  at: string;
}

export interface CareRequest {
  id: string;
  code: string; // référence courte lisible, ex. KL-0042
  patientId: string;
  patientName: string;
  patientPhone?: string;
  serviceId: string;
  serviceName: string;
  address: string;
  lat: number;
  lng: number;
  notes?: string;
  price: number;
  travelFee: number;
  total: number;
  status: RequestStatus;
  nurseId?: string;
  nurseName?: string;
  nursePhone?: string;
  nurseRating?: number;
  nurseLat?: number;
  nurseLng?: number;
  etaMin?: number;
  declinedBy: string[];
  report?: CareReport;
  payment?: Payment;
  rating?: { stars: number; comment?: string; at: string };
  messages: Message[];
  createdAt: string;
  assignedAt?: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  assignedByAdmin?: boolean;
}

export interface Incident {
  id: string;
  requestId?: string;
  requestCode?: string;
  reporterId: string;
  reporterRole: Role;
  reporterName: string;
  category: 'retard' | 'comportement' | 'paiement' | 'medical' | 'autre';
  description: string;
  status: 'open' | 'in_review' | 'resolved';
  resolution?: string;
  createdAt: string;
}

export type NotificationChannel = 'push' | 'sms' | 'realtime' | 'alert';

export interface AppNotification {
  id: string;
  userId: string; // 'admin' pour tous les administrateurs
  event: NotificationEvent;
  title: string;
  body: string;
  channels: NotificationChannel[];
  requestId?: string;
  read: boolean;
  createdAt: string;
}

export type NotificationEvent =
  | 'request_created'
  | 'request_accepted'
  | 'nurse_en_route'
  | 'intervention_completed'
  | 'payment_confirmed'
  | 'rating_sent'
  | 'nurse_validated'
  | 'incident_reported'
  | 'message'
  | 'admin_message'
  | 'document_submitted'
  | 'document_reviewed';

export interface Settings {
  commissionRate: number; // ex. 0.15
  travelFee: number; // FCFA
  searchRadiusKm: number;
}

export const STATUS_LABELS: Record<RequestStatus, string> = {
  searching: 'Recherche en cours',
  assigned: 'Infirmier trouvé',
  en_route: 'Infirmier en route',
  in_progress: 'Intervention en cours',
  awaiting_payment: 'En attente de paiement',
  paid: 'Payée',
  rated: 'Terminée',
  cancelled: 'Annulée',
};

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  airtel: 'Airtel Money',
  moov: 'Moov Money',
  zamani: 'Zamani Cash',
  cash: 'Espèces',
};

export const ACTIVE_STATUSES: RequestStatus[] = ['searching', 'assigned', 'en_route', 'in_progress', 'awaiting_payment', 'paid'];

export function formatFCFA(n: number): string {
  return `${Math.round(n).toLocaleString('fr-FR').replace(/ | /g, ' ')} FCFA`;
}
