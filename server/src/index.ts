import express from 'express';
import cors from 'cors';
import { resolve, dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getDb } from './db/schema.js';
import { scanRoutes } from './routes/scans.js';
import { comparisonRoutes } from './routes/comparisons.js';
import { deliveryRoutes } from './routes/deliveries.js';
import { dashboardRoutes } from './routes/dashboard.js';

// Project root is two levels up from server/src/
const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(__dirname, '..', '..');

const PORT = parseInt(process.env.PORT || '3001', 10);
const app = express();

app.use(cors());
app.use(express.json());

const dataDir = resolve(PROJECT_ROOT, 'data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

getDb();

app.use('/api/dashboard', dashboardRoutes);
app.use('/api/scans', scanRoutes);
app.use('/api/comparisons', comparisonRoutes);
app.use('/api/deliveries', deliveryRoutes);

// Serve screenshot files from the scans directory so the client can display evidence images
const scansDir = resolve(PROJECT_ROOT, 'scans');
if (!existsSync(scansDir)) mkdirSync(scansDir, { recursive: true });
app.use('/scans-files', express.static(scansDir));

const clientDist = resolve(PROJECT_ROOT, 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(resolve(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`BR Scanner server running on http://localhost:${PORT}`);
  console.log(`Project root: ${PROJECT_ROOT}`);
});
