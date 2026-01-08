# Email Tracker

Lightweight email open tracking server for [Inbox Zero](https://github.com/elie222/inbox-zero). Track when recipients open your emails with invisible tracking pixels.

## Features

- **Pixel Tracking** - 1x1 transparent GIF injected into outgoing emails
- **Per-Recipient Tracking** - Track opens for each recipient separately
- **Open History** - Records timestamp, IP address, and user agent for each open
- **REST API** - Simple API for creating pixels and querying status
- **Dashboard** - Built-in web dashboard to view tracking data
- **SQLite Storage** - Zero-config database, persists to single file
- **Docker Ready** - Deploy anywhere with Docker

## Quick Start

```bash
# Clone and install
git clone https://github.com/infinitewatts/email-tracker.git
cd email-tracker
npm install

# Configure
cp .env.example .env
# Edit .env with your settings

# Run
npm start
```

Server runs at `http://localhost:3001`

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/pixels` | POST | Create tracking pixel |
| `/api/status/:emailId` | GET | Get tracking status for an email |
| `/api/opens/:pixelId` | GET | Get all opens for a pixel |
| `/api/activity` | GET | Activity feed of recent opens |
| `/api/dashboard` | GET | Aggregated dashboard data |
| `/v1/:pixelId.gif` | GET | Tracking pixel endpoint |

All `/api/*` routes require `X-API-Key` header (except `/health` and pixel endpoint).

## Environment Variables

```env
PORT=3001                                    # Server port
TRACKER_BASE_URL=https://t.yourdomain.com   # Public URL for pixel links
API_KEY=your-secret-api-key                  # API authentication key
```

## Integration with Inbox Zero

Add to your Inbox Zero environment:

```env
EMAIL_TRACKING_ENABLED=true
EMAIL_TRACKER_API_URL=https://t.yourdomain.com
EMAIL_TRACKER_API_KEY=your-secret-api-key
NEXT_PUBLIC_EMAIL_TRACKER_URL=https://t.yourdomain.com
NEXT_PUBLIC_EMAIL_TRACKER_API_KEY=your-secret-api-key
```

## Deployment

See [SETUP.md](./SETUP.md) for detailed deployment guides:
- Docker / Docker Compose
- Cloudflare Tunnel
- VPS with nginx + Let's Encrypt

## Docker

```bash
# Using Docker Compose
docker compose up -d

# Or build manually
docker build -t email-tracker .
docker run -d -p 3001:3001 -v tracker_data:/data email-tracker
```

## How It Works

1. **Send Email** - Inbox Zero injects a tracking pixel into outgoing emails
2. **Recipient Opens** - Email client loads the invisible 1x1 GIF
3. **Track Open** - Server logs the open with timestamp and metadata
4. **View Status** - See who opened your emails in Inbox Zero or the dashboard

## License

MIT
