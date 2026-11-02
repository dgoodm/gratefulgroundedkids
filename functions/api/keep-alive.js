/* ═══════════════════════════════════════
   GRATEFUL & GROUNDED KIDS
   Cloudflare Pages Function — /api/keep-alive
   Supabase's free plan pauses a project after about a week
   without activity, which stops sign-in and lead saving.
   A scheduled GitHub workflow calls this to keep it awake.
   It reads one row and returns none of it.
   ═══════════════════════════════════════ */

export async function onRequestGet({ env }) {
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  let ok = false;
  try {
    const res = await fetch(`${new URL(env.SUPABASE_URL).origin}/rest/v1/user_roles?select=role&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    ok = res.ok;
  } catch (err) {
    console.error('Keep-alive failed:', err);
  }
  return new Response(JSON.stringify({ ok }), {
    status: ok ? 200 : 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
