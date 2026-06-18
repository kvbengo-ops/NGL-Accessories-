import {
  getStoreSettings,
  supabase,
  startSupportChat,
  fetchSupportThread,
  setSupportContact,
} from './supabase.js';

// Send a customer message to the AI backend (Cloudflare Worker → /api/support).
// Returns { status, escalated, message: { id, role, body, created_at } | null }.
// NOTE: /api/support only exists under `wrangler dev` or a Cloudflare deploy —
// Vite's `npm run dev` does NOT serve it, so sends will fail there by design.
async function postSupportMessage(conversationId, accessToken, message) {
  const res = await fetch('/api/support', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation_id: conversationId, access_token: accessToken, message }),
  });
  if (!res.ok) throw new Error(`support backend returned ${res.status}`);
  return res.json();
}

let widgetConfig = {
  conversation_id: null,
  access_token: null,
  isEscalated: false
};

async function initWidget() {
  const settings = await getStoreSettings();
  if (settings.support_enabled !== 'true') return;

  const container = document.createElement('div');
  container.className = 'support-widget-container';
  container.innerHTML = `
    <button class="support-fab" id="support-fab" aria-label="Open support chat" aria-expanded="false">
      <span class="material-symbols-outlined">chat_bubble</span>
    </button>
    <div class="support-panel" id="support-panel" aria-hidden="true">
      <div class="support-header">
        <div class="support-title">
          <span class="material-symbols-outlined">support_agent</span>
          <div>
            <h3>NGL Support</h3>
            <p>Usually replies instantly</p>
          </div>
        </div>
        <button class="support-close" id="support-close" aria-label="Close support chat">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <div class="support-messages" id="support-messages" role="log" aria-live="polite">
        <!-- Messages go here -->
      </div>
      <div class="support-escalation-form hidden" id="support-escalation-form">
        <p>Connecting you with our team — leave your name & email so we can follow up:</p>
        <input type="text" id="support-name" placeholder="Your Name" required />
        <input type="email" id="support-email" placeholder="Your Email" required />
        <button id="support-submit-contact">Send</button>
      </div>
      <div class="support-input-area" id="support-input-area">
        <textarea id="support-input" placeholder="Type your message..." rows="1" aria-label="Type message"></textarea>
        <button id="support-send" aria-label="Send message">
          <span class="material-symbols-outlined">send</span>
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(container);

  const fab = document.getElementById('support-fab');
  const panel = document.getElementById('support-panel');
  const closeBtn = document.getElementById('support-close');
  const messagesEl = document.getElementById('support-messages');
  const inputEl = document.getElementById('support-input');
  const sendBtn = document.getElementById('support-send');
  const escalationForm = document.getElementById('support-escalation-form');
  const inputArea = document.getElementById('support-input-area');

  let isSending = false;

  fab.addEventListener('click', async () => {
    panel.setAttribute('aria-hidden', 'false');
    fab.setAttribute('aria-expanded', 'true');
    panel.classList.add('open');
    inputEl.focus();

    if (!widgetConfig.conversation_id) {
      try {
        const saved = localStorage.getItem('ngl_support');
        let parsed = saved ? JSON.parse(saved) : null;
        // Ignore stale stub tokens from earlier builds.
        if (parsed && (parsed.conversation_id === 'conv_stub' || !parsed.access_token)) {
          parsed = null;
          localStorage.removeItem('ngl_support');
        }

        if (parsed) {
          widgetConfig.conversation_id = parsed.conversation_id;
          widgetConfig.access_token = parsed.access_token;
          const history = await fetchSupportThread(widgetConfig.conversation_id, widgetConfig.access_token);
          renderHistory(history);
        } else {
          const res = await startSupportChat(window.location.pathname);
          widgetConfig.conversation_id = res.conversation_id;
          widgetConfig.access_token = res.access_token;
          localStorage.setItem('ngl_support', JSON.stringify({
            conversation_id: res.conversation_id,
            access_token: res.access_token,
          }));
          appendMessage({ role: 'ai', body: res.greeting });
        }
        setupRealtime();
      } catch (err) {
        console.error('support init failed', err);
        appendMessage({ role: 'system', body: 'Sorry — chat is unavailable right now. Please email us and we\'ll help.' });
      }
    }
  });

  closeBtn.addEventListener('click', () => {
    panel.setAttribute('aria-hidden', 'true');
    fab.setAttribute('aria-expanded', 'false');
    panel.classList.remove('open');
  });

  function appendMessage(msg) {
    const el = document.createElement('div');
    el.className = `support-message support-message--${msg.role}`;
    el.dataset.id = msg.id || Date.now().toString();
    el.innerHTML = `<div class="bubble">${escapeHtml(msg.body)}</div>`;
    
    // Dedupe
    if (msg.id && messagesEl.querySelector(`[data-id="${msg.id}"]`)) return;
    
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderHistory(history) {
    messagesEl.innerHTML = '';
    history.forEach(appendMessage);
  }

  function showTyping() {
    const el = document.createElement('div');
    el.className = 'support-message support-message--typing';
    el.id = 'support-typing';
    el.innerHTML = `<div class="bubble"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>`;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function hideTyping() {
    const el = document.getElementById('support-typing');
    if (el) el.remove();
  }

  function escapeHtml(unsafe) {
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  async function handleSend() {
    const text = inputEl.value.trim();
    if (!text || isSending) return;
    
    isSending = true;
    inputEl.value = '';
    inputEl.style.height = 'auto';
    sendBtn.disabled = true;

    appendMessage({ role: 'customer', body: text });
    showTyping();

    try {
      const res = await postSupportMessage(widgetConfig.conversation_id, widgetConfig.access_token, text);
      hideTyping();
      if (res.message) {
        appendMessage(res.message);
      }
      if (res.escalated || res.status === 'needs_human' || res.status === 'with_admin') {
        triggerEscalation();
      }
    } catch (e) {
      hideTyping();
      appendMessage({ role: 'system', body: 'Failed to send message. Please try again.' });
    } finally {
      isSending = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }
  }

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
  });

  sendBtn.addEventListener('click', handleSend);

  function triggerEscalation() {
    if (widgetConfig.isEscalated) return; // prompt for contact details only once
    widgetConfig.isEscalated = true;
    // Keep the input usable so the customer can keep chatting with the human.
    escalationForm.classList.remove('hidden');
  }

  document.getElementById('support-submit-contact').addEventListener('click', async () => {
    const name = document.getElementById('support-name').value;
    const email = document.getElementById('support-email').value;
    if (!name || !email) return;
    
    await setSupportContact(widgetConfig.conversation_id, widgetConfig.access_token, name, email);

    escalationForm.classList.add('hidden');
    appendMessage({ role: 'system', body: "Thanks! You're connected to our team — keep chatting here and they'll reply." });
    inputEl.focus();
  });

  function setupRealtime() {
    if (!widgetConfig.access_token) return;
    supabase
      .channel(`convo:${widgetConfig.access_token}`)
      .on('broadcast', { event: 'message' }, ({ payload }) => {
        // Ignore our own echoes; show AI / admin / system messages live.
        if (!payload || payload.role === 'customer') return;
        hideTyping();
        appendMessage(payload);
      })
      .subscribe();
  }
}

document.addEventListener('DOMContentLoaded', initWidget);
