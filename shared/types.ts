// Types et constantes partagés entre le serveur, l'application web et l'application mobile.

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
  documents: { contract: DocStatus; insurance: DocStatus; diploma: DocStatus };
}

export type DocStatus = 'missing' | 'submitted' | 'validated';

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
  | 'message';

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
