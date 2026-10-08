/* ═══════════════════════════════════════
   GRATEFUL & GROUNDED KIDS
   Cloudflare Pages Function — /api/contact
   Saves each contact form submission as a lead
   in Supabase, then emails Doug and the visitor
   through Resend.

   Variables (Cloudflare → Settings → Variables and Secrets):
   - RESEND_API_KEY       Resend API key (secret)
   - NOTIFICATION_EMAIL   where new-lead emails go; several addresses may be separated by commas
   - SUPABASE_URL         https://xxxx.supabase.co
   - SUPABASE_SECRET_KEY  Supabase secret (service role) key (secret)
   - ADMIN_URL            optional; defaults to https://admin.gratefulgroundedkids.com
   ═══════════════════════════════════════ */

const SITE_NAME = 'Grateful & Grounded Kids';
const FROM_ADDRESS = 'noreply@gratefulgroundedkids.com';
const FALLBACK_EMAIL = 'doug@gratefulgroundedkids.com';
const DEFAULT_ADMIN_URL = 'https://admin.gratefulgroundedkids.com';
const TOPICS = ['Workshop', 'Speaking', 'Consulting', 'General'];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// Everything a visitor types is escaped before it goes into an email
const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Single-line fields: collapse whitespace (including line breaks) and cap the length
const cleanLine = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanMessage = (value) => String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 5000);

export async function onRequestPost(context) {
  const { request, env } = context;

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ message: 'Please fill out the form and try again.' }, 400);
  }
  if (!data || typeof data !== 'object') {
    return json({ message: 'Please fill out the form and try again.' }, 400);
  }

  // Honeypot: a hidden field real visitors never see. Bots fill it; answer as if it worked and drop it.
  if (data.website) return json({ message: 'Thank you! Your message has been sent.' });

  const lead = {
    first_name: cleanLine(data.firstName, 80),
    last_name: cleanLine(data.lastName, 80),
    email: cleanLine(data.email, 200).toLowerCase(),
    phone: cleanLine(data.phone, 40),
    topic: TOPICS.includes(data.topic) ? data.topic : '',
    message: cleanMessage(data.message),
  };

  if (!lead.first_name || !lead.email || !lead.topic) {
    return json({ message: 'Missing required fields: firstName, email, and topic.' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lead.email)) {
    return json({ message: 'Please provide a valid email address.' }, 400);
  }

  const recipients = (env.NOTIFICATION_EMAIL || FALLBACK_EMAIL).split(',').map((a) => a.trim()).filter(Boolean);

  // Save first, so a lead is never lost because an email failed
  const saved = await saveLead(env, lead);
  const emails = await sendEmails(env, lead, saved, recipients);

  if (saved) context.waitUntil(recordEmailResults(env, saved.id, emails, recipients));

  if (!saved && !emails.notification) {
    return json({ message: `We couldn't send your message. Please email ${FALLBACK_EMAIL} directly.` }, 503);
  }
  return json({ message: 'Thank you! Your message has been sent.' });
}

/* ── Supabase ── */

// Returns null when Supabase is not configured, so the form still works on email alone
function supabaseRequest(env, path, init = {}) {
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env.SUPABASE_URL || !key) return null;
  return fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
}

async function saveLead(env, lead) {
  try {
    const res = await supabaseRequest(env, 'leads', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        ...lead,
        last_name: lead.last_name || null,
        phone: lead.phone || null,
        message: lead.message || null,
        source: 'website',
      }),
    });
    if (!res) return null;
    if (!res.ok) {
      console.error('Could not save lead:', res.status, await res.text());
      return null;
    }
    const rows = await res.json();
    return rows[0] || null;
  } catch (err) {
    console.error('Could not save lead:', err);
    return null;
  }
}

// Notes on the lead's history showing whether each email went out
async function recordEmailResults(env, leadId, emails, recipients) {
  try {
    const emailIsSetUp = Boolean(env.RESEND_API_KEY);
    await supabaseRequest(env, `leads?id=eq.${leadId}`, {
      method: 'PATCH',
      body: JSON.stringify({ notification_sent: emails.notification, confirmation_sent: emails.confirmation }),
    });
    await supabaseRequest(env, 'lead_activity', {
      method: 'POST',
      body: JSON.stringify([
        {
          lead_id: leadId,
          kind: 'system',
          body: !emailIsSetUp
            ? 'No emails sent: email is not set up yet'
            : emails.notification
              ? `Notification email sent to ${recipients.join(', ')}`
              : 'Notification email could not be sent',
        },
        ...(emailIsSetUp
          ? [{
              lead_id: leadId,
              kind: 'system',
              body: emails.confirmation ? 'Thank-you email sent to the visitor' : 'Thank-you email could not be sent',
            }]
          : []),
      ]),
    });
  } catch (err) {
    console.error('Could not record email results:', err);
  }
}

/* ── Email ── */

async function sendEmail(env, payload) {
  if (!env.RESEND_API_KEY) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error('Resend error:', res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.error('Resend request failed:', err);
    return false;
  }
}

async function sendEmails(env, lead, saved, recipients) {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ');
  const adminUrl = (env.ADMIN_URL || DEFAULT_ADMIN_URL).replace(/\/+$/, '');
  const cell = 'padding:8px;border-bottom:1px solid #eee;';
  const row = (label, value) =>
    `<tr><td style="${cell}font-weight:bold;vertical-align:top;white-space:nowrap;">${label}</td><td style="${cell}">${value}</td></tr>`;

  const [notification, confirmation] = await Promise.all([
    // Email 1: tell Doug. Replying to it replies straight to the visitor.
    sendEmail(env, {
      from: `${SITE_NAME} <${FROM_ADDRESS}>`,
      to: recipients,
      reply_to: lead.email,
      subject: `New ${lead.topic} inquiry from ${name}`,
      html: `
        <div style="max-width:600px;font-family:system-ui,sans-serif;color:#1C1208;">
          <h2 style="color:#243D10;">New contact form submission</h2>
          <table style="border-collapse:collapse;width:100%;">
            ${row('Name', escapeHtml(name))}
            ${row('Email', `<a href="mailto:${escapeHtml(lead.email)}" style="color:#4A7C2F;">${escapeHtml(lead.email)}</a>`)}
            ${row('Phone', lead.phone ? escapeHtml(lead.phone) : 'Not provided')}
            ${row('Topic', escapeHtml(lead.topic))}
            ${row('Message', lead.message ? escapeHtml(lead.message).replace(/\n/g, '<br>') : 'No message provided')}
          </table>
          <p style="margin-top:1.25rem;">Reply to this email to answer ${escapeHtml(lead.first_name)} directly.</p>
          ${saved ? `<p><a href="${adminUrl}/#lead=${saved.id}" style="display:inline-block;background:#4A7C2F;color:#fff;padding:10px 22px;border-radius:100px;text-decoration:none;font-weight:600;">Open in the dashboard</a></p>` : ''}
        </div>
      `,
    }),
    // Email 2: thank the visitor. Their reply goes to Doug, not to the no-reply address.
    sendEmail(env, {
      from: `Doug at ${SITE_NAME} <${FROM_ADDRESS}>`,
      to: [lead.email],
      reply_to: recipients[0],
      subject: `Thanks for reaching out — ${SITE_NAME}`,
      html: `
        <div style="max-width:600px;font-family:system-ui,sans-serif;color:#1C1208;">
          <h2 style="color:#243D10;">Thanks for reaching out, ${escapeHtml(lead.first_name)}!</h2>
          <p>I received your message and will get back to you within 1–2 business days.</p>
          <p>In the meantime, feel free to check out the book:</p>
          <p><a href="https://a.co/d/0hMkGw1y" style="color:#4A7C2F;">Grateful &amp; Grounded Kids on Amazon</a></p>
          <br>
          <p>— Doug</p>
          <hr style="border:none;border-top:1px solid #D4C9A8;margin:1.5rem 0;">
          <p style="font-size:.85rem;color:#8C7D64;">Grateful &amp; Grounded Kids &middot; <a href="https://gratefulgroundedkids.com" style="color:#4A7C2F;">gratefulgroundedkids.com</a></p>
        </div>
      `,
    }),
  ]);

  return { notification, confirmation };
}
