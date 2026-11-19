import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import { api } from './api.js';
import { initRealtime } from './realtime.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use('/api', api);

// En production, le serveur sert aussi l'application web compilée.
const webDist = process.env.KULAWA_WEB_DIST ?? path.resolve(process.cwd(), '../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

const server = http.createServer(app);
initRealtime(server);

const port = Number(process.env.PORT ?? 4000);
server.listen(port, '0.0.0.0', () => console.log(`Kulawa API prête sur http://localhost:${port}`));
