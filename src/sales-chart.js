/* ============================================================
   NGL Admin — Sales line chart (revenue + gross profit), canvas
   No imports, so the pure helpers run in Node: see sales-chart.check.js
   ============================================================ */

const DAY_MS = 864e5;

/* Bucket orders into daily or weekly (Monday-start) totals from `from` to now. */
export function buildSeries(orders, from, daily, now = new Date()) {
  const start = new Date(from); start.setHours(0, 0, 0, 0);
  if (!daily) start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  const stepDays = daily ? 1 : 7;
  const buckets = [];
  for (const d = new Date(start); d <= now; d.setDate(d.getDate() + stepDays)) {
    buckets.push({ start: new Date(d), revenue: 0, profit: 0, orders: 0 });
  }
  // ponytail: fixed-length ms buckets; exact for Asia/Manila (no DST), use calendar math if that changes.
  orders.forEach(o => {
    const b = buckets[Math.floor((new Date(o.created_at) - start) / (stepDays * DAY_MS))];
    if (!b) return;
    b.revenue += Number(o.total);
    b.profit += Number(o.profit || 0);
    b.orders++;
  });
  return { buckets, daily };
}

/* Item sales per product category, biggest first. Every catalog category is listed,
   so one with no sales shows as ₱0 instead of silently disappearing. */
export function salesByCategory(orders, products) {
  const catOf = Object.fromEntries(products.map(p => [p.id, p.category]));
  const rows = Object.fromEntries([...new Set(products.map(p => p.category))].map(c => [c, { category: c, revenue: 0, qty: 0 }]));
  orders.forEach(o => (o.order_items || []).forEach(i => {
    const c = catOf[i.product_id] || 'Other';
    rows[c] ??= { category: c, revenue: 0, qty: 0 };
    rows[c].revenue += Number(i.subtotal);
    rows[c].qty += Number(i.quantity);
  }));
  return Object.values(rows).sort((a, b) => b.revenue - a.revenue || a.category.localeCompare(b.category));
}

/* Whole-percent change vs the previous period; null when there's no base to compare to. */
export function pctChange(cur, prev) {
  return prev > 0 ? Math.round((cur - prev) / prev * 100) : null;
}

/* Smallest 1/2/2.5/5 × 10^n step at or above `raw`, for round gridlines. */
export function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw);
}

export function compactPeso(v) {
  const a = Math.abs(v);
  const s = a >= 1000 ? (a / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(Math.round(a));
  return (v < 0 ? '-₱' : '₱') + s;
}

/* Draws the chart; returns each bucket's x position so the caller can hit-test hover. */
export function drawChart(canvas, { buckets }, hover = -1) {
  const ctx = canvas.getContext('2d');
  // Canvas pixels do not inherit CSS when the theme changes; resolve and redraw.
  const styles = getComputedStyle(canvas);
  const color = (name) => styles.getPropertyValue(name).trim();
  const dpr = window.devicePixelRatio || 1;
  const { width: W, height: H } = canvas.getBoundingClientRect();
  if (!W || !H || !buckets.length) return [];
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  const pad = { top: 16, right: 16, bottom: 30, left: 52 };
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top - pad.bottom;
  const n = buckets.length;
  const rev = buckets.map(b => b.revenue);
  const prof = buckets.map(b => b.profit);
  const dataMax = Math.max(1, ...rev, ...prof);
  const dataMin = Math.min(0, ...prof);
  const step = niceStep((dataMax - dataMin) / 4);
  const lo = Math.floor(dataMin / step) * step;
  const ticks = Math.ceil((dataMax - lo) / step);
  const hi = lo + ticks * step;
  const xs = buckets.map((_, i) => pad.left + (n === 1 ? cW / 2 : i * cW / (n - 1)));
  const y = (v) => pad.top + cH - (v - lo) / (hi - lo) * cH;

  const accent = color('--adm-gold');
  const profitInk = `rgb(${color('--adm-fg')} / 0.6)`;
  ctx.font = '10px DM Sans';
  ctx.lineWidth = 1;

  // Gridlines + y labels
  ctx.textAlign = 'right';
  for (let k = 0; k <= ticks; k++) {
    const v = lo + k * step;
    ctx.strokeStyle = color('--adm-chart-grid');
    ctx.beginPath(); ctx.moveTo(pad.left, y(v)); ctx.lineTo(W - pad.right, y(v)); ctx.stroke();
    ctx.fillStyle = color('--adm-chart-label');
    ctx.fillText(compactPeso(v), pad.left - 8, y(v) + 3);
  }

  // X labels: roughly one per 70px so they never collide
  const every = Math.ceil(n / Math.max(2, Math.floor(cW / 70)));
  buckets.forEach((b, i) => {
    if (i % every) return;
    ctx.textAlign = i === n - 1 && n > 1 ? 'right' : 'center';
    ctx.fillText(b.start.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }), xs[i], H - pad.bottom + 18);
  });

  const trace = (vals) => {
    ctx.beginPath();
    vals.forEach((v, i) => (i ? ctx.lineTo(xs[i], y(v)) : ctx.moveTo(xs[i], y(v))));
  };

  // Revenue: faint area, then the line. Profit: dashed, so identity never rests on color alone.
  trace(rev);
  ctx.lineTo(xs[n - 1], y(0)); ctx.lineTo(xs[0], y(0)); ctx.closePath();
  ctx.globalAlpha = 0.12; ctx.fillStyle = accent; ctx.fill(); ctx.globalAlpha = 1;
  ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  trace(prof); ctx.strokeStyle = profitInk; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
  trace(rev); ctx.strokeStyle = accent; ctx.stroke();

  // Hover: crosshair + ringed markers. A lone point gets markers too, or it would be invisible.
  const at = hover >= 0 ? hover : (n === 1 ? 0 : -1);
  if (at >= 0) {
    if (hover >= 0) {
      ctx.lineWidth = 1; ctx.strokeStyle = color('--adm-chart-label');
      ctx.beginPath(); ctx.moveTo(xs[at], pad.top); ctx.lineTo(xs[at], pad.top + cH); ctx.stroke();
    }
    [[prof[at], profitInk], [rev[at], accent]].forEach(([v, fill]) => {
      ctx.beginPath(); ctx.arc(xs[at], y(v), 4, 0, Math.PI * 2);
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = color('--adm-card'); ctx.stroke();
    });
  }
  return xs;
}
