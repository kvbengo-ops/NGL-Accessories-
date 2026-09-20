// Customer care remains on service/checkout pages; storefront discovery uses Stylist.
const carePages = ['/support.html', '/checkout.html', '/track-order.html', '/order-confirm.html'];
if (carePages.includes(location.pathname)) {
  await import('./support-chat.js');
} else {
  const { initStylist } = await import('./stylist-widget.js');
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initStylist, { once: true });
  else initStylist();
}
