/* ============================================================
   NGL Admin — Dashboard Logic
   ============================================================ */
import {
  supabase, getOrders,
  getAllProducts, getTasks, getExpenses, getAdminSetting, setAdminSetting
} from '../src/supabase.js';
import { requireAuth, renderSidebar, formatPrice, formatDate, statusBadge, escapeHtml, showToast, isStockPurchase } from '../src/admin.js';
import { buildSeries, drawChart, salesByCategory, pctChange, shippingOf, grossOf, itemNet, cashStateOf } from './sales-chart.js';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

function startTour() {
  const driverObj = driver({
    showProgress: true,
    steps: [
      {
        element: '#tour-welcome',
        popover: {
          title: 'Welcome to your Dashboard',
          description: 'This is your central command hub for NGL Accessories. Let\'s take a quick tour to get you oriented!',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '#tour-kpis',
        popover: {
          title: 'Performance KPIs',
          description: 'Revenue, gross profit, orders and average order for the period picked in "Showing", each compared with the period before it.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '#tour-chart',
        popover: {
          title: 'Sales Trends',
          description: 'Revenue (solid line) and gross profit (dashed) over the period you pick in "Showing". Hover or tap to see each day or week. Swipe, or use "By category", to see which kinds of jewelry sell most.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '#tour-pnl',
        popover: {
          title: 'Profit & Loss',
          description: 'Your real-time financial health. It calculates your net profit automatically based on orders and expenses.',
          side: 'left',
          align: 'start'
        }
      },
      {
        element: '#tour-cash',
        popover: {
          title: 'Cash calculator',
          description: 'Opens a quick estimate of how much money you should have across cash, GCash and bank: your starting money plus paid sales, minus everything you spent.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '#tour-stock',
        popover: {
          title: 'Stock on hand',
          description: 'What your unsold items are worth. "Value at cost" is what you paid for them, which is your inventory asset.',
          side: 'left',
          align: 'start'
        }
      },
      {
        element: '#tour-tasks',
        popover: {
          title: 'My To-Do List',
          description: 'Keep track of your daily tasks right from the dashboard. Click "Open To-Do" to manage them properly.',
          side: 'left',
          align: 'start'
        }
      },
      {
        element: '#tour-pos',
        popover: {
          title: 'Point of Sale',
          description: 'Whenever you have an in-person customer, click here to open the POS terminal to process their order.',
          side: 'bottom',
          align: 'end'
        }
      }
    ]
  });
  driverObj.drive();
}

(async () => {
  const admin = await requireAuth();
  renderSidebar('Dashboard', admin);

  // Greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  document.getElementById('dashboard-greeting').textContent = `${greeting}, ${admin.name}.`;

  // Tour Logic
  const btnStartTour = document.getElementById('btn-start-tour');
  if (btnStartTour) {
    btnStartTour.addEventListener('click', startTour);
  }

  // Recent orders collapse: remember the choice in this browser (storage can be blocked; then it just starts open).
  const ordersDetails = document.getElementById('recent-orders-details');
  try { if (localStorage.getItem('ngl_dash_orders_open') === '0') ordersDetails.open = false; } catch {}
  ordersDetails.addEventListener('toggle', () => {
    try { localStorage.setItem('ngl_dash_orders_open', ordersDetails.open ? '1' : '0'); } catch {}
  });

  // Load all data in parallel
  let orders, products, myTasks, expenses;
  try {
    [orders, products, myTasks, expenses] = await Promise.all([
      getOrders(),
      getAllProducts(),
      getTasks({ status: 'pending', assigned_to: admin.id }),
      getExpenses()
    ]);
  } catch (err) {
    console.error('Dashboard load failed:', err);
    document.getElementById('tour-welcome').insertAdjacentHTML('afterend',
      `<p role="alert" style="margin:0 0 16px;padding:12px 16px;border:1px solid rgb(var(--adm-red));border-radius:4px;color:rgb(var(--adm-red));font-size:13px;">
        Couldn't load your store data. Check your connection and <a href="" style="color:inherit;text-decoration:underline;">reload the page</a>.
      </p>`);
    document.querySelectorAll('.table-loading, .recent-orders-empty').forEach(el => { el.textContent = 'Not loaded'; });
    return;
  }

  // ── Needs attention (always "right now", not period-scoped) ──
  const pending = orders.filter(o => o.status === 'pending').length;

  const lowStock = products.filter(p =>
    p.inventory && p.inventory.stock <= p.inventory.low_stock_threshold
  ).length;

  document.getElementById('kpi-pending').textContent  = pending;
  document.getElementById('kpi-lowstock').textContent = lowStock;
  if (lowStock > 0) document.getElementById('kpi-lowstock').style.color = 'rgb(var(--adm-red))';

  // ── Period filter: one control drives the chart, P&L and best sellers ──
  const isLive = o => !['cancelled','voided'].includes(o.status);

  function renderPnl(periodOrders, since, label) {
    const revenue = periodOrders.reduce((s, o) => s + Number(o.total), 0);
    const cost = periodOrders.reduce((s, o) => s + Number(o.total_cost || 0), 0);
    const shipping = periodOrders.reduce((s, o) => s + shippingOf(o), 0);
    const gross = periodOrders.reduce((s, o) => s + grossOf(o), 0);
    const missingCost = periodOrders.reduce((s, o) => s + (o.order_items || []).reduce((n, item) =>
      n + (Number(item.cost_price) <= 0 ? Number(item.quantity) : 0), 0), 0);

    // expense_date is a plain date; parse it as local midnight, not UTC.
    const periodExpenses = expenses.filter(e => e.expense_date && new Date(e.expense_date + 'T00:00:00') >= since);
    const opex = periodExpenses.filter(e => !isStockPurchase(e)).reduce((s, e) => s + Number(e.amount), 0);
    const stockSpend = periodExpenses.filter(isStockPurchase).reduce((s, e) => s + Number(e.amount), 0);
    const net = gross - opex;

    document.getElementById('pnl-period-label').textContent = label;
    document.getElementById('pnl-rev').textContent = formatPrice(revenue);
    document.getElementById('pnl-product-sales').textContent = formatPrice(revenue - shipping);
    document.getElementById('pnl-shipping').textContent = formatPrice(shipping);
    document.getElementById('pnl-cogs').textContent = `-${formatPrice(cost)}`;
    document.getElementById('pnl-gross').textContent = formatPrice(gross);
    document.getElementById('pnl-exp').textContent = `-${formatPrice(opex)}`;
    const netEl = document.getElementById('pnl-net');
    netEl.textContent = (net < 0 ? '-' : '') + formatPrice(Math.abs(net));
    netEl.style.color = net < 0 ? 'rgb(var(--adm-red))' : '';
    document.getElementById('pnl-stock').textContent = formatPrice(stockSpend);
    const missingCostNote = document.getElementById('pnl-missing-cost');
    missingCostNote.textContent = `${missingCost} items sold in this period had no cost price, so profit is overstated. Add costs in Inventory.`;
    missingCostNote.hidden = missingCost === 0;
  }

  function renderTop(periodOrders, label) {
    const salesMap = {};
    periodOrders.forEach(o => (o.order_items || []).forEach(item => {
      if (!salesMap[item.product_name]) salesMap[item.product_name] = { qty: 0, rev: 0 };
      salesMap[item.product_name].qty += item.quantity;
      salesMap[item.product_name].rev += itemNet(o, item);
    }));
    const top = Object.entries(salesMap).sort((a, b) => b[1].qty - a[1].qty).slice(0, 5);

    document.getElementById('top-period-label').textContent = label;
    document.getElementById('top-products').innerHTML = top.length ? top.map(([name, { qty, rev }], i) => `
      <div class="top-product-row">
        <span class="top-rank">${i + 1}</span>
        <span class="top-name">${escapeHtml(name)}</span>
        <span class="top-qty">${qty} sold</span>
        <span class="top-rev">${formatPrice(rev)}</span>
      </div>
    `).join('') : '<p class="table-empty">No sales in this period</p>';
  }

  // ── Sales chart ──────────────────────────────────────────
  const canvas = document.getElementById('sales-chart');
  const tip = document.getElementById('chart-tooltip');
  let series = { buckets: [], daily: true };
  let xs = [];
  let hover = -1;
  const redraw = () => { xs = drawChart(canvas, series, hover); };
  const dayLabel = d => d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });

  function renderChartText(periodOrders) {
    const sum = f => periodOrders.reduce((s, o) => s + Number(f(o) || 0), 0);
    document.getElementById('chart-summary').textContent =
      `${formatPrice(sum(o => o.total))} revenue · ${formatPrice(sum(grossOf))} gross profit · ` +
      `${periodOrders.length} order${periodOrders.length === 1 ? '' : 's'} · ${series.daily ? 'per day' : 'per week'}`;
    document.getElementById('sales-table').innerHTML =
      `<caption>Sales ${series.daily ? 'per day' : 'per week'}</caption>
      <tr><th scope="col">${series.daily ? 'Day' : 'Week of'}</th><th scope="col">Revenue</th><th scope="col">Gross profit</th><th scope="col">Orders</th></tr>` +
      series.buckets.map(b => `<tr><td>${dayLabel(b.start)}</td><td>${formatPrice(b.revenue)}</td><td>${formatPrice(b.profit)}</td><td>${b.orders}</td></tr>`).join('');
  }

  function showTip() {
    const b = series.buckets[hover];
    if (!b) { tip.hidden = true; return; }
    tip.innerHTML = `
      <div class="chart-tooltip-date">${series.daily ? '' : 'Week of '}${dayLabel(b.start)}</div>
      <div class="chart-tooltip-row"><span class="legend-line"></span><strong>${formatPrice(b.revenue)}</strong> Revenue</div>
      <div class="chart-tooltip-row"><span class="legend-line legend-line--profit"></span><strong>${formatPrice(b.profit)}</strong> Gross profit</div>
      <div class="chart-tooltip-orders">${b.orders} order${b.orders === 1 ? '' : 's'}</div>`;
    tip.hidden = false;
    tip.style.left = `${canvas.offsetLeft + xs[hover]}px`;
    tip.style.top = `${canvas.offsetTop + 8}px`;
    tip.style.transform = xs[hover] > canvas.clientWidth / 2 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)';
  }
  const clearHover = () => { hover = -1; tip.hidden = true; redraw(); };

  // The crosshair snaps to the nearest day/week, so the pointer never has to hit the line itself.
  // pointerdown covers a tap on touch screens, where no hover happens.
  const hoverAt = e => {
    const px = e.clientX - canvas.getBoundingClientRect().left;
    let best = -1;
    xs.forEach((x, i) => { if (best < 0 || Math.abs(x - px) < Math.abs(xs[best] - px)) best = i; });
    if (best !== hover) { hover = best; redraw(); showTip(); }
  };
  canvas.addEventListener('pointermove', hoverAt);
  canvas.addEventListener('pointerdown', hoverAt);
  canvas.addEventListener('pointerleave', clearHover);
  canvas.addEventListener('blur', clearHover);
  canvas.addEventListener('keydown', e => {
    const move = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!move || !xs.length) return;
    e.preventDefault();
    hover = hover < 0 ? xs.length - 1 : Math.min(xs.length - 1, Math.max(0, hover + move));
    redraw(); showTip();
  });
  document.addEventListener('ngl:admin-theme-change', redraw);
  new ResizeObserver(() => { redraw(); if (hover >= 0) showTip(); }).observe(canvas.parentElement);

  function renderCategories(periodOrders) {
    const rows = salesByCategory(periodOrders, products);
    const total = rows.reduce((s, r) => s + r.revenue, 0);
    const max = Math.max(1, ...rows.map(r => r.revenue));
    document.getElementById('category-bars').innerHTML = rows.map(r => `
      <li class="category-row">
        <span class="category-name">${escapeHtml(r.category)}</span>
        <span class="category-track"><span class="category-bar" style="width:${(r.revenue / max * 100).toFixed(1)}%"></span></span>
        <span class="category-value">${formatPrice(r.revenue)}<small>${total ? Math.round(r.revenue / total * 100) : 0}% · ${r.qty} sold</small></span>
      </li>`).join('');
  }

  // ── Swipe between chart views ────────────────────────────
  // The swipe itself is native scroll-snap (CSS); this keeps the tabs and dots in step with it.
  const slides = document.getElementById('chart-slides');
  const tabs = [...document.querySelectorAll('.chart-switch [role="tab"]')];
  const dots = [...document.querySelectorAll('.chart-dots span')];
  const showSlide = i => slides.scrollTo({
    left: i * slides.clientWidth,
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => showSlide(i));
    tab.addEventListener('keydown', e => {
      const next = tabs[{ ArrowLeft: i - 1, ArrowRight: i + 1 }[e.key]];
      if (next) { next.focus(); showSlide(tabs.indexOf(next)); }
    });
  });
  slides.addEventListener('scroll', () => {
    const active = Math.round(slides.scrollLeft / slides.clientWidth);
    tabs.forEach((t, k) => { t.setAttribute('aria-selected', String(k === active)); t.tabIndex = k === active ? 0 : -1; });
    dots.forEach((d, k) => d.classList.toggle('is-active', k === active));
    if (active !== 0 && hover >= 0) clearHover();
  }, { passive: true });

  // ── Number tiles: the period's totals vs the previous period of the same length ──
  function renderKpis(periodOrders, prevOrders, prevLabel) {
    const totals = list => {
      const revenue = list.reduce((s, o) => s + Number(o.total), 0);
      return {
        revenue,
        profit: list.reduce((s, o) => s + grossOf(o), 0),
        orders: list.length,
        aov: list.length ? revenue / list.length : 0,
      };
    };
    const cur = totals(periodOrders);
    const prev = prevOrders && totals(prevOrders);
    const count = n => n.toLocaleString('en-PH');
    [['revenue', formatPrice], ['profit', formatPrice], ['orders', count], ['aov', formatPrice]].forEach(([key, fmt]) => {
      document.getElementById(`kpi-${key}`).textContent = fmt(cur[key]);
      const delta = document.getElementById(`kpi-${key}-delta`);
      if (!prev) { delta.textContent = 'Since your first sale'; return; }
      const pct = pctChange(cur[key], prev[key]);
      // Arrow + sign carry the direction, so it never rests on color alone.
      delta.innerHTML = pct === null ? `${prevLabel[0].toUpperCase() + prevLabel.slice(1)}: ${fmt(prev[key])}`
        : pct === 0 ? `No change vs ${prevLabel}`
        : `<span class="kpi-delta kpi-delta--${pct > 0 ? 'up' : 'down'}">${pct > 0 ? '▲ +' : '▼ '}${pct}%</span> vs ${prevLabel}`;
    });
  }

  const periodSelect = document.getElementById('dash-period');
  function renderPeriod() {
    const option = periodSelect.selectedOptions[0];
    const period = option.value;
    const label = option.textContent;
    const liveOrders = orders.filter(isLive);
    // Whole calendar days ending today: "Last 7 days" = today and the 6 days before it.
    const since = new Date(); since.setHours(0, 0, 0, 0);
    let chartFrom = since;
    let prevOrders = null;
    if (period === 'all') {
      // P&L counts everything; the chart starts at the first order instead of 1970.
      chartFrom = new Date(Math.min(+since, ...liveOrders.map(o => +new Date(o.created_at))));
      since.setTime(0);
    } else {
      const days = Number(period);
      since.setDate(since.getDate() - (days - 1));
      const prevSince = new Date(since); prevSince.setDate(prevSince.getDate() - days);
      prevOrders = liveOrders.filter(o => new Date(o.created_at) >= prevSince && new Date(o.created_at) < since);
    }
    const periodOrders = liveOrders.filter(o => new Date(o.created_at) >= since);

    renderKpis(periodOrders, prevOrders, option.dataset.prev);
    renderPnl(periodOrders, since, label);
    renderTop(periodOrders, label);
    renderCategories(periodOrders);
    series = buildSeries(periodOrders, chartFrom, period !== 'all' && Number(period) <= 90);
    renderChartText(periodOrders);
    clearHover();
  }
  periodSelect.addEventListener('change', renderPeriod);
  renderPeriod();

  // ── Stock on hand ────────────────────────────────────────
  // Inventory asset = cost_price × stock. Cash on hand isn't tracked anywhere, so it's not included.
  let units = 0, stockCost = 0, stockRetail = 0, missingCost = 0;
  products.forEach(p => {
    const qty = Number(p.inventory?.stock || 0);
    if (qty <= 0) return;
    units += qty;
    stockCost += Number(p.cost_price || 0) * qty;
    stockRetail += Number(p.price || 0) * qty;
    if (!(Number(p.cost_price) > 0)) missingCost++;
  });
  document.getElementById('stock-units').textContent = units.toLocaleString();
  document.getElementById('stock-cost').textContent = formatPrice(stockCost);
  document.getElementById('stock-retail').textContent = formatPrice(stockRetail);
  document.getElementById('stock-margin').textContent = formatPrice(stockRetail - stockCost);
  if (missingCost) {
    const note = document.getElementById('stock-missing-cost');
    note.textContent = `${missingCost} in-stock product${missingCost > 1 ? 's have' : ' has'} no cost price, so ${missingCost > 1 ? 'they count' : 'it counts'} as ₱0 at cost. Add it in Inventory.`;
    note.hidden = false;
  }

  // ── Cash on hand (estimate) ──────────────────────────────
  // Starting money + paid sales − everything spent (stock included: here we follow
  // the cash, not profit). Can't see owner withdrawals or later top-ups.
  const peso = n => (n < 0 ? '-' : '') + formatPrice(Math.abs(n));
  const cashIn = orders.filter(o => cashStateOf(o) === 'received')
    .reduce((s, o) => s + Number(o.total), 0);
  const unpaid = orders.filter(o => cashStateOf(o) === 'unpaid');
  const unpaidTotal = unpaid.reduce((s, o) => s + Number(o.total), 0);
  const cashStock = expenses.filter(isStockPurchase).reduce((s, e) => s + Number(e.amount), 0);
  const cashExp = expenses.filter(e => !isStockPurchase(e)).reduce((s, e) => s + Number(e.amount), 0);
  const cashStart = document.getElementById('cash-start');

  function renderCash() {
    const start = Number(cashStart.value) || 0;
    const fromBusiness = cashIn - cashStock - cashExp;
    const total = start + fromBusiness;
    document.getElementById('cash-in').textContent = formatPrice(cashIn);
    document.getElementById('cash-stock').textContent = `-${formatPrice(cashStock)}`;
    document.getElementById('cash-exp').textContent = `-${formatPrice(cashExp)}`;
    const totalEl = document.getElementById('cash-total');
    totalEl.textContent = peso(total);
    totalEl.style.color = total < 0 ? 'rgb(var(--adm-red))' : '';

    const notes = [];
    if (!cashStart.value && fromBusiness < 0) {
      notes.push(`Enter the money you started with. You've spent <strong>${formatPrice(-fromBusiness)}</strong> more than your paid sales, so you put in at least that much yourself.`);
    } else if (total < 0) {
      notes.push('Below zero means you started with more, or added money later. Update the starting amount.');
    }
    if (unpaid.length) {
      notes.push(`Not counted yet: <strong>${formatPrice(unpaidTotal)}</strong> from ${unpaid.length} unpaid order${unpaid.length > 1 ? 's' : ''} (pending, processing or shipped COD).`);
    }
    notes.push("If your real balance is lower, the gap is usually money you took out for yourself or a cost you didn't log.");
    document.getElementById('cash-note').innerHTML = notes.join(' ');
  }

  // Loaded separately so a missing admin_settings table (migration not run) can't break the dashboard.
  getAdminSetting('starting_cash')
    .then(v => { if (v !== null) cashStart.value = v; })
    .catch(err => console.warn('starting_cash not loaded:', err.message))
    .finally(renderCash);
  cashStart.addEventListener('input', renderCash);
  cashStart.addEventListener('change', async () => {
    const value = Number(cashStart.value);
    if (!Number.isFinite(value) || value < 0) { showToast('Enter an amount of ₱0 or more', 'error'); return; }
    try {
      await setAdminSetting('starting_cash', value);
      showToast('Starting money saved');
    } catch (err) {
      console.error(err);
      showToast("Couldn't save. Has the admin_settings migration been run?", 'error');
    }
  });

  // ── Real-time pending orders badge ───────────────────────
  supabase
    .channel('orders-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
      // Refresh pending count
      getOrders({ status: 'pending' }).then(p => {
        document.getElementById('kpi-pending').textContent = p.length;
      });
    })
    .subscribe();

  // ── Recent Orders ─────────────────────────────────────────
  const tbody = document.getElementById('recent-orders-body');
  const recent = [...orders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);
  tbody.innerHTML = recent.length ? recent.map(o => {
    const date = new Date(o.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const channel = o.type === 'pos' ? 'In store' : o.type === 'online' ? 'Online' : o.type || '';
    const status = String(o.status || 'Unknown').replaceAll('_', ' ');
    return `<tr>
      <td><span class="recent-order-customer">${escapeHtml(o.customer_name || 'Walk-in customer')}</span><span class="recent-order-meta">${escapeHtml(String(o.order_number || '—'))} · ${escapeHtml(date)}${channel ? ' · ' + escapeHtml(channel) : ''}</span></td>
      <td><span class="recent-order-status">${escapeHtml(status)}</span></td>
      <td class="recent-order-amount">${formatPrice(o.total)}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="3" class="recent-orders-empty">No orders yet. New orders will appear here.</td></tr>';

  const tasksTbody = document.getElementById('pending-tasks-body');
  if (tasksTbody) {
    if (myTasks.length === 0) {
      tasksTbody.innerHTML = '<tr><td colspan="3" class="table-empty">No pending tasks</td></tr>';
    } else {
      const pColor = { low: 'var(--adm-text-muted)', medium: 'var(--adm-gold)', high: 'rgb(var(--adm-red))' };
      tasksTbody.innerHTML = myTasks.slice(0, 5).map(t => `
        <tr>
          <td>
            <div style="font-weight:500; margin-bottom:2px;">${escapeHtml(t.title)}</div>
            ${t.due_date ? `<small style="color:var(--adm-text-muted);">Due: ${formatDate(t.due_date).split(',')[0]}</small>` : ''}
          </td>
          <td><span style="color:${pColor[t.priority] || 'var(--adm-text-muted)'}; font-size:0.85rem; font-weight:600; text-transform:uppercase;">${t.priority}</span></td>
          <td style="text-align:right;">
            <a href="/admin/tasks.html?id=${t.id}" style="color:var(--adm-gold); font-size:0.9rem; font-weight:500; text-decoration:none;">View &rarr;</a>
          </td>
        </tr>
      `).join('');
    }
  }

  // ── Trending Products ───────────────────────────────────────
  const trendingEl = document.getElementById('trending-products');
  if (trendingEl) {
    const trending = products
      .filter(p => (p.likes_count > 0))
      .sort((a, b) => {
        return (b.likes_count || 0) - (a.likes_count || 0);
      })
      .slice(0, 5);

    if (trending.length === 0) {
      trendingEl.innerHTML = '<p class="table-empty">No engagement data yet</p>';
    } else {
      trendingEl.innerHTML = trending.map((p, i) => `
        <div class="top-product-row">
          <span class="top-rank" style="color:var(--adm-gold)">${i + 1}</span>
          <span class="top-name">${escapeHtml(p.name)}</span>
          <span class="top-rev" style="color:rgb(var(--adm-red))"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;">favorite</span> ${p.likes_count || 0}</span>
        </div>
      `).join('');
    }
  }
})();
