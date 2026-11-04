export const MAX_CLOUD_JPEG = 4 * 1024 * 1024;
const MAX_ARCHIVE = 32 * 1024 * 1024;
const MAX_EXTRACTED = 48 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });
const jpegName = /\.jpe?g$/i;
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  return n;
});

function checksum(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

export async function extractPanoramas(archive) {
  if (archive.size > MAX_ARCHIVE) throw new Error('The ZIP must be 32 MiB or smaller.');
  const bytes = new Uint8Array(await archive.arrayBuffer());
  const data = new DataView(bytes.buffer);
  const u16 = pos => data.getUint16(pos, true);
  const u32 = pos => data.getUint32(pos, true);
  const invalid = () => new Error('The ZIP is damaged or uses an unsupported layout.');
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) &&
    (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== bytes.length)) end--;
  if (end < Math.max(0, bytes.length - 65557) || u16(end + 4) || u16(end + 6)) throw invalid();
  const count = u16(end + 10);
  const central = u32(end + 16);
  if (!count || count > 64 || count !== u16(end + 8) || central + u32(end + 12) !== end) throw invalid();
  let pos = central;
  let expanded = 0;
  const entries = [];
  const paths = new Set();
  const ranges = [];
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || u32(pos) !== 0x02014b50) throw invalid();
    const flags = u16(pos + 8), method = u16(pos + 10), crc = u32(pos + 16);
    const compressed = u32(pos + 20), size = u32(pos + 24);
    const length = u16(pos + 28), offset = u32(pos + 42);
    const next = pos + 46 + length + u16(pos + 30) + u16(pos + 32);
    if (next > end || !length || u16(pos + 34) || (flags & ~0x080e) ||
        ![0, 8].includes(method) || offset + 30 > central || u32(offset) !== 0x04034b50 ||
        u16(offset + 6) !== flags || u16(offset + 8) !== method) throw invalid();
    const path = decoder.decode(bytes.subarray(pos + 46, pos + 46 + length));
    const parts = path.replace(/\/$/, '').split('/');
    if (/[:\\\x00-\x1f]/.test(path) || parts.some(part => !part || part === '.' || part === '..') ||
        paths.has(path.toLowerCase()) || (u32(pos + 38) >>> 28) === 10) {
      throw new Error('The ZIP contains an unsafe or repeated path.');
    }
    paths.add(path.toLowerCase());
    const name = parts.at(-1);
    if (/\.(zip|7z|rar|tar|gz|bz2|xz|jar|shtour)$/i.test(name)) throw new Error('Nested archives are not supported.');
    const start = offset + 30 + u16(offset + 26) + u16(offset + 28);
    if (start + compressed > central || u16(offset + 26) !== length ||
        decoder.decode(bytes.subarray(offset + 30, offset + 30 + length)) !== path) throw invalid();
    ranges.push([offset, start + compressed]);
    expanded += size;
    if (expanded > MAX_EXTRACTED || size > Math.max(4096, compressed * 200)) throw new Error('The ZIP expands beyond the safety limits.');
    if (!path.endsWith('/') && jpegName.test(name)) entries.push({ name, start, compressed, size, method, crc });
    else if (!path.endsWith('/') && !/^(README(?:\.txt|\.md)?|\.DS_Store|Thumbs\.db)$/i.test(name)) {
      throw new Error('Use a ZIP of stitched JPEGs. Other file types are not supported.');
    }
    pos = next;
  }
  ranges.sort((a, b) => a[0] - b[0]);
  if (pos !== end || ranges.some((range, i) => i && range[0] < ranges[i - 1][1])) throw invalid();
  if (!entries.length) throw new Error('No stitched JPEGs found. Capture-frame archives cannot create a panorama.');
  const images = [];
  for (const { name, start, compressed, size, method, crc } of entries) {
    if (!size || size > MAX_CLOUD_JPEG) {
      images.push({ name, error: 'Each cloud JPEG must be 4 MiB or smaller.' });
      continue;
    }
    const stream = new Blob([bytes.subarray(start, start + compressed)]).stream();
    const reader = (method === 8 ? stream.pipeThrough(new DecompressionStream('deflate-raw')) : stream).getReader();
    const output = new Uint8Array(size);
    let written = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (written + value.length > size) {
        await reader.cancel();
        throw new Error('The ZIP expanded beyond its declared image size.');
      }
      output.set(value, written);
      written += value.length;
    }
    if (written !== size || checksum(output) !== crc) throw invalid();
    images.push({ name, file: new File([output], name, { type: 'image/jpeg' }) });
  }
  return images;
}
