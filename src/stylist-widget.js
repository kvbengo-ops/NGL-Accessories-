import './stylist.css';
import { getProducts, cfImg } from './supabase.js';
import { publicProduct, isOrderHelp } from './stylist-engine.js';
import { addCatalogProduct, readCart } from './cart-store.js';

const money = n => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = name => `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;
const starters = [['celebration', 'Wedding guest'], ['wb_sunny', 'Everyday essentials'], ['work_outline', 'Office looks'], ['favorite_border', 'Date night'], ['redeem', 'Find a gift'], ['sell', 'Under ₱1,000']];

export function initStylist({ tryOn = false, getTryOnProduct, canTryOnProduct, onTryOnProduct } = {}) {
  if (document.querySelector('.stylist-root')) return;
  const root = document.createElement('div');
  root.className = tryOn ? 'stylist-root stylist-root--try-on' : 'stylist-root';
  const panelTag = tryOn ? 'section' : 'dialog';
  root.innerHTML = `<button class="stylist-launch" aria-haspopup="dialog" aria-label="Ask NGL Stylist" aria-expanded="false">${icon('auto_awesome')}<span>Ask a stylist</span><span class="stylist-launch-dot"></span></button>
    <${panelTag} class="stylist-panel" id="stylist-panel" aria-labelledby="stylist-title" ${tryOn ? 'role="dialog" aria-modal="false" hidden' : ''}>
      <header class="stylist-header"><div class="stylist-monogram">N</div><div class="stylist-heading"><h2 id="stylist-title">NGL <em>Stylist</em></h2><p>AI-assisted styling · real NGL pieces</p></div><button class="stylist-icon" data-reset aria-label="Start a new styling conversation" title="Start over">${icon('restart_alt')}</button><button class="stylist-icon" data-close aria-label="Close stylist">${icon('close')}</button></header>
      <div class="stylist-brief" hidden></div>
      <div class="stylist-scroll"><section class="stylist-welcome">
        <div class="stylist-editorial"><img src="/images/natural-collection-minimalist-gold-jewelry.png" alt="Jewelry styling inspiration" /><span>THE FINISHING TOUCH</span></div>
        <div class="stylist-intro"><span class="stylist-eyebrow">A LITTLE GUIDANCE. A LOT OF YOU.</span><h3>What are you<br/>dressing <em>for?</em></h3><p>An occasion, an outfit, or just a feeling.<br/>Let’s find the pieces that feel like you.</p></div>
        <div class="stylist-starters">${starters.map(([i, label]) => `<button data-prompt="${esc(label)}">${icon(i)}${esc(label)}${icon('north_east')}</button>`).join('')}</div>
      </section><div class="stylist-thread" role="log" aria-label="Styling conversation" aria-live="polite" aria-relevant="additions"></div></div>
      <div class="stylist-status" role="status"></div>
      <footer class="stylist-footer"><form class="stylist-form"><label for="stylist-message" class="stylist-sr">Describe your occasion, outfit or budget</label><textarea id="stylist-message" rows="1" maxlength="2000" placeholder="A black dress. Date night. Your ideas?" required></textarea><button type="submit" aria-label="Send message">${icon('arrow_upward')}</button></form><div class="stylist-footnote"><span>Thoughtful picks. Your choice.</span><a href="/support.html?chat=1">Help with an order ${icon('north_east')}</a></div></footer>
    </${panelTag}>`;
  document.body.append(root);
  const panel = root.querySelector('.stylist-panel'), launcher = root.querySelector('.stylist-launch');
  launcher.setAttribute('aria-controls', 'stylist-panel');
  const isOpen = () => tryOn ? !panel.hidden : panel.open;
  const thread = root.querySelector('.stylist-thread'), scroll = root.querySelector('.stylist-scroll');
  const input = root.querySelector('textarea'), form = root.querySelector('form'), send = form.querySelector('button');
  const status = root.querySelector('.stylist-status'), briefEl = root.querySelector('.stylist-brief');
  let brief = {}, lastPicks = [], history = [], busy = false, generation = 0, returnFocus;
  if (tryOn) {
    const context = document.createElement('div');
    context.className = 'stylist-try-on-context';
    const label = document.createElement('span');
    label.textContent = 'IN YOUR MIRROR';
    const name = document.createElement('strong');
    context.append(label, name);
    panel.querySelector('.stylist-header').after(context);
    const updateSelection = () => {
      const product = getTryOnProduct?.();
      context.hidden = !product;
      name.textContent = product?.name || '';
    };
    window.addEventListener('ngl:try-on-selected', updateSelection);
    updateSelection();
    input.placeholder = 'Describe your outfit or ask a question…';
    root.querySelector('.stylist-intro').innerHTML = '<p>Need help choosing? Tell me your outfit or occasion.</p>';
    root.querySelector('.stylist-starters').innerHTML = [
      ['How can I style these earrings?', 'Style this pair'],
      ['Suggest earrings for everyday wear', 'Everyday'],
      ['Suggest earrings for date night', 'Date night'],
    ].map(([prompt, label]) => `<button type="button" data-prompt="${esc(prompt)}">${label}</button>`).join('');
  }
  function fitKeyboard() {
    if (tryOn) {
      if (!isOpen()) return;
      const viewport = window.visualViewport;
      const visibleHeight = viewport?.height || window.innerHeight;
      const mobile = matchMedia('(max-width: 700px)').matches;
      const preferredHeight = mobile ? Math.min(440, window.innerHeight * 0.58) : 620;
      const height = Math.max(0, Math.min(preferredHeight, visibleHeight - 24));
      panel.style.height = `${height}px`;
      panel.style.maxHeight = `${height}px`;
      panel.style.top = `${(viewport?.offsetTop || 0) + visibleHeight - height - 12}px`;
      panel.style.bottom = 'auto';
      return;
    }
    if (matchMedia('(max-width: 600px)').matches && window.visualViewport) {
      panel.style.height = `${window.visualViewport.height}px`;
      panel.style.top = `${window.visualViewport.offsetTop}px`;
    } else { panel.style.height = ''; panel.style.top = ''; }
  }
  window.visualViewport?.addEventListener('resize', fitKeyboard);
  window.visualViewport?.addEventListener('scroll', fitKeyboard);
  window.addEventListener('resize', fitKeyboard);

  function open() {
    if (isOpen()) return;
    returnFocus = document.activeElement;
    if (tryOn) { panel.hidden = false; root.dataset.open = 'true'; }
    else panel.showModal();
    fitKeyboard(); launcher.setAttribute('aria-expanded', 'true');
    // Don't raise a phone keyboard before the shopper has picked an occasion.
    if (!tryOn && matchMedia('(min-width: 601px)').matches) input.focus();
    else root.querySelector('[data-close]').focus({ preventScroll: true });
  }
  function restoreFocus() {
    launcher.setAttribute('aria-expanded', 'false');
    returnFocus?.focus({ preventScroll: true });
  }
  function close() {
    if (tryOn) {
      input.blur();
      panel.hidden = true;
      root.dataset.open = 'false';
      restoreFocus();
    } else panel.close();
  }
  if (!tryOn) panel.addEventListener('close', restoreFocus);
  launcher.addEventListener('click', () => { if (isOpen()) close(); else open(); });
  if (tryOn) panel.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  root.querySelector('[data-close]').addEventListener('click', close);
  panel.addEventListener('click', e => { if (e.target === panel) { const r = panel.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(); } });
  document.querySelectorAll('[data-open-stylist]').forEach(button => button.addEventListener('click', open));

  function updateBrief() {
    const tags = [brief.occasion, brief.theme, brief.outfit, brief.vibe, brief.metal, ...(brief.categories || []), brief.budget != null ? `Up to ${money(brief.budget)}${brief.set ? ' total' : ''}` : ''].filter(Boolean);
    briefEl.hidden = !tags.length;
    briefEl.innerHTML = `<span class="stylist-brief-label">YOUR LOOK</span>${tags.map(t => `<span>${esc(t)}</span>`).join('')}`;
  }
  function bubble(text, role = 'stylist') {
    const el = document.createElement('div'); el.className = `stylist-message stylist-message--${role}`;
    if (role === 'stylist') el.innerHTML = '<span class="stylist-message-label">NGL STYLIST</span>';
    const p = document.createElement('p'); p.textContent = text; el.append(p); thread.append(el); return el;
  }
  function productCards(answer, target) {
    if (!answer.products?.length) return;
    const list = document.createElement('div'); list.className = 'stylist-products';
    answer.products.forEach(product => {
      const card = document.createElement('article'); card.className = 'stylist-product';
      const href = `/shop.html?product=${encodeURIComponent(product.id)}`;
      const image = cfImg(product.image_url, 240);
      const safeImage = /^(https?:\/\/|\/(?!\/))/.test(image) ? image : '/images/logo.png';
      card.innerHTML = `<a class="stylist-product-photo" href="${href}" tabindex="-1" aria-hidden="true"><img src="${esc(safeImage)}" alt="" loading="lazy" /></a><div class="stylist-product-info"><span class="stylist-product-collection">${esc(product.collection)} COLLECTION</span><a class="stylist-product-name" href="${href}">${esc(product.name)}</a><p>${esc(product.reason)}</p><div class="stylist-product-bottom"><strong>${money(product.price)}</strong><button type="button" aria-label="Add ${esc(product.name)} to bag">${icon('add')} Add to bag</button></div></div>`;
      const button = card.querySelector('button');
      if (tryOn && canTryOnProduct?.(product.id)) {
        const tryButton = document.createElement('button');
        tryButton.type = 'button';
        tryButton.className = 'stylist-try-on-button';
        tryButton.textContent = 'Try on';
        tryButton.setAttribute('aria-label', `Try on ${product.name}`);
        tryButton.addEventListener('click', () => {
          if (onTryOnProduct?.(product.id)) {
            status.textContent = `${product.name} is now in your mirror.`;
            close();
          }
        });
        card.querySelector('.stylist-product-info').append(tryButton);
      }
      button.addEventListener('click', async () => {
        button.disabled = true; status.textContent = 'Checking availability…';
        try {
          const current = (await getProducts()).map(publicProduct).find(p => p.id === product.id);
          if (!current || current.stock < 1) throw new Error('This piece has just sold out. Ask me for another option.');
          if (current.price !== product.price) {
            product.price = current.price; card.querySelector('strong').textContent = money(current.price);
            if (answer.total != null) target.querySelector('.stylist-set-total')?.remove();
            status.textContent = `The price changed to ${money(current.price)}. Please review your budget before adding.`;
            return;
          }
          const result = addCatalogProduct(current);
          status.textContent = result.message;
          if (result.ok) button.innerHTML = `${icon('check')} Added`;
        } catch (error) { status.textContent = error.message || 'Couldn’t update your bag. Please try again.'; }
        finally { button.disabled = false; }
      });
      list.append(card);
      if (product.evidence) {
        const source = document.createElement('details'); source.className = 'stylist-source';
        const summary = document.createElement('summary'); summary.textContent = 'From the product details';
        const quote = document.createElement('p'); quote.textContent = product.evidence;
        source.append(summary, quote); card.querySelector('.stylist-product-info').append(source);
      }
    });
    target.append(list);
    if (answer.total != null) { const total = document.createElement('p'); total.className = 'stylist-set-total'; total.textContent = `Together, ${money(answer.total)} · shipping separate`; target.append(total); }
    const refinements = document.createElement('div'); refinements.className = 'stylist-refinements';
    refinements.innerHTML = ['More subtle', 'Lower price', 'Another option'].map(t => `<button data-prompt="${t}">${t}</button>`).join(''); target.append(refinements);
  }

  async function submit(text) {
    if (busy || !text.trim()) return;
    text = text.trim().slice(0, 2000); busy = true; send.disabled = true;
    const selected = getTryOnProduct?.();
    // Send product context only; camera images never enter the chat request.
    const contextText = selected
      ? `Currently trying on: ${JSON.stringify({ id: String(selected.id).slice(0, 100), name: String(selected.name).slice(0, 150), category: 'Earrings' })}\n\n`
      : '';
    const requestText = contextText + text.slice(0, 2000 - contextText.length);
    const turn = ++generation;
    root.querySelector('.stylist-welcome').hidden = true; input.value = '';
    bubble(text, 'customer'); status.textContent = 'Finding your finishing touches…';
    scroll.scrollTop = scroll.scrollHeight;
    try {
      let answer;
      if (isOrderHelp(text)) answer = { message: 'For order tracking, returns, or a person on our team, head to customer care below.', help: true, products: [] };
      else {
        try {
          const response = await fetch('/api/stylist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: requestText, brief, history: history.slice(-8), previousIds: lastPicks.map(p => p.id) }), signal: AbortSignal.timeout(30000) });
          if (!response.ok) { const body = await response.json().catch(() => ({})); const e = new Error(body.error || 'The AI stylist is unavailable. Please try again.'); e.noFallback = true; throw e; }
          answer = await response.json();
          if (!Array.isArray(answer.products) || typeof answer.message !== 'string') throw new Error('Invalid response');
        } catch (e) {
          // Never disguise a provider/network failure as a successful AI conversation.
          throw e;
        }
      }
      if (turn !== generation) return;
      history = [...history, { role: 'user', content: requestText.slice(0, 700) }, { role: 'assistant', content: answer.message.slice(0, 700) }].slice(-8);
      brief = answer.brief || brief; lastPicks = answer.products || []; updateBrief();
      const message = bubble(answer.message); productCards(answer, message);
      if (answer.help) {
        const links = document.createElement('div'); links.className = 'stylist-help-links';
        links.innerHTML = '<a href="/track-order.html">Track an order ↗</a><a href="/support.html?chat=1">Customer care ↗</a>'; message.append(links);
      }
      status.textContent = answer.mode === 'rag' ? 'Groq stylist · grounded in the current collection' : '';
      root.querySelector('.stylist-heading p').textContent = answer.mode === 'rag' ? 'AI advice · live collection' : 'Your personal jewelry guide';
      // Keep the new answer's beginning visible, not only the last card.
      if (tryOn) scroll.scrollTop += message.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
      else message.scrollIntoView({ block: 'start', behavior: 'instant' });
    } catch (e) {
      if (turn === generation) {
        const error = bubble(e.noFallback ? e.message : 'I couldn’t reach the AI stylist just now. Please try again, or browse the shop.');
        const link = document.createElement('a'); link.href = '/shop.html'; link.textContent = 'Browse the collection ↗'; link.className = 'stylist-browse-link'; error.append(link);
        status.textContent = 'Your previous preferences are still here.';
      }
    } finally { if (turn === generation) { busy = false; send.disabled = false; } }
  }
  form.addEventListener('submit', e => { e.preventDefault(); submit(input.value); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(input.value); } });
  root.addEventListener('click', e => { const chip = e.target.closest('[data-prompt]'); if (chip) submit(chip.dataset.prompt); });
  root.querySelector('[data-reset]').addEventListener('click', () => { generation++; busy = false; send.disabled = false; brief = {}; lastPicks = []; history = []; thread.replaceChildren(); updateBrief(); status.textContent = ''; input.value = ''; root.querySelector('.stylist-welcome').hidden = false; scroll.scrollTop = 0; });
  function refreshBadge() { const count = readCart().reduce((n, p) => n + p.quantity, 0); document.querySelectorAll('.cart-count').forEach(el => { el.textContent = count; el.setAttribute('aria-label', `${count} items`); }); }
  window.addEventListener('ngl:cart-updated', refreshBadge);
  window.addEventListener('storage', refreshBadge);
  if (new URLSearchParams(location.search).get('stylist') === '1') open();
}
