/* Placeholder configs for the Phase 1 lab page (no database). The SVGs are
   neutral test shapes, NOT product designs; swap in real transparent cutouts
   of pilot products before judging visual accuracy. Contract shape. */
const xy = (x, y) => ({ x, y });
const base = (id, file, anchor, scaleRatio) => ({
  productId: `fixture-${id}`,
  version: 1,
  enabled: true,
  assets: { left: `/try-on/fixtures/${file}`, right: null },
  mirrorLeftForRight: true,
  anchor: { left: anchor, right: xy(1 - anchor.x, anchor.y) },
  offset: { left: xy(0, 0), right: xy(0, 0) },
  rotationDeg: { left: 0, right: 0 },
  scaleRatio,
  lengthMm: null,
});

export const FIXTURES = [
  base('stud', 'stud.svg', xy(0.5, 0.5), 0.07),
  base('hoop', 'hoop.svg', xy(0.5, 0.07), 0.2),
  base('drop', 'drop.svg', xy(0.5, 0.045), 0.32),
];
