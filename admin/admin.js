/* ═══════════════════════════════════════
   GRATEFUL & GROUNDED KIDS — Admin dashboard
   Sign-in, lead pipeline, submissions list, the
   history on each lead, and the Resources downloads.

   Talks to Supabase straight from the browser.
   Row-level security there decides what a signed-in
   account may read, so nothing here is the lock.
   Downloads go through /api/documents, which checks
   the same admin role before it touches GitHub.
   ═══════════════════════════════════════ */

const STAGES = [
  { id: 'new', label: 'New' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'conversation', label: 'In Conversation' },
  { id: 'proposal', label: 'Proposal Sent' },
  { id: 'booked', label: 'Booked' },
  { id: 'closed', label: 'Closed' },
];
const OPEN_STAGES = ['new', 'contacted', 'conversation', 'proposal'];
const TOPICS = ['Workshop', 'Speaking', 'Consulting', 'General'];
const ACTIVITY_KINDS = {
  note: 'Note',
  call: 'Call',
  email_sent: 'Reply sent',
  reply_received: 'Reply received',
  stage_change: 'Stage',
  system: 'System',
};
const SESSION_KEY = 'ggk-admin-session';
const REFRESH_EVERY_MS = 60000;
const MAX_FILE_BYTES = 25000000;
const PUBLISH_CHECK_MS = 5000;
const PUBLISH_WAIT_MS = 180000;
const FILE_KINDS = { pdf: 'PDF', doc: 'Word', docx: 'Word', xls: 'Excel', xlsx: 'Excel', ppt: 'PowerPoint', pptx: 'PowerPoint' };
const UNREACHABLE = "The dashboard can't reach its database right now. Check your connection and try again. If this keeps happening, the Supabase project may be paused.";

const state = {
  config: null,   // { supabaseUrl, supabaseKey }
  session: null,  // { access_token, refresh_token, expires_at, user }
  leads: [],
  view: 'pipeline',
  search: '',
  topic: '',
  stage: '',
  openId: null,
  documents: null,    // { configured, sections }, once the tab has been opened
  documentsBusy: false,
  publishing: null,   // version of the latest change until it reaches the site
};
let noteDraft = '';
let askIfReplySent = false;

const $ = (id) => document.getElementById(id);
const stageLabel = (id) => STAGES.find((s) => s.id === id)?.label || id;
const fullName = (lead) => [lead.first_name, lead.last_name].filter(Boolean).join(' ');
const isOpen = (lead) => OPEN_STAGES.includes(lead.stage);

// Builds elements with text added as text, never as HTML, so nothing a visitor typed can run as code
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.flat().filter((child) => child != null && child !== false));
  return node;
}

function toast(message, isError = false) {
  const node = el('div', { class: `toast${isError ? ' toast--error' : ''}` }, message);
  $('toasts').append(node);
  setTimeout(() => node.remove(), isError ? 6000 : 2500);
}

function show(screen) {
  for (const id of ['screen-loading', 'screen-setup', 'screen-login', 'screen-forgot', 'screen-reset', 'app']) {
    $(id).hidden = id !== screen;
  }
}

// Fills a message line and hides it when there is nothing to say
function setNote(id, message) {
  $(id).textContent = message;
  $(id).hidden = !message;
}
const showLoginError = (message) => setNote('login-error', message);

/* ── Dates ── */

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const shortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const dateTime = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
// follow_up_on is a calendar date (YYYY-MM-DD); build it in local time so it never shifts a day
const plainDate = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const isDue = (lead) => Boolean(lead.follow_up_on) && lead.follow_up_on <= today() && isOpen(lead);
function ago(iso) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : shortDate(iso);
}

/* ── Supabase: sign-in ── */

// A browser reports an unreachable server as "Failed to fetch", which helps no one
async function reach(url, init) {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error(UNREACHABLE);
  }
}

class SessionEnded extends Error {}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function saveSession(session) {
  state.session = session;
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Private browsing can block storage; the session then lasts until the tab closes
  }
}

async function authRequest(path, body, token) {
  const res = await reach(`${state.config.supabaseUrl}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: state.config.supabaseKey,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.msg || data.error_description || data.message || 'Sign-in failed.');
  return data;
}

const toSession = (data) => ({
  access_token: data.access_token,
  refresh_token: data.refresh_token,
  expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
  user: { id: data.user.id, email: data.user.email },
});

async function signIn(email, password) {
  saveSession(toSession(await authRequest('token?grant_type=password', { email, password })));
}

// A refresh token works once, so everything waiting shares the same refresh
let refreshing = null;
function refreshSession() {
  refreshing ??= authRequest('token?grant_type=refresh_token', { refresh_token: state.session.refresh_token })
    .then((data) => saveSession(toSession(data)))
    .catch(() => {
      throw new SessionEnded();
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function signOut() {
  try {
    await authRequest('logout', null, state.session.access_token);
  } catch {
    // Signing out locally is what matters
  }
  saveSession(null);
}

/* ── Supabase: password reset ── */

// The short-lived session a reset link carries. It is used only to save the new password.
let recovery = null;

// Following an emailed link lands back here with the result after "#" in the address
function readEmailLinkResult() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (params.get('error') || params.get('error_code')) return { failed: true };
  if (params.get('type') === 'recovery' && params.get('access_token')) {
    return {
      recovery: {
        access_token: params.get('access_token'),
        refresh_token: params.get('refresh_token'),
        expires_at: Number(params.get('expires_at')) || Math.floor(Date.now() / 1000) + (Number(params.get('expires_in')) || 3600),
      },
    };
  }
  return null;
}

// Returns true when the address carried the result of an emailed link and it has been dealt with
function handleEmailLink() {
  const result = readEmailLinkResult();
  if (!result) return false;
  // Keep the one-time tokens out of the address bar and the browser history
  history.replaceState(null, '', window.location.pathname + window.location.search);
  if (result.recovery) {
    recovery = result.recovery;
    show('screen-reset');
  } else {
    show('screen-login');
    showLoginError('That reset link is invalid or has already been used. Use "Forgot password?" to get a new one.');
  }
  return true;
}

function requestPasswordReset(email) {
  // Bring the link back to wherever the dashboard is open now: the subdomain, or /admin/ on the main site
  const returnTo = window.location.origin + window.location.pathname;
  return authRequest(`recover?redirect_to=${encodeURIComponent(returnTo)}`, { email });
}

async function saveNewPassword(password) {
  const res = await reach(`${state.config.supabaseUrl}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      apikey: state.config.supabaseKey,
      Authorization: `Bearer ${recovery.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  });
  const user = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(user.msg || user.message || 'Could not save the new password.');
  saveSession({ ...recovery, user: { id: user.id, email: user.email } });
  recovery = null;
}

/* ── Supabase: data ── */

async function api(path, { method = 'GET', body, returning = false } = {}, isRetry = false) {
  if (state.session.expires_at - 60 < Date.now() / 1000) await refreshSession();
  const res = await reach(`${state.config.supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: state.config.supabaseKey,
      Authorization: `Bearer ${state.session.access_token}`,
      'Content-Type': 'application/json',
      ...(returning ? { Prefer: 'return=representation' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !isRetry) {
    await refreshSession();
    return api(path, { method, body, returning }, true);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Request failed (${res.status}).`);
  }
  return res.json().catch(() => null);
}

// Any failed action: say so. If the session is over, go back to sign-in.
function fail(err) {
  if (err instanceof SessionEnded) {
    saveSession(null);
    closeLead();
    show('screen-login');
    showLoginError('Your session ended. Please sign in again.');
    return;
  }
  toast(err.message || 'Something went wrong.', true);
}

/* ── Loading and changing leads ── */

async function loadLeads() {
  state.leads = await api('leads?select=*&order=created_at.desc&limit=2000');
  render();
}

async function reloadLead(id) {
  const [rows, activity] = await Promise.all([
    api(`leads?select=*&id=eq.${id}`),
    api(`lead_activity?select=*&lead_id=eq.${id}&order=created_at.desc`),
  ]);
  const lead = rows[0];
  if (lead) state.leads = state.leads.map((l) => (l.id === id ? lead : l));
  render();
  if (lead && state.openId === id) renderDrawer(lead, activity);
}

async function saveField(id, patch) {
  try {
    await api(`leads?id=eq.${id}`, { method: 'PATCH', body: patch });
    await reloadLead(id);
    toast('Saved');
  } catch (err) {
    fail(err);
  }
}

async function setStage(id, stage) {
  const lead = state.leads.find((l) => l.id === id);
  if (!lead || lead.stage === stage) return;
  try {
    await api(`leads?id=eq.${id}`, { method: 'PATCH', body: { stage } });
    await api('lead_activity', {
      method: 'POST',
      body: { lead_id: id, kind: 'stage_change', body: `Moved from ${stageLabel(lead.stage)} to ${stageLabel(stage)}` },
    });
    await reloadLead(id);
    toast(`Moved to ${stageLabel(stage)}`);
  } catch (err) {
    fail(err);
  }
}

async function addActivity(id, kind, body) {
  if (kind === 'note' && !body) {
    toast('Write the note first.', true);
    return;
  }
  const lead = state.leads.find((l) => l.id === id);
  try {
    await api('lead_activity', { method: 'POST', body: { lead_id: id, kind, body: body || null } });
    noteDraft = '';
    askIfReplySent = false;
    // Replies move a lead along on their own: answered leads leave "New", and a reply back starts a conversation
    const nextStage =
      kind === 'email_sent' && lead?.stage === 'new' ? 'contacted'
      : kind === 'reply_received' && ['new', 'contacted'].includes(lead?.stage) ? 'conversation'
      : null;
    if (nextStage) {
      await setStage(id, nextStage);
    } else {
      await reloadLead(id);
      toast('Saved');
    }
  } catch (err) {
    fail(err);
  }
}

async function deleteLead(lead) {
  if (!window.confirm(`Delete ${fullName(lead)} and their history? This cannot be undone.`)) return;
  try {
    await api(`leads?id=eq.${lead.id}`, { method: 'DELETE' });
    state.leads = state.leads.filter((l) => l.id !== lead.id);
    closeLead();
    render();
    toast('Lead deleted');
  } catch (err) {
    fail(err);
  }
}

/* ── Resources downloads ── */

async function documentsApi(path, init = {}, isRetry = false) {
  if (state.session.expires_at - 60 < Date.now() / 1000) await refreshSession();
  const res = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${state.session.access_token}`, 'Content-Type': 'application/json' },
  }).catch(() => {
    throw new Error("Couldn't reach the website. Check your connection and try again.");
  });
  if (res.status === 401 && !isRetry) {
    await refreshSession();
    return documentsApi(path, init, true);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Request failed (${res.status}).`);
  return data;
}

async function loadDocuments() {
  state.documents = await documentsApi('/api/documents');
  render();
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

async function uploadFile(file) {
  const content = await readAsBase64(file);
  const { sha } = await documentsApi('/api/documents/upload', {
    method: 'POST',
    body: JSON.stringify({ content, encoding: 'base64' }),
  });
  return sha;
}

async function publish(change) {
  const result = await documentsApi('/api/documents', { method: 'POST', body: JSON.stringify(change) });
  state.documents = { configured: true, sections: result.sections };
  state.publishing = result.version;
  render();
  watchPublish(result.version);
}

// Each save stamps the page, so seeing the stamp on the page means Cloudflare has finished
async function watchPublish(version) {
  const giveUpAt = Date.now() + PUBLISH_WAIT_MS;
  while (Date.now() < giveUpAt) {
    await new Promise((resolve) => setTimeout(resolve, PUBLISH_CHECK_MS));
    if (state.publishing !== version) return;
    const page = await fetch('/resources', { cache: 'no-store' }).then((res) => res.text()).catch(() => '');
    if (page.includes(version)) {
      state.publishing = null;
      setPublishNote('Live on the website.');
      return;
    }
  }
  if (state.publishing !== version) return;
  state.publishing = null;
  setPublishNote('Saved, but it is taking longer than usual to appear on the website. Check again in a few minutes.', true);
}

function setPublishNote(message, isWarning = false) {
  setNote('publish-note', message);
  $('publish-note').classList.toggle('publish-note--warn', isWarning);
}

async function changeDocument(change) {
  if (state.documentsBusy) return;
  state.documentsBusy = true;
  renderDocuments();
  try {
    await publish(change);
  } catch (err) {
    fail(err);
  }
  state.documentsBusy = false;
  renderDocuments();
}

function removeDocument(section, doc) {
  if (!window.confirm(`Remove "${doc.title}" from the website? The file will be deleted from the site.`)) return;
  changeDocument({ action: 'remove', section: section.id, file: doc.file });
}

function documentRow(section, doc, index) {
  const kind = FILE_KINDS[doc.file.split('.').pop().toLowerCase()] || 'File';
  const busy = state.documentsBusy;
  const move = (direction, label, symbol, disabled) =>
    el('button', {
      type: 'button',
      class: 'icon-button',
      title: label,
      'aria-label': `${label}: ${doc.title}`,
      disabled: disabled || busy,
      onclick: () => changeDocument({ action: 'move', section: section.id, file: doc.file, direction }),
    }, symbol);
  return el('div', { class: 'doc-row' },
    el('div', { class: 'doc-row-text' },
      el('div', { class: 'doc-row-title' }, doc.title, ' ', el('span', { class: 'badge' }, kind)),
      el('div', { class: 'doc-row-desc' }, doc.description),
    ),
    el('div', { class: 'doc-row-actions' },
      move('up', 'Move up', '↑', index === 0),
      move('down', 'Move down', '↓', index === section.documents.length - 1),
      el('a', { class: 'btn btn-outline btn-sm', href: `/assets/docs/${doc.file}`, target: '_blank', rel: 'noopener' }, 'View'),
      el('button', { type: 'button', class: 'btn btn-outline btn-sm', disabled: busy, onclick: () => openDocumentDialog(section, doc) }, 'Replace or Edit'),
      el('button', { type: 'button', class: 'btn btn-danger btn-sm', disabled: busy, onclick: () => removeDocument(section, doc) }, 'Remove'),
    ),
  );
}

function renderDocuments() {
  const list = $('documents-list');
  const data = state.documents;
  $('add-document').disabled = !data?.configured;
  if (state.publishing) setPublishNote('Publishing to the website. This usually takes about a minute.');
  if (!data) {
    list.replaceChildren(el('p', { class: 'documents-empty' }, 'Loading…'));
  } else if (!data.configured) {
    list.replaceChildren(el('p', { class: 'documents-empty' }, 'Publishing is not set up yet: GITHUB_TOKEN needs adding in Cloudflare.'));
  } else {
    list.replaceChildren(
      ...data.sections.map((section) =>
        el('section', { class: 'doc-section' },
          el('h2', { class: 'doc-section-title' }, section.label, el('span', { class: 'column-count' }, String(section.documents.length))),
          section.documents.length
            ? section.documents.map((doc, index) => documentRow(section, doc, index))
            : el('p', { class: 'documents-empty' }, 'Nothing here yet'),
        ),
      ),
    );
  }
}

let editing = null; // { section, doc } while the dialog is changing an existing document

function openDocumentDialog(section, doc) {
  editing = doc ? { section, doc } : null;
  $('doc-form').reset();
  setNote('doc-error', '');
  setChosenFile();
  $('doc-dialog-title').textContent = doc ? 'Replace or Edit' : 'Add a Document';
  $('doc-dialog-text').textContent = doc ? `In ${section.label}. Leave the file alone to change only the wording.` : 'It will appear at the end of the section you choose.';
  $('doc-section-field').hidden = Boolean(doc);
  $('doc-section').required = !doc;
  $('doc-file-label').textContent = doc ? 'New file (optional)' : 'File';
  $('doc-choose').textContent = doc ? 'Choose Replacement File' : 'Choose File';
  $('doc-title').value = doc?.title || '';
  $('doc-description').value = doc?.description || '';
  $('doc-dialog').showModal();
}

function setChosenFile() {
  const file = $('doc-file').files[0];
  $('doc-file-name').textContent = file ? file.name : editing ? editing.doc.file : 'No file chosen';
}

/* ── Rendering: summary, board, table ── */

function visibleLeads() {
  const query = state.search.trim().toLowerCase();
  return state.leads.filter((lead) => {
    if (state.topic && lead.topic !== state.topic) return false;
    if (state.view === 'submissions' && state.stage && lead.stage !== state.stage) return false;
    if (!query) return true;
    return [fullName(lead), lead.email, lead.phone, lead.message].some((value) => (value || '').toLowerCase().includes(query));
  });
}

function renderStats() {
  const open = state.leads.filter(isOpen);
  const tiles = [
    { count: state.leads.filter((l) => l.stage === 'new').length, label: 'New, not yet answered', alert: true },
    { count: open.length, label: 'Open leads' },
    { count: open.filter(isDue).length, label: 'Follow-ups due', alert: true },
    { count: state.leads.filter((l) => l.stage === 'booked').length, label: 'Booked' },
  ];
  $('stats').replaceChildren(
    ...tiles.map((tile) =>
      el('div', { class: `stat${tile.alert && tile.count ? ' stat--alert' : ''}` },
        el('div', { class: 'stat-number' }, String(tile.count)),
        el('div', { class: 'stat-label' }, tile.label),
      ),
    ),
  );
}

function leadCard(lead) {
  const emailMissed = lead.source === 'website' && !lead.notification_sent;
  return el('button', {
      type: 'button',
      class: 'lead-card',
      draggable: true,
      onclick: () => openLead(lead.id),
      ondragstart: (e) => {
        e.dataTransfer.setData('text/plain', lead.id);
        e.dataTransfer.effectAllowed = 'move';
        e.currentTarget.classList.add('dragging');
      },
      ondragend: (e) => e.currentTarget.classList.remove('dragging'),
    },
    el('div', { class: 'lead-card-top' },
      el('span', { class: `badge badge--${lead.topic}` }, lead.topic),
      el('span', { class: 'lead-card-age' }, ago(lead.last_activity_at)),
    ),
    el('div', { class: 'lead-card-name' }, fullName(lead)),
    lead.message && el('div', { class: 'lead-card-snippet' }, lead.message),
    (lead.follow_up_on || emailMissed) && el('div', { class: 'lead-card-foot' },
      lead.follow_up_on && el('span', { class: isDue(lead) ? 'due' : '' }, `Follow up ${plainDate(lead.follow_up_on)}`),
      emailMissed && el('span', { class: 'warn' }, 'Email alert not sent'),
    ),
  );
}

function renderBoard() {
  const leads = visibleLeads();
  $('view-pipeline').replaceChildren(
    ...STAGES.map((stage) => {
      const inStage = leads
        .filter((lead) => lead.stage === stage.id)
        .sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at));
      return el('div', {
          class: 'column',
          ondragover: (e) => {
            e.preventDefault();
            e.currentTarget.classList.add('drop-target');
          },
          ondragleave: (e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drop-target');
          },
          ondrop: (e) => {
            e.preventDefault();
            e.currentTarget.classList.remove('drop-target');
            const id = e.dataTransfer.getData('text/plain');
            if (id) setStage(id, stage.id);
          },
        },
        el('div', { class: 'column-head' }, stage.label, el('span', { class: 'column-count' }, String(inStage.length))),
        inStage.length ? inStage.map(leadCard) : el('p', { class: 'column-empty' }, 'Nothing here'),
      );
    }),
  );
}

function renderTable() {
  const leads = visibleLeads();
  const rows = leads.map((lead) =>
    el('tr', { onclick: () => openLead(lead.id) },
      el('td', {}, shortDate(lead.created_at)),
      el('td', {},
        el('div', { class: 'table-name' }, fullName(lead)),
        lead.message && el('div', { class: 'table-sub' }, lead.message.length > 80 ? `${lead.message.slice(0, 80)}…` : lead.message),
      ),
      el('td', {}, el('span', { class: `badge badge--${lead.topic}` }, lead.topic)),
      el('td', {}, el('div', {}, lead.email), lead.phone && el('div', { class: 'table-sub' }, lead.phone)),
      el('td', {}, el('span', { class: `badge badge--stage badge--${lead.stage}` }, stageLabel(lead.stage))),
      el('td', {}, lead.follow_up_on ? el('span', { class: isDue(lead) ? 'due' : '' }, plainDate(lead.follow_up_on)) : '—'),
      el('td', {}, ago(lead.last_activity_at)),
    ),
  );
  const empty = el('tr', {},
    el('td', { class: 'table-empty', colSpan: 7 }, state.leads.length ? 'No leads match these filters' : 'No submissions yet'),
  );
  $('table-body').replaceChildren(...(rows.length ? rows : [empty]));
}

const VIEW_TITLES = { pipeline: 'Pipeline', submissions: 'Submissions', documents: 'Files & Documents' };

function render() {
  const { view } = state;
  const onDocuments = view === 'documents';
  $('view-title').textContent = VIEW_TITLES[view];
  $('view-pipeline').hidden = view !== 'pipeline';
  $('view-submissions').hidden = view !== 'submissions';
  $('view-documents').hidden = !onDocuments;
  $('stats').hidden = onDocuments;
  $('filters').hidden = onDocuments;
  $('filter-stage').hidden = view !== 'submissions';
  $('add-lead').hidden = onDocuments;
  $('add-document').hidden = !onDocuments;
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === view));
  if (onDocuments) {
    renderDocuments();
    return;
  }
  renderStats();
  if (view === 'pipeline') renderBoard();
  else renderTable();
}

/* ── Lead detail ── */

async function openLead(id) {
  const lead = state.leads.find((l) => l.id === id);
  if (!lead) {
    toast('That lead is no longer here.', true);
    return;
  }
  if (state.openId !== id) {
    noteDraft = '';
    askIfReplySent = false;
  }
  state.openId = id;
  history.replaceState(null, '', `#lead=${id}`);
  $('scrim').hidden = false;
  $('drawer').hidden = false;
  renderDrawer(lead, null); // details straight away, history when it arrives
  try {
    const activity = await api(`lead_activity?select=*&lead_id=eq.${id}&order=created_at.desc`);
    const current = state.leads.find((l) => l.id === id);
    if (current && state.openId === id) renderDrawer(current, activity);
  } catch (err) {
    fail(err);
  }
}

function closeLead() {
  state.openId = null;
  $('scrim').hidden = true;
  $('drawer').hidden = true;
  if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
}

function renderDrawer(lead, activity) {
  // "@" is left readable; anything that could add extra fields to the email link is encoded
  const mailto = `mailto:${encodeURIComponent(lead.email).replace(/%40/g, '@')}?subject=${encodeURIComponent('Re: your message to Grateful & Grounded Kids')}`;
  const note = el('textarea', {
    class: 'input',
    rows: 3,
    placeholder: 'Write a note, or what was said…',
    value: noteDraft,
    oninput: (e) => {
      noteDraft = e.target.value;
    },
  });
  const log = (kind) => addActivity(lead.id, kind, note.value.trim());

  const section = (heading, ...children) => el('div', { class: 'drawer-section' }, el('div', { class: 'drawer-heading' }, heading), ...children);

  $('drawer').replaceChildren(
    el('div', { class: 'drawer-head' },
      el('h2', { class: 'drawer-name' }, fullName(lead)),
      el('button', { type: 'button', class: 'drawer-close', 'aria-label': 'Close', onclick: closeLead }, '×'),
    ),
    el('p', { class: 'drawer-meta' },
      `${lead.source === 'website' ? 'Sent through the website' : 'Added by hand'} · ${dateTime(lead.created_at)}`,
    ),

    section('Contact',
      el('p', { class: 'contact-line' }, el('a', { href: mailto }, lead.email)),
      lead.phone && el('p', { class: 'contact-line' }, el('a', { href: `tel:${lead.phone.replace(/[^\d+]/g, '')}` }, lead.phone)),
      el('div', { class: 'action-row' },
        el('a', {
          class: 'btn btn-primary btn-sm',
          href: mailto,
          onclick: () => {
            askIfReplySent = true;
            // Let the mail app open first, then show the question
            setTimeout(() => state.openId === lead.id && renderDrawer(lead, activity), 300);
          },
        }, 'Reply by Email'),
        el('span', { class: `badge badge--${lead.topic}` }, lead.topic),
      ),
      askIfReplySent && el('div', { class: 'confirm-bar' },
        'Did the reply go out?',
        el('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => log('email_sent') }, 'Yes, log it'),
        el('button', {
          type: 'button',
          class: 'btn btn-outline btn-sm',
          onclick: () => {
            askIfReplySent = false;
            renderDrawer(lead, activity);
          },
        }, 'Not yet'),
      ),
    ),

    lead.message && section('Message', el('div', { class: 'message' }, lead.message)),

    section('Pipeline',
      el('label', { class: 'field' },
        el('span', { class: 'field-label' }, 'Stage'),
        el('select', { class: 'input', onchange: (e) => setStage(lead.id, e.target.value) },
          STAGES.map((stage) => el('option', { value: stage.id, selected: stage.id === lead.stage }, stage.label)),
        ),
      ),
      el('div', { class: 'field-row' },
        el('label', { class: 'field' },
          el('span', { class: 'field-label' }, 'Follow up on'),
          el('input', {
            type: 'date',
            class: 'input',
            value: lead.follow_up_on || '',
            onchange: (e) => saveField(lead.id, { follow_up_on: e.target.value || null }),
          }),
        ),
        el('label', { class: 'field' },
          el('span', { class: 'field-label' }, 'Estimated value ($)'),
          el('input', {
            type: 'number',
            class: 'input',
            min: 0,
            step: 50,
            value: lead.estimated_value ?? '',
            onchange: (e) => saveField(lead.id, { estimated_value: e.target.value === '' ? null : Number(e.target.value) }),
          }),
        ),
      ),
    ),

    section('Log Activity',
      note,
      el('div', { class: 'action-row' },
        el('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => log('note') }, 'Add Note'),
        el('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => log('call') }, 'Log Call'),
        el('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => log('email_sent') }, 'Reply Sent'),
        el('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => log('reply_received') }, 'They Replied'),
      ),
    ),

    section('History',
      !activity ? el('p', { class: 'timeline-empty' }, 'Loading…')
      : !activity.length ? el('p', { class: 'timeline-empty' }, 'Nothing yet')
      : activity.map((item) =>
          el('div', { class: 'timeline-item' },
            el('div', { class: 'timeline-top' },
              el('span', { class: `timeline-kind timeline-kind--${item.kind}` }, ACTIVITY_KINDS[item.kind] || item.kind),
              el('span', {}, dateTime(item.created_at)),
            ),
            item.body && el('div', { class: 'timeline-body' }, item.body),
          ),
        ),
    ),

    el('div', { class: 'drawer-section' },
      el('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: () => deleteLead(lead) }, 'Delete this lead'),
    ),
  );
}

/* ── Starting up ── */

async function enter() {
  // Signing in is not enough: the account must also hold the admin role
  const roles = await api(`user_roles?select=role&user_id=eq.${state.session.user.id}&role=eq.admin`);
  if (!roles.length) {
    await signOut();
    throw new Error('This account does not have admin access.');
  }
  $('user-email').textContent = state.session.user.email;
  show('app');
  await loadLeads();
  openFromHash();
}

function openFromHash() {
  const match = window.location.hash.match(/^#lead=([0-9a-f-]{36})$/i);
  if (match && state.session && !$('app').hidden) openLead(match[1]);
}

async function start() {
  try {
    const res = await fetch('/api/admin-config', { cache: 'no-store' });
    state.config = res.ok ? await res.json() : null;
  } catch {
    state.config = null;
  }
  if (!state.config?.configured) {
    show('screen-setup');
    return;
  }

  if (handleEmailLink()) return;

  state.session = loadSession();
  if (!state.session) {
    show('screen-login');
    return;
  }
  try {
    await enter();
  } catch (err) {
    saveSession(null);
    show('screen-login');
    if (!(err instanceof SessionEnded)) showLoginError(err.message);
  }
}

/* ── Wiring ── */

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = $('login-submit');
  showLoginError('');
  button.disabled = true;
  button.textContent = 'Signing in…';
  try {
    await signIn($('login-email').value.trim(), $('login-password').value);
    $('login-password').value = '';
    await enter();
  } catch (err) {
    saveSession(null);
    show('screen-login');
    showLoginError(err instanceof SessionEnded ? 'Please sign in again.' : err.message);
  }
  button.disabled = false;
  button.textContent = 'Sign In';
});

$('forgot-link').addEventListener('click', () => {
  $('forgot-email').value = $('login-email').value;
  setNote('forgot-error', '');
  setNote('forgot-note', '');
  show('screen-forgot');
});

$('forgot-back').addEventListener('click', () => {
  showLoginError('');
  show('screen-login');
});

$('forgot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = $('forgot-submit');
  setNote('forgot-error', '');
  setNote('forgot-note', '');
  button.disabled = true;
  button.textContent = 'Sending…';
  try {
    await requestPasswordReset($('forgot-email').value.trim());
    setNote('forgot-note', 'If that email has an admin account, a reset link is on its way. The link can be used once.');
  } catch (err) {
    setNote('forgot-error', err.message);
  }
  button.disabled = false;
  button.textContent = 'Send Reset Link';
});

$('reset-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = $('reset-submit');
  setNote('reset-error', '');
  if (!recovery) {
    // The reset link's session is gone (it was already used on this page); start over from sign-in
    show('screen-login');
    return;
  }
  if ($('reset-password').value !== $('reset-confirm').value) {
    setNote('reset-error', 'The two passwords do not match.');
    return;
  }
  button.disabled = true;
  button.textContent = 'Saving…';
  let saved = false;
  try {
    await saveNewPassword($('reset-password').value);
    saved = true;
    $('reset-password').value = '';
    $('reset-confirm').value = '';
    await enter();
  } catch (err) {
    if (saved) {
      // The password is changed; only getting into the dashboard failed
      saveSession(null);
      show('screen-login');
      showLoginError(err instanceof SessionEnded ? 'Your password was saved. Please sign in.' : err.message);
    } else {
      setNote('reset-error', err.message);
    }
  }
  button.disabled = false;
  button.textContent = 'Save and Sign In';
});

$('sign-out').addEventListener('click', async () => {
  await signOut();
  closeLead();
  state.leads = [];
  show('screen-login');
});

document.querySelectorAll('.tab').forEach((tab) =>
  tab.addEventListener('click', () => {
    state.view = tab.dataset.view;
    render();
    if (state.view === 'documents' && !state.documents) loadDocuments().catch(fail);
  }),
);

$('filter-topic').append(el('option', { value: '' }, 'All topics'), ...TOPICS.map((topic) => el('option', { value: topic }, topic)));
$('filter-stage').append(el('option', { value: '' }, 'All stages'), ...STAGES.map((stage) => el('option', { value: stage.id }, stage.label)));
$('add-topic').append(...TOPICS.map((topic) => el('option', { value: topic }, topic)));

$('filter-search').addEventListener('input', (e) => {
  state.search = e.target.value;
  render();
});
$('filter-topic').addEventListener('change', (e) => {
  state.topic = e.target.value;
  render();
});
$('filter-stage').addEventListener('change', (e) => {
  state.stage = e.target.value;
  render();
});

$('refresh').addEventListener('click', () =>
  (state.view === 'documents' ? loadDocuments() : loadLeads()).then(() => toast('Up to date')).catch(fail),
);

$('add-lead').addEventListener('click', () => $('add-dialog').showModal());
$('add-cancel').addEventListener('click', () => $('add-dialog').close());
$('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const text = (name) => String(form.get(name) || '').trim();
  try {
    const rows = await api('leads', {
      method: 'POST',
      returning: true,
      body: {
        first_name: text('first_name'),
        last_name: text('last_name') || null,
        email: text('email').toLowerCase(),
        phone: text('phone') || null,
        topic: text('topic'),
        message: text('message') || null,
        source: 'manual',
      },
    });
    await api('lead_activity', { method: 'POST', body: { lead_id: rows[0].id, kind: 'system', body: 'Added by hand' } });
    state.leads = [rows[0], ...state.leads];
    e.target.reset();
    $('add-dialog').close();
    render();
    toast('Lead added');
    openLead(rows[0].id);
  } catch (err) {
    fail(err);
  }
});

$('doc-section').append(el('option', { value: '' }, 'Choose a section…'), ...['chores-work', 'finances', 'technology'].map((id) =>
  el('option', { value: id }, { 'chores-work': 'Chores & Work', finances: 'Finances', technology: 'Technology' }[id]),
));
$('add-document').addEventListener('click', () => openDocumentDialog());
$('doc-cancel').addEventListener('click', () => $('doc-dialog').close());
$('doc-choose').addEventListener('click', () => $('doc-file').click());
$('doc-file').addEventListener('change', () => {
  setChosenFile();
  const file = $('doc-file').files[0];
  if (file && !editing && !$('doc-title').value) $('doc-title').value = file.name.replace(/\.[^.]+$/, '');
});
$('doc-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = $('doc-file').files[0];
  const problem =
    !editing && !file ? 'Please choose a file to upload.'
    : file && !file.size ? 'That file is empty.'
    : file && file.size > MAX_FILE_BYTES ? 'Files can be up to 25 MB.'
    : '';
  setNote('doc-error', problem);
  if (problem) return;

  const button = $('doc-save');
  button.disabled = true;
  state.documentsBusy = true;
  try {
    button.textContent = file ? 'Uploading…' : 'Saving…';
    const blobSha = file ? await uploadFile(file) : undefined;
    button.textContent = 'Saving…';
    await publish({
      action: editing ? 'update' : 'add',
      section: editing ? editing.section.id : $('doc-section').value,
      file: editing?.doc.file,
      title: $('doc-title').value,
      description: $('doc-description').value,
      fileName: file?.name,
      blobSha,
    });
    $('doc-dialog').close();
  } catch (err) {
    if (err instanceof SessionEnded) {
      $('doc-dialog').close();
      fail(err);
    } else {
      setNote('doc-error', err.message);
    }
  }
  state.documentsBusy = false;
  button.disabled = false;
  button.textContent = 'Save and Publish';
  renderDocuments();
});

$('scrim').addEventListener('click', closeLead);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.openId) closeLead();
});
window.addEventListener('hashchange', () => {
  if (state.config?.configured && handleEmailLink()) return;
  openFromHash();
});

// Pick up new submissions without a manual refresh. A dropped connection stays quiet; an ended session does not.
setInterval(() => {
  if (document.hidden || !state.session || $('app').hidden) return;
  loadLeads().catch((err) => {
    if (err instanceof SessionEnded) fail(err);
  });
}, REFRESH_EVERY_MS);

start();
