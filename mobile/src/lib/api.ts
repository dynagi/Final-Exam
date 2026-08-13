import { CRYPTO_SERVER_URL } from './config';
import { supabase } from './supabase';
import {
  CustodyEvent,
  DraftPaperResult,
  Exam,
  ExamSetsResult,
  ExtractedQuestion,
  NewQuestionInput,
  PaperCopy,
  PaperPreviewResult,
  PaperValidationResult,
  PrintResult,
  QrDetection,
  QuestionType,
  Role,
} from './types';
import type { CompositionReport, FormatSummary, ResolvedFormat } from './examFormats';

async function request(
  path: string,
  body: Record<string, unknown> | null,
  token?: string,
  method: 'GET' | 'POST' | 'PATCH' = 'POST'
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${CRYPTO_SERVER_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        // Skip ngrok-free's HTML browser-warning interstitial so we get JSON.
        'ngrok-skip-browser-warning': 'true',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new Error(
      `Cannot reach crypto service at ${CRYPTO_SERVER_URL}. Is it running? (see server/README in project root)`
    );
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = new Error(
      typeof json.error === 'string' ? json.error : `Server error ${res.status}`
    ) as Error & { report?: CompositionReport };
    // Composition failures carry the full per-section report so the caller can
    // show exactly which section is short or over.
    if (json.report) err.report = json.report as CompositionReport;
    throw err;
  }
  return json;
}

async function authToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');
  return token;
}

/** Authenticated call to the Node crypto/ceremony service. */
async function post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return request(path, body, await authToken());
}

async function get(path: string): Promise<Record<string, unknown>> {
  return request(path, null, await authToken(), 'GET');
}

async function patch(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return request(path, body, await authToken(), 'PATCH');
}

/**
 * Sign-up goes through the server's admin API: the account is created
 * pre-confirmed, so no confirmation email is sent and Supabase's mailer
 * rate limit can never block it.
 */
export const signUpUser = (role: Role, fullName: string, email: string, password: string) =>
  request('/api/auth/signup', { role, fullName, email, password });

/* ------------------------- exam formats & composition --------------------- */

/** Every (format, year) pair the Admin can schedule an exam against. */
export const fetchExamFormats = () =>
  get('/api/exam-formats') as Promise<{ ok: boolean; years: number[]; formats: FormatSummary[] }>;

/** The full blueprint for one format in one year. */
export const fetchExamFormat = (code: string, year: number) =>
  get(`/api/exam-formats/${encodeURIComponent(code)}/${year}`) as Promise<{
    ok: boolean;
    format: ResolvedFormat;
  }>;

/**
 * Schedule an exam. The blueprint is resolved server-side from the format
 * catalogue, so the stored structure can only be one the catalogue defines.
 */
export const createExam = (body: {
  /** Required — question counts come from the format. */
  formatCode: string;
  formatYear: number;
  name: string;
  examDate: string;
  slots: { label?: string; startAt: string; endAt: string }[];
  paperSetCount: number;
  allowQuestionReuse: boolean;
  /** Required for formats whose reference publishes no question counts. */
  customSections?: {
    name: string;
    subject: string;
    /** The answer style the section takes — the server validates it against
     *  QUESTION_TYPES and falls back to 'mcq' for anything it does not know. */
    question_type: QuestionType;
    count: number;
    marks_correct: number;
    negative_marks: number;
  }[];
  paperId?: string | null;
}) =>
  post('/api/exams', body) as Promise<{
    ok: boolean;
    exam: { id: string; name: string };
    format: ResolvedFormat | null;
    sets: string[];
  }>;

/**
 * Change an exam's paper-set count or its reuse policy. Sets that already
 * hold a sealed paper cannot be dropped — the server refuses.
 */
export const updatePaperSets = (
  examId: string,
  body: { paperSetCount?: number; allowQuestionReuse?: boolean }
) =>
  patch(`/api/exams/${examId}/paper-sets`, body) as unknown as Promise<{
    ok: boolean;
    exam: Exam;
    sets: string[];
    dropped: string[];
  }>;

/** Per-set completion, plus which question is already committed to which set. */
export const fetchExamSets = (examId: string) =>
  get(`/api/exams/${examId}/sets`) as unknown as Promise<ExamSetsResult>;

/**
 * Questions per request. The server accepts up to 500; staying under that
 * keeps each HTTP body small. It is a transport detail, not a limit on the
 * bank — larger imports are simply split across consecutive requests.
 */
const QUESTION_BATCH = 200;

/**
 * Add questions to an exam's bank. The only route in: section/type/marks
 * alignment is checked here, not in the app, along with the per-slot bank
 * ceiling. An import of any size is chunked rather than refused; questions
 * that overflow a slot's ceiling come back in `rejected`.
 *
 * `onProgress` reports (sent, total) after each batch.
 */
export async function submitQuestions(
  examId: string,
  questions: NewQuestionInput[],
  onProgress?: (sent: number, total: number) => void
): Promise<{ ok: boolean; accepted: number; rejected: string[] }> {
  let accepted = 0;
  const rejected: string[] = [];

  for (let i = 0; i < questions.length; i += QUESTION_BATCH) {
    const batch = questions.slice(i, i + QUESTION_BATCH);
    try {
      const res = (await post('/api/questions', { examId, questions: batch })) as unknown as {
        accepted: number;
        rejected: string[];
      };
      accepted += res.accepted ?? 0;
      rejected.push(...(res.rejected ?? []));
    } catch (e) {
      // A batch that fails outright shouldn't discard the ones that landed;
      // report it and let the caller show what did and didn't save.
      const reason = e instanceof Error ? e.message : 'Unknown error';
      rejected.push(
        `Questions ${i + 1}–${i + batch.length} were not saved: ${reason}`
      );
    }
    onProgress?.(Math.min(i + batch.length, questions.length), questions.length);
  }

  return { ok: rejected.length === 0, accepted, rejected };
}

/**
 * Save one paper set's selection. Idempotent per (exam, set) — re-saving
 * Set A rewrites that set rather than creating a second paper. May be short
 * of the quota, never over it, and never reusing another set's questions
 * unless the Admin allows it.
 */
export const savePaperSet = (body: {
  examId: string;
  setLabel: string;
  title: string;
  questionIds: string[];
}) => post('/api/papers', body) as unknown as Promise<DraftPaperResult>;

/** Live composition report for a draft. */
export const validatePaper = (paperId: string) =>
  get(`/api/papers/${paperId}/validate`) as unknown as Promise<PaperValidationResult>;

/** The exact paper students will receive, with final numbering. */
export const previewPaper = (paperId: string) =>
  get(`/api/papers/${paperId}/preview`) as unknown as Promise<PaperPreviewResult>;

/** The setter's explicit confirmation of the preview — sealing needs it. */
export const confirmPaperPreview = (paperId: string) =>
  post(`/api/papers/${paperId}/confirm-preview`, {}) as Promise<{
    ok: boolean;
    previewed_at: string;
  }>;

export const sealPaper = (paperId: string, passphrase: string) =>
  post(`/api/papers/${paperId}/seal`, { passphrase });

export const cosignPaper = (paperId: string, passphrase: string) =>
  post(`/api/papers/${paperId}/cosign`, { passphrase });

export const printCopies = (
  paperId: string,
  setterPassphrase: string,
  adminPassphrase: string,
  copies: number,
  location: string
) =>
  post(`/api/papers/${paperId}/print`, {
    setterPassphrase,
    adminPassphrase,
    copies,
    location,
  }) as unknown as Promise<PrintResult>;

/** Provision an exam center + its invigilator login account (admin-only). */
export const provisionCenter = (body: {
  examId: string;
  slotId: string | null;
  name: string;
  code: string;
  password: string;
  capacity?: number;
}) =>
  post('/api/centers', body) as Promise<{
    ok: boolean;
    center: { id: string; name: string; code: string };
    login: { code: string; email: string };
  }>;

/** Allocate up to `count` unallocated copies of an exam's paper to a center. */
export const allocateCopies = (centerId: string, count: number) =>
  post(`/api/centers/${centerId}/allocate`, { count }) as Promise<{
    ok: boolean;
    allocated: number;
    requested: number;
  }>;

/**
 * Leak forensics. Give it whatever survived in the leaked material — the
 * short code from the page watermark, the full header QR, or a photo — and
 * it identifies the copy, marks it leaked and fires a CRITICAL alert to
 * every admin dashboard in real time.
 */
export const identifyLeak = (body: {
  trace_code?: string;
  qr_payload?: string;
  copy_id?: string;
  image_base64?: string;
}) =>
  post('/api/forensics/identify', body) as unknown as Promise<{
    ok: boolean;
    via: string;
    copy: PaperCopy & { paper?: { title: string; subject: string } | null };
    custody_chain: CustodyEvent[];
  }>;

/* ---------------------------- QR watermark events -------------------------- */

/**
 * Report a QR watermark sighting. The server verifies the token's HMAC,
 * resolves it to copy / page / frame, deduplicates repeat sightings and
 * raises a live alert on the admin dashboard.
 */
export const reportDetection = (body: {
  qr_token: string;
  scanner_id?: string;
  device_info?: string;
  confidence?: number;
  image_ref?: string;
  latitude?: number;
  longitude?: number;
  location_accuracy_m?: number;
  location_label?: string;
  timezone?: string;
  detected_at?: string;
}) =>
  post('/api/detections', body) as unknown as Promise<{
    ok: boolean;
    deduplicated: boolean;
    dedup_window_sec: number;
    detection: QrDetection;
  }>;

/** Newest-first detection feed for the admin dashboard. */
export const fetchDetections = (limit = 50) =>
  get(`/api/detections?limit=${limit}`) as unknown as Promise<{
    ok: boolean;
    dedup_window_sec: number;
    detections: QrDetection[];
  }>;

/** Invigilator scan-in: verify a copy's QR and mark it scanned. */
export const scanCopy = (qrPayload: string) =>
  post('/api/copies/scan', { qr_payload: qrPayload }) as Promise<{
    ok: boolean;
    copy_number: number;
    scanned_at: string;
  }>;

/**
 * Send a PDF (base64) to the NLP service via the crypto server, which
 * returns structured questions (MCQ + theoretical) the teacher can review.
 */
export async function extractQuestions(
  pdfBase64: string,
  fileName: string
): Promise<{ engine: string; pages: number; questions: ExtractedQuestion[] }> {
  const res = await post('/api/questions/extract', { pdfBase64, fileName });
  return {
    engine: typeof res.engine === 'string' ? res.engine : 'unknown',
    pages: typeof res.pages === 'number' ? res.pages : 0,
    questions: (res.questions as ExtractedQuestion[]) ?? [],
  };
}
