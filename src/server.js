import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// 1x1 transparent GIF (43 bytes)
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

// Initialize SQLite database
const db = new Database(join(__dirname, '..', 'tracker.db'));

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS pixels (
    id TEXT PRIMARY KEY,
    email_id TEXT,
    recipient TEXT,
    subject TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS opens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pixel_id TEXT NOT NULL,
    opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip_address TEXT,
    user_agent TEXT,
    FOREIGN KEY (pixel_id) REFERENCES pixels(id)
  );

  CREATE INDEX IF NOT EXISTS idx_pixels_email_id ON pixels(email_id);
  CREATE INDEX IF NOT EXISTS idx_opens_pixel_id ON opens(pixel_id);
`);

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Create a new tracking pixel
app.post('/api/pixels', (req, res) => {
  const { emailId, recipient, subject } = req.body;

  if (!emailId || !recipient) {
    return res.status(400).json({ error: 'emailId and recipient are required' });
  }

  const pixelId = nanoid(32);

  const stmt = db.prepare(`
    INSERT INTO pixels (id, email_id, recipient, subject)
    VALUES (?, ?, ?, ?)
  `);

  stmt.run(pixelId, emailId, recipient, subject || '');

  const baseUrl = process.env.TRACKER_BASE_URL || `http://localhost:${PORT}`;

  res.json({
    pixelId,
    pixelUrl: `${baseUrl}/v1/${pixelId}.gif`,
    pixelHtml: `<div style="display:none;border:0;width:0;height:0;overflow:hidden"><img src="${baseUrl}/v1/${pixelId}.gif" alt=" " width="1" height="0" style="display:none;border:0;width:0;height:0;overflow:hidden"></div>`
  });
});

// Serve tracking pixel and log open
app.get('/v1/:pixelId.gif', (req, res) => {
  const pixelId = req.params.pixelId;

  const pixel = db.prepare('SELECT * FROM pixels WHERE id = ?').get(pixelId);

  if (pixel) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';

    const stmt = db.prepare(`
      INSERT INTO opens (pixel_id, ip_address, user_agent)
      VALUES (?, ?, ?)
    `);
    stmt.run(pixelId, ip, userAgent);

    console.log(`[OPEN] Pixel: ${pixelId}, IP: ${ip}, Time: ${new Date().toISOString()}`);
  }

  res.set({
    'Content-Type': 'image/gif',
    'Content-Length': TRANSPARENT_GIF.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  res.send(TRANSPARENT_GIF);
});

// Get tracking status for an email
app.get('/api/status/:emailId', (req, res) => {
  const { emailId } = req.params;

  const pixels = db.prepare(`
    SELECT p.id as pixel_id, p.recipient, p.subject, p.created_at as sent_at,
           (SELECT COUNT(*) FROM opens WHERE pixel_id = p.id) as open_count,
           (SELECT opened_at FROM opens WHERE pixel_id = p.id ORDER BY opened_at ASC LIMIT 1) as first_opened,
           (SELECT opened_at FROM opens WHERE pixel_id = p.id ORDER BY opened_at DESC LIMIT 1) as last_opened
    FROM pixels p
    WHERE p.email_id = ?
  `).all(emailId);

  res.json({
    emailId,
    recipients: pixels.map(p => ({
      recipient: p.recipient,
      pixelId: p.pixel_id,
      sentAt: p.sent_at,
      opened: p.open_count > 0,
      openCount: p.open_count,
      firstOpened: p.first_opened,
      lastOpened: p.last_opened
    }))
  });
});

// Get all opens for a specific pixel
app.get('/api/opens/:pixelId', (req, res) => {
  const { pixelId } = req.params;

  const opens = db.prepare(`
    SELECT opened_at, ip_address, user_agent
    FROM opens
    WHERE pixel_id = ?
    ORDER BY opened_at DESC
  `).all(pixelId);

  res.json({ pixelId, opens });
});

// Dashboard API
app.get('/api/dashboard', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;

  const emails = db.prepare(`
    SELECT
      p.email_id,
      p.subject,
      GROUP_CONCAT(p.recipient) as recipients,
      MIN(p.created_at) as sent_at,
      SUM((SELECT COUNT(*) FROM opens WHERE pixel_id = p.id)) as total_opens,
      COUNT(DISTINCT CASE WHEN (SELECT COUNT(*) FROM opens WHERE pixel_id = p.id) > 0 THEN p.recipient END) as recipients_opened,
      COUNT(DISTINCT p.recipient) as total_recipients
    FROM pixels p
    GROUP BY p.email_id
    ORDER BY sent_at DESC
    LIMIT ?
  `).all(limit);

  res.json({ emails });
});

// Activity Feed API - chronological list of all opens
app.get('/api/activity', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const since = req.query.since; // ISO timestamp for polling new opens

  let query = `
    SELECT
      o.id as open_id,
      o.opened_at,
      o.ip_address,
      o.user_agent,
      p.id as pixel_id,
      p.email_id,
      p.recipient,
      p.subject,
      p.created_at as sent_at
    FROM opens o
    JOIN pixels p ON o.pixel_id = p.id
  `;

  const params = [];

  if (since) {
    query += ` WHERE o.opened_at > ? `;
    params.push(since);
  }

  query += ` ORDER BY o.opened_at DESC LIMIT ?`;
  params.push(limit);

  const opens = db.prepare(query).all(...params);

  // Get count of new opens since timestamp (for badge)
  let newCount = 0;
  if (since) {
    const countResult = db.prepare(`
      SELECT COUNT(*) as count FROM opens WHERE opened_at > ?
    `).get(since);
    newCount = countResult.count;
  }

  res.json({
    opens,
    newCount,
    timestamp: new Date().toISOString()
  });
});

// Simple HTML dashboard
app.get('/', (req, res) => {
  const emails = db.prepare(`
    SELECT
      p.email_id,
      p.subject,
      p.recipient,
      p.created_at as sent_at,
      (SELECT COUNT(*) FROM opens WHERE pixel_id = p.id) as open_count,
      (SELECT opened_at FROM opens WHERE pixel_id = p.id ORDER BY opened_at DESC LIMIT 1) as last_opened
    FROM pixels p
    ORDER BY sent_at DESC
    LIMIT 100
  `).all();

  let tableRows = '';
  for (const e of emails) {
    const statusBadge = e.open_count > 0
      ? '<span class="badge badge-success">Opened</span>'
      : '<span class="badge badge-pending">Sent</span>';
    const lastOpened = e.last_opened ? new Date(e.last_opened).toLocaleString() : '-';

    tableRows += `
    <tr>
      <td>${e.subject || '(no subject)'}</td>
      <td>${e.recipient}</td>
      <td>${new Date(e.sent_at).toLocaleString()}</td>
      <td>${statusBadge}</td>
      <td>${e.open_count}</td>
      <td>${lastOpened}</td>
    </tr>`;
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Email Tracker Dashboard</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 20px; background: #f5f5f5; }
    h1 { color: #333; }
    table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f8f9fa; font-weight: 600; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; }
    .badge-success { background: #dcfce7; color: #166534; }
    .badge-pending { background: #f3f4f6; color: #6b7280; }
  </style>
</head>
<body>
  <h1>Email Tracker Dashboard</h1>
  <table>
    <tr>
      <th>Subject</th>
      <th>Recipient</th>
      <th>Sent</th>
      <th>Status</th>
      <th>Opens</th>
      <th>Last Opened</th>
    </tr>
    ${tableRows}
  </table>
</body>
</html>`;
  res.send(html);
});

app.listen(PORT, () => {
  console.log(`Email Tracker Server running on http://localhost:${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/`);
  console.log(`Pixel URL format: http://localhost:${PORT}/v1/{pixelId}.gif`);
});
