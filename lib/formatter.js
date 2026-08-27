// Port of Services/FileNameFormatter.cs — keep the two in step.
//
// Implements the Foundation's "File Naming Conventions: Guidance and Business
// Value" (Content Management + Legal & Compliance, 2026).
//
// Programmatic files — documents belonging to a program lifecycle:
//     DocumentType-LeadPartnerName-ProgramAcronym-YY-MM-DD-Stage
//
// Non-programmatic files — operational, administrative or internal working
// documents with no Program-Partner folder to place them:
//     Document Title - YYYY-MM-DD - Stage
//
// The two differ deliberately, per the guidance: programmatic names take no
// spaces around the hyphens and a two-digit year, while non-programmatic names
// put spaces either side of the hyphen and use a four-digit year.

/**
 * Longest a single field may be. A 92-character programme name repeated in
 * every file name pushed real paths past Windows' 260-character limit, and the
 * files then could not be opened at all. Truncating keeps names usable; the
 * full name still lives in the folder.
 */
export const MAX_FIELD_LENGTH = 40;

/**
 * Proposed names longer than this are flagged in the preview. Not a hard limit
 * — how much room is left depends on the folder path — but the point where a
 * deep OneDrive path starts to be at risk.
 */
export const LONG_NAME_WARNING_LENGTH = 120;

// The guidance's "avoid special characters" list (\ / : * ? " < > | & % # @),
// plus C0 control codes.
const ILLEGAL = /[\\/:*?"<>|&%#@\u0000-\u001f]/g;

// Whitespace, dash punctuation (-, en dash, em dash) and connector punctuation
// (_). The hyphen separates elements in a programmatic name, so none of these
// may survive inside a field or the name stops being readable back.
const SEPARATORS = /[\s\p{Pd}\p{Pc}]/gu;

/**
 * Reduces a name piece to letters and digits: every space, hyphen (including
 * en/em dashes) and underscore is removed, so "Approval Note" ->
 * "ApprovalNote" and "GYE-MCF" -> "GYEMCF". The date is built separately and
 * never passes through here, which is why it is the only part of a
 * programmatic name that still contains a hyphen.
 */
export function sanitize(raw) {
  const cleaned = String(raw).replace(ILLEGAL, '').replace(SEPARATORS, '');
  return cleaned.slice(0, MAX_FIELD_LENGTH);
}

/**
 * Non-programmatic titles keep their spaces — the guidance asks for a "short,
 * meaningful summary", not a run-together token — but still lose the
 * characters it tells us to avoid.
 */
export function sanitizeTitle(raw) {
  return String(raw)
    .replace(ILLEGAL, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FIELD_LENGTH * 2);
}

const pad = (n) => String(n).padStart(2, '0');

/** "26-02-10" — the two-digit form the guidance specifies for programmatic files. */
function shortDate({ year, month, day }) {
  return `${pad(year % 100)}-${pad(month)}-${pad(day)}`;
}

/** "2026-02-10" — the four-digit form the guidance specifies for the rest. */
function longDate({ year, month, day }) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Strips a trailing " - YYYY-MM-DD - Stage" that an earlier run added, so
 * re-scanning a non-programmatic file rebuilds its name instead of appending a
 * second date and stage every time.
 */
export function titleFrom(stem) {
  return stem
    .replace(/\s*[-–—]\s*\d{4}-\d{2}-\d{2}\s*[-–—]\s*(?:final|draft|v(?:ersion)?\s*\d{1,3})\s*$/i, '')
    .replace(/\s*[-–—]\s*\d{4}-\d{2}-\d{2}\s*$/i, '')
    .trim();
}

function withExtension(name, extension) {
  const ext = extension.startsWith('.') ? extension : `.${extension}`;
  return name + ext;
}

/**
 * @param meta {{documentType, leadPartnerName, programAcronym, stage, documentDate}}
 *        documentDate is a plain {year, month, day} taken literally from the
 *        document — no timezone conversion, so what the file says is what the
 *        name gets.
 */
export function buildFileName(meta, extension) {
  if (!meta.documentDate) throw new Error('documentDate is required.');

  const parts = [
    sanitize(meta.documentType),
    sanitize(meta.leadPartnerName),
    sanitize(meta.programAcronym),
    shortDate(meta.documentDate),
    sanitize(meta.stage),
  ];

  return withExtension(parts.join('-'), extension);
}

/**
 * "Document Title - YYYY-MM-DD - Stage", for files that belong to no program.
 * @param title the existing file name stem, used as the document title
 */
export function buildNonProgrammaticName(title, meta, extension) {
  if (!meta.documentDate) throw new Error('documentDate is required.');

  const parts = [sanitizeTitle(title), longDate(meta.documentDate), meta.stage];
  return withExtension(parts.join(' - '), extension);
}
