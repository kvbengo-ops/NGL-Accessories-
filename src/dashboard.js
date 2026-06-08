/* ============================================================
   NGL Admin — Dashboard Logic
   ============================================================ */
import { 
  supabase, getOrders, getSalesSummary, 
  getAllProducts, getTasks, getExpenses
} from '../src/supabase.js';
import { requireAuth, renderSidebar, formatPrice, formatDate, statusBadge } from '../src/admin.js';
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
          description: 'A quick glance at your crucial metrics: daily/weekly revenue, pending orders, and low stock warnings.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '#tour-chart',
        popover: {
          title: 'Sales Trends',
          description: 'This chart tracks your sales over the last 7 days so you can visually spot performance peaks.',
          side: 'right',
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
  document.getElementById('dashboard-greeting').textContent = `${greeting}, ${admin.name} ✦`;

  // Tour Logic
  const btnStartTour = document.getElementById('btn-start-tour');
  if (btnStartTour) {
    btnStartTour.addEventListener('click', startTour);
  }
  if (!localStorage.getItem('ngl_admin_tour_seen')) {
    setTimeout(() => {
      startTour();
      localStorage.setItem('ngl_admin_tour_seen', 'true');
    }, 1000);
  }

  // Load all data in parallel
  const [orders, salesData, products, myTasks, expenses] = await Promise.all([
    getOrders(),
    getSalesSummary(7),
    getAllProducts(),
    getTasks({ status: 'pending', assigned_to: admin.id }),
    getExpenses()
  ]);

  // ── KPIs ─────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const todayRevenue = orders
    .filter(o => o.created_at.slice(0,10) === today && !['cancelled','voided'].includes(o.status))
    .reduce((s, o) => s + Number(o.total), 0);
  const todayProfit = orders
    .filter(o => o.created_at.slice(0,10) === today && !['cancelled','voided'].includes(o.status))
    .reduce((s, o) => s + Number(o.profit || 0), 0);

  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const weekRevenue = orders
    .filter(o => new Date(o.created_at) >= weekAgo && !['cancelled','voided'].includes(o.status))
    .reduce((s, o) => s + Number(o.total), 0);
  const weekProfit = orders
    .filter(o => new Date(o.created_at) >= weekAgo && !['cancelled','voided'].includes(o.status))
    .reduce((s, o) => s + Number(o.profit || 0), 0);

  const pending = orders.filter(o => o.status === 'pending').length;

  const lowStock = products.filter(p =>
    p.inventory && p.inventory.stock <= p.inventory.low_stock_threshold
  ).length;

  document.getElementById('kpi-today').textContent    = formatPrice(todayRevenue);
  if(document.getElementById('kpi-profit-today')) document.getElementById('kpi-profit-today').textContent = formatPrice(todayProfit);
  document.getElementById('kpi-week').textContent     = formatPrice(weekRevenue);
  if(document.getElementById('kpi-profit-week')) document.getElementById('kpi-profit-week').textContent  = formatPrice(weekProfit);
  document.getElementById('kpi-pending').textContent  = pending;
  document.getElementById('kpi-lowstock').textContent = lowStock;
  if (lowStock > 0) document.getElementById('kpi-lowstock').style.color = '#ef4444';

  // ── P&L Widget (This Month) ──────────────────────────────
  const thisMonthStr = today.substring(0, 7); // YYYY-MM
  
  const monthOrders = orders.filter(o => 
    o.created_at.startsWith(thisMonthStr) && !['cancelled','voided'].includes(o.status)
  );
  
  const monthRevenue = monthOrders.reduce((s, o) => s + Number(o.total), 0);
  const monthCost = monthOrders.reduce((s, o) => s + Number(o.total_cost || 0), 0);
  const monthGross = monthOrders.reduce((s, o) => s + Number(o.profit || 0), 0);
  
  const monthExpenses = expenses
    .filter(e => e.expense_date && e.expense_date.startsWith(thisMonthStr))
    .reduce((s, e) => s + Number(e.amount), 0);
    
  const monthNet = monthGross - monthExpenses;
  
  if(document.getElementById('pnl-rev')) {
    document.getElementById('pnl-rev').textContent = formatPrice(monthRevenue);
    document.getElementById('pnl-cogs').textContent = `-${formatPrice(monthCost)}`;
    document.getElementById('pnl-gross').textContent = formatPrice(monthGross);
    document.getElementById('pnl-exp').textContent = `-${formatPrice(monthExpenses)}`;
    document.getElementById('pnl-net').textContent = formatPrice(monthNet);
    if(monthNet < 0) document.getElementById('pnl-net').style.color = 'var(--error)';
  }


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

  // ── Sales Chart (Canvas) ──────────────────────────────────
  const canvas = document.getElementById('sales-chart');
  if (canvas) drawChart(canvas, salesData);

  // ── Recent Orders ─────────────────────────────────────────
  const tbody = document.getElementById('recent-orders-body');
  const recent = orders.slice(0, 10);
  if (recent.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No orders yet</td></tr>';
  } else {
    tbody.innerHTML = recent.map(o => `
      <tr>
        <td class="order-num">${o.order_number}</td>
        <td>${o.customer_name || '—'}</td>
        <td><span class="type-badge type-badge--${o.type}">${o.type}</span></td>
        <td>${formatPrice(o.total)}</td>
        <td>${statusBadge(o.status)}</td>
        <td class="date-cell">${formatDate(o.created_at)}</td>
      </tr>
    `).join('');
  }

  // ── My Pending Tasks ──────────────────────────────────────
  const tasksTbody = document.getElementById('pending-tasks-body');
  if (tasksTbody) {
    if (myTasks.length === 0) {
      tasksTbody.innerHTML = '<tr><td colspan="3" class="table-empty">No pending tasks</td></tr>';
    } else {
      const pColor = { low: '#888', medium: '#b8860b', high: '#ef4444' };
      tasksTbody.innerHTML = myTasks.slice(0, 5).map(t => `
        <tr>
          <td>
            <div style="font-weight:500; margin-bottom:2px;">${t.title}</div>
            ${t.due_date ? `<small style="color:#888;">Due: ${formatDate(t.due_date).split(',')[0]}</small>` : ''}
          </td>
          <td><span style="color:${pColor[t.priority] || '#888'}; font-size:0.85rem; font-weight:600; text-transform:uppercase;">${t.priority}</span></td>
          <td style="text-align:right;">
            <a href="/admin/tasks.html?id=${t.id}" style="color:var(--gold); font-size:0.9rem; font-weight:500; text-decoration:none;">View &rarr;</a>
          </td>
        </tr>
      `).join('');
    }
  }

  // ── Top Products ──────────────────────────────────────────
  const salesMap = {};
  orders.forEach(o => {
    if (['cancelled','voided'].includes(o.status)) return;
    (o.order_items || []).forEach(item => {
      if (!salesMap[item.product_name]) salesMap[item.product_name] = { qty: 0, rev: 0 };
      salesMap[item.product_name].qty += item.quantity;
      salesMap[item.product_name].rev += Number(item.subtotal);
    });
  });
  const top = Object.entries(salesMap)
    .sort((a,b) => b[1].qty - a[1].qty)
    .slice(0, 5);

  const topEl = document.getElementById('top-products');
  if (top.length === 0) {
    topEl.innerHTML = '<p class="table-empty">No sales data yet</p>';
  } else {
    topEl.innerHTML = top.map(([name, { qty, rev }], i) => `
      <div class="top-product-row">
        <span class="top-rank">${i + 1}</span>
        <span class="top-name">${name}</span>
        <span class="top-qty">${qty} sold</span>
        <span class="top-rev">${formatPrice(rev)}</span>
      </div>
    `).join('');
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
          <span class="top-rank" style="color:var(--gold-300)">${i + 1}</span>
          <span class="top-name">${p.name}</span>
          <span class="top-rev" style="color:var(--coral)"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;">favorite</span> ${p.likes_count || 0}</span>
        </div>
      `).join('');
    }
  }
})();

/* ── Canvas Bar Chart ────────────────────────────────────── */
function drawChart(canvas, data) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.parentElement.offsetWidth;
  const H   = 220;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  ctx.scale(dpr, dpr);

  // Build last 7 days labels
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const values = days.map(day => {
    const rec = data.find(d => d.sale_date?.slice(0, 10) === day);
    return rec ? Number(rec.revenue) : 0;
  });

  const labels = days.map(d => {
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('en-PH', { weekday: 'short' });
  });

  const maxVal = Math.max(...values, 1);
  const pad    = { top: 20, right: 16, bottom: 40, left: 56 };
  const cW     = W - pad.left - pad.right;
  const cH     = H - pad.top - pad.bottom;
  const barW   = Math.floor(cW / days.length * 0.6);
  const gap    = cW / days.length;

  // Y gridlines
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth   = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + cH - (i / 4) * cH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font      = '10px DM Sans';
    ctx.textAlign = 'right';
    ctx.fillText(formatPrice((maxVal * i / 4)).replace('₱','₱'), pad.left - 6, y + 4);
  }

  // Bars
  values.forEach((val, i) => {
    const x   = pad.left + i * gap + (gap - barW) / 2;
    const bH  = val > 0 ? Math.max(4, (val / maxVal) * cH) : 0;
    const y   = pad.top + cH - bH;

    // Gradient
    const grad = ctx.createLinearGradient(0, y, 0, y + bH);
    grad.addColorStop(0, 'rgba(212,175,55,0.9)');
    grad.addColorStop(1, 'rgba(212,175,55,0.25)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, bH, [4, 4, 0, 0]);
    ctx.fill();

    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font      = '11px DM Sans';
    ctx.textAlign = 'center';
    ctx.fillText(labels[i], x + barW / 2, H - pad.bottom + 16);

    // Value on bar
    if (val > 0) {
      ctx.fillStyle = 'rgba(212,175,55,0.9)';
      ctx.font      = '10px DM Sans';
      ctx.fillText('₱' + (val >= 1000 ? (val/1000).toFixed(1)+'K' : val), x + barW / 2, y - 5);
    }
  });
}
