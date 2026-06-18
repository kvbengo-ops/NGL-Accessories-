import { requireAdmin, renderSidebar, showToast, escapeHtml } from './admin.js';
import { supabase } from './supabase.js';

let adminUser = null;
let conversations = [];
let messages = {}; // conversation_id -> message[]
let activeConversationId = null;
let knownNeedsHuman = new Set();
let firstLoad = true;

async function init() {
  adminUser = await requireAdmin();
  renderSidebar('Live Chat', adminUser);

  document.getElementById('btn-takeover').addEventListener('click', handleTakeover);
  document.getElementById('btn-resolve').addEventListener('click', handleResolve);
  document.getElementById('support-admin-send').addEventListener('click', handleReply);

  const inputEl = document.getElementById('support-admin-input');
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleReply();
    }
  });
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  });

  await loadConversations();
  setupRealtime();
}

async function loadConversations() {
  const { data, error } = await supabase
    .from('support_conversations')
    .select('*')
    .order('last_message_at', { ascending: false });

  if (error) {
    console.error('load conversations failed', error);
    document.getElementById('support-queue-list').innerHTML =
      `<div class="support-empty-state">Couldn't load chats: ${escapeHtml(error.message)}</div>`;
    return;
  }
  conversations = data || [];

  // Toast when a NEW conversation needs a human (not on first load).
  const current = new Set(conversations.filter((c) => c.status === 'needs_human').map((c) => c.id));
  if (!firstLoad) {
    for (const id of current) {
      if (!knownNeedsHuman.has(id)) { showToast('A customer needs a human 💬'); break; }
    }
  }
  knownNeedsHuman = current;
  firstLoad = false;

  renderQueue();

  // Keep the open thread's header/buttons in sync with fresh data.
  if (activeConversationId) {
    const convo = conversations.find((c) => c.id === activeConversationId);
    if (convo) {
      setStatusBadge(convo.status);
      updateActionButtons(convo);
    }
  }
}

function renderQueue() {
  const listEl = document.getElementById('support-queue-list');
  listEl.innerHTML = '';

  const sorted = [...conversations].sort((a, b) => {
    const rank = { needs_human: 0, with_admin: 1, ai: 2, resolved: 3 };
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return new Date(b.last_message_at) - new Date(a.last_message_at);
  });

  if (sorted.length === 0) {
    listEl.innerHTML = '<div class="support-empty-state">No conversations yet.</div>';
    return;
  }

  sorted.forEach((c) => {
    const el = document.createElement('div');
    el.className = `support-queue-item ${c.id === activeConversationId ? 'active' : ''}`;
    if (c.status === 'needs_human') el.classList.add('urgent');

    let badgeHtml = '';
    if (c.status === 'needs_human') badgeHtml = '<span class="status-dot red"></span>';
    else if (c.status === 'with_admin') badgeHtml = '<span class="status-dot green"></span>';

    const unreadHtml = c.unread_admin > 0 ? `<span class="unread-badge">${c.unread_admin}</span>` : '';
    const preview = c.last_preview ? `<div class="queue-item-preview">${escapeHtml(c.last_preview)}</div>` : '';

    el.innerHTML = `
      <div class="queue-item-header">
        <strong>${escapeHtml(c.customer_name || 'Anonymous')}</strong>
        ${unreadHtml}
      </div>
      <div class="queue-item-meta">
        ${badgeHtml} ${c.status.replace('_', ' ')}
      </div>
      ${preview}
    `;
    el.addEventListener('click', () => selectConversation(c.id));
    listEl.appendChild(el);
  });
}

async function selectConversation(id) {
  activeConversationId = id;
  const convo = conversations.find((c) => c.id === id);
  if (!convo) return;

  // Clear the admin unread badge (DB + local).
  if (convo.unread_admin > 0) {
    convo.unread_admin = 0;
    supabase.from('support_conversations').update({ unread_admin: 0 }).eq('id', id)
      .then(({ error }) => { if (error) console.error('reset unread failed', error); });
  }
  renderQueue();

  document.getElementById('support-thread-empty').classList.add('hidden');
  document.getElementById('support-thread-content').classList.remove('hidden');
  document.getElementById('support-thread-name').textContent = convo.customer_name || convo.customer_email || 'Anonymous';
  setStatusBadge(convo.status);
  updateActionButtons(convo);

  await loadMessages(id);
}

function setStatusBadge(status) {
  const el = document.getElementById('support-thread-status');
  el.className = `status-badge ${getStatusClass(status)}`;
  el.textContent = status.replace('_', ' ');
}

function getStatusClass(status) {
  if (status === 'needs_human') return 'badge--error';
  if (status === 'with_admin') return 'badge--info';
  if (status === 'resolved') return 'badge--success';
  return 'badge--purple'; // ai
}

function updateActionButtons(convo) {
  const isWithMe = convo.status === 'with_admin' && convo.assigned_admin === adminUser.id;
  const canReply = convo.status === 'needs_human' || convo.status === 'ai' || isWithMe;
  document.getElementById('support-admin-input').disabled = !canReply;
  document.getElementById('support-admin-send').disabled = !canReply;
  document.getElementById('btn-takeover').style.display =
    convo.status === 'with_admin' || convo.status === 'resolved' ? 'none' : 'block';
  document.getElementById('btn-resolve').style.display = convo.status === 'resolved' ? 'none' : 'block';
}

async function loadMessages(convoId) {
  const { data, error } = await supabase
    .from('support_messages')
    .select('*')
    .eq('conversation_id', convoId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('load messages failed', error);
    return;
  }
  messages[convoId] = data || [];
  renderMessages(convoId);
}

function renderMessages(convoId) {
  if (convoId !== activeConversationId) return;
  const container = document.getElementById('support-thread-messages');
  container.innerHTML = '';
  (messages[convoId] || []).forEach((msg) => {
    const el = document.createElement('div');
    el.className = `support-message support-message--${msg.role}`;
    el.dataset.id = msg.id;
    el.innerHTML = `<div class="bubble">${escapeHtml(msg.body)}</div>`;
    container.appendChild(el);
  });
  container.scrollTop = container.scrollHeight;
}

async function handleTakeover() {
  if (!activeConversationId) return;
  const { error } = await supabase
    .from('support_conversations')
    .update({ status: 'with_admin', assigned_admin: adminUser.id })
    .eq('id', activeConversationId);
  if (error) { showToast('Take over failed: ' + error.message, 'error'); return; }

  const convo = conversations.find((c) => c.id === activeConversationId);
  if (convo) { convo.status = 'with_admin'; convo.assigned_admin = adminUser.id; setStatusBadge('with_admin'); updateActionButtons(convo); }
  renderQueue();
  showToast('You have taken over this chat');
}

async function handleResolve() {
  if (!activeConversationId) return;
  const { error } = await supabase
    .from('support_conversations')
    .update({ status: 'resolved' })
    .eq('id', activeConversationId);
  if (error) { showToast('Resolve failed: ' + error.message, 'error'); return; }

  const convo = conversations.find((c) => c.id === activeConversationId);
  if (convo) { convo.status = 'resolved'; setStatusBadge('resolved'); updateActionButtons(convo); }
  renderQueue();
  showToast('Chat marked as resolved');
}

async function handleReply() {
  const inputEl = document.getElementById('support-admin-input');
  const text = inputEl.value.trim();
  if (!text || !activeConversationId) return;
  inputEl.value = '';
  inputEl.style.height = 'auto';

  const convo = conversations.find((c) => c.id === activeConversationId);

  // Replying implicitly takes over the chat (so the AI stays silent).
  if (convo && convo.status !== 'with_admin') {
    const { error: upErr } = await supabase
      .from('support_conversations')
      .update({ status: 'with_admin', assigned_admin: adminUser.id })
      .eq('id', activeConversationId);
    if (!upErr) { convo.status = 'with_admin'; convo.assigned_admin = adminUser.id; setStatusBadge('with_admin'); updateActionButtons(convo); renderQueue(); }
  }

  const { error } = await supabase
    .from('support_messages')
    .insert({ conversation_id: activeConversationId, role: 'admin', body: text, admin_id: adminUser.id });
  if (error) { showToast('Send failed: ' + error.message, 'error'); return; }

  // The DB trigger broadcasts it to the customer; refresh our own view.
  await loadMessages(activeConversationId);
}

function setupRealtime() {
  supabase
    .channel('support-admin')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'support_conversations' }, () => {
      loadConversations();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, (payload) => {
      const m = payload.new;
      if (!m) return;
      if (m.conversation_id === activeConversationId) {
        if (!messages[m.conversation_id]) messages[m.conversation_id] = [];
        if (!messages[m.conversation_id].some((x) => x.id === m.id)) {
          messages[m.conversation_id].push(m);
          renderMessages(m.conversation_id);
        }
      }
      loadConversations(); // refresh queue ordering / unread / previews
    })
    .subscribe();
}

document.addEventListener('DOMContentLoaded', init);
