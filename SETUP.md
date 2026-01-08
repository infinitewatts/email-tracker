# Email Tracker Setup Guide

## Quick Start (Local Development)

```bash
cd /Users/Eric/Projects/email-tracker
npm start
```

Server runs at http://localhost:3001

---

## Production Setup: Cloudflare Tunnel (Recommended)

The easiest way to expose your tracker with a custom domain and HTTPS.

### Step 1: Install cloudflared

```bash
# macOS
brew install cloudflare/cloudflare/cloudflared

# Or download from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
```

### Step 2: Authenticate with Cloudflare

```bash
cloudflared tunnel login
```

This opens a browser to authorize access to your Cloudflare account.

### Step 3: Create the Tunnel

```bash
cloudflared tunnel create email-tracker
```

Save the tunnel ID and credentials file path shown.

### Step 4: Configure DNS

In Cloudflare dashboard, add a CNAME record:
- **Name**: `t` (for t.affordablesolar.io)
- **Target**: `<tunnel-id>.cfargotunnel.com`
- **Proxy status**: Proxied (orange cloud)

Or use CLI:
```bash
cloudflared tunnel route dns email-tracker t.affordablesolar.io
```

### Step 5: Create Config File

```bash
mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml << 'EOF'
tunnel: <your-tunnel-id>
credentials-file: /Users/Eric/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: t.affordablesolar.io
    service: http://localhost:3001
  - service: http_status:404
EOF
```

### Step 6: Start the Tunnel

```bash
# Start tracker server in one terminal
cd /Users/Eric/Projects/email-tracker && npm start

# Start tunnel in another terminal
cloudflared tunnel run email-tracker
```

### Step 7: Run as Service (Optional)

```bash
# Install as macOS service
sudo cloudflared service install

# Start service
sudo launchctl start com.cloudflare.cloudflared
```

---

## Production Setup: VPS + nginx

For traditional server deployment.

### Step 1: Deploy to VPS

```bash
# On your VPS
git clone <your-repo> /opt/email-tracker
cd /opt/email-tracker
npm install --production
```

### Step 2: Create systemd Service

```bash
sudo cat > /etc/systemd/system/email-tracker.service << 'EOF'
[Unit]
Description=Email Tracker Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/email-tracker
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
Environment=PORT=3001
Environment=TRACKER_BASE_URL=https://t.affordablesolar.io

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable email-tracker
sudo systemctl start email-tracker
```

### Step 3: Configure nginx

```nginx
# /etc/nginx/sites-available/tracker
server {
    listen 80;
    server_name t.affordablesolar.io;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name t.affordablesolar.io;

    ssl_certificate /etc/letsencrypt/live/t.affordablesolar.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/t.affordablesolar.io/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Step 4: Get SSL Certificate

```bash
sudo certbot --nginx -d t.affordablesolar.io
```

---

## Production Setup: Docker

```bash
cd /Users/Eric/Projects/email-tracker

# Build and start
docker compose up -d

# View logs
docker compose logs -f
```

---

## Update Inbox Zero Environment

Add to your Inbox Zero `.env`:

```bash
EMAIL_TRACKING_ENABLED=true
EMAIL_TRACKER_API_URL=https://t.affordablesolar.io
```

---

## Test the Setup

```bash
# Test health endpoint
curl https://t.affordablesolar.io/health

# Create a test pixel
curl -X POST https://t.affordablesolar.io/api/pixels \
  -H "Content-Type: application/json" \
  -d '{"emailId": "test-123", "recipient": "test@example.com", "subject": "Test Email"}'

# Open the pixel URL in browser to test tracking
# Then check dashboard at https://t.affordablesolar.io/
```

---

## Verify End-to-End

1. Start Inbox Zero with tracking enabled
2. Send a test email
3. Check the tracker dashboard for the new entry
4. Open the email (or view HTML source and load pixel URL)
5. Refresh dashboard - should show "Opened" status
