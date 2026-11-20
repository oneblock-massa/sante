import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { api } from './api.js';
import { initRealtime } from './realtime.js';
import { APP_VERSION } from '../../shared/types.js';

const app = express();
app.use(cors());
// 8 Mo : les pièces justificatives sont envoyées encodées en base64.
app.use(express.json({ limit: '8mb' }));
app.use('/api', api);

// En production, le serveur sert aussi l'application web compilée.
const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = process.env.KULAWA_WEB_DIST ?? path.resolve(here, '../../web/dist');
app.use(express.static(webDist));
app.get(/^\/(?!api|socket\.io).*/, (_req, res) => {
  const index = path.join(webDist, 'index.html');
  if (fs.existsSync(index)) return res.sendFile(index);
  res
    .status(503)
    .type('html')
    .send('<h1>Kulawa</h1><p>L\u2019application web n\u2019est pas encore compilée.</p><p>Dans le terminal : arrêtez le serveur (Ctrl + C), lancez <code>npm run build</code>, puis <code>npm start</code>.</p>');
});

const server = http.createServer(app);
initRealtime(server);

const port = Number(process.env.PORT ?? 4000);
server.listen(port, '0.0.0.0', () => {
  console.log(`Kulawa API prête sur http://localhost:${port} — version ${APP_VERSION}`);
  if (!fs.existsSync(path.join(webDist, 'index.html'))) console.warn('⚠ Application web non compilée : lancez « npm run build » puis relancez « npm start ».');
});
