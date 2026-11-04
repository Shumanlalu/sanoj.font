# Sanoj Type Foundry

A complete, dependency-light type foundry storefront with a private studio admin,
UPI checkout, manual payment verification, and protected font downloads.

The frontend is hand-written HTML, CSS, and JavaScript — no build step, framework,
or bundler. The backend is Node.js + Express with SQLite via Node's built-in
`node:sqlite` module.

## Quick start

Requirements: **Node.js 22.5 or newer** (tested on Node 26) and npm.

```powershell
npm.cmd install
npm.cmd start
```

> On Windows PowerShell, use `npm.cmd` instead of `npm` if script execution is
> disabled. You can also start the server directly with `node server.js`.

Then open:

| Area | URL |
| --- | --- |
| Storefront | <http://localhost:3000> |
| Studio admin | <http://localhost:3000/admin/> |
| Checkout | <http://localhost:3000/checkout.html?order=ORDER_ID> |

The database, session secret, and folders are created automatically on first run.
The first launch also seeds six demo typefaces and the store settings.

### Open from another browser or device

On this computer, use **<http://localhost:3000>**. The server now listens on
both IPv4 and IPv6, so it also works when a browser resolves `localhost` to
`::1`.

To use a phone, tablet, or another computer on the same Wi-Fi, open the network
address printed by `npm.cmd start` (for example
`http://192.168.1.20:3000`). Keep the server window open while using the site.
If that address does not load on the other device:

- Make sure both devices are on the same Wi-Fi network (guest networks and
  campus/office Wi-Fi often block device-to-device traffic).
- Allow **Node.js JavaScript Runtime** through Windows Defender Firewall for
  private networks when Windows asks.
- Disable any VPN or proxy on the device, then try again.

For a one-click start on Windows, double-click **`Start-Sanoj.cmd`**. It starts
the server in a minimized window, shows the local and network addresses, and
opens the storefront. The local-IP address is only reachable on your own network;
it is not a public internet address.

### Demo admin credentials

```
Username: admin
Password: Sanoj@2026
```

Change the password immediately from **Settings → Studio password** after your
first sign-in. The default admin password is only used when the database has no
stored hash yet; editing `ADMIN_PASSWORD` later does not overwrite an existing
password.

### Upgrade path

For development with automatic restart:

```powershell
npm.cmd run dev
```

Optionally copy `.env.example` to `.env` and edit it. The app loads `.env`
automatically through `process.loadEnvFile`. All values are optional.

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
7. The order becomes `paid`; the customer's checkout page reveals download
   links and the server serves the font package only for paid orders.

**Important:** the default UPI address `sanoj.studio@okhdfcbank` is a placeholder.
Replace it in **Settings → UPI destination** with the real account before taking
orders. Approval is a manual financial decision — always verify the UTR against
the actual bank statement.

## Project layout

```
server.js                 Express app, APIs, checkout and download logic
src/
  config.js               Env loading, paths, defaults, session config
  database.js             SQLite schema, defaults, and demo typeface seeding
  security.js             scrypt password hashing and signed session tokens
  middleware.js           Admin auth, header checks, rate limits, CSP headers
  upi.js                  UPI deep link, payment note, QR generation
public/
  index.html              Storefront
  404.html                Not-found page
  checkout.html           Customer checkout
  admin/index.html        Studio shell and dialogs
  assets/css/             Storefront, checkout, and admin styles
  assets/js/              site.js, checkout.js, admin.js
  assets/fonts/           Locally bundled OFL display fonts
storage/fonts/            Downloadable customer font packages
data/                     SQLite database, WAL files, session secret (generated)
```

The demo products use locally bundled OFL-licensed fonts under fictional product
names. The font files in `storage/fonts` are demo packages; replace them with your
real customer packages through the admin uploader when you launch.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | Set to `production` for secure cookies and cache headers |
| `ADMIN_USER` | `admin` | Admin username |
| `ADMIN_PASSWORD` | `Sanoj@2026` | Used only when seeding the first password hash |
| `SESSION_SECRET` | generated | Stored in `data/.session-secret` when not set |
| `STORE_NAME` | `Sanoj Type Foundry` | Initial store name |

For production:

- Set `NODE_ENV=production`.
- Set a strong `SESSION_SECRET`.
- Serve over HTTPS behind a reverse proxy, and set `Host` correctly.
- Replace the default admin password and UPI address.
- Back up `data/` and `storage/fonts/`.
- Do not expose `data/` or `storage/` as static directories. Only the download
  endpoint serves paid files, after checking the order status and line item.

## Reset or recover

The database lives at `data/sanoj.db` (with `-wal`/`-shm` companions). To reset the
entire demo — including orders, fonts, and settings — stop the server, delete those
three files, and start again. The default admin password and demo fonts are
re-seeded on the next boot.

To reset only the admin password from a terminal (with the server stopped):

```powershell
node -e "const { setSetting } = require('./src/database'); const { hashPassword } = require('./src/security'); setSetting('admin_password_hash', hashPassword('YourNewPassword')); console.log('Admin password updated');"
```

## Security notes

- Passwords are stored as scrypt hashes with per-user salts.
- Admin sessions are HMAC-signed, HttpOnly, SameSite=Strict cookies with an
  8-hour lifetime.
- Every protected admin API requires both a valid session and the
  `X-Sanoj-Admin: 1` request header (and a same-host `Origin` when supplied).
- Login, order creation, and UTR submission are rate limited in memory.
- Uploaded packages are limited to 10 MB and checked by extension and magic
  bytes (WOFF2, WOFF, TTF, OTF, ZIP).
- A strict Content-Security-Policy blocks inline scripts and third-party script
  sources. Inline styles are allowed for the dynamic specimen cards.
- Download links are not public; the server verifies a paid order and that the
  requested font is part of that order before streaming the file.

## Checks

```powershell
npm.cmd run check
```

This runs `node --check` over the server and all three browser scripts.
