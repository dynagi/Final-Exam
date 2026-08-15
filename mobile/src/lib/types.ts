export type Role = 'teacher' | 'paper_setter' | 'admin' | 'invigilator';

/** Teacher/paper-setter sign-ups start 'pending'; admin/invigilator are always 'approved'. */
export type AccountStatus = 'pending' | 'approved' | 'rejected';

export interface Profile {
  id: string;
  full_name: string;
  role: Role;
  status: AccountStatus;
  created_at: string;
  /**
   * Paper-setter subject domains — present only on `GET /api/accounts/pending`
   * and `GET /api/accounts/setters` responses, not on the base profile row.
   */
  domains?: string[];
}

export type QuestionStatus = 'submitted' | 'approved' | 'used';
/**
 * mcq        four options, one correct
 * msq        several options, one or more correct (GATE / UCEED style)
 * numerical  a numeric answer, no options (JEE Main NVT style)
 * theoretical subjective / descriptive, no answer key
 */
export type QuestionType = 'mcq' | 'msq' | 'numerical' | 'theoretical';
export type QuestionSource = 'manual' | 'pdf';

export interface Question {
  id: string;
  teacher_id: string;
  exam_id: string | null;
  subject: string;
  /** Which section of the exam format's blueprint this question fills. */
  section_name: string | null;
  topic: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  question_type: QuestionType;
  marks: number;
  source: QuestionSource;
  body: string;
  options: string[];
  /** MCQ answer key; null for every other type. */
  correct_index: number | null;
  /** MSQ answer key. */
  correct_indices: number[] | null;
  /** Numerical answer key. */
  answer_numeric: number | null;
  status: QuestionStatus;
  created_at: string;
  exam?: { name: string } | null;
}

/** A question on its way into the bank via POST /api/questions. */
export interface NewQuestionInput {
  subject: string;
  section_name: string | null;
  topic?: string | null;
  difficulty?: 'easy' | 'medium' | 'hard';
  question_type: QuestionType;
  marks: number;
  source?: QuestionSource;
  body: string;
  options?: string[];
  correct_index?: number | null;
  correct_indices?: number[] | null;
  answer_numeric?: number | null;
}

/** A question parsed from a PDF by the NLP service, before it's saved. */
export interface ExtractedQuestion {
  question_type: QuestionType;
  body: string;
  options: string[];
  correct_index: number | null;
  marks: number;
  subject?: string | null;
  topic?: string | null;
  difficulty?: 'easy' | 'medium' | 'hard';
}

export type PaperStatus =
  | 'draft'
  | 'sealed'
  | 'sealed_dual'
  | 'printed'
  | 'distributed'
  | 'completed';

export interface Paper {
  id: string;
  title: string;
  subject: string;
  setter_id: string;
  exam_id: string | null;
  status: PaperStatus;
  question_count: number;
  format_code: string | null;
  format_year: number | null;
  /** Which paper set this is: 'Set A', 'Set B', … One paper per (exam, set). */
  set_label: string | null;
  /** Set when the setter confirms the preview; cleared if the paper changes. */
  previewed_at: string | null;
  sealed_at: string | null;
  cosigned_at: string | null;
  printed_at: string | null;
  created_at: string;
  setter?: { full_name: string } | null;
  exam?: { name: string } | null;
}

export type CopyStatus =
  | 'printed'
  | 'in_transit'
  | 'at_center'
  | 'delivered'
  | 'missing'
  | 'leaked';

export interface PaperCopy {
  id: string;
  paper_id: string;
  copy_number: number;
  qr_payload: string;
  fingerprint_hash: string;
  fingerprint_method: string;
  current_location: string;
  status: CopyStatus;
  center_id: string | null;
  scanned_at: string | null;
  scanned_by: string | null;
  created_at: string;
  paper?: { title: string } | null;
}

export interface ExamCenter {
  id: string;
  exam_id: string;
  slot_id: string | null;
  name: string;
  code: string;
  starts_at: string;
  capacity: number;
  reconciled_at: string | null;
  auth_user_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ExamSlot {
  id: string;
  exam_id: string;
  label: string;
  slot_no: number;
  start_at: string;
  end_at: string;
  duration_min: number;
  created_at: string;
}

export interface CustodyEvent {
  id: string;
  copy_id: string;
  event_type: CopyStatus;
  location: string;
  note: string | null;
  actor_id: string | null;
  prev_hash: string | null;
  hash: string | null;
  created_at: string;
  /** The scanning device's GPS fix at scan time — null if denied/unavailable. */
  latitude: number | null;
  longitude: number | null;
  location_accuracy_m: number | null;
  copy?: { copy_number: number; paper_id: string } | null;
}

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertRow {
  id: string;
  severity: AlertSeverity;
  type: string;
  message: string;
  paper_id: string | null;
  copy_id: string | null;
  acknowledged: boolean;
  created_at: string;
}

export interface AuditEntry {
  id: number;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  prev_hash: string | null;
  hash: string | null;
  created_at: string;
}

/** A question as it appears inside a decrypted paper at print time. */
export interface PaperQuestionContent {
  question_type: QuestionType;
  body: string;
  options: string[];
  correct_index: number | null;
  marks: number;
  subject?: string | null;
  topic?: string | null;
  difficulty?: string | null;
}

/* --------------------- format-aware paper composition --------------------- */

/** One question as it appears in the previewed/printed paper. */
export interface PaperViewQuestion {
  /** Final, continuous question number across the whole paper. */
  number: number;
  id: string;
  question_type: QuestionType;
  body: string;
  options: string[];
  marks: number;
  negative_marks: number;
  unattempted_marks: number;
  subject?: string | null;
  topic?: string | null;
}

export interface PaperViewMarking {
  label: string;
  marks_correct: number;
  negative_marks: number;
  unattempted_marks: number;
}

/**
 * A typed sub-section inside a subject, the way real papers label them:
 * "Section A — MCQ", "Section B — Numerical Value".
 */
export interface PaperViewGroup {
  label: string;
  /** Exact requirement, or null when the format publishes a range. */
  required: number | null;
  required_min: number;
  required_max: number;
  types: QuestionType[];
  marks_correct: number | null;
  negative_marks: number;
  unattempted_marks: number;
  questions: PaperViewQuestion[];
}

export interface PaperViewSection {
  name: string;
  subject: string | null;
  groups: PaperViewGroup[];
  /** Every question in the section, flattened, in printed order. */
  questions: PaperViewQuestion[];
  question_count: number;
  marks: number;
  marking: PaperViewMarking[];
}

/**
 * The exact document the students receive — built once on the server and
 * used for the preview, the sealed blob and the printed copies, so the three
 * can never disagree.
 */
export interface PaperView {
  paper_id: string;
  title: string;
  subject: string;
  status: PaperStatus;
  /** 'Set A', 'Set B', … printed in the paper header and footer. */
  set_label: string | null;
  exam_name: string | null;
  exam_date: string | null;
  format_code: string | null;
  format_name: string | null;
  format_year: number | null;
  format_display_name: string | null;
  /** Sub-title under the exam name, e.g. "JEE Main — Paper 1 (B.E./B.Tech.)". */
  paper_label: string | null;
  provisional: boolean;
  enforced: boolean;
  duration_minutes: number | null;
  sections: PaperViewSection[];
  total_questions: number;
  total_marks: number;
  instructions: string[];
}

export interface PaperValidationResult {
  ok: boolean;
  report: import('./examFormats').CompositionReport;
  previewed_at: string | null;
  status: PaperStatus;
}

export interface PaperPreviewResult {
  ok: boolean;
  view: PaperView;
  report: import('./examFormats').CompositionReport;
  previewed_at: string | null;
}

export interface DraftPaperResult {
  ok: boolean;
  paper: Paper;
  report: import('./examFormats').CompositionReport;
}

/** One paper set's progress against the exam format. */
export interface ExamSetSummary {
  label: string;
  paper_id: string | null;
  title: string | null;
  /** 'not_started' until a selection has been saved, then the paper status. */
  status: PaperStatus | 'not_started';
  previewed_at: string | null;
  question_ids: string[];
  report: import('./examFormats').CompositionReport;
  ready: boolean;
}

export interface ExamSetsResult {
  ok: boolean;
  exam: {
    id: string;
    name: string;
    paper_set_count: number;
    allow_question_reuse: boolean;
  };
  format: import('./examFormats').ResolvedFormat | null;
  sets: ExamSetSummary[];
  /** question id -> the set that already owns it. */
  usage: Record<string, string>;
}

export interface PrintedCopy {
  id: string;
  copy_number: number;
  qr_payload: string;
  /** Short code identifying this copy in every QR (see patch-7). */
  trace_code?: string | null;
  /**
   * One HMAC-tagged token per question, aligned so `frames[n - 1]` belongs to
   * question n. Minted by the server — only it holds the key — and printed
   * beside each question's answer area.
   */
  frames?: string[] | null;
}

/** A QR watermark sighting recorded against a printed copy. */
export interface QrDetection {
  id: string;
  copy_id: string | null;
  paper_id: string | null;
  exam_id: string | null;
  exam_name: string | null;
  set_label: string | null;
  trace_code: string;
  page_number: number;
  frame_number: number;
  frame_label: string | null;
  qr_token: string;
  detected_at: string;
  timezone: string | null;
  scanner_id: string | null;
  device_info: string | null;
  ip_address: string | null;
  user_agent: string | null;
  reported_by: string | null;
  latitude: number | null;
  longitude: number | null;
  location_accuracy_m: number | null;
  location_label: string | null;
  confidence: number | null;
  image_ref: string | null;
  /** Repeat sightings inside the dedup window fold into this counter. */
  detection_count: number;
  first_detected_at: string;
  last_detected_at: string;
  alert_level: AlertSeverity;
  created_at: string;
}

/** Returned by the print ceremony — everything needed to render & print. */
export interface PrintResult {
  ok: boolean;
  status: string;
  copies: number;
  location: string;
  paper: {
    id: string;
    title: string;
    subject: string;
    exam_name?: string | null;
    total_marks: number;
    questions: PaperQuestionContent[];
    /** Present for papers sealed with an exam format — the previewed layout. */
    sections?: PaperViewSection[] | null;
    instructions?: string[] | null;
    duration_minutes?: number | null;
    format_display_name?: string | null;
    set_label?: string | null;
  };
  copyList: PrintedCopy[];
}

export interface Exam {
  id: string;
  name: string;
  exam_date: string;
  duration_min: number;
  status: string;
  paper_id: string | null;
  created_by: string;
  /** Examination format this exam follows, e.g. 'jee-main-paper-1' + 2026. */
  format_code: string | null;
  format_year: number | null;
  /** Display copy of the resolved blueprint; the server catalogue is authority. */
  format_blueprint: import('./examFormats').ResolvedFormat | null;
  /** How many independent paper sets the Admin wants (Set A … Set Z). */
  paper_set_count: number;
  /** May the same question appear in more than one set? Default off. */
  allow_question_reuse: boolean;
  created_at: string;
}

/** ['Set A', 'Set B', …] — must match setLabels() in the Node service. */
export function paperSetLabels(count: number): string[] {
  const n = Math.max(1, Math.min(26, Math.trunc(count) || 1));
  return Array.from({ length: n }, (_, i) => `Set ${String.fromCharCode(65 + i)}`);
}

/** Per-exam subject assignment for a teacher. */
export interface TeacherSubject {
  exam_id: string;
  teacher_id: string;
  subject: string;
  assigned_by: string | null;
  created_at: string;
}

export const ROLE_LABEL: Record<Role, string> = {
  teacher: 'Teacher',
  paper_setter: 'Paper Setter',
  admin: 'Admin',
  invigilator: 'Invigilator',
};
