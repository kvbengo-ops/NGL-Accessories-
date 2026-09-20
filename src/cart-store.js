// One storage format for shop cards and stylist recommendations.
export function readCart() {
  try {
    const value = JSON.parse(localStorage.getItem('ngl_cart') || '[]');
    return Array.isArray(value) ? value.filter(p => p && typeof p.id === 'string' && Number.isInteger(p.quantity) && p.quantity > 0) : [];
  } catch { return []; }
}
export function writeCart(cart) {
  localStorage.setItem('ngl_cart', JSON.stringify(cart));
  window.dispatchEvent(new Event('ngl:cart-updated'));
}
export function addCatalogProduct(product) {
  const cart = readCart();
  const existing = cart.find(item => item.id === product.id);
  if (product.stock <= 0) return { ok: false, message: 'This piece has just sold out.' };
  if ((existing?.quantity || 0) >= Math.min(product.stock, 99)) return { ok: false, message: 'All available units are already in your bag.' };
  if (existing) Object.assign(existing, { quantity: existing.quantity + 1, price: product.price, stock: product.stock });
  else cart.push({ id: product.id, name: product.name, collection: product.collection, price: product.price, image_url: product.image_url, stock: product.stock, quantity: 1 });
  writeCart(cart);
  return { ok: true, message: `${product.name} added to your bag.` };
}
