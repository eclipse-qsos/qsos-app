# Installing QSOS on a YunoHost server

This guide explains how to deploy the QSOS web application on a VPS running [YunoHost](https://yunohost.org), exposed on its own subdomain (for example `app.qsos.org`) with a Let's Encrypt certificate.

The app is a Nuxt 4 server-rendered application. It builds into a standalone Node.js server (`.output/server/index.mjs`) and keeps its content as JSON files in a `data/` folder next to where it is started. YunoHost handles the domain, the HTTPS certificate and the nginx reverse proxy. The app itself runs as a systemd service.

```
Browser ──HTTPS──▶ YunoHost nginx (app.qsos.org) ──HTTP──▶ 127.0.0.1:3080 (Node / QSOS)
```

Throughout this guide, replace:

| Placeholder | Meaning |
|---|---|
| `app.qsos.org` | The subdomain you deploy to |
| `<user>` | The Linux user on the VPS that owns and runs the app |
| `/home/<user>/dev/qsos-app` | Where the repository is cloned on the VPS |
| `3080` | The local port the app listens on |

## Prerequisites

- A VPS running YunoHost (Debian based), reachable over SSH with a sudo-capable user.
- Control over the DNS zone of the parent domain (`qsos.org`).
- A GitHub and/or GitLab account to register the OAuth applications used for login.

---

## 1. DNS: create the subdomain record

Only one new record is needed. Leave the existing records of the parent domain (landing page, `www`, mail, and so on) untouched.

Find the VPS's public IP addresses (also shown in the YunoHost admin under **Diagnosis → Internet connectivity**):

```bash
ip -4 addr show scope global | grep inet
ip -6 addr show scope global | grep inet6
```

Add these records with your DNS provider:

| Type | Name | Value | TTL |
|---|---|---|---|
| `A` | `app` | VPS IPv4 | 3600 |
| `AAAA` | `app` | VPS IPv6 (only if IPv6 really works) | 3600 |

A `CNAME` pointing `app` to the VPS hostname works too.

Check for things that can block certificate issuance:

- **CAA records:** if the parent domain has any, one must allow `letsencrypt.org`.
- **Proxying DNS (Cloudflare and similar):** set the `app` record to *DNS only*.
- **A wrong `AAAA` record** breaks Let's Encrypt validation. Remove it if the VPS has no working IPv6.

Check that the record has propagated:

```bash
dig +short app.qsos.org A
dig +short app.qsos.org AAAA
```

## 2. YunoHost: add the domain and certificate

In the web admin go to **Domains → Add domain** → `app.qsos.org`, or from the command line:

```bash
sudo yunohost domain add app.qsos.org
```

A new domain starts with a self-signed certificate. Once DNS resolves to the VPS, replace it with a Let's Encrypt certificate. A trusted certificate is required for browsers and for OAuth login.

```bash
sudo yunohost domain cert install app.qsos.org
sudo yunohost domain cert status app.qsos.org
```

YunoHost will suggest mail and XMPP DNS records (MX, SPF, DKIM, DMARC, and so on) for the new domain. The app doesn't need them. To silence the diagnosis warnings, disable mail and XMPP for this domain under **Domains → app.qsos.org → Configuration**. Do not let YunoHost manage the parent domain's records.

> Do **not** install certbot or edit files in `/etc/nginx/sites-enabled`. YunoHost manages nginx and certificates itself.

## 3. Install the system dependencies

```bash
sudo apt install -y git build-essential python3
```

`build-essential` and `python3` are needed to compile the native modules (`sharp`, `sqlite3`).

> Do not open the app's port in the firewall. Only YunoHost's nginx talks to it, locally.

## 4. Install a private Node.js 22

Nuxt 4 requires Node.js 20 or later. To avoid clashing with the Node versions that YunoHost apps install for themselves, don't add the NodeSource repository system-wide. Install a standalone copy instead:

```bash
cd /tmp
curl -fsSLO https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt
TARBALL=$(grep linux-x64.tar.xz SHASUMS256.txt | awk '{print $2}')
curl -fsSLO https://nodejs.org/dist/latest-v22.x/$TARBALL
sha256sum -c --ignore-missing SHASUMS256.txt
sudo mkdir -p /opt/node22
sudo tar -xJf "$TARBALL" -C /opt/node22 --strip-components=1

echo 'export PATH=/opt/node22/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
node -v && npm -v
```

## 5. Get the code

```bash
mkdir -p /home/<user>/dev
git clone https://github.com/qsos-org/qsos.git /home/<user>/dev/qsos-app
cd /home/<user>/dev/qsos-app
```

## 6. Configure the environment

```bash
cp .env.example .env
openssl rand -base64 48   # use the output as NUXT_SESSION_PASSWORD
nano .env
chmod 600 .env
```

| Variable | Description |
|---|---|
| `NUXT_SESSION_PASSWORD` | Secret of at least 32 characters used to encrypt session cookies |
| `NUXT_OAUTH_GITHUB_CLIENT_ID` / `_SECRET` | GitHub OAuth app credentials (see [step 11](#11-register-the-oauth-applications)) |
| `NUXT_OAUTH_GITLAB_CLIENT_ID` / `_SECRET` | GitLab OAuth app credentials |
| `DOCS_SERVER_PORT` | Port of the optional documentation server (default `3001`) |

The app runs without the OAuth values (login is simply unavailable), so you can fill them in later.

> `nuxt.config.ts` reads some of these variables **at build time**. Keep `.env` in place when building, and rebuild after changing it.

## 7. Provide the data folder

`data/` is git-ignored, so a fresh clone doesn't have it. Either copy an existing data set from another machine:

```bash
# run from the machine that has the data
rsync -avz ./data/ <user>@<vps>:/home/<user>/dev/qsos-app/data/
```

or start empty. The app creates `data/` on first start, and you can fetch the SPDX license list with:

```bash
npm run update-licenses
```

## 8. Install dependencies and build

```bash
cd /home/<user>/dev/qsos-app
npm ci
npm run build
```

The build runs a TypeScript type check and produces `.output/`. On small VPSes the build can run out of memory. If it does, add swap or raise Node's memory limit, for example `NODE_OPTIONS=--max-old-space-size=2048 npm run build`.

## 9. Run the app as a systemd service

Make sure the chosen port is free (this command should print nothing):

```bash
sudo ss -ltnp | grep :3080
```

Create `/etc/systemd/system/qsos.service`:

```ini
[Unit]
Description=QSOS app
After=network.target

[Service]
User=<user>
WorkingDirectory=/home/<user>/dev/qsos-app
EnvironmentFile=/home/<user>/dev/qsos-app/.env
Environment=NODE_ENV=production HOST=127.0.0.1 PORT=3080
Environment=PATH=/opt/node22/bin:/usr/bin:/bin
ExecStart=/opt/node22/bin/node .output/server/index.mjs
Restart=always

[Install]
WantedBy=multi-user.target
```

`WorkingDirectory` matters: the app looks for `data/` relative to it.

Start it and check that it responds:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now qsos
sudo systemctl status qsos
curl -I http://127.0.0.1:3080   # expect HTTP/1.1 200
```

Optionally, register the service with YunoHost so it appears in the admin's service list and diagnosis:

```bash
sudo yunohost service add qsos --description "QSOS app"
```

## 10. Expose the app with the YunoHost "Redirect" app

The official **Redirect** app can act as a reverse proxy, and YunoHost keeps the nginx configuration up to date for it.

In the web admin go to **Applications → Install → Redirect** and set:

- **Domain:** `app.qsos.org`, **path:** `/` (the app must be served at the root of its domain)
- **Target:** `http://127.0.0.1:3080`
- **Type:** public reverse proxy

The app must be **public**. Otherwise YunoHost's single sign-on (SSOwat) shows its login page to visitors and can break the OAuth callbacks.

Open `https://app.qsos.org`. It should load with a valid certificate.

## 11. Register the OAuth applications

Users sign in with GitHub or GitLab. Each provider needs an OAuth application. Its owner is just the account that administers the app's credentials. It does not make users log in as that account, and it grants no access to the owner's repositories.

### GitHub

**Settings → Developer settings → OAuth Apps → New OAuth App**:

- **Application name:** `QSOS` (shown to users on the consent screen)
- **Homepage URL:** `https://app.qsos.org`
- **Authorization callback URL:** `https://app.qsos.org/auth/github`

### GitLab

**User settings → Applications** (or a group's settings):

- **Redirect URI:** `https://app.qsos.org/auth/gitlab`
- **Scopes:** `read_user`

Copy the client IDs and secrets into `.env`, then rebuild and restart:

```bash
npm run build && sudo systemctl restart qsos
```

### Tips

- A GitHub OAuth app has a single callback URL. Create **separate apps** for production (`https://app.qsos.org/...`) and local development (`http://localhost:3000/...`), each with its own credentials.
- Enable two-factor authentication on the account that owns the OAuth apps.

### Ownership: personal account now, organization later

The OAuth apps should ideally belong to the project's organization rather than to an individual. Only an organization owner can create OAuth apps under an organization, so this may require help from whoever administers the organization.

A practical path:

1. Create the apps under a maintainer's personal account to get the deployment running.
2. Later, move them to the organization, in one of two ways:
   - **Transfer:** in the GitHub OAuth app settings use **Transfer ownership**. An organization owner may need to approve it. The client ID is kept; generate a new secret afterwards, update `.env`, rebuild and restart.
   - **Recreate:** an organization owner creates a new app with the same callback URL. Put the new credentials in `.env`, rebuild and restart. Users only see the consent screen again at their next login, and their data in the app is not affected.

## 12. Optional: the documentation site (`/docs`)

The main app forwards `/docs` to a separate Docus site on `DOCS_SERVER_PORT` (default `3001`). To serve it:

```bash
cd /home/<user>/dev/qsos-app/docs
npm ci
npm run build
```

Then create a second service (for example `qsos-docs.service`) identical to the one in step 9, but with `WorkingDirectory=/home/<user>/dev/qsos-app/docs` and `PORT=3001`. Without it, `/docs` returns a gateway error and the rest of the app works normally.

## 13. Updating

```bash
cd /home/<user>/dev/qsos-app
git pull
npm ci
npm run build
sudo systemctl restart qsos
```

## 14. Backups

All content lives in `data/`. Because the app is not installed as a YunoHost package, **YunoHost's own backups (`yunohost backup create`) do not include it**. Back it up yourself, for example with a nightly cron job:

```bash
# crontab -e
0 3 * * * tar -czf /home/<user>/backups/qsos-data-$(date +\%F).tar.gz -C /home/<user>/dev/qsos-app data
```

Keep a copy off the server as well.

## Troubleshooting

| Symptom | Things to check |
|---|---|
| Certificate install fails | `dig` returns the VPS IP; port 80 reachable; no blocking CAA record; no wrong `AAAA` record; DNS proxying disabled |
| 502 Bad Gateway on `app.qsos.org` | `systemctl status qsos`, `curl -I http://127.0.0.1:3080`, the Redirect app's target port matches `PORT` |
| YunoHost login page instead of the app | The Redirect app is not public. Set it to *public reverse proxy* or grant the *visitors* group access |
| OAuth error "redirect_uri mismatch" | The callback URL in the provider settings is exactly `https://app.qsos.org/auth/<provider>` |
| Changes to `.env` are ignored | Rebuild (`npm run build`) and restart the service |
| Build killed / out of memory | Add swap or set `NODE_OPTIONS=--max-old-space-size=2048` |

Logs:

```bash
journalctl -u qsos -f
```
