// Run: node src/sales-chart.check.js
import assert from 'node:assert';
import { buildSeries, niceStep, compactPeso, salesByCategory, pctChange, shippingOf, grossOf, itemNet, cashStateOf } from './sales-chart.js';

const now = new Date(2026, 9, 18, 15, 0);                       // Sun 18 Oct 2026, 3pm
const at = (d, h = 10) => new Date(2026, 9, d, h).toISOString();
const orders = [
  { created_at: at(12, 0), subtotal: 100, total: 100, profit: 60 }, // Mon, just after midnight
  { created_at: at(12, 23), subtotal: 50, total: 50, profit: 30 },  // Mon, late night
  { created_at: at(18), subtotal: 200, total: 200, profit: 120 },  // today
  { created_at: at(1), subtotal: 999, total: 999, profit: 999 },   // before range → ignored
];

const daily = buildSeries(orders, new Date(2026, 9, 12), true, now);
assert.strictEqual(daily.buckets.length, 7);                     // Mon 12 … Sun 18
assert.deepStrictEqual(daily.buckets.map(b => b.revenue), [150, 0, 0, 0, 0, 0, 200]);
assert.strictEqual(daily.buckets[0].orders, 2);

const weekly = buildSeries(orders, new Date(2026, 9, 14), false, now);  // Wed → rolls back to Mon 12
assert.strictEqual(weekly.buckets[0].start.getDate(), 12);
assert.strictEqual(weekly.buckets.length, 1);
assert.strictEqual(weekly.buckets[0].profit, 210);

const sampleOrder = { subtotal: 1000, discount: 0, shipping: 0, total: 1150, total_cost: 400, profit: 600 };
assert.strictEqual(shippingOf(sampleOrder), 150);
assert.strictEqual(grossOf(sampleOrder), 750);
assert.strictEqual(itemNet({ subtotal: 1000, discount: 100 }, { subtotal: 300 }), 270);
assert.strictEqual(itemNet({ subtotal: 0, discount: 0 }, { subtotal: 300 }), 0);
assert.strictEqual(cashStateOf({ status: 'shipped', payment_method: 'cod' }), 'unpaid');
assert.strictEqual(cashStateOf({ status: 'shipped', payment_method: 'COD - cash on delivery' }), 'unpaid');
assert.strictEqual(cashStateOf({ status: 'shipped', payment_method: 'GCash' }), 'received');
assert.strictEqual(cashStateOf({ status: 'shipped' }), 'received');
assert.strictEqual(cashStateOf({ status: 'pending' }), 'unpaid');
assert.strictEqual(cashStateOf({ status: 'cancelled' }), null);

assert.strictEqual(niceStep(1812), 2000);
assert.strictEqual(niceStep(240), 250);
assert.strictEqual(niceStep(1), 1);
assert.strictEqual(compactPeso(7248), '₱7.2K');
assert.strictEqual(compactPeso(2000), '₱2K');
assert.strictEqual(compactPeso(-500), '-₱500');
const cats = salesByCategory(
  [{ subtotal: 800, discount: 80, order_items: [{ product_id: 'e1', subtotal: 300, quantity: 2 }, { product_id: 'r1', subtotal: 500, quantity: 1 }] },
   { subtotal: 500, discount: 50, order_items: [{ product_id: 'e1', subtotal: 450, quantity: 3 }, { product_id: 'gone', subtotal: 50, quantity: 1 }] }],
  [{ id: 'e1', category: 'Earrings' }, { id: 'r1', category: 'Rings' }, { id: 'n1', category: 'Necklaces' }]
);
assert.deepStrictEqual(cats.map(c => [c.category, c.revenue, c.qty]),
  [['Earrings', 675, 5], ['Rings', 450, 1], ['Other', 45, 1], ['Necklaces', 0, 0]]);
assert.strictEqual(pctChange(150, 100), 50);
assert.strictEqual(pctChange(50, 100), -50);
assert.strictEqual(pctChange(100, 100), 0);
assert.strictEqual(pctChange(100, 0), null);                    // no base → caller shows the raw previous value
console.log('sales-chart: ok');
