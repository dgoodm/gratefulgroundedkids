/* ═══════════════════════════════════════
   GRATEFUL & GROUNDED KIDS
   Cloudflare Pages Function — /api/documents/upload
   Hands a file to GitHub and returns its id. Nothing is on
   the site until /api/documents commits it, and that step
   is what checks the file type.

   The body is passed straight through without being read,
   so a large file costs this function no processing time.
   ═══════════════════════════════════════ */

import { MAX_UPLOAD_BODY, UserError, github, json, requireAdmin } from '../../_lib/documents.js';

export async function onRequestPost({ request, env }) {
  try {
    await requireAdmin(request, env);
    const length = Number(request.headers.get('Content-Length'));
    if (!length || length > MAX_UPLOAD_BODY) throw new UserError('Files can be up to 25 MB.', 413);
    const res = await github(env, 'git/blobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: request.body,
    });
    const { sha } = await res.json();
    return json({ sha });
  } catch (err) {
    if (err instanceof UserError) return json({ message: err.message }, err.status);
    console.error('Upload error:', err);
    return json({ message: 'The upload failed. Nothing was changed.' }, 500);
  }
}
