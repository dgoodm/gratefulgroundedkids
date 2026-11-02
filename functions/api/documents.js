/* ═══════════════════════════════════════
   GRATEFUL & GROUNDED KIDS
   Cloudflare Pages Function — /api/documents
   Lists the Resources page downloads and publishes changes
   to them. Admins only; see functions/_lib/documents.js.

   Variables (Cloudflare → Settings → Variables and Secrets):
   - GITHUB_TOKEN  fine-grained token for this one repository, Contents read and write (secret)
   - GITHUB_REPO   optional; defaults to dgoodm/gratefulgroundedkids
   ═══════════════════════════════════════ */

import { UserError, json, publishChange, readDocuments, requireAdmin } from '../_lib/documents.js';

function failure(err) {
  if (err instanceof UserError) return json({ message: err.message }, err.status);
  console.error('Documents error:', err);
  return json({ message: 'Something went wrong. Nothing was changed.' }, 500);
}

export async function onRequestGet({ request, env }) {
  try {
    await requireAdmin(request, env);
    if (!env.GITHUB_TOKEN) return json({ configured: false, sections: [] });
    return json({ configured: true, sections: await readDocuments(env) });
  } catch (err) {
    return failure(err);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    await requireAdmin(request, env);
    const change = await request.json().catch(() => null);
    if (!change || typeof change !== 'object') throw new UserError('Unknown change.');
    return json(await publishChange(env, change));
  } catch (err) {
    return failure(err);
  }
}
