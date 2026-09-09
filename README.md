# Masjid Ar-Rahman website

An owner-controlled, mobile-responsive website for Masjid Ar-Rahman and the Nigerian Islamic Society of Massachusetts (NISLAM). It includes:

- Homepage, daily prayer times, announcements, programs, donations, contact details, Google Maps link, and NISLAM social links.
- A protected `/admin` dashboard for content, donation links, social accounts, contact information, location, and announcements.
- Live prayer times from AlAdhan after the precise city is set in the dashboard.
- Secure outbound donation-link support: payments occur only on the masjid's own Stripe, PayPal, or Donorbox payment page; the website never receives card data.
- No framework or paid platform lock-in. The masjid owns and can transfer every file in this folder.

## Important before publishing

The supplied letterhead contained the logo and NISLAM/Massachusetts identity, but no readable full street address, public phone number, email address, or official social-media URLs. Those fields intentionally remain incomplete rather than inventing contact details. Add them through the dashboard before public launch. Also confirm the precise city or coordinates: the default `Massachusetts, United States` setting deliberately shows a draft schedule instead of claiming it is live.

## Start locally

Use Node.js 20 or later.

```powershell
cd "C:\Users\PC\Documents\Codex\2026-09-07\files-mentioned-by-the-user-sodiq\outputs\masjid-ar-rahman-website"
cd C:\path\to\masjid-ar-rahman-website
npm run setup-admin -- masjid-admin "choose-a-long-unique-password"
npm start
```

Open [http://localhost:3000](http://localhost:3000) for the website and [http://localhost:3000/admin](http://localhost:3000/admin) for the dashboard. The admin HTML is stored outside `public/` and is served only by the `/admin` server route. `setup-admin` stores the username and salted password hash in `.env`; this local file is excluded from Git.

## Publish checklist

1. Register the domain directly in the masjid's legal name and retain the registrar login, recovery email, and MFA codes under masjid custody.
2. Host this folder in a masjid-owned hosting account and enable HTTPS. Set the host's startup command to `npm start`; use its assigned `PORT` environment variable if required.
3. Run `npm run setup-admin -- <username> <long-password>` only on the host. It writes the salted login hash to `.env`, which must remain private and uncommitted; save the original credentials in the masjid's password manager.
4. In `/admin`, add the exact address, public phone, email, maps link, city/country, current programs, social URLs, and charity-owned donation links.
5. Test every donation button in a private browser window. Confirm the receiving account belongs to the masjid and its payment provider displays HTTPS.
6. Give at least two masjid officers full registrar, host, source-code, dashboard, and payment-provider access. Keep a copy of this folder and a dashboard JSON export in masjid-controlled storage.

## Maintenance terms template

Use the following as a starting point in a separate agreement with any maintainer:

> Monthly maintenance covers server and dependency updates, uptime checks, backups, and up to one hour of routine content support. New pages, custom integrations, payment-provider changes, redesigns, and emergency work are separately quoted and require written approval. The masjid retains all accounts, credentials, domain, hosting, design files, source code, content, and unrestricted transfer rights at all times.

## Technical notes

- Content is stored in `data/site.json`; the dashboard writes updates atomically to that file. Download a JSON backup from the dashboard after important changes.
- If a save fails after a file-sync or antivirus scan, restart the website server and retry. The server falls back to a direct write if Windows temporarily blocks the atomic file replacement.
- Login sessions are memory-only and expire after eight hours. Restarting the server signs admins out.
- `.env` and all environment variants are ignored by Git, except the comment-only `.env.example` template. Existing `data/admin.json` installations remain supported temporarily; rerun `npm run setup-admin -- <username> <long-password>` to migrate the active credentials to `.env`.
- The dashboard permits a selected trusted administrator to publish text and public URLs. It rejects script tags and `javascript:` links; however, normal operational review of public content is still important.
- AlAdhan provides calculated salah times, not local iqamah times. Use the public note field to clarify any masjid-specific iqamah schedule.
- For high-traffic or multi-admin operation, keep the same front end but move `data/site.json` and session storage to a masjid-owned database and add audited role-based accounts.
