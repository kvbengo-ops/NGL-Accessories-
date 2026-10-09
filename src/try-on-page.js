import './style.css';
import { getProducts, getTryOnConfigs } from './supabase.js';
import { addCatalogProduct, readCart } from './cart-store.js';
import { openTryOn } from './try-on/controller.js';

// Standalone try-on page: /try-on.html (optionally ?product=<id>). The shared navbar comes from main.js.
const host = document.getElementById('tryon-page');
const showCount = () => {
  const el = document.querySelector('.cart-count');
  if (el) el.textContent = readCart().reduce((n, i) => n + i.quantity, 0);
};
showCount();
addEventListener('ngl:cart-updated', showCount);
document.querySelector('.cart-btn')?.addEventListener('click', () => { location.href = '/checkout.html'; });

const unavailable = () => {
  host.innerHTML = '<p style="text-align:center;padding:80px 0">The mirror is resting right now. <a href="/shop.html">Back to the shop</a></p>';
};

try {
  const [rows, configs] = await Promise.all([getProducts(), getTryOnConfigs()]);
  const products = rows.filter(p => (p.inventory?.stock || 0) > 0).map(p => ({
    id: p.id, name: p.name, itemCategory: p.category, categoryLabel: p.collection,
    price: Number(p.price), image: p.image_url || '', stock: p.inventory?.stock || 0,
  }));
  const wanted = new URLSearchParams(location.search).get('product');
  const earrings = products.filter(p => p.itemCategory === 'Earrings' && configs.has(p.id));
  const product = earrings.find(p => String(p.id) === wanted) || earrings[0];
  if (!product) unavailable();
  else openTryOn({
    product, products, configs, embed: host,
    onAddToBag: p => addCatalogProduct({ ...p, collection: p.categoryLabel, image_url: p.image }).ok,
  });
} catch (error) {
  console.error('Try-on unavailable:', error);
  unavailable();
}
