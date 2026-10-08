# Grateful & Grounded Kids

Website for Doug's Grateful & Grounded Kids — workshops, speaking, and consulting for families raising grateful and grounded kids in an age of entitlement.

**Live site:** https://gratefulgroundedkids.com
**Admin dashboard:** https://admin.gratefulgroundedkids.com (also at `/admin/` on the main site)

This file is kept out of the published site (see `functions/_middleware.js`).

## Tech Stack

- **Frontend:** Plain HTML / CSS / JavaScript (no framework, no build step)
- **Hosting:** Cloudflare Pages (auto-deploys from GitHub on push to `main`)
- **Contact form:** Cloudflare Pages Function → saves the lead in Supabase → emails through Resend
- **Database and sign-in:** Supabase (leads, lead history, admin accounts)
- **Admin dashboard:** plain HTML / CSS / JavaScript in `admin/`, reading Supabase from the browser
- **Email:** Resend, sending from `noreply@gratefulgroundedkids.com`
- **Domain email:** Google Workspace (doug@gratefulgroundedkids.com)

## Project Structure

```
gratefulgroundedkids/
├── index.html              # Home page
├── workshop.html           # Workshop details
├── services.html           # Seminars, sessions, consulting
├── resources.html          # Downloadable docs + book recs
├── connect.html            # Contact form
├── 404.html                # Not-found page (without it, Cloudflare serves the home page for missing URLs)
├── css/
│   └── style.css           # Full design system
├── js/
│   ├── main.js             # Nav, scroll, tabs, mobile menu, hero video
│   └── form.js             # Contact form validation + submission
├── assets/
│   ├── images/             # Logo, photos, icons
│   └── docs/               # Downloadable documents
├── admin/
│   ├── index.html          # Dashboard: sign-in, pipeline, submissions, lead history
│   ├── admin.css
│   └── admin.js
├── functions/
│   ├── _middleware.js      # Hides repo-only files; admin subdomain opens the dashboard
│   └── api/
│       ├── contact.js      # Saves a submission as a lead, then sends both emails
│       └── admin-config.js # Tells the dashboard which Supabase project to use
├── supabase/
│   └── schema.sql          # Database setup: run once in the Supabase SQL Editor
├── _routes.json            # Which addresses run a function (everything else is a plain file)
├── _headers                # Cloudflare security and cache headers
├── _redirects
├── site.webmanifest
└── originals/              # Full-size source images; on this Mac only, not in the repo
```

## How a submission flows

1. A visitor sends the form on `/connect`. `js/form.js` posts it to `/api/contact`.
2. `functions/api/contact.js` checks it, drops it silently if the hidden spam-trap field is filled, and saves it to the `leads` table.
3. It sends two emails through Resend: an alert to `NOTIFICATION_EMAIL` (replying to it replies to the visitor) and a thank-you to the visitor (replying to it reaches Doug).
4. It records on the lead whether each email went out.
5. The lead appears under **New** in the dashboard.

If Supabase is down or not set up, the emails still go. If email fails, the lead is still saved. The visitor sees an error only when both fail.

## Variables (Cloudflare → Workers & Pages → gratefulgroundedkids → Settings → Variables and Secrets)

| Name | Type | What it is |
| --- | --- | --- |
| `RESEND_API_KEY` | Secret | Resend API key |
| `NOTIFICATION_EMAIL` | Text | Where new-lead alerts go. Several addresses may be separated by commas. |
| `SUPABASE_URL` | Text | Project URL, like `https://xxxx.supabase.co`. Pasting it with `/rest/v1` on the end also works. |
| `SUPABASE_PUBLISHABLE_KEY` | Text | Supabase publishable (anon) key. Public by design. |
| `SUPABASE_SECRET_KEY` | Secret | Supabase secret (service role) key. Never put this anywhere else. |
| `ADMIN_URL` | Text, optional | Dashboard address used in alert emails. Defaults to `https://admin.gratefulgroundedkids.com`. |

Variables only apply to new deployments: after changing one, retry the latest deployment or push.

## Setting up the dashboard

1. **Supabase project:** create one for this site.
2. **Database:** in the SQL Editor, paste all of `supabase/schema.sql` and run it.
3. **Admin account:** Authentication → Users → Add user → Create new user, with "Auto Confirm User" ticked. Then run the three-line `insert` at the bottom of `schema.sql` with that email.
4. **Variables:** add the three `SUPABASE_` values above in Cloudflare and redeploy.
5. **Subdomain:** in the Cloudflare Pages project → Custom domains, add `admin.gratefulgroundedkids.com`.
6. **Password-reset links:** in Supabase → Authentication → URL Configuration, set Site URL to `https://admin.gratefulgroundedkids.com` and add `https://admin.gratefulgroundedkids.com/**` and `https://gratefulgroundedkids.com/admin/**` to Redirect URLs. Without this, reset emails send people to `localhost`.

To give someone else access, repeat step 3 for their email.

## Security notes

- The dashboard's HTML and JavaScript are public, like any web page. The data is not: Supabase only returns leads to a signed-in account that has the `admin` role (`supabase/schema.sql`, row-level security).
- Visitors never talk to Supabase. Only the server function writes leads, using the secret key.
- Everything a visitor types is escaped before it goes into an email, and added to the dashboard as text, never as HTML.

## Design

- **Palette:** Deep Roots (forest green + amber + linen)
- **Primary:** `#243D10` (Canopy) / `#4A7C2F` (Grove)
- **Accent:** `#C47B2B` (Harvest amber)
- **Background:** `#F5EDD8` (Linen)
- **Typography:** Playfair Display (headings) + Source Sans 3 (body)
