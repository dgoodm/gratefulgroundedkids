/* ═══════════════════════════════════════
   GRATEFUL & GROUNDED KIDS
   Cloudflare Pages Function — /api/admin-config
   Tells the admin dashboard which Supabase
   project to talk to.

   The publishable key is meant to be public.
   What protects the data is row-level security
   in Supabase: only signed-in admins can read it.

   Variables (Cloudflare → Settings → Variables and Secrets):
   - SUPABASE_URL              https://xxxx.supabase.co
   - SUPABASE_PUBLISHABLE_KEY  Supabase publishable (anon) key
   ═══════════════════════════════════════ */

// The address may be pasted with a trailing slash or with /rest/v1 on the end
// (Supabase's Data API page shows it that way); only the origin is wanted.
function projectOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

export function onRequestGet({ env }) {
  const supabaseUrl = projectOrigin(env.SUPABASE_URL);
  const supabaseKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '';
  return new Response(
    JSON.stringify({ configured: Boolean(supabaseUrl && supabaseKey), supabaseUrl, supabaseKey }),
    { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  );
}
