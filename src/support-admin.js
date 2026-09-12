import { requireAdmin, renderSidebar, showToast, escapeHtml } from './admin.js';
import { supabase } from './supabase.js';

let adminUser = null;
let conversations = [];
let messages = {}; // conversation_id -> message[]
let activeConversationId = null;
let knownNeedsHuman = new Set();
let firstLoad = true;
const drafts = new Map();
const sending = new Set();
const statusLabels = { needs_human: 'Needs a reply', with_admin: 'With support', ai: 'With assistant', resolved: 'Resolved' };

async function init() {
  adminUser = await requireAdmin();
  renderSidebar('Live Chat', adminUser);

  document.getElementById('btn-takeover').addEventListener('click', handleTakeover);
  document.getElementById('btn-resolve').addEventListener('click', handleResolve);
  document.getElementById('support-admin-send').addEventListener('click', handleReply);
  document.getElementById('chat-search').addEventListener('input', renderQueue);
  document.getElementById('chat-filter').addEventListener('change', renderQueue);
  document.getElementById('chat-refresh').addEventListener('click', loadConversations);
  document.getElementById('chat-back').addEventListener('click', () => {
    document.querySelector('.support-admin-layout').classList.remove('thread-open');
    document.querySelector('.support-queue-item.active')?.focus();
  });

  const inputEl = document.getElementById('support-admin-input');
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      handleReply();
    }
  });
  inputEl.addEventListener('input', () => {
    if (activeConversationId) drafts.set(activeConversationId, inputEl.value);
    const convo = conversations.find(c => c.id === activeConversationId);
    if (convo) updateActionButtons(convo);
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

  const query = document.getElementById('chat-search').value.trim().toLowerCase();
  const filter = document.getElementById('chat-filter').value;
  const sorted = conversations.filter(c => {
    const matchesText = [c.customer_name, c.customer_email, c.last_preview].some(value => (value || '').toLowerCase().includes(query));
    const matchesStatus = filter === 'all' || (filter === 'open' ? c.status !== 'resolved' : filter === 'mine' ? c.status === 'with_admin' && c.assigned_admin === adminUser.id : c.status === filter);
    return matchesText && matchesStatus;
  }).sort((a, b) => {
    const rank = { needs_human: 0, with_admin: 1, ai: 2, resolved: 3 };
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return new Date(b.last_message_at) - new Date(a.last_message_at);
  });
  document.getElementById('chat-queue-count').textContent = sorted.length;

  if (sorted.length === 0) {
    listEl.innerHTML = '<div class="support-empty-state">No conversations in this view. Try another filter or search.</div>';
    return;
  }

  sorted.forEach((c) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.setAttribute('aria-pressed', String(c.id === activeConversationId));
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
        <span>${badgeHtml} ${statusLabels[c.status] || 'Conversation'}</span>
        <time>${c.last_message_at ? new Date(c.last_message_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}</time>
      </div>
      ${preview}
    `;
    el.addEventListener('click', () => selectConversation(c.id));
    listEl.appendChild(el);
  });
}

async function selectConversation(id) {
  if (activeConversationId) drafts.set(activeConversationId, document.getElementById('support-admin-input').value);
  activeConversationId = id;
  const convo = conversations.find((c) => c.id === id);
  if (!convo) return;
  document.querySelector('.support-admin-layout').classList.add('thread-open');
  const input = document.getElementById('support-admin-input');
  input.value = drafts.get(id) || '';
  input.style.height = 'auto';

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
  document.getElementById('support-thread-email').textContent = convo.customer_email || '';
  document.getElementById('support-thread-messages').innerHTML = '<div class="support-empty-state">Loading messages…</div>';
  setStatusBadge(convo.status);
  updateActionButtons(convo);

  await loadMessages(id);
}

function setStatusBadge(status) {
  const el = document.getElementById('support-thread-status');
  el.className = `status-badge ${getStatusClass(status)}`;
  el.textContent = statusLabels[status] || 'Conversation';
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
  const busy = sending.has(convo.id);
  document.getElementById('support-admin-input').disabled = !canReply || busy;
  document.getElementById('support-admin-send').disabled = !canReply || busy || !document.getElementById('support-admin-input').value.trim();
  document.getElementById('support-admin-send').querySelector('span').textContent = busy ? 'Sending…' : 'Send';
  document.getElementById('btn-resolve').disabled = busy;
  document.getElementById('btn-takeover').disabled = busy;
  document.getElementById('chat-reply-hint').textContent = convo.status === 'resolved' ? 'This conversation is resolved. Replying is closed.' : !canReply ? 'Another team member is handling this conversation.' : isWithMe ? 'You are replying as support.' : 'Sending a reply assigns this conversation to you and pauses the assistant.';
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
    if (convoId === activeConversationId) document.getElementById('support-thread-messages').innerHTML = '<div class="support-empty-state">Messages could not be loaded. Select this conversation again to retry.</div>';
    return;
  }
  messages[convoId] = data || [];
  renderMessages(convoId);
}

function renderMessages(convoId) {
  if (convoId !== activeConversationId) return;
  const container = document.getElementById('support-thread-messages');
  const stayAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80 || !container.querySelector('.support-message');
  container.innerHTML = '';
  if (!(messages[convoId] || []).length) container.innerHTML = '<div class="support-empty-state">No messages yet.</div>';
  (messages[convoId] || []).forEach((msg) => {
    const el = document.createElement('div');
    el.className = `support-message support-message--${msg.role}`;
    el.dataset.id = msg.id;
    const sender = { admin: 'Support', ai: 'Assistant', customer: 'Customer', system: 'System' }[msg.role] || 'Message';
    const time = msg.created_at ? new Date(msg.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    el.innerHTML = `<div class="chat-message-meta">${sender} · ${escapeHtml(time)}</div><div class="bubble">${escapeHtml(msg.body)}</div>`;
    container.appendChild(el);
  });
  if (stayAtBottom) container.scrollTop = container.scrollHeight;
}

async function handleTakeover() {
  const id = activeConversationId;
  if (!id) return;
  const { error } = await supabase
    .from('support_conversations')
    .update({ status: 'with_admin', assigned_admin: adminUser.id })
    .eq('id', id);
  if (error) { showToast('Take over failed: ' + error.message, 'error'); return; }

  const convo = conversations.find((c) => c.id === id);
  if (convo) { convo.status = 'with_admin'; convo.assigned_admin = adminUser.id; if (activeConversationId === id) { setStatusBadge('with_admin'); updateActionButtons(convo); } }
  renderQueue();
  showToast('You have taken over this chat');
}

async function handleResolve() {
  const id = activeConversationId;
  if (!id) return;
  const { error } = await supabase
    .from('support_conversations')
    .update({ status: 'resolved' })
    .eq('id', id);
  if (error) { showToast('Resolve failed: ' + error.message, 'error'); return; }

  const convo = conversations.find((c) => c.id === id);
  if (convo) { convo.status = 'resolved'; if (activeConversationId === id) { setStatusBadge('resolved'); updateActionButtons(convo); } }
  renderQueue();
  showToast('Chat marked as resolved');
}

async function handleReply() {
  const id = activeConversationId;
  const inputEl = document.getElementById('support-admin-input');
  const text = inputEl.value.trim();
  const convo = conversations.find(c => c.id === id);
  if (!text || !convo || sending.has(id) || inputEl.disabled) return;
  const canReply = ['needs_human', 'ai'].includes(convo.status) || (convo.status === 'with_admin' && convo.assigned_admin === adminUser.id);
  if (!canReply) return;
  drafts.set(id, inputEl.value);
  sending.add(id);
  updateActionButtons(convo);
  try {
    if (convo.status !== 'with_admin') {
      const { error } = await supabase.from('support_conversations')
        .update({ status: 'with_admin', assigned_admin: adminUser.id }).eq('id', id);
      if (error) throw error;
      convo.status = 'with_admin';
      convo.assigned_admin = adminUser.id;
    }
    const { error } = await supabase.from('support_messages')
      .insert({ conversation_id: id, role: 'admin', body: text, admin_id: adminUser.id });
    if (error) throw error;
    drafts.delete(id);
    if (activeConversationId === id) {
      inputEl.value = '';
      inputEl.style.height = 'auto';
    }
    await loadMessages(id);
  } catch (error) {
    showToast('Reply not sent. Your draft is saved. ' + error.message, 'error');
  } finally {
    sending.delete(id);
    if (activeConversationId === id) {
      const current = conversations.find(c => c.id === id) || convo;
      setStatusBadge(current.status);
      updateActionButtons(current);
      if (!inputEl.disabled) inputEl.focus();
    }
    renderQueue();
  }
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
