/* ═══════════════════════════════════════
   GRATEFUL & GROUNDED KIDS — Admin dashboard
   Sign-in, lead pipeline, submissions list and
   the history on each lead.

   Talks to Supabase straight from the browser.
   Row-level security there decides what a signed-in
   account may read, so nothing here is the lock.
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

const state = {
  config: null,   // { supabaseUrl, supabaseKey }
  session: null,  // { access_token, refresh_token, expires_at, user }
  leads: [],
  view: 'pipeline',
  search: '',
  topic: '',
  stage: '',
  openId: null,
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
  for (const id of ['screen-loading', 'screen-setup', 'screen-login', 'app']) $(id).hidden = id !== screen;
}

function showLoginError(message) {
  $('login-error').textContent = message;
  $('login-error').hidden = !message;
}

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
  const res = await fetch(`${state.config.supabaseUrl}/auth/v1/${path}`, {
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

/* ── Supabase: data ── */

async function api(path, { method = 'GET', body, returning = false } = {}, isRetry = false) {
  if (state.session.expires_at - 60 < Date.now() / 1000) await refreshSession();
  const res = await fetch(`${state.config.supabaseUrl}/rest/v1/${path}`, {
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

function render() {
  const onPipeline = state.view === 'pipeline';
  renderStats();
  $('view-title').textContent = onPipeline ? 'Pipeline' : 'Submissions';
  $('view-pipeline').hidden = !onPipeline;
  $('view-submissions').hidden = onPipeline;
  $('filter-stage').hidden = onPipeline;
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === state.view));
  if (onPipeline) renderBoard();
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

$('refresh').addEventListener('click', () => loadLeads().then(() => toast('Up to date')).catch(fail));

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

$('scrim').addEventListener('click', closeLead);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.openId) closeLead();
});
window.addEventListener('hashchange', openFromHash);

// Pick up new submissions without a manual refresh. A dropped connection stays quiet; an ended session does not.
setInterval(() => {
  if (document.hidden || !state.session || $('app').hidden) return;
  loadLeads().catch((err) => {
    if (err instanceof SessionEnded) fail(err);
  });
}, REFRESH_EVERY_MS);

start();
