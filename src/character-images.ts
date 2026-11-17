import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { Character } from './extract';

interface Image {
  rgba: Buffer;
  width: number;
  height: number;
}

function indexFiles(dlcDir: string): Map<string, string> {
  const found = new Map<string, string>();
  const stack = [dlcDir];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else found.set(entry.name.toLowerCase(), path);
    }
  }
  return found;
}

/** oo_tool unpacks `.dz` next to its input and has to run from its own dist folder. */
function unpack(source: string, name: string): Buffer {
  const cache = join(tmpdir(), 'dffoo-resource-images');
  mkdirSync(cache, { recursive: true });
  const unpacked = join(cache, name.replace(/\.dz$/i, ''));
  if (!existsSync(unpacked)) {
    const copy = join(cache, name);
    writeFileSync(copy, readFileSync(source));
    const unpacker = process.env.DFFOO_UNPACKER ?? resolve(__dirname, '..', 'node_modules', 'oo_tool');
    const result = spawnSync(process.execPath, [join(unpacker, 'build', 'lib', 'app.cjs'), '-u', copy], {
      cwd: join(unpacker, 'dist'),
      encoding: 'utf8',
    });
    if (result.status !== 0 || !existsSync(unpacked)) throw new Error(result.stderr || result.stdout || `could not unpack ${name}`);
  }
  return readFileSync(unpacked);
}

/** The first texture of a g1t. Character event art is format 0x00, 8-bit RGBA. */
export function decodeRgba8(g1t: Buffer): Image {
  if (g1t.subarray(0, 4).toString('latin1') !== 'GT1G') throw new Error('not a g1t');
  const table = g1t.readUInt32LE(0x0c);
  const start = table + g1t.readUInt32LE(table);
  const format = g1t[start + 1];
  if (format !== 0x00) throw new Error(`texture is format 0x${format.toString(16)}, expected 0x0`);
  const width = 1 << (g1t[start + 2] & 0x0f);
  const height = 1 << (g1t[start + 2] >> 4);
  return { rgba: Buffer.from(g1t.subarray(start + 8, start + 8 + width * height * 4)), width, height };
}

export function trim(image: Image): Image {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.rgba[(y * image.width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) return image;
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const from = ((minY + y) * image.width + minX) * 4;
    image.rgba.copy(rgba, y * width * 4, from, from + width * 4);
  }
  return { rgba, width, height };
}

/** Halves each side, averaging 2 by 2 blocks with colour weighted by alpha so edges don't darken. */
export function halve(image: Image): Image {
  const width = Math.ceil(image.width / 2);
  const height = Math.ceil(image.height / 2);
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const sx = Math.min(image.width - 1, x * 2 + dx);
        const sy = Math.min(image.height - 1, y * 2 + dy);
        const at = (sy * image.width + sx) * 4;
        const alpha = image.rgba[at + 3];
        r += image.rgba[at] * alpha;
        g += image.rgba[at + 1] * alpha;
        b += image.rgba[at + 2] * alpha;
        a += alpha;
      }
      const at = (y * width + x) * 4;
      if (a > 0) {
        rgba[at] = Math.round(r / a);
        rgba[at + 1] = Math.round(g / a);
        rgba[at + 2] = Math.round(b / a);
      }
      rgba[at + 3] = Math.round(a / 4);
    }
  }
  return { rgba, width, height };
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), data])), 0);
  return Buffer.concat([header, data, crc]);
}

export function encodePng(image: Image): Buffer {
  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) image.rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Writes `<image_id>.png` per character from stl_chara_event_<image_id>, trimmed and at half size. Returns how many it wrote. */
export function writeCharacterImages(dlcDir: string, characters: Character[], outDir: string): number {
  const files = indexFiles(dlcDir);
  mkdirSync(outDir, { recursive: true });
  let written = 0;
  for (const imageId of new Set(characters.map((character) => character.image_id))) {
    const name = `stl_chara_event_${String(imageId).padStart(8, '0')}.g1t.dz`;
    const source = files.get(name);
    if (!source) continue;
    writeFileSync(join(outDir, `${imageId}.png`), encodePng(halve(trim(decodeRgba8(unpack(source, name))))));
    written += 1;
  }
  return written;
}
