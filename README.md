# Document Renamer — PWA

Same tool as the WinUI app, as an installable web app. It exists because the
target device blocks unsigned executables but runs PWAs happily.

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

- A PDF that hides its Info dictionary in a compressed object stream *and*
  exceeds the stream-scan caps reports no date, so the file is skipped rather
  than misnamed. Same outcome as the desktop app on a file it can't read.
- Encrypted or password-protected documents are skipped.
- The folder permission can't be made permanent; the last folder is remembered,
  but access must be re-granted each session.
