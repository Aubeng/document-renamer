// Port of Services/FileNameClassifier.cs — keep the two in step.
//
// Pulls DocumentType and DocumentStage out of the file name using keyword
// scans. Type keywords match whole words only (plurals allowed), against a
// copy where every run of non-alphanumerics collapses to one space, so
// "Attendance-Sheet", "Attendance_Sheet" and "Attendance Sheet" all hit the
// same keyword.
//
// Tables are ordered: first match wins. Two rules when editing — multi-word
// keywords go above the single-word ones they contain, and deliberately
// broad keywords go in the fallback block at the bottom.

export const DOCUMENT_TYPES = [
  // "Appendix N - <anything>" is filed as an Appendix even when the rest of
  // the name mentions another category, so this sits above everything.
  ['appendix', 'Appendix'],

  // ---- multi-word entries first so "Concept Note" wins over a stray "Note" ----
  ['concept note', 'Concept Note'],
  ['conceptnote', 'Concept Note'],
  ['approval note', 'Approval Note'],
  ['briefing note', 'Briefing Note'],
  ['assessment tool', 'Assessment Tool'],
  ['review form', 'Review Form'],

  // programme delivery
  ['attendance sheet', 'Attendance Sheet'],
  ['attendance register', 'Attendance Sheet'],
  ['attendance list', 'Attendance Sheet'],
  ['sign in sheet', 'Attendance Sheet'],
  ['signin sheet', 'Attendance Sheet'],
  ['sign up sheet', 'Attendance Sheet'],
  ['participant list', 'Participant List'],
  ['participant register', 'Participant List'],
  ['beneficiary list', 'Participant List'],
  ['beneficiary register', 'Participant List'],
  ['enrolment list', 'Participant List'],
  ['enrollment list', 'Participant List'],
  ['facilitator guide', 'Facilitator Guide'],
  ['facilitation guide', 'Facilitator Guide'],
  ['trainer guide', 'Facilitator Guide'],
  ['training manual', 'Training Material'],
  ['training material', 'Training Material'],
  ['training deck', 'Training Material'],
  ['session plan', 'Training Material'],
  ['lesson plan', 'Training Material'],
  ['implementation plan', 'Workplan'],
  ['activity plan', 'Workplan'],
  ['work plan', 'Workplan'],


  // reporting annexes
  ['impact story', 'Impact Story'],
  ['impact stories', 'Impact Story'],
  ['success story', 'Success Story'],
  ['success stories', 'Success Story'],
  ['brand mention', 'Brand Mentions'],
  ['risk management', 'Risk Management'],

  // due-diligence paperwork
  ['private benefit analysis', 'Private Benefit Analysis'],
  ['payment advice', 'Payment Advice'],
  ['account statement', 'Statement'],
  ['bank statement', 'Statement'],
  ['financial statement', 'Statement'],
  ['audited financial', 'Statement'],
  ['articles of incorporation', 'Certificate'],
  ['certificate of incorporation', 'Certificate'],
  ['board of directors', 'Board Members'],
  ['board of director', 'Board Members'],
  ['board members', 'Board Members'],
  ['licence', 'Licence'],
  ['license', 'Licence'],

  // comments, trackers, meetings
  ['board update', 'Update'],
  ['check in meeting', 'Minutes'],
  ['action plan', 'Workplan'],
  ['self assessment', 'Assessment'],
  ['invitation email', 'Invitation'],

  // governance & compliance
  ['due diligence', 'Due Diligence'],
  ['risk register', 'Risk Register'],
  ['risk matrix', 'Risk Register'],
  ['risk assessment', 'Risk Assessment'],
  ['code of conduct', 'Code of Conduct'],
  ['conflict of interest', 'Conflict of Interest'],
  ['compliance checklist', 'Checklist'],
  ['board resolution', 'Resolution'],
  ['management letter', 'Letter'],
  ['meeting minutes', 'Minutes'],
  ['meeting notes', 'Minutes'],
  ['standard operating procedure', 'SOP'],

  // ---- single-word categories ----
  ['contract', 'Contract'],
  ['agreement', 'Agreement'],
  ['mou', 'MOU'],
  ['addendum', 'Addendum'],
  ['closeout', 'Closeout'],
  ['close out', 'Closeout'],
  ['amendment', 'Amendment'],
  ['correspondence', 'Correspondence'],
  ['eoi', 'EOI'],
  ['proposal', 'Proposal'],
  ['budget', 'Budget'],
  ['workplan', 'Workplan'],
  ['roadmap', 'Roadmap'],
  ['policy', 'Policy'],
  ['policies', 'Policy'],
  ['guidelines', 'Guidelines'],
  ['guideline', 'Guidelines'],
  ['questionnaire', 'Questionnaire'],
  ['snapshot', 'Snapshot'],
  ['mel', 'MEL'],
  ['curriculum', 'Curriculum'],
  ['syllabus', 'Curriculum'],
  ['certificate', 'Certificate'],
  ['agenda', 'Agenda'],
  ['charter', 'Charter'],
  ['declaration', 'Declaration'],
  ['resolution', 'Resolution'],
  ['sop', 'SOP'],
  ['narrative', 'Narrative'],
  ['learnings', 'Learnings'],
  ['tracker', 'Tracker'],
  ['comment', 'Comments'],
  ['invitation', 'Invitation'],

  // "report" stays ahead of the broad fallbacks so "Audit Report",
  // "Training Report" and "Field Visit Report" all land on Report.
  ['report', 'Report'],

  ['memo', 'Memo'],
  ['brief', 'Brief'],
  ['invoice', 'Invoice'],
  ['receipt', 'Receipt'],
  ['presentation', 'Presentation'],
  ['minutes', 'Minutes'],

  // ---- broad fallbacks: only reached when nothing above matched ----
  ['audit', 'Audit'],
  ['review', 'Review'],
  ['monitoring', 'Monitoring'],
  ['statement', 'Statement'],
  ['meeting', 'Minutes'],
  ['training', 'Training Material'],
  ['attendance', 'Attendance Sheet'],
  ['checklist', 'Checklist'],
  ['manual', 'Manual'],
  ['letter', 'Letter'],
  ['form', 'Form'],
  ['note', 'Note'],
  ['toolkit', 'Toolkit'],
  ['tool', 'Tool'],
];

// Stage order matters: Final/Signed beats Version N beats Draft.
const SIGNED_FINAL =
  /\b(fully[\s_-]*co[\s_-]*signed|countersigned|co[\s_-]*signed|fully[\s_-]*signed|signed|executed|approved|ratified|final)\b/i;

// Digits capped at 1-3 so date-shaped numbers like 102122 aren't read as
// "version 102122". Real version numbers are tiny.
const VERSION_MARKER =
  /\b(?:v|ver|version|rev|revision|iteration|iter)\.?[\s_-]*0*(\d{1,3})\b(?!\d)/i;

const DRAFT = /\b(draft|wip|working[\s_-]*draft)\b/i;

function stem(fileName) {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/** Lower-case, with every run of non-alphanumerics collapsed to one space. */
function normaliseForType(fileName) {
  return stem(fileName)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Underscores/dots to spaces, matching what the stage regexes expect. */
function normaliseForStage(fileName) {
  return stem(fileName).replace(/[_.]/g, ' ');
}

const isLetter = (c) => c !== undefined && /\p{L}/u.test(c);

/**
 * Whole-word (plural-tolerant) containment. A plain includes() would classify
 * "Performance Framework" as Form and "Newsletter" as Letter; requiring a word
 * edge on both sides avoids that, while still letting "report" match "Reports"
 * and "note" match "Notes".
 */
function matchesWord(haystack, keyword) {
  for (let i = haystack.indexOf(keyword); i >= 0; i = haystack.indexOf(keyword, i + 1)) {
    if (i > 0 && isLetter(haystack[i - 1])) continue; // no left word edge

    let end = i + keyword.length;
    if (!isLetter(haystack[end])) return true; // word ends here

    if (haystack[end] === 'e' && haystack[end + 1] === 's') end++;
    if (haystack[end] === 's' && !isLetter(haystack[end + 1])) return true; // plural
  }
  return false;
}

/**
 * A name this tool wrote already states its type in the first field, with the
 * spaces removed ("TrainingMaterial_Partner_Program_..."). Recognising that
 * shape keeps re-scanning idempotent: without it every multi-word type failed
 * to classify the second time around, because the keyword "training material"
 * has a space the file name no longer does.
 */
function canonicalFromOwnFormat(fileName) {
  const first = stem(fileName).split(/[_-]/)[0].trim().toLowerCase();
  if (!first) return null;

  for (const [, canonical] of DOCUMENT_TYPES) {
    if (canonical.replace(/\s+/g, '').toLowerCase() === first) return canonical;
  }
  return null;
}

export function classifyType(fileName) {
  const own = canonicalFromOwnFormat(fileName);
  if (own) return own;

  const haystack = normaliseForType(fileName);
  for (const [keyword, canonical] of DOCUMENT_TYPES) {
    if (matchesWord(haystack, keyword)) return canonical;
  }
  return null;
}

/**
 * Null when the file name carries no stage marker at all — the caller then
 * falls back to the scan's default stage, and finally to FALLBACK_STAGE.
 */
export function classifyStage(fileName) {
  const haystack = normaliseForStage(fileName);

  if (SIGNED_FINAL.test(haystack)) return 'Final';

  const version = VERSION_MARKER.exec(haystack);
  if (version) return `Version ${version[1]}`;

  if (DRAFT.test(haystack)) return 'Draft';

  return null;
}
