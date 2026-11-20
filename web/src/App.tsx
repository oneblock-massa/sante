import { lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { Spinner } from './components/ui';
import { APP_VERSION } from '../../shared/types';

const PatientApp = lazy(() => import('./patient/PatientApp'));
const NurseApp = lazy(() => import('./nurse/NurseApp'));
const AdminApp = lazy(() => import('./admin/AdminApp'));

export default function App() {
  return (
    <Suspense fallback={<div className="center-screen"><Spinner /></div>}>
      <Routes>
        <Route path="/patient/*" element={<PatientApp />} />
        <Route path="/infirmier/*" element={<NurseApp />} />
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </Suspense>
  );
}

function Landing() {
  return (
    <div className="landing">
      <header>
        <p className="eyebrow">Soins infirmiers à domicile · Niamey</p>
        <h1>Kulawa</h1>
        <p className="lead">Un infirmier diplômé chez vous en quelques minutes. Demandez, suivez, payez par mobile money.</p>
      </header>
      <div className="modules">
        <Link to="/patient" className="module patient">
          <span className="dot" />
          <strong>Application Patient</strong>
          <small>Demander un soin, suivre l'infirmier en direct, payer et évaluer.</small>
        </Link>
        <Link to="/infirmier" className="module nurse">
          <span className="dot" />
          <strong>Application Infirmier</strong>
          <small>Recevoir les demandes à proximité, intervenir, rédiger le compte-rendu, suivre ses gains.</small>
        </Link>
        <Link to="/admin" className="module admin">
          <span className="dot" />
          <strong>Back-office Admin</strong>
          <small>Coordination : file des demandes, suivi temps réel, transactions, qualité.</small>
        </Link>
      </div>
      <p className="tip">
        Astuce démo : ouvrez les trois modules dans trois onglets pour voir les notifications circuler en temps réel.
      </p>
      <p className="tip">Version {APP_VERSION}</p>
    </div>
  );
}
