// Run: node src/sales-chart.check.js
import assert from 'node:assert';
import { buildSeries, niceStep, compactPeso, salesByCategory, pctChange } from './sales-chart.js';

const now = new Date(2026, 9, 18, 15, 0);                       // Sun 18 Oct 2026, 3pm
const at = (d, h = 10) => new Date(2026, 9, d, h).toISOString();
const orders = [
  { created_at: at(12, 0), total: 100, profit: 60 },             // Mon, just after midnight
  { created_at: at(12, 23), total: 50, profit: 30 },             // Mon, late night
  { created_at: at(18), total: 200, profit: 120 },               // today
  { created_at: at(1), total: 999, profit: 999 },                // before range → ignored
];

const daily = buildSeries(orders, new Date(2026, 9, 12), true, now);
assert.strictEqual(daily.buckets.length, 7);                     // Mon 12 … Sun 18
assert.deepStrictEqual(daily.buckets.map(b => b.revenue), [150, 0, 0, 0, 0, 0, 200]);
assert.strictEqual(daily.buckets[0].orders, 2);

const weekly = buildSeries(orders, new Date(2026, 9, 14), false, now);  // Wed → rolls back to Mon 12
assert.strictEqual(weekly.buckets[0].start.getDate(), 12);
assert.strictEqual(weekly.buckets.length, 1);
assert.strictEqual(weekly.buckets[0].profit, 210);

assert.strictEqual(niceStep(1812), 2000);
assert.strictEqual(niceStep(240), 250);
assert.strictEqual(niceStep(1), 1);
assert.strictEqual(compactPeso(7248), '₱7.2K');
assert.strictEqual(compactPeso(2000), '₱2K');
assert.strictEqual(compactPeso(-500), '-₱500');
const cats = salesByCategory(
  [{ order_items: [{ product_id: 'e1', subtotal: 300, quantity: 2 }, { product_id: 'r1', subtotal: 500, quantity: 1 }] },
   { order_items: [{ product_id: 'e1', subtotal: 450, quantity: 3 }, { product_id: 'gone', subtotal: 50, quantity: 1 }] }],
  [{ id: 'e1', category: 'Earrings' }, { id: 'r1', category: 'Rings' }, { id: 'n1', category: 'Necklaces' }]
);
assert.deepStrictEqual(cats.map(c => [c.category, c.revenue, c.qty]),
  [['Earrings', 750, 5], ['Rings', 500, 1], ['Other', 50, 1], ['Necklaces', 0, 0]]);
assert.strictEqual(pctChange(150, 100), 50);
assert.strictEqual(pctChange(50, 100), -50);
assert.strictEqual(pctChange(100, 100), 0);
assert.strictEqual(pctChange(100, 0), null);                    // no base → caller shows the raw previous value
console.log('sales-chart: ok');
