# Kulawa — soins infirmiers à domicile

Implémentation du modèle Figma *Kulawa* : trois modules reliés en temps réel.

| Module | Où | Écrans |
|---|---|---|
| **Application Patient** (bleu) | Web (`/patient`) + mobile iOS/Android | Connexion OTP · Accueil · Sélection du service · Adresse & tarif · Envoi · Recherche · Infirmier trouvé · Suivi en direct (+ messages) · Paiement mobile money · Évaluation · Historique · Profil / incidents |
| **Application Infirmier** (teal) | Web (`/infirmier`) + mobile iOS/Android | Connexion / candidature · Disponibilité · Notification reçue · Détail & Accepter/Refuser · Navigation (position partagée) · Intervention en cours · Compte-rendu · Confirmation de paiement · Gains & note · Profil & documents |
| **Back-office Admin** (vert) | Web (`/admin`) | Connexion · Tableau de bord · File des demandes (assignation manuelle) · Statut assigné / détail · Suivi des interventions (carte) · Transactions + export CSV · Incidents & qualité · Fiches infirmiers (validation diplôme/Ordre) · Patients · Journal des notifications · Tarifs & commission |

## Architecture

```
shared/   types + constantes communs (statuts, moyens de paiement, format FCFA)
server/   API REST Express + Socket.IO (temps réel), stockage JSON (server/data/db.json)
web/      React + Vite — les 3 modules, PWA installable, cartes OpenStreetMap (Leaflet)
mobile/   Expo (React Native) — modules Patient et Infirmier
```

Cycle de vie d'une demande (piloté par le serveur, propagé en temps réel aux 3 modules) :

`searching` → `assigned` → `en_route` → `in_progress` → `awaiting_payment` → `paid` → `rated` (ou `cancelled`)

Les 8 événements de la *carte des notifications* (p. 9 du modèle) sont implémentés dans `server/src/api.ts` avec leurs destinataires et canaux (push, SMS, temps réel, alerte). Les SMS sont simulés (journalisés dans la console du serveur).

## Démarrer

Prérequis : Node.js 20+.

```bash
npm run install:all
```

```bash
npm run dev:server
```

```bash
npm run dev:web
```

Ouvrez http://localhost:5173 — choisissez un module. Astuce : ouvrez Patient, Infirmier et Admin dans trois onglets pour voir les notifications circuler.

### Comptes de démonstration

| Rôle | Identifiants |
|---|---|
| Patient | n'importe quel numéro (ex. `96000001`) — le code OTP s'affiche à l'écran en mode démo |
| Infirmier | `90000001` / `kulawa123` (aussi `90000002`, `90000003`) — `90000004` est « en vérification » |
| Admin | `admin@kulawa.ne` / `admin123` |

Le bouton « Réinitialiser la démo » du tableau de bord remet les données à zéro.

### Application mobile

```bash
npm run dev:mobile
```

Scannez le QR code avec **Expo Go**. Sur l'écran d'accueil de l'app, renseignez l'adresse du serveur accessible depuis le téléphone (ex. `http://192.168.1.20:4000`, l'IP de votre ordinateur), ou définissez `EXPO_PUBLIC_API_URL`. Pour publier sur les stores : `npx eas-cli@latest build` (bundle id `ne.kulawa.app`).

## Production

```bash
npm run build
```

```bash
NODE_ENV=production JWT_SECRET=un-secret-long npm start
```

Le serveur (port `PORT`, 4000 par défaut) sert alors l'API, le temps réel et l'application web compilée sur une seule adresse. En production, le code OTP n'est plus renvoyé au client et la réinitialisation de la démo est désactivée.

## À brancher pour un lancement réel

- **SMS / OTP** : remplacer le `console.log` de `server/src/auth.ts` (`issueOtp`) et de `notify()` par un agrégateur SMS.
- **Mobile money** : remplacer le paiement simulé (`POST /requests/:id/pay`) par l'API de l'agrégateur (Airtel Money, Moov Money, Zamani Cash) avec confirmation par webhook.
- **Push mobile** : ajouter `expo-notifications` pour les notifications hors application.
- **Base de données** : le stockage JSON convient à la démo ; migrer vers PostgreSQL pour la production.
