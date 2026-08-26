// UI wiring: pick / scan / rename / export log.
//
// Mirrors MainWindow.xaml.cs — two-phase, nothing on disk changes until the
// user presses Rename, and the preview shows every proposed name first.

import { buildPlan, execute, STATUS } from './lib/engine.js';

const $ = (id) => document.getElementById(id);
const ui = {
  pick: $('pick'), scan: $('scan'), rename: $('rename'), export: $('export'),
  folder: $('folder'), program: $('program'), partner: $('partner'), stage: $('stage'),
  rows: $('rows'), counts: $('counts'), progress: $('progress'), statusText: $('statusText'),
  log: $('log'), unsupported: $('unsupported'),
};

let directoryHandle = null;
let plans = [];
const logLines = [];

if (!window.showDirectoryPicker) {
  ui.unsupported.hidden = false;
  ui.pick.disabled = true;
}

// ------------------------------------------------------------- plumbing --

function log(line) {
  const stamped = `[${new Date().toTimeString().slice(0, 8)}] ${line}`;
  logLines.push(stamped);
  ui.log.textContent = logLines.join('\n');
  ui.log.scrollTop = ui.log.scrollHeight;
  ui.export.disabled = false;
}

function setBusy(busy) {
  for (const b of [ui.pick, ui.scan, ui.rename]) b.disabled = busy;
  if (!busy) refreshButtons();
}

function refreshButtons() {
  ui.scan.disabled = !directoryHandle;
  ui.rename.disabled = !plans.some((p) => p.status === STATUS.pending);
}

function progress(done, total) {
  ui.progress.value = total === 0 ? 0 : (100 * done) / total;
}

const statusClass = (status) =>
  status.startsWith('Skipped') ? 'status-Skipped'
    : status.startsWith('Already') ? 'status-Already'
      : `status-${status}`;

function render() {
  if (plans.length === 0) {
    ui.rows.innerHTML = '<tr><td colspan="4" class="hint">Nothing scanned yet.</td></tr>';
    ui.counts.textContent = '';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const plan of plans) {
    const tr = document.createElement('tr');

    const original = document.createElement('td');
    original.className = 'mono';
    original.textContent = plan.relativePath;

    const proposed = document.createElement('td');
    proposed.className = 'mono';
    proposed.textContent = plan.proposedName ?? '—';

    const status = document.createElement('td');
    status.className = statusClass(plan.status);
    status.textContent = plan.status;

    const notes = document.createElement('td');
    notes.className = 'mono hint';
    notes.textContent = plan.notes ?? '';

    tr.append(original, proposed, status, notes);
    fragment.append(tr);
  }
  ui.rows.replaceChildren(fragment);

  const count = (s) => plans.filter((p) => p.status === s).length;
  ui.counts.textContent =
    `${plans.length} file(s) — ${count(STATUS.pending)} to rename, ` +
    `${count(STATUS.alreadyCorrect)} already correct, ` +
    `${count(STATUS.skippedMissing) + count(STATUS.skippedUnsupported)} skipped`;
}

// -------------------------------------------------------------- actions --

ui.pick.addEventListener('click', async () => {
  try {
    directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch {
    return; // user cancelled the picker
  }
  await rememberHandle(directoryHandle);
  ui.folder.textContent = `Selected folder: ${directoryHandle.name}`;
  plans = [];
  render();
  refreshButtons();
  log(`Folder selected: ${directoryHandle.name}`);
});

ui.scan.addEventListener('click', async () => {
  setBusy(true);
  ui.statusText.textContent = 'Scanning…';
  try {
    plans = await buildPlan(
      directoryHandle,
      {
        programOverride: ui.program.value,
        partnerOverride: ui.partner.value,
        defaultStage: ui.stage.value,
      },
      (done, total) => {
        progress(done, total);
        ui.statusText.textContent = `Scanning ${done}/${total}`;
      },
    );

    for (const plan of plans) {
      if (plan.status === STATUS.skippedUnsupported) log(`SKIP (unsupported): ${plan.relativePath}`);
      else if (plan.status === STATUS.skippedMissing) log(`SKIP ${plan.relativePath} — ${plan.notes}`);
      else if (plan.status === STATUS.alreadyCorrect) log(`OK   (already correct): ${plan.relativePath}`);
      else log(`PLAN ${plan.relativePath} -> ${plan.proposedName}`);
    }

    render();
    const pending = plans.filter((p) => p.status === STATUS.pending).length;
    ui.statusText.textContent = `Found ${plans.length} file(s) — ${pending} to rename.`;
  } catch (error) {
    ui.statusText.textContent = `Scan failed: ${error.message}`;
    log(`ERROR during scan — ${error.message}`);
  } finally {
    setBusy(false);
  }
});

ui.rename.addEventListener('click', async () => {
  const pending = plans.filter((p) => p.status === STATUS.pending).length;
  if (!confirm(`Rename ${pending} file(s)? Existing files are never overwritten.`)) return;

  setBusy(true);
  ui.statusText.textContent = 'Renaming…';
  try {
    await execute(
      plans,
      (done, total) => {
        progress(done, total);
        ui.statusText.textContent = `Renaming ${done}/${total}`;
      },
      log,
    );
    render();
    const renamed = plans.filter((p) => p.status === STATUS.renamed).length;
    const failed = plans.filter((p) => p.status === STATUS.failed).length;
    ui.statusText.textContent = `Renamed ${renamed} file(s)` + (failed ? `, ${failed} failed.` : '.');
  } finally {
    setBusy(false);
  }
});

ui.export.addEventListener('click', () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const blob = new Blob([logLines.join('\r\n')], { type: 'text/plain' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `document-renamer-log_${stamp}.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
});

// ------------------------------------------ remember the folder handle --
//
// Directory handles survive in IndexedDB, so the app can offer the same
// folder next time instead of making the user hunt for it again. Permission
// still has to be re-granted per session — that's the browser's rule, not
// something we can or should work around.

const DB_NAME = 'document-renamer';
const STORE = 'handles';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function rememberHandle(handle) {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(handle, 'lastFolder');
  } catch {
    // Not fatal — the user can always pick the folder again.
  }
}

async function restoreHandle() {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get('lastFolder');
    const handle = await new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    if (!handle) return;

    if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') {
      directoryHandle = handle;
      ui.folder.textContent = `Selected folder: ${handle.name}`;
      refreshButtons();
    } else {
      ui.folder.textContent = `Last used: ${handle.name} — press "Pick folder…" to grant access again.`;
    }
  } catch {
    // Ignore — nothing remembered.
  }
}

restoreHandle();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // Offline support is a nice-to-have; the app works without it.
  });
}
