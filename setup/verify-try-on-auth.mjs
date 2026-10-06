// Real-request authorization check for the try-on table + bucket (task C9).
// Run AFTER applying supabase/migrations/20260914001100_try-on.sql:
//   node --env-file=.env.local setup/verify-try-on-auth.mjs <earring-product-uuid> [adminEmail adminPassword]
// Anonymous checks always run. Pass admin credentials to also check admin writes
// (it inserts one DRAFT row for that product, then deletes it — skipped if a row exists).
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL, key = process.env.VITE_SUPABASE_ANON_KEY;
const [productId, email, password] = process.argv.slice(2);
if (!url || !key || !productId) { console.error('Need VITE_SUPABASE_URL/ANON_KEY and a product id.'); process.exit(2); }

const results = [];
const check = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const draft = (id) => ({ product_id: id, enabled: false });
const png = new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0))], { type: 'image/png' });
const objectPath = `${productId}/left-${Date.now()}.png`;

// --- anonymous ---------------------------------------------------------
const anon = createClient(url, key);
{
  const { data, error } = await anon.from('product_try_on_configs').select('product_id, enabled');
  check('anon can read the table', !error, error?.message);
  check('anon sees only enabled rows', !error && data.every(r => r.enabled), `${data?.length ?? 0} row(s)`);
  const ins = await anon.from('product_try_on_configs').insert(draft(productId));
  check('anon insert is rejected', !!ins.error, ins.error?.message);
  const upd = await anon.from('product_try_on_configs').update({ enabled: true }).eq('product_id', productId).select();
  check('anon update changes nothing', !!upd.error || upd.data.length === 0);
  const del = await anon.from('product_try_on_configs').delete().eq('product_id', productId).select();
  check('anon delete removes nothing', !!del.error || del.data.length === 0);
  const up = await anon.storage.from('try-on-assets').upload(objectPath, png, { contentType: 'image/png' });
  check('anon bucket upload is rejected', !!up.error, up.error?.message);
}

// --- admin (optional) ----------------------------------------------------
if (email && password) {
  const admin = createClient(url, key);
  const { error: authError } = await admin.auth.signInWithPassword({ email, password });
  if (authError) { check('admin sign-in', false, authError.message); }
  else {
    const existing = await admin.from('product_try_on_configs').select('product_id').eq('product_id', productId);
    if (existing.data?.length) console.log('SKIP  admin write checks: a row already exists for this product');
    else {
      const ins = await admin.from('product_try_on_configs').insert(draft(productId));
      check('admin can insert a draft', !ins.error, ins.error?.message);
      const bad = await admin.from('product_try_on_configs').update({ scale_ratio: 5 }).eq('product_id', productId);
      check('admin cannot break CHECK bounds', !!bad.error, bad.error?.message);
      const seen = await anon.from('product_try_on_configs').select('product_id').eq('product_id', productId);
      check('anon still cannot see the draft', !seen.error && seen.data.length === 0);
      const up = await admin.storage.from('try-on-assets').upload(objectPath, png, { contentType: 'image/png' });
      check('admin can upload a webp/png asset', !up.error, up.error?.message);
      const badName = await admin.storage.from('try-on-assets').upload(`${productId}/evil.png`, png, { contentType: 'image/png' });
      check('admin upload with a wrong name is rejected', !!badName.error, badName.error?.message);
      if (!up.error) await admin.storage.from('try-on-assets').remove([objectPath]);
      const del = await admin.from('product_try_on_configs').delete().eq('product_id', productId);
      check('admin cleanup (delete draft)', !del.error, del.error?.message);
    }
    await admin.auth.signOut();
  }
}
process.exit(results.every(Boolean) ? 0 : 1);
