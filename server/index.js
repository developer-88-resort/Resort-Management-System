import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HttpError } from './lib.js';
import { seed } from './seed.js';
import { authRouter, adminRouter } from './routes/admin.js';
import { roomsRouter } from './routes/rooms.js';
import { reservationsRouter, attachmentsRouter } from './routes/reservations.js';
import { departmentsRouter, paymentsRouter } from './routes/departments.js';
import { dayTourRouter } from './routes/daytour.js';
import { reportsRouter } from './routes/reports.js';
import { approvalsRouter } from './routes/approvals.js';

seed();

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '12mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/rooms', roomsRouter);
app.use('/api/reservations', reservationsRouter);
app.use('/api/attachments', attachmentsRouter);
app.use('/api/department', departmentsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/daytour', dayTourRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/approvals', approvalsRouter);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Unknown API route.')));

// Serve the built web client in production.
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.details || {}) });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Upload is too large.' });
  if (String(err?.code || '').startsWith('ERR_SQLITE') && /UNIQUE|constraint/i.test(err.message))
    return res.status(409).json({ error: 'This record conflicts with an existing one (duplicate or in use).' });
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error. The action was not saved.' });
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 4000;
  app.listen(port, () => console.log(`IRMS API listening on http://localhost:${port}`));
}
