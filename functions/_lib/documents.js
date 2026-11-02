/* ═══════════════════════════════════════
   GRATEFUL & GROUNDED KIDS
   Shared by the /api/documents functions.

   resources.html is the list of downloads: each section sits
   between <!-- documents:id --> markers, and each change the
   dashboard makes is one GitHub commit of that page and the
   file, which Cloudflare then deploys like any other push.
   The public page keeps working without Supabase or JavaScript.
   ═══════════════════════════════════════ */

export const SECTIONS = [
  { id: 'chores-work', label: 'Chores & Work' },
  { id: 'finances', label: 'Finances' },
  { id: 'technology', label: 'Technology' },
];

// Cloudflare Pages refuses a deployment holding a file over 25 MiB, so stop well before that
export const MAX_FILE_BYTES = 25000000;
// Upload bodies are base64 (a third larger) in a small JSON wrapper
export const MAX_UPLOAD_BODY = Math.ceil(MAX_FILE_BYTES / 3) * 4 + 100;

// Documents only: a web page or script served from the main domain could run code there
const FILE_TYPES = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
const PAGE_PATH = 'resources.html';
const DOCS_PATH = 'assets/docs';
const BRANCH = 'main';
const DEFAULT_REPO = 'dgoodm/gratefulgroundedkids';

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// A problem to show as it is, as opposed to something unexpected
export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/* ── Who is asking ── */

function projectOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

// Throws unless the request carries the session of an account with the admin role
export async function requireAdmin(request, env) {
  const origin = projectOrigin(env.SUPABASE_URL);
  const key = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!origin || !key) throw new UserError('The dashboard is not connected to its database.', 503);
  if (!token) throw new UserError('Please sign in again.', 401);

  const headers = { apikey: key, Authorization: `Bearer ${token}` };
  let userRes, roleRes;
  try {
    userRes = await fetch(`${origin}/auth/v1/user`, { headers });
    if (!userRes.ok) throw new UserError('Please sign in again.', 401);
    const user = await userRes.json();
    roleRes = await fetch(`${origin}/rest/v1/user_roles?select=role&user_id=eq.${encodeURIComponent(user.id)}&role=eq.admin`, { headers });
  } catch (err) {
    if (err instanceof UserError) throw err;
    throw new UserError('Could not reach the database to check your sign-in. Please try again.', 503);
  }
  const roles = roleRes.ok ? await roleRes.json() : [];
  if (!roles.length) throw new UserError('This account does not have admin access.', 403);
}

/* ── GitHub ── */

export async function github(env, path, init = {}) {
  if (!env.GITHUB_TOKEN) throw new UserError('Publishing is not set up yet: GITHUB_TOKEN is missing in Cloudflare.', 503);
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO || DEFAULT_REPO}/${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        'User-Agent': 'gratefulgroundedkids-admin',
        'X-GitHub-Api-Version': '2022-11-28',
        ...init.headers,
      },
    });
  } catch {
    throw new UserError('Could not reach GitHub. Please try again.', 503);
  }
  if (res.ok) return res;
  console.error('GitHub error:', res.status, path, await res.text());
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    throw new UserError('GitHub refused the change. The GITHUB_TOKEN in Cloudflare may have expired.', 503);
  }
  if (path.startsWith('git/refs/') && (res.status === 409 || res.status === 422)) {
    throw new UserError('Another change went through at the same moment. Please try again.', 409);
  }
  throw new UserError('GitHub could not save the change. Please try again.', 502);
}

const latestCommit = async (env) => (await (await github(env, `git/ref/heads/${BRANCH}`)).json()).object.sha;

async function readPage(env, ref) {
  const res = await github(env, `contents/${PAGE_PATH}?ref=${ref}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
  return res.text();
}

/* ── Reading and writing the page ── */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', mdash: '—', ndash: '–', hellip: '…' };
const decode = (text) =>
  text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/g, (whole, name) => ENTITIES[name] ?? whole);
const escapeHtml = (value) => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cleanLine = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const ICON = '<div class="doc-icon">\n              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>\n            </div>';

const buildCard = ({ title, description, file }) => ({
  title,
  description,
  file,
  raw: `          <div class="doc-card">
            ${ICON}
            <div class="doc-info">
              <h3 class="doc-title">${escapeHtml(title)}</h3>
              <p class="doc-desc">${escapeHtml(description)}</p>
            </div>
            <a href="/${DOCS_PATH}/${file}" class="btn btn-primary btn-sm" download>Download</a>
          </div>`,
});

const sectionPattern = (id) => new RegExp(`(<!-- documents:${id} -->\\n)([\\s\\S]*?)([ \\t]*<!-- /documents:${id} -->)`);

// Cards keep their exact markup; only the one being changed is rebuilt
function readSection(html, id) {
  const block = html.match(sectionPattern(id));
  if (!block) throw new Error(`resources.html has no markers for ${id}`);
  return block[2]
    .split(/(?=^[ \t]*<div class="doc-card">)/m)
    .filter((raw) => raw.trim())
    .map((raw) => {
      const title = raw.match(/class="doc-title">([\s\S]*?)<\/h3>/);
      const description = raw.match(/class="doc-desc">([\s\S]*?)<\/p>/);
      const file = raw.match(/href="\/assets\/docs\/([^"/]+)"/);
      if (!title || !file) throw new Error(`Could not read a card in ${id}`);
      return { title: decode(title[1]), description: description ? decode(description[1]) : '', file: file[1], raw: raw.trimEnd() };
    });
}

function writeSection(html, id, cards) {
  const body = cards.map((card) => `${card.raw}\n`).join('\n');
  return html.replace(sectionPattern(id), (_, open, __, close) => open + body + close);
}

export function listSections(html) {
  return SECTIONS.map((section) => ({
    ...section,
    documents: readSection(html, section.id).map(({ title, description, file }) => ({ title, description, file })),
  }));
}

const extensionOf = (name) => (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();

function newFileName(uploaded, taken) {
  const extension = extensionOf(uploaded);
  if (!FILE_TYPES.includes(extension)) throw new UserError(`Please choose a ${FILE_TYPES.join(', ')} file.`);
  const base = uploaded.slice(0, -extension.length - 1).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'document';
  let name = `${base}.${extension}`;
  for (let n = 2; taken.includes(name); n += 1) name = `${base}-${n}.${extension}`;
  return name;
}

function checkedText(change) {
  const title = cleanLine(change.title, 120);
  const description = cleanLine(change.description, 300);
  if (!title || !description) throw new UserError('Please add a title and a short description.');
  return { title, description };
}

function checkedBlob(change) {
  if (!/^[0-9a-f]{40}$/.test(change.blobSha || '')) throw new UserError('Please choose a file to upload.');
  return change.blobSha;
}

// Works out the new page and which files go in and out. `taken` is every name already in the documents folder.
export function applyChange(html, change, taken) {
  const section = SECTIONS.find((s) => s.id === change.section);
  if (!section) throw new UserError('Please choose a section.');
  const cards = readSection(html, section.id);
  const index = cards.findIndex((card) => card.file === change.file);
  if (change.action !== 'add' && index < 0) throw new UserError('That document is no longer on the page. Press Refresh and try again.', 409);
  const current = cards[index];
  let upload = null;
  let remove = null;
  let message;

  if (change.action === 'add') {
    const { title, description } = checkedText(change);
    const sha = checkedBlob(change);
    const file = newFileName(String(change.fileName || ''), taken);
    cards.push(buildCard({ title, description, file }));
    upload = { file, sha };
    message = `Add document: ${title}`;
  } else if (change.action === 'update') {
    const { title, description } = checkedText(change);
    let { file } = current;
    if (change.blobSha) {
      const sha = checkedBlob(change);
      // Same kind of file: keep the address. A different kind needs a new name, and the old file goes.
      if (extensionOf(String(change.fileName || '')) !== extensionOf(file)) {
        remove = file;
        file = newFileName(String(change.fileName || ''), taken);
      }
      upload = { file, sha };
    }
    cards[index] = buildCard({ title, description, file });
    message = `${upload ? 'Replace' : 'Edit'} document: ${title}`;
  } else if (change.action === 'remove') {
    cards.splice(index, 1);
    remove = current.file;
    message = `Remove document: ${current.title}`;
  } else if (change.action === 'move') {
    const target = index + (change.direction === 'up' ? -1 : 1);
    if (target < 0 || target >= cards.length) throw new UserError('That document is already at the end of the list.');
    [cards[index], cards[target]] = [cards[target], cards[index]];
    message = `Reorder documents in ${section.label}`;
  } else {
    throw new UserError('Unknown change.');
  }

  return { html: writeSection(html, section.id, cards), upload, remove, message };
}

const stamp = (html, version) => html.replace(/(<meta name="documents-version" content=")[^"]*/, (_, start) => start + version);

/* ── The steps that reach GitHub ── */

export async function readDocuments(env) {
  return listSections(await readPage(env, await latestCommit(env)));
}

// One commit, so a file and its card always arrive on the site together
export async function publishChange(env, change) {
  const parent = await latestCommit(env);
  const folder = await (await github(env, `contents/${DOCS_PATH}?ref=${parent}`)).json();
  const result = applyChange(await readPage(env, parent), change, folder.map((item) => item.name));

  const version = crypto.randomUUID();
  const html = stamp(result.html, version);
  const entry = (path, fields) => ({ path, mode: '100644', type: 'blob', ...fields });
  const tree = [entry(PAGE_PATH, { content: html })];
  if (result.upload) tree.push(entry(`${DOCS_PATH}/${result.upload.file}`, { sha: result.upload.sha }));
  if (result.remove) tree.push(entry(`${DOCS_PATH}/${result.remove}`, { sha: null }));

  const base = await (await github(env, `git/commits/${parent}`)).json();
  const post = (path, body, method = 'POST') =>
    github(env, path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((res) => res.json());
  const newTree = await post('git/trees', { base_tree: base.tree.sha, tree });
  const commit = await post('git/commits', { message: `${result.message} (from the dashboard)`, tree: newTree.sha, parents: [parent] });
  await post(`git/refs/heads/${BRANCH}`, { sha: commit.sha }, 'PATCH');

  return { version, sections: listSections(html) };
}
