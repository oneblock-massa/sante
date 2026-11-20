import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

// Écran d'ouverture (index.html) : visible au moins ~1,6 s, puis fondu et retrait.
const splash = document.getElementById('splash');
if (splash) {
  setTimeout(() => {
    splash.classList.add('hide');
    setTimeout(() => splash.remove(), 500);
  }, Math.max(0, 1600 - performance.now()));
}
