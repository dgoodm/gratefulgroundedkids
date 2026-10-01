# Grateful Grounded Kids

Website for Doug's Grateful Grounded Kids — workshops, speaking, and consulting for families raising grateful and grounded kids in an age of entitlement.

**Live site:** https://gratefulgroundedkids.com

## Tech Stack

- **Frontend:** Plain HTML / CSS / JavaScript (no framework)
- **Hosting:** Cloudflare Pages (auto-deploys from GitHub on push)
- **Forms:** Cloudflare Pages Functions → Resend API
- **Documents:** Supabase Storage (future integration)
- **CMS:** Decap CMS at /admin (future setup)
- **Email:** Resend for form notification emails
- **Domain email:** Google Workspace (doug@gratefulgroundedkids.com)

## Project Structure

```
gratefulgroundedkids/
├── index.html              # Home page
├── workshop.html           # Workshop details
├── services.html           # Seminars, sessions, consulting
├── resources.html          # Downloadable docs + book recs
├── connect.html            # Contact/interest form
├── css/
│   └── style.css           # Full design system
├── js/
│   ├── main.js             # Nav, scroll, tabs, mobile menu
│   └── form.js             # Form validation + submission
├── assets/
│   ├── images/             # Logo, headshot, book cover
│   └── docs/               # Downloadable PDFs/documents
├── functions/
│   └── api/
│       └── contact.js      # Cloudflare Pages Function (Resend)
├── admin/
│   └── index.html          # CMS placeholder
├── _headers                # Cloudflare security headers
├── _redirects              # Cloudflare redirects
└── .gitignore
```

## Setup

### 1. GitHub Repository

```bash
cd gratefulgroundedkids
git init
git add .
git commit -m "Initial site build"
git remote add origin https://github.com/YOUR_USERNAME/gratefulgroundedkids.git
git push -u origin main
```

### 2. Cloudflare Pages

1. Go to **Cloudflare Dashboard → Pages → Create a project**
2. Connect your GitHub repo
3. Build settings:
   - **Build command:** (leave empty — no build step needed)
   - **Build output directory:** `/` (root)
4. Deploy

Your site will be live at `your-project.pages.dev` for preview.

### 3. Custom Domain

1. In Cloudflare Pages → your project → **Custom domains**
2. Add `gratefulgroundedkids.com`
3. Cloudflare will auto-configure DNS (since the domain is already on Cloudflare)

### 4. Resend Email (wire up later)

1. Sign up at [resend.com](https://resend.com)
2. Verify your domain (`gratefulgroundedkids.com`)
3. Get your API key
4. In Cloudflare Pages → Settings → Environment variables, add:
   - `RESEND_API_KEY` = your key
   - `NOTIFICATION_EMAIL` = `doug@gratefulgroundedkids.com`

### 5. Add Your Assets

Replace placeholder files in `assets/`:
- `assets/images/logo.png` — your logo file
- `assets/images/headshot.jpg` — Doug's headshot
- `assets/images/book-cover.jpg` — book cover image
- `assets/docs/` — add your downloadable PDFs here

Then update the `<img>` `src` attributes in the HTML files to point to your actual filenames.

## Design

- **Palette:** Deep Roots (forest green + amber + linen)
- **Primary:** `#243D10` (Canopy) / `#4A7C2F` (Grove)
- **Accent:** `#C47B2B` (Harvest amber)
- **Background:** `#F5EDD8` (Linen)
- **Typography:** Playfair Display (headings) + Source Sans 3 (body)
