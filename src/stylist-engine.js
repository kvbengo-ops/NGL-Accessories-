// Shared, deterministic catalog constraints. No provider or browser dependencies.
export const CATEGORIES = ['Earrings', 'Necklaces', 'Bracelets', 'Rings', 'Anklets'];
export const OCCASIONS = ['Wedding guest', 'Everyday', 'Office', 'Date night', 'Vacation', 'Party', 'Gift', 'Prom', 'Graduation'];
const occasionPatterns = [/wedding|kasal|bridal/, /everyday|daily|araw/, /office|work|trabaho/, /date|dinner/, /beach|vacation|travel|resort/, /party|gala|birthday/, /gift|regalo/, /\bprom\b/, /graduation/];
export function cleanBrief(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  return {
    occasion: typeof value.occasion === 'string' ? value.occasion.trim().slice(0, 80) : '',
    theme: typeof value.theme === 'string' ? value.theme.trim().slice(0, 80) : '',
    searchTerms: Array.isArray(value.searchTerms) ? value.searchTerms.filter(t => typeof t === 'string').map(t => t.slice(0, 40)).slice(0, 12) : [],
    categories: Array.isArray(value.categories) ? [...new Set(value.categories.filter(c => CATEGORIES.includes(c)))].slice(0, 3) : [],
    excluded: Array.isArray(value.excluded) ? value.excluded.filter(c => CATEGORIES.includes(c)) : [],
    budget: typeof value.budget === 'number' && Number.isFinite(value.budget) && value.budget >= 0 ? Math.min(value.budget, 1000000) : null,
    vibe: ['Simple', 'Statement'].includes(value.vibe) ? value.vibe : '',
    metal: ['gold', 'silver', 'rose gold'].includes(value.metal) ? value.metal : '',
    outfit: typeof value.outfit === 'string' ? value.outfit.slice(0, 100) : '',
    set: value.set === true,
    safety: value.safety === true,
    cheaper: value.cheaper === true,
    alternate: value.alternate === true,
    language: value.language === 'fil' ? 'fil' : 'en',
  };
}
export function parseBrief(message, previous = {}, interpreted = {}) {
  const old = cleanBrief(previous);
  const b = cleanBrief({ ...old, ...interpreted, cheaper: false, alternate: false });
  const t = message.toLowerCase();
  for (let i = 0; i < occasionPatterns.length; i++) if (occasionPatterns[i].test(t)) b.occasion = OCCASIONS[i];
  // Keep themes as first-class conversation context, not a synonym for "party".
  if (/\b(?:19)?80['’]?s\b|eighties/.test(t)) b.theme = '80s';
  else if (/\b(?:19)?90['’]?s\b|nineties/.test(t)) b.theme = '90s';
  else if (/\b(?:19)?70['’]?s\b|seventies/.test(t)) b.theme = '70s';
  else {
    const theme = t.match(/\btheme(?:d)?(?:\s+is|\s*[:=])?\s+(.{1,70}?)(?:[.!?]|$)/);
    if (theme) b.theme = theme[1].trim();
  }
  if (/no theme|remove (?:the )?theme|forget (?:the )?theme/.test(t)) b.theme = '';
  const selected = [], excluded = new Set(b.excluded);
  for (const category of CATEGORIES) {
    const word = category.toLowerCase().replace(/s$/, '');
    if (new RegExp(`\\b${word}s?\\b`).test(t)) {
      if (new RegExp(`(?:no|without|not|ayaw|except)\\s+(?:any\\s+)?${word}s?\\b`).test(t)) excluded.add(category);
      else { selected.push(category); excluded.delete(category); }
    }
  }
  if (selected.length) b.categories = selected;
  b.excluded = [...excluded];
  const budget = t.match(/(?:under|below|within|budget(?:\s+(?:is|of|ko))?|up to|max(?:imum)?|less than|make it|at most|spend|hanggang|₱|php|peso[s]?)\s*(?:[:=]|of)?\s*(?:₱|php)?\s*([\d,]+(?:\.\d+)?)\s*(k\b)?/i);
  if (budget) b.budget = Math.min(Number(budget[1].replaceAll(',', '')) * (budget[2] ? 1000 : 1), 1000000);
  else if (old.budget !== null) b.budget = old.budget; // AI cannot silently remove a previous price ceiling.
  if (/no budget|any budget|remove budget|no price limit/.test(t)) b.budget = null;
  if (/simple|minimal|subtle|understated|delicate/.test(t)) b.vibe = 'Simple';
  if (/statement|bold|dramatic/.test(t)) b.vibe = 'Statement';
  if (/rose gold/.test(t)) b.metal = 'rose gold';
  else if (/\bsilver\b/.test(t)) b.metal = 'silver';
  else if (/\bgold\b/.test(t)) b.metal = 'gold';
  if (/any metal|either metal/.test(t)) b.metal = '';
  const outfit = t.match(/\b(black|white|sage green|green|blue|red|pink|cream|navy|beige)\s+(dress|outfit|gown|top|shirt|suit)\b/);
  if (outfit) b.outfit = outfit[0];
  if (/complete look|full look|matching|combo|\bset\b|together/.test(t) || selected.length > 1) b.set = true;
  if (/only|just one|one piece|single item/.test(t)) b.set = false;
  b.safety = /waterproof|swim|saltwater|sweat|hypoallergenic|allerg|sensitive skin|nickel|tarnish/.test(t) || interpreted.safety === true || (old.safety && !/ignore that|style only/.test(t));
  b.cheaper = /cheaper|lower price|less expensive|mas mura/.test(t);
  b.alternate = /another|different option|alternatives|iba naman/.test(t);
  if (/\b(ako|ko|lang|regalo|kasal|mura|naman|gusto|pang|may)\b/.test(t)) b.language = 'fil';
  return b;
}
export function publicProduct(p) {
  const inv = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
  return { id: String(p.id), name: String(p.name || ''), collection: String(p.collection || ''), category: String(p.category || ''), price: Number(p.price), image_url: String(p.image_url || ''), description: String(p.description || ''), tags: Array.isArray(p.tags) ? p.tags.filter(t => typeof t === 'string') : [], stock: Number(inv?.stock ?? p.stock ?? 0), is_active: p.is_active !== false };
}
export function isOrderHelp(message) {
  return /\b(refund|complaint|human|track|tracking|where.*order|order.*status|damaged|wrong item|contact|support)\b/i.test(message);
}
