// Port of Services/DocumentDateReader.cs, using only browser built-ins.
//
// Reads the document's own internal modification date. We prefer this over
// the file-system Last-Modified date because the latter changes any time the
// file is touched (copy, sync, antivirus). The internal date reflects when
// the author actually edited the content.
//
//   .docx/.docm/.xlsx/.xlsm/.pptx/.pptm -> package core properties
//                                          (dcterms:modified, then created)
//   .pdf                                -> Info dictionary
//                                          (ModDate, then CreationDate)
//
// Office files are ZIPs: we read the central directory by hand and inflate
// the one entry we need with DecompressionStream('deflate-raw'). That
// replaces DocumentFormat.OpenXml; nothing is downloaded.
//
// Dates come back as a literal {year, month, day} — the calendar digits as
// written in the document, with no timezone conversion. The desktop app
// behaves the same way for PDFs, and for Office files it makes no difference
// in a UTC+0 timezone.

// Modern Office formats are ZIP packages, so the core properties are readable.
// .xlsb is binary INSIDE, but the container is still a ZIP with docProps —
// so it belongs here, not with the legacy formats.
const OFFICE_EXTENSIONS = new Set([
  '.docx', '.docm', '.xlsx', '.xlsm', '.xlsb', '.pptx', '.pptm',
]);

// Pre-2007 OLE compound files. Supported so they get renamed, but their dates
// live in an OLE property stream this reader does not parse — they fall
// through to the date in the file name, then the filesystem date.
const LEGACY_EXTENSIONS = new Set([
  '.doc', '.dot', '.xls', '.xlt', '.ppt', '.pot',
]);

export function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

export function isSupported(name) {
  const ext = extensionOf(name);
  return OFFICE_EXTENSIONS.has(ext) || LEGACY_EXTENSIONS.has(ext) || ext === '.pdf';
}

/** True for formats we rename but cannot read a date out of. */
export function isLegacyOffice(name) {
  return LEGACY_EXTENSIONS.has(extensionOf(name));
}

/**
 * @returns {Promise<{year, month, day}|null>} null when the date can't be
 *          read (corrupt, password-protected, or a PDF that hides its Info
 *          dictionary inside a compressed object stream).
 */
export async function readDocumentDate(file) {
  const ext = extensionOf(file.name);

  // Don't read the bytes of a legacy file just to fail: its date is in an OLE
  // property stream, not anywhere this reader looks.
  if (LEGACY_EXTENSIONS.has(ext)) return null;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (OFFICE_EXTENSIONS.has(ext)) return await readOfficeDate(bytes);
    if (ext === '.pdf') return await readPdfDate(bytes);
  } catch {
    // Fall through to null and let the engine flag it as a skip.
  }
  return null;
}

/**
 * Last-resort date source: a name this tool wrote already contains the date,
 * e.g. "Report_Partner_Program_22-07-07_Version5.xlsx". That matters for files
 * whose full path exceeds Windows' 260-character limit — they can be listed
 * but not opened, so the name is the only readable thing about them.
 *
 * Deliberately strict: yy-MM-dd bounded by our own separators, so a stray
 * "18.08.25" or "Q4 2025" in a human-written name is not mistaken for one.
 */
export function dateFromFileName(name) {
  const m = /(?:^|[_-])(\d{2})-(\d{2})-(\d{2})(?:[_-]|$)/.exec(
    name.slice(0, name.lastIndexOf('.') > 0 ? name.lastIndexOf('.') : undefined));
  if (!m) return null;

  const [, yy, mm, dd] = m.map(Number);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return { year: 2000 + yy, month: mm, day: dd };
}

// ---------------------------------------------------------------- Office --

async function readOfficeDate(bytes) {
  const xml = await readZipEntryAsText(bytes, 'docProps/core.xml');
  if (!xml) return null;

  const modified = /<dcterms:modified[^>]*>([^<]+)</i.exec(xml);
  const created = /<dcterms:created[^>]*>([^<]+)</i.exec(xml);
  return parseIsoDate(modified?.[1]) ?? parseIsoDate(created?.[1]);
}

/** "2024-05-27T09:12:00Z" -> {year: 2024, month: 5, day: 27} */
function parseIsoDate(raw) {
  if (!raw) return null;
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return m ? { year: +m[1], month: +m[2], day: +m[3] } : null;
}

// ------------------------------------------------------------------- ZIP --

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

/**
 * Minimal ZIP reader: locate one entry by name via the central directory and
 * inflate it. Only the stored (0) and deflate (8) methods exist in practice
 * for Office packages.
 */
async function readZipEntryAsText(bytes, wantedName) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The end-of-central-directory record sits in the last 64KB (22 bytes plus
  // an optional comment).
  let eocd = -1;
  const searchFrom = Math.max(0, bytes.length - 66_000);
  for (let i = bytes.length - 22; i >= searchFrom; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) { eocd = i; break; }
  }
  if (eocd < 0) return null;

  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > bytes.length) return null;
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) return null;

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);

    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name === wantedName) {
      // Local header: name/extra lengths differ from the central copy.
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const data = bytes.subarray(dataStart, dataStart + compressedSize);

      if (method === 0) return new TextDecoder().decode(data);
      if (method === 8) return new TextDecoder().decode(await inflateRaw(data));
      return null; // some other method — not worth supporting
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

async function inflateRaw(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ------------------------------------------------------------------- PDF --

/**
 * PDF dates are "D:YYYYMMDDHHmmSSOHH'mm'" (ISO 32000-1 §7.9.4); everything
 * after the year is optional. We only need the calendar part.
 */
function parsePdfDate(raw) {
  if (!raw) return null;
  const m = /^\s*(?:D:)?(\d{4})(\d{2})?(\d{2})?/.exec(raw.trim());
  if (!m) return null;
  return { year: +m[1], month: +(m[2] ?? 1), day: +(m[3] ?? 1) };
}

async function readPdfDate(bytes) {
  // latin1 keeps every byte addressable as one character, so offsets from the
  // regex line up with the byte array.
  const text = new TextDecoder('latin1').decode(bytes);

  // Preferred: follow the trailer's /Info reference to the actual object.
  const infoRef = lastMatch(/\/Info\s+(\d+)\s+(\d+)\s+R/g, text);
  if (infoRef) {
    const objectPattern = new RegExp(`(?:^|[^0-9])${infoRef[1]}\\s+${infoRef[2]}\\s+obj([\\s\\S]*?)endobj`);
    const object = objectPattern.exec(text);
    const found = object && datesFrom(object[1]);
    if (found) return found;
  }

  // Fallback: the dictionary is usually plain text somewhere in the file.
  const found = datesFrom(text);
  if (found) return found;

  // Last resort: the Info dictionary lives inside a compressed object stream.
  return await datesFromCompressedStreams(bytes, text);
}

function datesFrom(text) {
  const modified = /\/ModDate\s*\(([^)]*)\)/.exec(text);
  const created = /\/CreationDate\s*\(([^)]*)\)/.exec(text);
  return parsePdfDate(modified?.[1])
      ?? parseIsoDate(xmp(text, 'ModifyDate'))
      ?? parsePdfDate(created?.[1])
      ?? parseIsoDate(xmp(text, 'CreateDate'));
}

/**
 * Plenty of real PDFs carry no Info dictionary at all and record their dates
 * only in an XMP metadata packet, which is normally stored as plain
 * uncompressed XML. Reading it turns a "no date, skipped" file into a
 * renameable one.
 */
function xmp(text, field) {
  const tagged = new RegExp(`<xmp:${field}[^>]*>([^<]+)<`, 'i').exec(text);
  if (tagged) return tagged[1];

  // String.raw so the \s survives — a template literal would eat the
  // backslash and quietly match a literal "s" instead of whitespace.
  const attribute = new RegExp('xmp:' + field + String.raw`\s*=\s*["']([^"']+)["']`, 'i').exec(text);
  return attribute?.[1] ?? null;
}

/**
 * Inflate FlateDecode streams and look inside. Capped so a large PDF can't
 * turn one file into a long stall — the common cases are handled above.
 */
async function datesFromCompressedStreams(bytes, text) {
  const MAX_STREAMS = 40;
  const MAX_STREAM_BYTES = 2_000_000;

  const pattern = /stream\r?\n/g;
  let match;
  let examined = 0;

  while ((match = pattern.exec(text)) && examined < MAX_STREAMS) {
    const start = match.index + match[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    if (end - start > MAX_STREAM_BYTES) continue;

    examined++;
    try {
      const inflated = await inflate(bytes.subarray(start, end));
      const found = datesFrom(new TextDecoder('latin1').decode(inflated));
      if (found) return found;
    } catch {
      // Not a deflate stream (image data, encrypted, …) — keep looking.
    }
  }
  return null;
}

async function inflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function lastMatch(pattern, text) {
  let match;
  let last = null;
  while ((match = pattern.exec(text))) last = match;
  return last;
}
