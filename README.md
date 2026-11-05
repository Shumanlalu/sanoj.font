# Sanoj Type Foundry

A complete type-foundry storefront with a private studio admin, UPI checkout,
manual payment verification, and protected font downloads.

The frontend is hand-written HTML, CSS, and JavaScript — no build step, framework,
or bundler. The backend is Node.js + Express, backed by **Supabase PostgreSQL**
for data and **private Supabase Storage** for font packages. The app is stateless
and deploys to Vercel without local file writes.

## Architecture

| Layer | Local development | Production (Vercel) |
| --- | --- | --- |
| Storefront / admin / checkout | Express + static files | Vercel CDN + one Express function |
| Database | Supabase PostgreSQL | Supabase PostgreSQL (transaction pooler) |
| Font packages | Private Supabase Storage bucket | Private Supabase Storage bucket |
| Paid downloads | Short-lived signed Supabase URLs | Short-lived signed Supabase URLs |
| Admin sessions | Signed HttpOnly cookie | Signed HttpOnly cookie |

There is no SQLite database, no `data/` directory, and no uploaded file ever
touches the server's disk. That removes the `ENOENT` failures caused by Vercel's
read-only, ephemeral filesystem.

## Quick start

Requirements: **Node.js 22 or newer**, npm, and a free
[Supabase](https://supabase.com/dashboard) project.

### 1. Create the Supabase project

1. Create a project at <https://supabase.com/dashboard>.
2. Open **Project Settings → Database → Connection string** and copy the
   **Supavisor transaction pooler** string (port `6543`). It looks like:
   `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`
3. Open **Project Settings → API** and copy the **Project URL** and the
   **service_role** key.

The service role key is a server-side secret. Never put it in frontend code,
commit it, or expose it to a browser.

### 2. Configure the environment

```powershell
Copy-Item .env.example .env
```

Edit `.env` and fill in:

```dotenv
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SESSION_SECRET=<a-long-random-string>
```

Generate a session secret with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

### 3. Initialize Supabase

```powershell
npm.cmd install
npm.cmd run setup:supabase
```

This creates the PostgreSQL schema, seeds the six demo typefaces and store
settings, creates the private `sanoj-fonts` bucket, and uploads the demo font
packages. It is safe to run again; existing rows and files are skipped.

### 4. Start locally

```powershell
npm.cmd start
```

| Area | URL |
| --- | --- |
| Storefront | <http://localhost:3000> |
| Studio admin | <http://localhost:3000/admin/> |
| Checkout | <http://localhost:3000/checkout.html?order=ORDER_ID> |

For automatic restart during development:

```powershell
npm.cmd run dev
```

On Windows you can also double-click **`Start-Sanoj.cmd`**. It checks the cloud
configuration, starts the server in a minimized window, prints the local and
LAN addresses, and opens the storefront.

### Demo admin credentials

```
Username: admin
Password: Sanoj@2026
```

Change the password immediately from **Settings → Studio password** after your
first sign-in. The default password is only used when the database has no stored
hash yet; editing `ADMIN_PASSWORD` later does not overwrite an existing password.

## Local network access

The server listens on both IPv4 and IPv6, so `localhost` works whether the
browser resolves it to `127.0.0.1` or `::1`. To use a phone, tablet, or another
computer on the same Wi-Fi, open the network address printed at startup (for
example `http://192.168.1.20:3000`).

If another device cannot connect:

- Make sure both devices are on the same Wi-Fi network. Guest networks and
  campus/office Wi-Fi often block device-to-device traffic.
- Allow **Node.js JavaScript Runtime** through Windows Defender Firewall for
  private networks.
- Disable any VPN or proxy on the device and try again.

**This local address is not an always-on public link.** It only works while this
computer is switched on and the Node server is running. Shutting the computer
down — or closing the minimized server window — takes the site offline. For a
link that stays available 24/7, deploy to Vercel as described below.

## Deploy to Vercel

Vercel detects the Express app exported from `server.js` with zero
configuration. Static pages and assets in `public/` are served from Vercel's
CDN; API routes, checkout, and admin authentication run in one serverless
function.

### Option A — deploy from Git

1. Push this repository to GitHub, GitLab, or Bitbucket.
2. Import it at <https://vercel.com/new>.
3. Add the environment variables from `.env` under
   **Project → Settings → Environment Variables**:
   - `DATABASE_URL`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SESSION_SECRET`
   - `SUPABASE_BUCKET` (optional, defaults to `sanoj-fonts`)
   - `MAX_FONT_UPLOAD_MB` (optional, defaults to `4` on Vercel)
4. Deploy. `NODE_ENV=production` is set automatically by Vercel.

### Option B — deploy with the Vercel CLI

```powershell
npm.cmd install -g vercel
vercel login
vercel link
```

Add the variables in the Vercel dashboard (or with `vercel env add`), then:

```powershell
vercel --prod
```

To pull the deployed environment into a local `.env`:

```powershell
vercel env pull .env
```

### After the first deployment

1. Open `https://<your-project>.vercel.app/admin/`.
2. Sign in with the seeded admin account.
3. Change the admin password.
4. Replace the placeholder UPI address in **Settings → UPI destination**.
5. Update the support email, phone, and Instagram handle.

`SESSION_SECRET` is required in production. The app refuses to start without it
so admin sessions cannot accidentally be signed with a temporary key.

### Vercel limits to know

- **Request body size:** Vercel Functions reject request bodies above roughly
  **4.5 MB**. The admin uploader defaults to 4 MB on Vercel
  (`MAX_FONT_UPLOAD_MB=4`). Larger packages must be uploaded from a local server
  or through Supabase Storage directly. A future direct-to-Supabase upload flow
  would remove this limit.
- **Function duration:** ordinary API calls finish quickly; database and storage
  calls are the only external work.
- **Static files:** Vercel serves `public/` itself. `express.static()` is only
  used for local development.

## What is included

### Storefront

- Animated 3D hero with layered type specimens and a kinetic ticker.
- Six seeded typefaces with live specimen modals, category filters, and an
  interactive Type Lab.
- Persistent cart, quick view, quantity-free digital checkout, and responsive
  layouts.
- UPI checkout with QR code, UPI intent deep link, copyable UPI ID, UTR
  submission, and live order-status polling.
- Paid orders unlock per-font download links.
- Dedicated 404 page.

### Studio admin

- Signed-cookie login with rate limiting and a show/hide password control.
- Overview dashboard: lifetime revenue, order counts, review queue, 14-day
  revenue chart, top sellers, and recent orders.
- Type library: create and edit font metadata, upload a font package, set card
  colors and specimen face, publish/unpublish, delete, and see download counts.
- Orders: filter by status, search by customer/email/order ID/UTR, inspect full
  order details, copy the UTR, save an internal note, approve, reject, cancel,
  or reopen orders.
- Settings: store profile, support details, ticker announcement, license note,
  UPI destination with live preview, and password changes.
- Fully responsive shell with a mobile drawer and native modal dialogs.

### Payment flow

There is no payment gateway integration and no automatic verification. The flow
is intentionally direct:

1. Customer adds typefaces to the bag and enters name, email, and phone.
2. The server creates a `pending` order and checkout page.
3. Customer scans the generated UPI QR (or opens the UPI intent) and pays.
4. Customer submits the UPI reference/UTR from their payment app.
5. Order moves to `review` and appears in the admin review queue.
6. Admin matches the UTR against their bank/UPI app and approves the payment.
7. The order becomes `paid`; the checkout page reveals download links. The
   download endpoint verifies the paid order, then redirects to a short-lived
   signed Supabase Storage URL.

**Important:** the default UPI address `sanoj.studio@okhdfcbank` is a placeholder.
Replace it in **Settings → UPI destination** with the real account before taking
orders. Approval is a manual financial decision — always verify the UTR against
the actual bank statement.

## Project layout

```
server.js                 Express app, APIs, checkout and download logic
vercel.json               Vercel headers, admin/checkout rewrites
src/
  config.js               Environment loading, defaults, session and upload config
  database.js             PostgreSQL schema, defaults, demo seeding, transactions
  storage.js              Supabase Storage bucket, uploads, signed downloads
  security.js             scrypt password hashing and signed session tokens
  middleware.js           Admin auth, header checks, rate limits, CSP headers
  upi.js                  UPI deep link, payment note, QR generation
scripts/
  setup-supabase.js       One-time schema, bucket, and demo upload setup
  start-sanoj.ps1         Windows launcher with cloud-env validation
public/
  index.html              Storefront
  404.html                Not-found page
  checkout.html           Customer checkout
  admin/index.html        Studio shell and dialogs
  assets/css/             Storefront, checkout, and admin styles
  assets/js/              site.js, checkout.js, admin.js
  assets/fonts/           Locally bundled OFL display fonts
storage/fonts/            Demo font packages uploaded by setup-supabase.js
```

The demo products use locally bundled OFL-licensed fonts under fictional product
names. The files in `storage/fonts` are demo packages; replace them with real
customer packages through the admin uploader when you launch.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | Local HTTP port |
| `HOST` | `::` | Local bind address; Vercel ignores it |
| `NODE_ENV` | `development` | Set automatically to `production` on Vercel |
| `ADMIN_USER` | `admin` | Admin username |
| `ADMIN_PASSWORD` | `Sanoj@2026` | Used only when seeding the first password hash |
| `SESSION_SECRET` | generated locally | **Required** in production |
| `STORE_NAME` | `Sanoj Type Foundry` | Initial store name |
| `DATABASE_URL` | — | Supabase PostgreSQL connection string |
| `DATABASE_SSL` | `true` | Set `false` only for a local PostgreSQL server |
| `SUPABASE_URL` | — | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Server-only service role key |
| `SUPABASE_BUCKET` | `sanoj-fonts` | Private storage bucket name |
| `SUPABASE_SIGNED_URL_TTL` | `60` | Signed download lifetime in seconds |
| `MAX_FONT_UPLOAD_MB` | `4` on Vercel, `10` locally | Upload size limit |

## Reset or recover

### Reset orders and demo catalogue

Run this in the Supabase SQL Editor:

```sql
TRUNCATE TABLE order_items, orders RESTART IDENTITY CASCADE;
DELETE FROM fonts;
```

Restart the app afterwards; the six demo fonts are seeded again. Settings and
the admin password are preserved.

### Reset the admin password

With the server stopped and `.env` configured:

```powershell
node -e "const { setSetting, getPool } = require('./src/database'); const { hashPassword } = require('./src/security'); (async () => { await setSetting('admin_password_hash', hashPassword('YourNewPassword')); await getPool().end(); console.log('Admin password updated'); })().catch((error) => { console.error(error.message); process.exit(1); });"
```

### Re-upload demo font packages

```powershell
npm.cmd run setup:supabase -- --force
```

## Security notes

- Passwords are stored as scrypt hashes with per-user salts.
- Admin sessions are HMAC-signed, HttpOnly, SameSite=Strict cookies with an
  8-hour lifetime and `Secure` enabled in production.
- Every protected admin API requires both a valid session and the
  `X-Sanoj-Admin: 1` request header (and a same-host `Origin` when supplied).
- Login, order creation, and UTR submission are rate limited in memory. On
  serverless, each instance keeps its own counters, so the limits are best-effort
  rather than global.
- Uploaded packages are checked by extension and magic bytes (WOFF2, WOFF, TTF,
  OTF, ZIP) before being sent to Supabase Storage.
- The storage bucket is private. Downloads use short-lived signed URLs generated
  only after the server verifies a paid order and matching line item.
- A strict Content-Security-Policy blocks inline scripts and third-party script
  sources. Inline styles are allowed for the dynamic specimen cards. Vercel
  applies the same policy to CDN-served HTML through `vercel.json`.
- The service role key bypasses Row Level Security. It is used only in the
  server process and must never reach the browser.

## Checks

```powershell
npm.cmd run check
```

This runs `node --check` over the server, all `src/` modules, the Supabase setup
script, and the three browser scripts.

## Troubleshooting

**`Supabase is not configured yet`**
Fill in `.env` from `.env.example`, then run `npm.cmd run setup:supabase`.

**`SESSION_SECRET is required in production`**
Add a long random `SESSION_SECRET` to the Vercel environment variables and
redeploy.

**`DATABASE_URL is not configured` / connection timeouts**
Use the Supavisor transaction pooler string on port `6543` for Vercel. The direct
connection on port `5432` may be IPv6-only or exhaust connections in serverless
functions.

**`Font upload failed` or `The font download could not be prepared`**
Confirm `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_BUCKET` are
correct, and that `npm.cmd run setup:supabase` created the bucket.

**Uploads fail with `413` on Vercel**
The function request-body limit is about 4.5 MB. Keep `MAX_FONT_UPLOAD_MB=4` or
lower. Upload larger packages from a local server.

**The site works locally but not from another device**
See [Local network access](#local-network-access). The local address is only
reachable on the same network and only while the server is running.

**The site is offline after shutting down the computer**
That is expected for the local link. Deploy to Vercel for a 24/7 public URL.
