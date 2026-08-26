// Port of Services/FolderInfoExtractor.cs, MetadataResolver.cs and
// RenameEngine.cs — keep them in step.
//
// Two-phase by design: buildPlan() never touches the disk, and execute() is a
// separate user action. Collisions are never overwritten — " (2)", " (3)" is
// appended instead.

import { classifyType, classifyStage } from './classifier.js';
import { buildFileName } from './formatter.js';
import { isSupported, extensionOf, readDocumentDate } from './docdate.js';

/**
 * Last-resort stage. Most documents that reach the tool are the copy the team
 * settled on — reports especially rarely carry a "final"/"v2" marker in the
 * file name — so an unmarked file is treated as Final rather than skipped.
 */
export const FALLBACK_STAGE = 'Final';

export const STATUS = {
  pending: 'Pending',
  alreadyCorrect: 'Already correct',
  skippedUnsupported: 'Skipped (unsupported)',
  skippedMissing: 'Skipped (missing metadata)',
  unreadable: 'Skipped (unreadable)',
  renamed: 'Renamed',
  failed: 'Failed',
};

// ------------------------------------------------------- folder → program --

/**
 * Reads "<Program>-<Partner>" off a folder name.
 *
 * Convention: a bare hyphen separates the two halves (no spaces required),
 * e.g. "GROW-Generation You", "MFAP-Jobberman", "GROW-GYE-MCF". The split is
 * on the FIRST hyphen only — everything after it is the partner, so a partner
 * name that itself contains a dash survives. The space-padded form (" - ") is
 * accepted first as a courtesy to folders named under the old convention.
 */
export function parseFolderName(folderName) {
  if (!folderName || !folderName.trim()) return null;

  for (const spaced of [' - ', ' – ', ' — ']) {
    const i = folderName.indexOf(spaced);
    if (i > 0 && i < folderName.length - spaced.length) {
      const program = folderName.slice(0, i).trim();
      const partner = folderName.slice(i + spaced.length).trim();
      if (program && partner) return { programAcronym: program, leadPartnerName: partner };
    }
  }

  const idx = folderName.indexOf('-');
  if (idx > 0 && idx < folderName.length - 1) {
    const program = folderName.slice(0, idx).trim();
    const partner = folderName.slice(idx + 1).trim();
    if (program && partner) return { programAcronym: program, leadPartnerName: partner };
  }
  return null;
}

/**
 * Walks up from the file's own folder toward the picked root and uses the
 * first ancestor whose name parses. `segments` is the chain of folder names
 * between the root and the file, root first.
 */
function folderInfoFor(segments) {
  for (let i = segments.length - 1; i >= 0; i--) {
    const parsed = parseFolderName(segments[i]);
    if (parsed) return parsed;
  }
  return null;
}

// ------------------------------------------------------------- resolution --

const trimmed = (s) => (s && s.trim() ? s.trim() : null);

/**
 * Program + Partner come from the file's OWN folder name, so a single root
 * holding many "Program-Partner" project folders renames correctly in one
 * pass — each file gets its project, not a global one. The typed values are
 * only a fallback for files whose folder name doesn't parse.
 *
 * Stage is the one field that never comes back null: filename keyword, then
 * the default stage box, then FALLBACK_STAGE.
 */
async function resolveMetadata(entry, options, rootName) {
  // The picked folder's own name counts too: pointing the tool straight at
  // "GROW-GYE-MCF" has to work, not just at a parent holding such folders.
  const folder = folderInfoFor([rootName, ...entry.segments]);

  return {
    documentType: classifyType(entry.name),
    stage: classifyStage(entry.name) ?? trimmed(options.defaultStage) ?? FALLBACK_STAGE,
    programAcronym: folder?.programAcronym ?? trimmed(options.programOverride) ?? null,
    leadPartnerName: folder?.leadPartnerName ?? trimmed(options.partnerOverride) ?? null,
    documentDate: await readDocumentDate(entry.file),
  };
}

function missingFields(meta) {
  const missing = [];
  if (!meta.documentType) missing.push('DocumentType');
  if (!meta.leadPartnerName) missing.push('LeadPartnerName');
  if (!meta.programAcronym) missing.push('ProgramAcronym');
  if (!meta.stage) missing.push('Stage');
  if (!meta.documentDate) missing.push('DocumentDate');
  return missing;
}

function describeFound(meta) {
  const found = [];
  if (meta.programAcronym) found.push(`Program=${meta.programAcronym}`);
  if (meta.leadPartnerName) found.push(`Partner=${meta.leadPartnerName}`);
  if (meta.documentType) found.push(`Type=${meta.documentType}`);
  if (meta.stage) found.push(`Stage=${meta.stage}`);
  if (meta.documentDate) {
    const { year, month, day } = meta.documentDate;
    found.push(`Date=${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return found;
}

// ------------------------------------------------------------ walk + plan --

/** Depth-first walk yielding every file with the folder chain above it. */
export async function* walk(directoryHandle, segments = []) {
  for await (const handle of directoryHandle.values()) {
    if (handle.kind === 'directory') {
      yield* walk(handle, [...segments, handle.name]);
    } else {
      yield { handle, parent: directoryHandle, segments, name: handle.name };
    }
  }
}

/**
 * Dry run: reads every file's metadata and works out the proposed name.
 * Nothing on disk changes.
 */
export async function buildPlan(directoryHandle, options, onProgress) {
  const rootName = directoryHandle.name;
  const entries = [];
  let walkError = null;

  try {
    for await (const entry of walk(directoryHandle)) entries.push(entry);
  } catch (error) {
    // Report what we did manage to enumerate rather than nothing at all.
    walkError = error;
  }

  const plans = [];
  let done = 0;

  for (const entry of entries) {
    done++;
    onProgress?.(done, entries.length);

    const relativePath = [...entry.segments, entry.name].join('/');

    if (!isSupported(entry.name)) {
      plans.push({ ...entry, relativePath, status: STATUS.skippedUnsupported, notes: '' });
      continue;
    }

    // One unreadable file must not abort the run. Managed devices hit this
    // for cloud placeholders and locked files, and losing the whole scan to a
    // single bad file makes the tool useless exactly where it is needed.
    let meta;
    try {
      entry.file = await entry.handle.getFile();
      meta = await resolveMetadata(entry, options, rootName);
    } catch (error) {
      plans.push({
        ...entry,
        relativePath,
        status: STATUS.unreadable,
        notes: `${error?.name ?? 'Error'}: ${error?.message ?? error}` + hintFor(error),
      });
      continue;
    }

    const missing = missingFields(meta);

    if (missing.length > 0) {
      const found = describeFound(meta);
      plans.push({
        ...entry,
        relativePath,
        metadata: meta,
        status: STATUS.skippedMissing,
        notes: `missing: ${missing.join(', ')}` + (found.length ? `  |  found: ${found.join(', ')}` : ''),
      });
      continue;
    }

    const proposedName = buildFileName(meta, extensionOf(entry.name));
    plans.push({
      ...entry,
      relativePath,
      metadata: meta,
      proposedName,
      status: proposedName === entry.name ? STATUS.alreadyCorrect : STATUS.pending,
      notes: '',
    });
  }

  if (walkError) {
    plans.push({
      relativePath: '(folder listing stopped early)',
      segments: [],
      name: '',
      status: STATUS.unreadable,
      notes: `${walkError?.name ?? 'Error'}: ${walkError?.message ?? walkError}` + hintFor(walkError),
    });
  }

  return plans;
}

/**
 * Turns the browser's terse DOMException into something actionable. These are
 * the failures seen on managed/locked-down devices, where the same folder
 * opens fine on an unrestricted machine.
 */
function hintFor(error) {
  switch (error?.name) {
    case 'NotFoundError':
      return '  |  the file is listed but cannot be opened — typically a OneDrive/SharePoint'
           + ' online-only placeholder. Right-click the folder and choose "Always keep on this'
           + ' device", let it download, then scan again.';
    case 'NotAllowedError':
      return '  |  permission was not granted or has lapsed — press "Pick folder…" and allow'
           + ' "Save changes" again.';
    case 'NoModificationAllowedError':
      return '  |  the file is locked, read-only, or blocked by Controlled Folder Access.';
    case 'SecurityError':
      return '  |  blocked by browser policy on this device.';
    default:
      return '';
  }
}

// ---------------------------------------------------------------- execute --

/**
 * If the target name already exists, append " (2)", " (3)", … before the
 * extension. Never overwrite — a destructive merge on production files would
 * be very hard to undo.
 */
async function resolveCollision(parent, target) {
  const exists = async (name) => {
    try {
      await parent.getFileHandle(name);
      return true;
    } catch {
      return false;
    }
  };

  if (!(await exists(target))) return target;

  const dot = target.lastIndexOf('.');
  const stem = dot > 0 ? target.slice(0, dot) : target;
  const ext = dot > 0 ? target.slice(dot) : '';

  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`Could not find a free filename for ${target}.`);
}

/** Commits the pending rows. Each row's status is updated in place. */
export async function execute(plans, onProgress, onLog) {
  const pending = plans.filter((p) => p.status === STATUS.pending);
  let done = 0;

  for (const plan of pending) {
    done++;
    onProgress?.(done, pending.length);

    try {
      const target = await resolveCollision(plan.parent, plan.proposedName);
      await plan.handle.move(target);

      plan.status = STATUS.renamed;
      plan.proposedName = target;
      onLog?.(`RENAMED ${plan.relativePath} -> ${target}`);
    } catch (error) {
      plan.status = STATUS.failed;
      plan.notes = String(error?.message ?? error);
      onLog?.(`FAILED  ${plan.relativePath} — ${plan.notes}`);
    }
  }
}
