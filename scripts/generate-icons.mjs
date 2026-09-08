import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const BRAND = '#b4321f';

/** The mark, at 100×100, in one colour. Same geometry as `LogoMark`. */
const mark = (colour) => `
  <circle cx="44.75" cy="50" r="30" fill="none" stroke="${colour}" stroke-width="15"/>
  <circle cx="66.25" cy="71.5" r="13" fill="${colour}"/>
  <rect x="62.75" y="65" width="30" height="13" rx="6.5" fill="${colour}"/>`;

/**
 * A launcher icon.
 *
 * `pad` is the share of the canvas left empty around the mark. Android's
 * maskable icons are cropped to a circle by the launcher, so the safe zone is
 * the middle 80% — a mark drawn to the edges loses its corners on a Pixel and
 * keeps them on a Samsung, which is how an icon ends up looking broken on half
 * the phones in a city.
 */
function icon({ size, pad, bg, fg }) {
  const inner = Math.round(size * (1 - pad * 2));
  const offset = Math.round((size - inner) / 2);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
       <rect width="${size}" height="${size}" fill="${bg}"/>
       <svg x="${offset}" y="${offset}" width="${inner}" height="${inner}" viewBox="0 0 100 100">${mark(fg)}</svg>
     </svg>`,
  );
}

const jobs = [
  // Ordinary launcher icons: white ground, brand mark, modest padding.
  ['icon-192.png',       icon({ size: 192,  pad: 0.16, bg: '#ffffff', fg: BRAND })],
  ['icon-512.png',       icon({ size: 512,  pad: 0.16, bg: '#ffffff', fg: BRAND })],
  // Maskable: brand ground so the launcher's crop has something to cut into,
  // and the mark pulled well inside the safe zone.
  ['maskable-192.png',   icon({ size: 192,  pad: 0.26, bg: BRAND,     fg: '#ffffff' })],
  ['maskable-512.png',   icon({ size: 512,  pad: 0.26, bg: BRAND,     fg: '#ffffff' })],
  // iOS draws its own rounded corners and does NOT respect transparency, so
  // this one is opaque by design.
  ['apple-touch-icon.png', icon({ size: 180, pad: 0.14, bg: '#ffffff', fg: BRAND })],
  // The little monochrome mark Android puts in the status bar.
  ['badge-72.png',       icon({ size: 72,   pad: 0.12, bg: '#00000000', fg: '#ffffff' })],
];

for (const [name, svg] of jobs) {
  await sharp(svg).png({ compressionLevel: 9 }).toFile(`public/icons/${name}`);
  console.log('  ', name);
}

// The favicon, as SVG so it stays sharp and follows the tab's theme.
writeFileSync(
  'public/icons/icon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${mark(BRAND)}</svg>\n`,
);
console.log('   icon.svg');
