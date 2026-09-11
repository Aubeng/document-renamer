# Document Renamer — PWA

Same tool as the WinUI app, as an installable web app. It exists because the
target device blocks unsigned executables but runs PWAs happily.

Implements the Foundation's **File Naming Conventions: Guidance and Business
Value** (Content Management + Legal & Compliance, 2026):

```
Programmatic      DocumentType-LeadPartnerName-ProgramAcronym-YY-MM-DD-Stage
                  Proposal-Jobberman-MFAP-26-02-10-Final.docx

Non-programmatic  Document Title - YYYY-MM-DD - Stage
                  PST Extended Planning Workshop Notes - 2026-04-02 - Draft.docx
```

A file is programmatic when its folder yields both a program and a partner;
otherwise it takes the non-programmatic shape. Note the deliberate differences
the guidance specifies: no spaces around the hyphen and a two-digit year for
programmatic names, spaces and a four-digit year for the rest.

Everything happens on the device: the page never uploads a file, never calls a
server, and works with the network off. Hosting it publicly exposes the code,
not your documents.

## Requirements

- **Edge or Chrome on the desktop.** It relies on the File System Access API
  (`showDirectoryPicker`, `FileSystemFileHandle.move`), which Firefox and
  Safari don't implement.
- **An https origin, or localhost.** The API is unavailable on `file://`, so
  double-clicking `index.html` will not work.

## Running it

**Hosted (recommended).** Push this folder to any static host with https —
GitHub Pages is the usual choice. Open the page in Edge, then
`⋯ → Apps → Install this site as an app`. It gets a Start-menu entry, its own
window, and keeps working offline.

**Locally, for a quick look:**

```powershell
cd pwa
python -m http.server 8765 --bind 127.0.0.1
```

then open `http://127.0.0.1:8765/`. `localhost` counts as a secure origin, so
the folder picker works.

## Using it

1. **Pick folder…** and grant read/write access. The browser asks every
   session — that permission prompt is the price of not installing anything.
2. Leave the **fallback** boxes alone unless you need them. Program and partner
   are read from each file's own `Program-Partner` folder, so one root holding
   many project folders renames correctly in a single pass. The boxes only
   catch files whose folder name doesn't parse.
3. **Scan / Preview** — nothing on disk changes. Check the proposed names.
4. **Rename files** — commits. Existing files are never overwritten; a
   colliding name gets ` (2)`, ` (3)`, … appended.
5. **Export log…** downloads a timestamped record of the run.

## How it maps to the desktop app

| PWA file | Ported from |
|----------|-------------|
| `lib/classifier.js` | `Services/FileNameClassifier.cs` |
| `lib/formatter.js` | `Services/FileNameFormatter.cs` |
| `lib/docdate.js` | `Services/DocumentDateReader.cs` |
| `lib/engine.js` | `FolderInfoExtractor.cs` + `MetadataResolver.cs` + `RenameEngine.cs` |
| `app.js` | `MainWindow.xaml.cs` |

The naming rules, keyword tables and skip behaviour are identical — a parity
suite checks the JS against the same cases the C# passes. **Change a rule in
one place and change it in the other**, or the two will drift.

## Two implementation notes

- **No dependencies.** Office files are ZIPs, read here with a small central-
  directory parser plus the browser's own `DecompressionStream` — that replaces
  DocumentFormat.OpenXml. PDF dates come from the Info dictionary, found by
  following the trailer's `/Info` reference, with a scan of inflated streams as
  a last resort. That replaces PdfPig.
- **Dates are taken literally.** The calendar digits written in the document are
  used as-is, with no timezone conversion — matching the desktop app's PDF
  behaviour, and identical for Office files in a UTC+0 timezone.

## Where the date comes from

Tried in this order; the first one that yields a date wins, and anything below
the first is flagged in the preview's Details column so a weak date never looks
like a strong one.

| # | Source | Why it ranks here |
|---|--------|-------------------|
| 1 | The document's **own internal date** — Office core properties, or a PDF's Info dictionary / XMP packet | Says when the document was actually written |
| 2 | A **date already in the file name** (`..._22-07-07_Final.xlsx`) | Written by an earlier run, so it *is* an internal date, preserved. Ranked above the system date deliberately: otherwise every sync or antivirus touch would change the system date, produce a new name, and rename the file again — drifting further from the truth on every scan. Here, a correctly-named file stays put forever |
| 3 | The **Windows modified date** | Last resort. Reflects the last time the file was touched on disk — a copy, a sync, a virus scan — not when it was written. Treat these rows with suspicion in the preview |

Legacy Office files (`.doc` `.dot` `.xls` `.xlt` `.ppt` `.pot`) are renamed but have
no source 1: their date lives in an OLE property stream this reader does not
parse, so they always land on source 2 or 3.

One ambiguity worth knowing about source 2: `18-08-26` in a file name is read as
**yy-MM-dd** — correct for a name this tool wrote, but a human-written
`DD-MM-YY` would be misread. Every such row says "date read from the existing
file name" in the preview, so it is visible before you commit.

Source 2 also rescues files whose path exceeds 260 characters: they can be
listed but not opened, so the name is the only readable thing about them.

**The desktop app has only source 1.** It skips anything without an internal
date. The two implementations diverge here on purpose — the PWA meets messier
real-world folders.

## If scanning fails on a managed device

A folder that opens fine on a personal machine can fail on a locked-down one.
The scan no longer aborts on the first bad file — unreadable files are listed
individually with the browser's own error name, which tells you which case it is:

| Error shown | Cause | Fix |
|-------------|-------|-----|
| `NotFoundError` | The file is listed but can't be opened — almost always a OneDrive/SharePoint **online-only placeholder**, or a mapped network drive | Right-click the folder → **Always keep on this device**, wait for the download, scan again. For a network drive, copy it local first. |
| `NotAllowedError` | Permission lapsed or was refused | Press **Pick folder…** and allow "Save changes" again |
| `NoModificationAllowedError` | File locked, read-only, or blocked by Controlled Folder Access | Close the file; ask IT about Controlled Folder Access |
| `SecurityError` | Browser policy on that device | Ask IT — the File System Access API may be restricted by policy |

## Known limits

- A PDF with no Info dictionary, no XMP packet and no date in its name falls
  back to the Windows modified date, which may be years off. Flagged in the
  preview.
- Encrypted or password-protected documents fall through to the same fallbacks.
- Windows' 260-character path limit is real: a file whose full path exceeds it
  can be renamed (the date comes from its name) but the rename itself may still
  fail. The fix is to shorten the *folder* name.
- The folder permission can't be made permanent; the last folder is remembered,
  but access must be re-granted each session.
