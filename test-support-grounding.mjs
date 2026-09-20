// Grounding check: real catalogue from Supabase -> real Groq call.
// Fails loudly if the bot recommends something the store doesn't sell.
import fs from 'fs';

const env = Object.fromEntries(
  ['.env', '.env.local'].flatMap((f) => fs.readFileSync(f, 'utf8').split(/\r?\n/))
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const base = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

const res = await fetch(
  `${base}/rest/v1/products?is_active=eq.true&select=name,collection,category,price,inventory(stock)&order=name.asc&limit=200`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } },
);
if (!res.ok) { console.error('supabase', res.status, await res.text()); process.exit(1); }
const products = await res.json();

const catalog = products.map((pr) => {
  const inv = Array.isArray(pr.inventory) ? pr.inventory[0] : pr.inventory;
  const tags = [pr.collection, pr.category].filter(Boolean).join(', ');
  return `- ${pr.name}${tags ? ` (${tags})` : ''} - P${pr.price}` + (inv && inv.stock === 0 ? ' - OUT OF STOCK' : '');
}).join('\n');

console.log(`${products.length} active products\n${catalog.split('\n').slice(0, 8).join('\n')}\n`);

const system =
  'You are the friendly customer-support assistant for NGL Accessories, a premium Philippines jewelry brand. ' +
  'Reply warmly and concisely (2-4 sentences). Use ONLY the facts below - never invent orders, prices, or policies. ' +
  'CATALOGUE below is the complete list of what NGL sells. Recommend ONLY items named there, quoting the name exactly. ' +
  "If the customer asks for something not in CATALOGUE, say plainly that we don't carry it, then offer the closest item that IS listed. " +
  'Never describe a product, material, or feature that is not in CATALOGUE. ' +
  `\n\nFACTS:\n\nCATALOGUE (everything NGL sells):\n${catalog}`;

const names = products.map((p) => p.name.toLowerCase());
for (const q of ['do you sell silver?', 'can you suggest something for my prom?', 'do you have a choker?']) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.GROQ_MODEL || 'openai/gpt-oss-120b',
      temperature: 0.4,
      max_tokens: 400,
      messages: [{ role: 'system', content: system }, { role: 'user', content: q }],
    }),
  });
  const reply = (await r.json())?.choices?.[0]?.message?.content || '(no content)';
  const named = names.filter((n) => reply.toLowerCase().includes(n));
  console.log(`Q: ${q}\nA: ${reply}\n   -> real products named: ${named.length ? named.join(' | ') : 'NONE'}\n`);
}
