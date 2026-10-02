/* ═══════════════════════════════════════
   GRATEFUL & GROUNDED KIDS
   Cloudflare Pages Function — /api/contact
   Receives form submissions and sends
   notification emails via Resend.

   ENV VARS needed in Cloudflare dashboard:
   - RESEND_API_KEY  (your Resend API key)
   - NOTIFICATION_EMAIL (doug@gratefulgroundedkids.com)
   ═══════════════════════════════════════ */

export async function onRequestPost(context) {
  const { request, env } = context;

  // CORS headers
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'https://gratefulgroundedkids.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  try {
    const data = await request.json();

    // Validate required fields
    if (!data.firstName || !data.email || !data.topic) {
      return new Response(
        JSON.stringify({ message: 'Missing required fields: firstName, email, and topic.' }),
        { status: 400, headers }
      );
    }

    // Basic email validation
    if (!data.email.includes('@') || !data.email.includes('.')) {
      return new Response(
        JSON.stringify({ message: 'Please provide a valid email address.' }),
        { status: 400, headers }
      );
    }

    // Check if Resend is configured
    if (!env.RESEND_API_KEY) {
      // Log the submission for now — Resend will be wired up later
      console.log('Form submission received (Resend not configured):', JSON.stringify(data));
      return new Response(
        JSON.stringify({ message: 'Thank you! Your message has been received.' }),
        { status: 200, headers }
      );
    }

    const notificationEmail = env.NOTIFICATION_EMAIL || 'doug@gratefulgroundedkids.com';

    // ── Email 1: Notify Doug ──
    const notifyRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Grateful & Grounded Kids <noreply@gratefulgroundedkids.com>',
        to: [notificationEmail],
        subject: `New ${data.topic} inquiry from ${data.firstName} ${data.lastName || ''}`.trim(),
        html: `
          <h2>New Contact Form Submission</h2>
          <table style="border-collapse:collapse;width:100%;max-width:600px;">
            <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Name</td><td style="padding:8px;border-bottom:1px solid #eee;">${data.firstName} ${data.lastName || ''}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Email</td><td style="padding:8px;border-bottom:1px solid #eee;"><a href="mailto:${data.email}">${data.email}</a></td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Phone</td><td style="padding:8px;border-bottom:1px solid #eee;">${data.phone || 'Not provided'}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Topic</td><td style="padding:8px;border-bottom:1px solid #eee;">${data.topic}</td></tr>
            <tr><td style="padding:8px;font-weight:bold;vertical-align:top;">Message</td><td style="padding:8px;">${data.message || 'No message provided'}</td></tr>
          </table>
        `,
      }),
    });

    if (!notifyRes.ok) {
      const err = await notifyRes.text();
      console.error('Resend notification error:', err);
      return new Response(
        JSON.stringify({ message: 'Something went wrong sending the notification. Please try again.' }),
        { status: 500, headers }
      );
    }

    // ── Email 2: Confirmation to submitter ──
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Doug at Grateful & Grounded Kids <noreply@gratefulgroundedkids.com>',
        to: [data.email],
        subject: 'Thanks for reaching out — Grateful & Grounded Kids',
        html: `
          <div style="max-width:600px;font-family:system-ui,sans-serif;color:#1C1208;">
            <h2 style="color:#243D10;">Thanks for reaching out, ${data.firstName}!</h2>
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
    });

    return new Response(
      JSON.stringify({ message: 'Thank you! Your message has been sent.' }),
      { status: 200, headers }
    );

  } catch (err) {
    console.error('Contact form error:', err);
    return new Response(
      JSON.stringify({ message: 'An unexpected error occurred. Please email doug@gratefulgroundedkids.com directly.' }),
      { status: 500, headers }
    );
  }
}
