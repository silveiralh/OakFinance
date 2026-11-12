// Gera os PNG e o favicon.ico a partir de src/brand/*.svg e public/favicon.svg (UX §4.11.5). Roda no build.
// Os arquivos gerados não são versionados nem editados à mão.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brand = (name) => join(root, 'src/brand', name);
const out = (name) => join(root, 'public', name);

/** Cantos arredondados de 22% (ícones "any"): transparente fora do quadrado arredondado. */
function roundedMask(size) {
  const r = Math.round(size * 0.22);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/></svg>`,
  );
}

function render(svg, size) {
  return sharp(svg, { density: Math.max(72, Math.ceil((72 * size) / 32)) }).resize(size, size);
}

/** ICO com imagens PNG embutidas (16, 32 e 48). */
export function icoFromPngs(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

export async function buildIcons() {
  await mkdir(out('icons'), { recursive: true });
  const maskable = await readFile(brand('of-icon-maskable.svg'));
  const mono = Buffer.from(
    (await readFile(brand('of-mono.svg'), 'utf8')).replaceAll('currentColor', '#FFFFFF'),
  );
  const favicon = await readFile(out('favicon.svg'));
  const written = [];
  const save = async (name, pipeline) => {
    await writeFile(out(name), await pipeline.png({ compressionLevel: 9 }).toBuffer());
    written.push(name);
  };

  for (const size of [192, 512]) {
    await save(`icons/icon-maskable-${size}.png`, render(maskable, size));
    const art = await render(maskable, size).png().toBuffer();
    await save(
      `icons/icon-${size}.png`,
      sharp(art).composite([{ input: roundedMask(size), blend: 'dest-in' }]),
    );
  }
  await save('icons/icon-mono-512.png', render(mono, 512));
  await save('icons/badge-96.png', render(mono, 96));
  await save('apple-touch-icon.png', render(maskable, 180).flatten({ background: '#0B0D0A' }));

  const pngs = [];
  for (const size of [16, 32, 48]) {
    pngs.push({ size, data: await render(favicon, size).png().toBuffer() });
  }
  await writeFile(out('favicon.ico'), icoFromPngs(pngs));
  written.push('favicon.ico');
  return written;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const written = await buildIcons();
  process.stdout.write(`build-icons: ${written.length} arquivos em public/\n`);
}
