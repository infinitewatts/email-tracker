import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.API_KEY;

// API Key authentication middleware
const requireApiKey = (req, res, next) => {
  if (!API_KEY) {
    // No API key configured - allow access (dev mode)
    return next();
  }

  const providedKey = req.headers['x-api-key'] || req.query.apiKey;

  if (!providedKey || providedKey !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized - Invalid or missing API key' });
  }

  next();
};

// 1x1 transparent GIF (43 bytes)
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

// Known bot/proxy detection
const BOT_USER_AGENTS = [
  'googlebot',
  'google-smtp',
  'googleimageproxy',
  'feedfetcher-google',
  'bingbot',
  'yahoo',
  'slurp',
  'duckduckbot',
  'baiduspider',
  'yandexbot',
  'facebookexternalhit',
  'twitterbot',
  'linkedinbot',
  'whatsapp',
  'slackbot',
  'telegrambot',
  'discordbot',
  'applebot',
  'pingdom',
  'uptimerobot',
  'monitor',
  'crawler',
  'spider',
  'bot/',
  'bot;',
];

// Google's known IP ranges for image proxy (partial list - these are common prefixes)
const GOOGLE_IP_PREFIXES = [
  '66.102.',    // Google
  '66.249.',    // Googlebot
  '72.14.',     // Google
  '74.125.',    // Google
  '173.194.',   // Google
  '192.178.',   // Google image proxy
  '209.85.',    // Google
  '216.239.',   // Google
  '216.58.',    // Google
];

const DEFAULT_DB_PATH = join(__dirname, '..', 'tracker.db');
const DATA_DB_PATH = '/data/tracker.db';
const CUSTOM_DB_PATH = process.env.TRACKER_DB_PATH;

const isEmptyFile = (path) => {
  try {
    return statSync(path).size === 0;
  } catch {
    return true;
  }
};

const getDbPath = () => {
  if (CUSTOM_DB_PATH) return CUSTOM_DB_PATH;
  return existsSync('/data') ? DATA_DB_PATH : DEFAULT_DB_PATH;
};

const ensurePersistentDb = (dbPath) => {
  if (dbPath === DEFAULT_DB_PATH) return;
  if (!existsSync(DEFAULT_DB_PATH)) return;

  const needsCopy = !existsSync(dbPath) || isEmptyFile(dbPath);
  if (!needsCopy) return;

  try {
    mkdirSync(dirname(dbPath), { recursive: true });
    copyFileSync(DEFAULT_DB_PATH, dbPath);
    console.log(`[DB] Copied ${DEFAULT_DB_PATH} -> ${dbPath}`);
  } catch (err) {
    console.error('[DB] Failed to copy database to persistent path:', err.message);
  }
};

function isBot(userAgent, ip) {
  const ua = (userAgent || '').toLowerCase();

  // Check user agent
  for (const botPattern of BOT_USER_AGENTS) {
    if (ua.includes(botPattern)) {
      return { isBot: true, reason: `user-agent: ${botPattern}` };
    }
  }

  // Check IP against known Google proxy ranges
  if (ip) {
    for (const prefix of GOOGLE_IP_PREFIXES) {
      if (ip.startsWith(prefix)) {
        return { isBot: true, reason: `ip-range: ${prefix}*` };
      }
    }
  }

  return { isBot: false };
}

// Initialize SQLite database
const dbPath = getDbPath();
ensurePersistentDb(dbPath);
const db = new Database(dbPath);

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
    is_bot INTEGER DEFAULT 0,
    bot_reason TEXT,
    FOREIGN KEY (pixel_id) REFERENCES pixels(id)
  );

  CREATE INDEX IF NOT EXISTS idx_pixels_email_id ON pixels(email_id);
  CREATE INDEX IF NOT EXISTS idx_opens_pixel_id ON opens(pixel_id);
`);

// Migration: Add bot columns to existing opens table if they don't exist
try {
  const tableInfo = db.prepare("PRAGMA table_info(opens)").all();
  const columnNames = tableInfo.map(col => col.name);

  if (!columnNames.includes('is_bot')) {
    db.prepare("ALTER TABLE opens ADD COLUMN is_bot INTEGER DEFAULT 0").run();
    console.log("[MIGRATION] Added is_bot column to opens table");
  }
  if (!columnNames.includes('bot_reason')) {
    db.prepare("ALTER TABLE opens ADD COLUMN bot_reason TEXT").run();
    console.log("[MIGRATION] Added bot_reason column to opens table");
  }

  // Always ensure no NULL values in is_bot (treat as human opens)
  const updated = db.prepare("UPDATE opens SET is_bot = 0 WHERE is_bot IS NULL").run();
  if (updated.changes > 0) {
    console.log(`[MIGRATION] Set ${updated.changes} NULL is_bot values to 0`);
  }
} catch (err) {
  console.error("[MIGRATION] Error:", err.message);
}

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Protected routes - require API key
app.use('/api', requireApiKey);

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

    // Detect if this is a bot/proxy
    const botCheck = isBot(userAgent, ip);

    const stmt = db.prepare(`
      INSERT INTO opens (pixel_id, ip_address, user_agent, is_bot, bot_reason)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(pixelId, ip, userAgent, botCheck.isBot ? 1 : 0, botCheck.reason || null);

    const botTag = botCheck.isBot ? ` [BOT: ${botCheck.reason}]` : '';
    console.log(`[OPEN] Pixel: ${pixelId}, IP: ${ip}, Time: ${new Date().toISOString()}${botTag}`);
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
  const includeBots = req.query.includeBots === 'true';

  // Filter condition for human opens only (unless includeBots=true)
  const botFilter = includeBots ? '' : 'AND is_bot = 0';

  const pixels = db.prepare(`
    SELECT p.id as pixel_id, p.recipient, p.subject, p.created_at as sent_at,
           (SELECT COUNT(*) FROM opens WHERE pixel_id = p.id ${botFilter}) as open_count,
           (SELECT COUNT(*) FROM opens WHERE pixel_id = p.id AND is_bot = 1) as bot_open_count,
           (SELECT opened_at FROM opens WHERE pixel_id = p.id ${botFilter} ORDER BY opened_at ASC LIMIT 1) as first_opened,
           (SELECT opened_at FROM opens WHERE pixel_id = p.id ${botFilter} ORDER BY opened_at DESC LIMIT 1) as last_opened
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
      botOpenCount: p.bot_open_count,
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
  const includeBots = req.query.includeBots === 'true';
  const botFilter = includeBots ? '' : 'AND is_bot = 0';

  const emails = db.prepare(`
    SELECT
      p.email_id,
      p.subject,
      GROUP_CONCAT(p.recipient) as recipients,
      MIN(p.created_at) as sent_at,
      SUM((SELECT COUNT(*) FROM opens WHERE pixel_id = p.id ${botFilter})) as total_opens,
      SUM((SELECT COUNT(*) FROM opens WHERE pixel_id = p.id AND is_bot = 1)) as bot_opens,
      COUNT(DISTINCT CASE WHEN (SELECT COUNT(*) FROM opens WHERE pixel_id = p.id ${botFilter}) > 0 THEN p.recipient END) as recipients_opened,
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
  const includeBots = req.query.includeBots === 'true';

  let query = `
    SELECT
      o.id as open_id,
      o.opened_at,
      o.ip_address,
      o.user_agent,
      o.is_bot,
      o.bot_reason,
      p.id as pixel_id,
      p.email_id,
      p.recipient,
      p.subject,
      p.created_at as sent_at
    FROM opens o
    JOIN pixels p ON o.pixel_id = p.id
    WHERE 1=1
  `;

  const params = [];

  if (!includeBots) {
    query += ` AND o.is_bot = 0 `;
  }

  if (since) {
    query += ` AND o.opened_at > ? `;
    params.push(since);
  }

  query += ` ORDER BY o.opened_at DESC LIMIT ?`;
  params.push(limit);

  const opens = db.prepare(query).all(...params);

  // Get count of new opens since timestamp (for badge)
  let newCount = 0;
  if (since) {
    const botCondition = includeBots ? '' : 'AND is_bot = 0';
    const countResult = db.prepare(`
      SELECT COUNT(*) as count FROM opens WHERE opened_at > ? ${botCondition}
    `).get(since);
    newCount = countResult.count;
  }

  res.json({
    opens,
    newCount,
    timestamp: new Date().toISOString()
  });
});

// Simple HTML dashboard (protected)
app.get('/', requireApiKey, (req, res) => {
  const emails = db.prepare(`
    SELECT
      p.email_id,
      p.subject,
      p.recipient,
      p.created_at as sent_at,
      (SELECT COUNT(*) FROM opens WHERE pixel_id = p.id AND is_bot = 0) as open_count,
      (SELECT COUNT(*) FROM opens WHERE pixel_id = p.id AND is_bot = 1) as bot_count,
      (SELECT opened_at FROM opens WHERE pixel_id = p.id AND is_bot = 0 ORDER BY opened_at DESC LIMIT 1) as last_opened
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
    const botInfo = e.bot_count > 0 ? `<span class="badge badge-bot">${e.bot_count} bot</span>` : '';

    tableRows += `
    <tr>
      <td>${e.subject || '(no subject)'}</td>
      <td>${e.recipient}</td>
      <td>${new Date(e.sent_at).toLocaleString()}</td>
      <td>${statusBadge}</td>
      <td>${e.open_count} ${botInfo}</td>
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
    .badge-bot { background: #fef3c7; color: #92400e; margin-left: 4px; }
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
