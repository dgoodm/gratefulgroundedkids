/* ═══════════════════════════════════════
   GRATEFUL & GROUNDED KIDS
   Runs before the routes listed in _routes.json.
   ═══════════════════════════════════════ */

export async function onRequest(context) {
  // If anything here fails, serve the page as if this file did not exist
  context.passThroughOnException();

  const url = new URL(context.request.url);

  // Kept in the repo for setup and documentation, not for visitors
  if (url.pathname === '/README.md' || url.pathname.startsWith('/supabase/')) {
    return new Response('Not found', { status: 404 });
  }

  // admin.gratefulgroundedkids.com opens the dashboard directly
  if (url.hostname.startsWith('admin.') && url.pathname === '/') {
    return context.env.ASSETS.fetch(new URL('/admin/', url));
  }

  return context.next();
}
