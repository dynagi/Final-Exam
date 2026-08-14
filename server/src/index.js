/**
 * SecureAIExam — Crypto & Ceremony Service
 *
 * Owns every operation that must never run on a client:
 *   - Sealing a paper        (AES-256-GCM, key split into two shares)
 *   - Admin co-sign          (dual control becomes active)
 *   - Print ceremony         (both passphrases -> decrypt -> mint copies)
 *   - Leak forensics         (fingerprint -> copy -> custody chain)
 *
 * Talks to Supabase with the service-role key (bypasses RLS) and writes
 * an audit entry for every sensitive action.
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const {
  YEARS,
  MAX_PAPER_SETS,
  setLabels,
  listFormats,
  resolveFormat,
  validateComposition,
  checkQuestionSlot,
  buildCustomBlueprint,
  buildPaperView,
  BANK_HEADROOM,
  slotCeiling,
} = require('./examFormats');
const { register: metricsRegister, httpMetricsMiddleware, auditEventsTotal, criticalAlertsTotal } = require('./metrics');

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SERVER_SECRET,
  AI_SERVICE_URL = 'http://127.0.0.1:8080',
  PORT = 4000,
  // Minutes before a center's start time at which unscanned copies are flagged.
  RECONCILE_WINDOW_MIN = 20,
  // Shared key for unattended monitoring clients posting QR detections.
  // Unset means only signed-in admins/invigilators may report a sighting.
  DETECTOR_KEY = '',
} = process.env;

// An exam's earliest slot must start at least this many days out (not
// "tomorrow" — printing, sealing and delivery all take real time) and no
// more than this many years out (a "scheduled" exam should be a real one,
// not a placeholder decades away).
const MIN_SCHEDULE_LEAD_DAYS = 2;
const MAX_SCHEDULE_LEAD_YEARS = 1;

for (const [name, value] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SERVER_SECRET })) {
  if (!value || value.includes('YOUR-PROJECT') || value === 'change-me-to-a-long-random-string') {
    console.error(`Missing or placeholder env var: ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const app = express();
// Detections record the reporting IP; behind a tunnel or proxy the real
// client address is in X-Forwarded-For.
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(httpMetricsMiddleware);

/* ----------------------------- crypto helpers ----------------------------- */

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };
const b64 = (buf) => buf.toString('base64');
const fromB64 = (s) => Buffer.from(s, 'base64');

function kdf(passphrase, salt) {
  return crypto.scryptSync(String(passphrase), salt, 32, SCRYPT_OPTS);
}

/** Wrap a 32-byte share under a passphrase: scrypt -> AES-256-GCM. */
function wrapShare(share, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', kdf(passphrase, salt), iv);
  const data = Buffer.concat([cipher.update(share), cipher.final()]);
  return { salt: b64(salt), iv: b64(iv), tag: b64(cipher.getAuthTag()), data: b64(data) };
}

/** Throws on a wrong passphrase (GCM auth failure). */
function unwrapShare(wrapped, passphrase) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    kdf(passphrase, fromB64(wrapped.salt)),
    fromB64(wrapped.iv)
  );
  decipher.setAuthTag(fromB64(wrapped.tag));
  return Buffer.concat([decipher.update(fromB64(wrapped.data)), decipher.final()]);
}

function xorBuffers(a, b) {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

/** Escrow passphrase: protects the admin share between seal and co-sign. */
function escrowPassphrase(paperId) {
  return `${SERVER_SECRET}:escrow:${paperId}`;
}

/**
 * Short per-copy trace code for the tiled QR watermark.
 *
 * The header QR carries the full signed payload, which is far too dense to
 * survive being printed faintly at ~20 mm across the page. This is 12
 * characters from a confusable-free alphabet (no I/L/O/U/0/1), which encodes
 * as a QR version 2 symbol even at the highest error correction — readable
 * from a phone photo of a page fragment.
 *
 * Derived from the server secret, so it cannot be forged or guessed from the
 * copy id, and reproducible so a lost row can be recomputed.
 */
const TRACE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const TRACE_LENGTH = 12;

function traceCode(copyId) {
  const digest = crypto.createHmac('sha256', SERVER_SECRET).update(`trace:${copyId}`).digest();
  let out = '';
  for (let i = 0; i < TRACE_LENGTH; i++) {
    out += TRACE_ALPHABET[digest[i] % TRACE_ALPHABET.length];
  }
  return out;
}

/** Accepts "SAE:ABC…", "sae-abc…" or the bare code, as scanners may report it. */
function normaliseTraceCode(raw) {
  const cleaned = String(raw || '')
    .toUpperCase()
    .replace(/^SAE[:\-\s]*/, '')
    .replace(/[^A-Z0-9]/g, '');
  return cleaned.length === TRACE_LENGTH ? cleaned : null;
}

/* --------------------------- per-question QR tags -------------------------- */

/**
 * Every question carries its own QR, printed in the paper's own whitespace
 * beside that question's answer area.
 *
 * This replaces the old faint full-page watermark grid. The forensic reach is
 * the same — a photograph of a single question names the copy it came from
 * AND which question was in shot — but anchoring on the question instead of a
 * grid cell buys two things. The symbol sits in whitespace rather than under
 * the text, so it can be printed at full contrast and actually decodes from a
 * phone snap; and question 7 is question 7 however the paper reflows, whereas
 * a grid cell moved whenever the layout did.
 */

/** Ceiling on taggable questions — the token carries a 3-digit index. */
const MAX_TAGGED_QUESTIONS = 999;
/**
 * Grid width of the retired watermark, kept only so tokens already printed on
 * earlier copies still resolve to the cell they were photographed from.
 */
const LEGACY_FRAME_COLS = 5;
/** Repeat sightings of one token by one scanner inside this window fold together. */
const DETECTION_DEDUP_SEC = Number(process.env.DETECTION_DEDUP_SEC || 120);

const pad2 = (n) => String(n).padStart(2, '0');
const pad3 = (n) => String(n).padStart(3, '0');

/**
 * 4-character tag binding a token to (copy, page, question). Nothing
 * per-question is stored — the tag is recomputed on lookup, which proves this
 * server minted the token and makes a forged one useless.
 */
function frameTag(copyId, page, frame) {
  const digest = crypto
    .createHmac('sha256', SERVER_SECRET)
    .update(`frame:${copyId}:${page}:${frame}`)
    .digest();
  let out = '';
  for (let i = 0; i < 4; i++) out += TRACE_ALPHABET[digest[i] % TRACE_ALPHABET.length];
  return out;
}

/**
 * `SAE:<trace12><page2><question3><tag4>` — 25 chars, a QR version 3 at ECC H.
 *
 * Copies printed before per-question tagging carry a 2-digit index (24
 * chars); parseFrameToken still accepts those.
 */
function frameToken(traceCodeValue, copyId, page, frame) {
  return `SAE:${traceCodeValue}${pad2(page)}${pad3(frame)}${frameTag(copyId, page, frame)}`;
}

/** One token per question, indexed so tokens[n - 1] belongs to question n. */
function questionFrameTokens(traceCodeValue, copyId, questionCount, page = 1) {
  const total = Math.max(
    0,
    Math.min(MAX_TAGGED_QUESTIONS, Math.trunc(Number(questionCount) || 0))
  );
  return Array.from({ length: total }, (_, i) =>
    frameToken(traceCodeValue, copyId, page, i + 1)
  );
}

/** "Q7" — which question the scanned symbol was printed beside. */
function frameLabel(frame, legacy = false) {
  if (!legacy) return `Q${frame}`;
  const index = frame - 1;
  return `R${Math.floor(index / LEGACY_FRAME_COLS) + 1}C${(index % LEGACY_FRAME_COLS) + 1}`;
}

/**
 * Parse a scanned token. Accepts the current 3-digit question form, the
 * 2-digit grid form still in circulation on already-printed copies, and the
 * plain patch-7 trace code, since a scanner may report any of them. Returns
 * null if it is none of them.
 */
function parseFrameToken(raw) {
  const cleaned = String(raw || '')
    .toUpperCase()
    .replace(/^SAE[:\-\s]*/, '')
    .replace(/[^A-Z0-9]/g, '');
  if (cleaned.length === TRACE_LENGTH) {
    return { trace: cleaned, page: 1, frame: 0, tag: null, framed: false, legacy: false };
  }
  // <page2><index2|index3><tag4>; the index width is what dates the token.
  const rest = cleaned.length - TRACE_LENGTH;
  if (rest !== 8 && rest !== 9) return null;
  const width = rest - 6;
  const trace = cleaned.slice(0, TRACE_LENGTH);
  const page = Number(cleaned.slice(TRACE_LENGTH, TRACE_LENGTH + 2));
  const frame = Number(cleaned.slice(TRACE_LENGTH + 2, TRACE_LENGTH + 2 + width));
  const tag = cleaned.slice(TRACE_LENGTH + 2 + width);
  if (!Number.isFinite(page) || !Number.isFinite(frame)) return null;
  return { trace, page, frame, tag, framed: true, legacy: width === 2 };
}

function signQr(copyId, paperId, copyNumber) {
  return crypto
    .createHmac('sha256', SERVER_SECRET)
    .update(`${copyId}.${paperId}.${copyNumber}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Deterministic login email derived from a center code. The center login
 * screen builds the same address, so invigilators sign in with just their
 * code + password. Codes are therefore globally unique (the login id).
 * Must match centerEmail() in the mobile app's config.
 */
function centerEmail(code) {
  const slug = String(code)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `center.${slug}@secureaiexam.local`;
}

/* ------------------------------ schema preflight -------------------------- */

/**
 * Columns this build needs, and the migration that adds each. Checked once at
 * boot so an unapplied patch surfaces in the startup log rather than halfway
 * through a print ceremony.
 */
const REQUIRED_COLUMNS = [
  ['questions', 'section_name', 'patch-5-exam-formats.sql'],
  ['exams', 'format_blueprint', 'patch-5-exam-formats.sql'],
  ['papers', 'previewed_at', 'patch-5-exam-formats.sql'],
  ['exams', 'paper_set_count', 'patch-6-paper-sets.sql'],
  ['papers', 'set_label', 'patch-6-paper-sets.sql'],
  ['paper_copies', 'trace_code', 'patch-7-qr-watermark.sql'],
  ['qr_detections', 'qr_token', 'patch-8-qr-detections.sql'],
  ['profiles', 'status', 'patch-9-account-approval.sql'],
];

/** Turns a PostgREST "column not found" message into an actionable instruction. */
function missingColumnHint(message) {
  const match = /Could not find the '(\w+)' column of '(\w+)'/.exec(String(message || ''));
  if (!match) return null;
  const [, column, table] = match;
  const patch = REQUIRED_COLUMNS.find(([t, c]) => t === table && c === column)?.[2];
  return patch
    ? `The database is missing ${table}.${column}. Run supabase/${patch} in the Supabase SQL Editor, then run: notify pgrst, 'reload schema';`
    : `The database is missing ${table}.${column}. Apply the outstanding migrations in supabase/.`;
}

/** Warn loudly at boot about any migration that has not been applied. */
async function checkSchema() {
  const pending = new Set();
  for (const [table, column, patch] of REQUIRED_COLUMNS) {
    const { error } = await db.from(table).select(column).limit(1);
    // Covers both a missing column and a table the patch has not created yet.
    if (error && /column|schema cache|does not exist|relation/i.test(error.message)) {
      console.error(`  ✗ ${table}.${column} is missing  → supabase/${patch}`);
      pending.add(patch);
    }
  }
  if (pending.size === 0) {
    console.log('Database schema is up to date.');
    return;
  }
  console.error(
    `\n${pending.size} migration(s) not applied: ${Array.from(pending).join(', ')}\n` +
      `Run them in the Supabase SQL Editor, then: notify pgrst, 'reload schema';\n`
  );
}

/* ------------------------------ auth middleware --------------------------- */

function requireRole(...roles) {
  return async (req, res, next) => {
    try {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!token) return res.status(401).json({ error: 'Missing bearer token' });

      const { data, error } = await db.auth.getUser(token);
      if (error || !data?.user) return res.status(401).json({ error: 'Invalid or expired token' });

      const { data: profile } = await db.from('profiles').select('*').eq('id', data.user.id).single();
      if (!profile) return res.status(403).json({ error: 'No profile for this user' });
      // Teacher / paper-setter accounts start 'pending' and cannot use the
      // service at all until an Admin approves them (admin/invigilator
      // profiles are never self-serve, so they are created already
      // 'approved' — see patch-9-account-approval.sql).
      if (profile.status && profile.status !== 'approved') {
        return res.status(403).json({
          error:
            profile.status === 'rejected'
              ? 'This account was not approved by an admin.'
              : 'This account is awaiting admin approval.',
          account_status: profile.status,
        });
      }
      if (roles.length && !roles.includes(profile.role)) {
        return res.status(403).json({ error: `Role '${profile.role}' may not perform this action` });
      }
      req.user = data.user;
      req.profile = profile;
      next();
    } catch (err) {
      next(err);
    }
  };
}

async function audit(actorId, action, entity, entityId, details) {
  const { error } = await db.rpc('write_audit', {
    p_actor: actorId,
    p_action: action,
    p_entity: entity,
    p_entity_id: String(entityId),
    p_details: details ?? {},
  });
  if (error) console.error('audit write failed:', error.message);
  auditEventsTotal.inc({ action });
}

/* --------------------------------- routes --------------------------------- */

app.get('/health', (_req, res) => res.json({ ok: true, service: 'crypto-service' }));

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', metricsRegister.contentType);
  res.end(await metricsRegister.metrics());
});

/**
 * Sign-up via the service-role admin API. The user is created with
 * email_confirm: true, so Supabase never sends a confirmation email —
 * which means the built-in mailer's rate limit (~2 emails/hour) can
 * never block sign-ups. The profile row is created by the
 * on_auth_user_created trigger from the metadata.
 *
 * Admin is deliberately NOT a self-serve role: there is no signup path to a
 * new admin account, so every admin in the system was provisioned directly
 * against the database. Invigilator accounts are likewise never created
 * here — they come from POST /api/centers.
 *
 * Teacher and paper_setter accounts are created 'pending' (see the
 * on_auth_user_created trigger in patch-9-account-approval.sql) and cannot
 * use the service until an Admin approves them via POST
 * /api/accounts/:id/approve — requireRole() enforces that on every route.
 *
 * Body: { fullName, email, password, role }
 */
const SIGNUP_ROLES = ['teacher', 'paper_setter'];
app.post('/api/auth/signup', async (req, res, next) => {
  try {
    const { fullName, email, password, role } = req.body || {};
    if (!fullName || !String(fullName).trim()) {
      return res.status(400).json({ error: 'Full name is required' });
    }
    if (!email || !/^\S+@\S+\.\S+$/.test(String(email).trim())) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!SIGNUP_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const { data, error } = await db.auth.admin.createUser({
      email: String(email).trim().toLowerCase(),
      password: String(password),
      email_confirm: true,
      user_metadata: { full_name: String(fullName).trim(), role },
    });
    if (error) {
      const status = /already|registered|exists/i.test(error.message) ? 409 : 400;
      return res.status(status).json({ error: error.message });
    }

    await audit(data.user.id, 'USER_SIGNUP', 'profile', data.user.id, { role, status: 'pending' });

    res.json({ ok: true, user_id: data.user.id, status: 'pending' });
  } catch (err) {
    next(err);
  }
});

/**
 * Accounts awaiting admin approval (teachers & paper setters only — admin
 * and invigilator profiles are never self-serve, so they never appear here).
 */
app.get('/api/accounts/pending', requireRole('admin'), async (req, res, next) => {
  try {
    const { data, error } = await db
      .from('profiles')
      .select('id, full_name, role, status, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json({ ok: true, accounts: data ?? [] });
  } catch (err) {
    next(err);
  }
});

/** Approve a pending teacher/paper-setter sign-up. Admin-only. */
app.post('/api/accounts/:id/approve', requireRole('admin'), async (req, res, next) => {
  try {
    const { data: account } = await db.from('profiles').select('*').eq('id', req.params.id).single();
    if (!account) return res.status(404).json({ error: 'Account not found' });
    if (account.status !== 'pending') {
      return res.status(409).json({ error: `Account is already '${account.status}'` });
    }

    const { data: updated, error } = await db
      .from('profiles')
      .update({ status: 'approved' })
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw error;

    await audit(req.user.id, 'ACCOUNT_APPROVED', 'profile', req.params.id, {
      full_name: account.full_name,
      role: account.role,
    });

    res.json({ ok: true, account: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * Reject a pending sign-up. Deletes the auth account outright (the profile
 * row cascades with it) — a declined sign-up is not a real user of the
 * system, so there is nothing worth keeping around as 'rejected'.
 * Admin-only.
 */
app.post('/api/accounts/:id/reject', requireRole('admin'), async (req, res, next) => {
  try {
    const { data: account } = await db.from('profiles').select('*').eq('id', req.params.id).single();
    if (!account) return res.status(404).json({ error: 'Account not found' });
    if (account.status !== 'pending') {
      return res.status(409).json({ error: `Account is already '${account.status}'` });
    }

    const { error } = await db.auth.admin.deleteUser(req.params.id);
    if (error) throw error;

    await audit(req.user.id, 'ACCOUNT_REJECTED', 'profile', req.params.id, {
      full_name: account.full_name,
      role: account.role,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * NLP question extraction from a PDF (or raw text). Teacher-only.
 * Proxies to the Python AI service, which uses Claude when an
 * ANTHROPIC_API_KEY is configured and falls back to an offline parser.
 * Body: { pdfBase64?, text?, fileName? }
 */
app.post('/api/questions/extract', requireRole('teacher'), async (req, res, next) => {
  try {
    const { pdfBase64, text, fileName } = req.body || {};
    if (!pdfBase64 && !text) {
      return res.status(400).json({ error: 'Provide a PDF (pdfBase64) or text' });
    }

    let aiRes;
    try {
      aiRes = await fetch(`${AI_SERVICE_URL}/extract/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_base64: pdfBase64, text, filename: fileName }),
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      return res.status(503).json({
        error: `Cannot reach the AI service at ${AI_SERVICE_URL}. Start it (see ai-service/README) to use PDF import.`,
      });
    }

    const json = await aiRes.json().catch(() => ({}));
    if (!aiRes.ok) {
      return res.status(aiRes.status).json({ error: json.detail || 'Extraction failed' });
    }

    await audit(req.user.id, 'QUESTIONS_EXTRACTED', 'questions', 'pdf', {
      engine: json.engine,
      count: json.count,
      file: fileName || null,
    });

    res.json(json);
  } catch (err) {
    next(err);
  }
});

/* ------------------------- exam formats & composition --------------------- */

/** Every (format, year) pair the Admin can pick from. */
app.get('/api/exam-formats', requireRole(), (_req, res) => {
  res.json({ ok: true, years: YEARS, formats: listFormats() });
});

/** The full blueprint for one format in one year. */
app.get('/api/exam-formats/:code/:year', requireRole(), (req, res) => {
  const resolved = resolveFormat(req.params.code, req.params.year);
  if (!resolved) return res.status(404).json({ error: 'Unknown exam format or year' });
  res.json({ ok: true, format: resolved });
});

/**
 * Exam + the blueprint its papers are judged against.
 *
 * For published formats the catalogue is the authority and the stored copy is
 * only a display cache. For formats whose reference publishes no counts, the
 * Admin supplied them at exam creation — that Admin-authored blueprint is
 * stored on the exam and is the authority, since there is nothing in the
 * catalogue to re-derive it from.
 */
async function loadExamContext(examId) {
  const { data: exam } = await db.from('exams').select('*').eq('id', examId).single();
  if (!exam) return { exam: null, resolved: null };
  if (exam.format_blueprint?.custom) return { exam, resolved: exam.format_blueprint };
  const resolved = exam.format_code ? resolveFormat(exam.format_code, exam.format_year) : null;
  return { exam, resolved };
}

/**
 * Which paper set (if any) already holds each question of an exam.
 * Returns { questionId: 'Set A', … }. This is both the "already used in
 * Set A" marker on the compose screen and the rule that keeps sets distinct.
 */
async function questionUsageBySet(examId, exceptPaperId = null) {
  const { data: papers } = await db
    .from('papers')
    .select('id, set_label')
    .eq('exam_id', examId)
    .not('set_label', 'is', null);
  const scoped = (papers ?? []).filter((p) => p.id !== exceptPaperId);
  if (scoped.length === 0) return {};

  const { data: links } = await db
    .from('paper_questions')
    .select('paper_id, question_id')
    .in(
      'paper_id',
      scoped.map((p) => p.id)
    );
  const labelOf = new Map(scoped.map((p) => [p.id, p.set_label]));
  const usage = {};
  for (const link of links ?? []) {
    usage[link.question_id] = labelOf.get(link.paper_id) ?? null;
  }
  return usage;
}

/**
 * Questions in this paper that another set already owns. Empty when the
 * Admin allows reuse. Re-checked at every gate, so turning reuse off after
 * two sets shared a question blocks the later one from being sealed.
 */
async function reuseConflicts(exam, paperId, questionIds) {
  if (!exam || exam.allow_question_reuse) return [];
  const usage = await questionUsageBySet(exam.id, paperId);
  return questionIds.filter((id) => usage[id]).map((id) => ({ id, set: usage[id] }));
}

/** Subjects a teacher is allowed to write for, or null when unrestricted. */
async function assignedSubjects(examId, teacherId) {
  const { data } = await db
    .from('teacher_subjects')
    .select('subject')
    .eq('exam_id', examId)
    .eq('teacher_id', teacherId);
  if (!data || data.length === 0) return null;
  return data.map((r) => r.subject);
}

/**
 * Schedule an exam against a format + year. The blueprint is resolved here,
 * server-side, and stored on the row — the Admin picks a format, they do not
 * get to invent its structure.
 * Body: { formatCode, formatYear, name, examDate, slots: [{ startAt, endAt }],
 *         paperSetCount?, allowQuestionReuse?, paperId? }
 */
app.post('/api/exams', requireRole('admin'), async (req, res, next) => {
  try {
    const { formatCode, formatYear, name, examDate, slots, paperId, paperSetCount, allowQuestionReuse } =
      req.body || {};

    if (!name || String(name).trim().length < 3) {
      return res.status(400).json({ error: 'Exam name must be at least 3 characters' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(examDate || '').trim())) {
      return res.status(400).json({ error: 'Exam date must be YYYY-MM-DD' });
    }
    if (!Array.isArray(slots) || slots.length === 0) {
      return res.status(400).json({ error: 'At least one slot is required' });
    }
    let earliestSlotStart = Infinity;
    for (const [i, s] of slots.entries()) {
      const start = Date.parse(s?.startAt);
      const end = Date.parse(s?.endAt);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return res.status(400).json({ error: `Slot ${i + 1}: end time must be after start time` });
      }
      earliestSlotStart = Math.min(earliestSlotStart, start);
    }

    // A paper cannot be readied — banked, composed, sealed, co-signed,
    // printed and delivered to a center — on short notice, and a date too far
    // out is not a real exam yet. Window: at least 2 days from now, at most 1
    // year from now.
    const now = new Date();
    const earliestAllowed = new Date(now.getTime() + MIN_SCHEDULE_LEAD_DAYS * 24 * 60 * 60 * 1000);
    const latestAllowed = new Date(now);
    latestAllowed.setFullYear(latestAllowed.getFullYear() + MAX_SCHEDULE_LEAD_YEARS);
    if (earliestSlotStart < earliestAllowed.getTime()) {
      return res.status(400).json({
        error: `An exam must be scheduled at least ${MIN_SCHEDULE_LEAD_DAYS} days from now — earliest allowed is ${earliestAllowed.toISOString().slice(0, 10)}.`,
      });
    }
    if (earliestSlotStart > latestAllowed.getTime()) {
      return res.status(400).json({
        error: `An exam cannot be scheduled more than ${MAX_SCHEDULE_LEAD_YEARS} year${MAX_SCHEDULE_LEAD_YEARS === 1 ? '' : 's'} from now — latest allowed is ${latestAllowed.toISOString().slice(0, 10)}.`,
      });
    }

    // An exam without an enforceable blueprint cannot police its papers, so
    // the format is mandatory and must end up with concrete question counts.
    if (!formatCode) {
      return res.status(400).json({ error: 'Choose an examination format — question counts are taken from it' });
    }
    let resolved = resolveFormat(formatCode, formatYear);
    if (!resolved) {
      return res.status(400).json({ error: `Unknown exam format "${formatCode}" for year ${formatYear}` });
    }

    // Formats whose reference defers to the yearly brochure carry no counts;
    // the Admin states them here and they become enforceable.
    if (!resolved.enforced) {
      const { blueprint, error: bErr } = buildCustomBlueprint(resolved, req.body?.customSections);
      if (bErr) {
        return res.status(400).json({
          error: `${resolved.display_name} does not publish question counts, so they must be set here — ${bErr}.`,
          needs_custom_sections: true,
          sections: resolved.sections.map((s) => ({ name: s.name, subject: s.subject })),
        });
      }
      resolved = blueprint;
    }

    const setCount = Math.trunc(Number(paperSetCount ?? 1));
    if (!Number.isFinite(setCount) || setCount < 1 || setCount > MAX_PAPER_SETS) {
      return res.status(400).json({ error: `Number of paper sets must be between 1 and ${MAX_PAPER_SETS}` });
    }

    const slotMinutes = slots.map((s) =>
      Math.round((Date.parse(s.endAt) - Date.parse(s.startAt)) / 60000)
    );
    const duration = resolved?.duration_minutes ?? Math.max(...slotMinutes);

    const { data: exam, error } = await db
      .from('exams')
      .insert({
        name: String(name).trim(),
        exam_date: String(examDate).trim(),
        duration_min: duration,
        paper_id: paperId || null,
        created_by: req.user.id,
        format_code: resolved?.code ?? null,
        format_year: resolved?.year ?? null,
        format_blueprint: resolved,
        paper_set_count: setCount,
        allow_question_reuse: !!allowQuestionReuse,
      })
      .select('*')
      .single();
    if (error) throw error;

    const slotRows = slots.map((s, i) => ({
      exam_id: exam.id,
      label: s.label || `Slot ${i + 1}`,
      slot_no: i + 1,
      start_at: new Date(s.startAt).toISOString(),
      end_at: new Date(s.endAt).toISOString(),
      duration_min: slotMinutes[i],
    }));
    const { error: sErr } = await db.from('exam_slots').insert(slotRows);
    if (sErr) {
      await db.from('exams').delete().eq('id', exam.id);
      throw sErr;
    }

    await audit(req.user.id, 'EXAM_SCHEDULED', 'exam', exam.id, {
      name: exam.name,
      format: resolved?.display_name ?? 'no format',
      slots: slotRows.length,
      paper_sets: setCount,
    });

    res.json({ ok: true, exam, format: resolved, sets: setLabels(setCount) });
  } catch (err) {
    next(err);
  }
});

/**
 * Change how many paper sets an exam has, and whether questions may be reused
 * across them. Admin-only, and only while the affected sets are still drafts:
 * a set whose paper is already sealed cannot be dropped.
 * Body: { paperSetCount?, allowQuestionReuse? }
 */
app.patch('/api/exams/:id/paper-sets', requireRole('admin'), async (req, res, next) => {
  try {
    const examId = req.params.id;
    const { paperSetCount, allowQuestionReuse } = req.body || {};

    const { data: exam } = await db.from('exams').select('*').eq('id', examId).single();
    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    const update = {};
    if (allowQuestionReuse !== undefined) update.allow_question_reuse = !!allowQuestionReuse;

    let dropped = [];
    if (paperSetCount !== undefined) {
      const count = Math.trunc(Number(paperSetCount));
      if (!Number.isFinite(count) || count < 1 || count > MAX_PAPER_SETS) {
        return res.status(400).json({ error: `Number of paper sets must be between 1 and ${MAX_PAPER_SETS}` });
      }

      const keep = new Set(setLabels(count));
      const { data: papers } = await db
        .from('papers')
        .select('id, set_label, status, title')
        .eq('exam_id', examId)
        .not('set_label', 'is', null);

      const losing = (papers ?? []).filter((p) => !keep.has(p.set_label));
      const finalized = losing.filter((p) => p.status !== 'draft');
      if (finalized.length > 0) {
        return res.status(409).json({
          error: `Cannot reduce to ${count} sets — ${finalized
            .map((p) => p.set_label)
            .join(', ')} ${finalized.length === 1 ? 'has' : 'have'} already been sealed.`,
        });
      }

      // Dropped sets were still drafts, so removing them loses only a
      // selection the setter can rebuild.
      if (losing.length > 0) {
        await db
          .from('papers')
          .delete()
          .in(
            'id',
            losing.map((p) => p.id)
          );
        dropped = losing.map((p) => p.set_label);
      }
      update.paper_set_count = count;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const { data: updated, error } = await db
      .from('exams')
      .update(update)
      .eq('id', examId)
      .select('*')
      .single();
    if (error) throw error;

    await audit(req.user.id, 'EXAM_PAPER_SETS_UPDATED', 'exam', examId, {
      paper_sets: updated.paper_set_count,
      allow_question_reuse: updated.allow_question_reuse,
      dropped_drafts: dropped,
    });

    res.json({ ok: true, exam: updated, sets: setLabels(updated.paper_set_count), dropped });
  } catch (err) {
    next(err);
  }
});

/**
 * Per-set completion for an exam: how far each of Set A…N is against the
 * format, plus the map of which question is already committed to which set.
 * Powers the setter's dashboard, the set dropdown and the reuse markers.
 */
app.get('/api/exams/:id/sets', requireRole('paper_setter', 'admin'), async (req, res, next) => {
  try {
    const examId = req.params.id;
    const { exam, resolved } = await loadExamContext(examId);
    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    const labels = setLabels(exam.paper_set_count);
    const { data: papers } = await db
      .from('papers')
      .select('*')
      .eq('exam_id', examId)
      .not('set_label', 'is', null);

    const byLabel = new Map((papers ?? []).map((p) => [p.set_label, p]));
    const paperIds = (papers ?? []).map((p) => p.id);

    const { data: links } = paperIds.length
      ? await db
          .from('paper_questions')
          .select('paper_id, position, question:questions(id, section_name, question_type, marks)')
          .in('paper_id', paperIds)
      : { data: [] };

    const byPaper = new Map();
    for (const link of links ?? []) {
      if (!link.question) continue;
      if (!byPaper.has(link.paper_id)) byPaper.set(link.paper_id, []);
      byPaper.get(link.paper_id).push({ ...link.question, position: link.position });
    }

    const usage = {};
    for (const [paperId, rows] of byPaper) {
      const label = (papers ?? []).find((p) => p.id === paperId)?.set_label ?? null;
      for (const q of rows) usage[q.id] = label;
    }

    const sets = labels.map((label) => {
      const paper = byLabel.get(label) ?? null;
      const questions = paper ? (byPaper.get(paper.id) ?? []) : [];
      const report = validateComposition(resolved, questions);
      return {
        label,
        paper_id: paper?.id ?? null,
        title: paper?.title ?? null,
        status: paper?.status ?? 'not_started',
        previewed_at: paper?.previewed_at ?? null,
        question_ids: questions.map((q) => q.id),
        report,
        ready: report.ok,
      };
    });

    res.json({
      ok: true,
      exam: {
        id: exam.id,
        name: exam.name,
        paper_set_count: exam.paper_set_count,
        allow_question_reuse: exam.allow_question_reuse,
      },
      format: resolved,
      sets,
      usage,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Questions accepted in a single POST /api/questions call. This bounds one
 * HTTP body and one insert; the cap on how many questions an exam's bank may
 * hold for a given slot is a separate rule — see slotCeiling().
 */
const BATCH_LIMIT = 500;

const SHAPE_ERRORS = {
  mcq: 'an MCQ needs exactly four options and a correct option',
  msq: 'a multiple-select question needs at least two options and at least one correct option',
  numerical: 'a numerical-value question needs a numeric answer and no options',
  theoretical: null,
};

/** Structural check that mirrors the questions_shape_chk constraint. */
function shapeError(q) {
  const options = Array.isArray(q.options) ? q.options.filter((o) => String(o).trim()) : [];
  if (q.question_type === 'mcq') {
    if (options.length !== 4 || q.correct_index == null) return SHAPE_ERRORS.mcq;
  } else if (q.question_type === 'msq') {
    if (options.length < 2 || !Array.isArray(q.correct_indices) || q.correct_indices.length === 0) {
      return SHAPE_ERRORS.msq;
    }
  } else if (q.question_type === 'numerical') {
    if (options.length > 0 || q.answer_numeric == null || !Number.isFinite(Number(q.answer_numeric))) {
      return SHAPE_ERRORS.numerical;
    }
  } else if (q.question_type !== 'theoretical') {
    return `unknown question type "${q.question_type}"`;
  }
  return null;
}

/**
 * Add questions to an exam's bank. Teacher-only, and the ONLY way in (the
 * client insert policy was removed in patch-5).
 *
 * Two rules apply. ALIGNMENT: a question must name a real section of the
 * format and carry a type and marks value that section actually uses,
 * otherwise it could never be selected into a paper. VOLUME: each
 * (section, type, marks) slot is capped at what the exam consumes across all
 * its paper sets, times BANK_HEADROOM for setter choice — see slotCeiling().
 * The exact-count rule still lives on the paper.
 * Body: { examId, questions: [ ... ] }
 */
app.post('/api/questions', requireRole('teacher'), async (req, res, next) => {
  try {
    const { examId, questions } = req.body || {};
    const incoming = Array.isArray(questions) ? questions : [];
    if (!examId) return res.status(400).json({ error: 'examId is required' });
    if (incoming.length === 0) return res.status(400).json({ error: 'No questions supplied' });
    // Per-REQUEST batch guard only — it keeps one payload inside the 15 MB
    // body limit and one insert inside a sane transaction; the per-slot bank
    // ceiling is enforced separately below. Larger imports arrive as
    // consecutive batches.
    if (incoming.length > BATCH_LIMIT) {
      return res.status(400).json({
        error: `Send at most ${BATCH_LIMIT} questions per request — split larger imports into batches.`,
      });
    }

    const { exam, resolved } = await loadExamContext(examId);
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    if (exam.status !== 'scheduled') {
      return res.status(409).json({ error: `Exam is '${exam.status}' — questions can only be added while it is scheduled` });
    }

    const allowedSubjects = await assignedSubjects(examId, req.user.id);
    const rows = [];
    const rejected = [];

    // How full each (section, type, marks) slot already is. Counted with an
    // exact HEAD query per slot rather than by reading the bank: a large bank
    // runs past PostgREST's max-rows, and an undercount would wave uploads
    // through. Only the slots this batch actually touches are queried, and the
    // tally then rises as rows are accepted so one batch cannot overfill.
    const setCount = Math.max(1, Math.trunc(Number(exam.paper_set_count) || 1));
    const slotDepth = new Map();
    const depthFor = async (key, sectionName, type, marks) => {
      if (slotDepth.has(key)) return slotDepth.get(key);
      let query = db
        .from('questions')
        .select('*', { count: 'exact', head: true })
        .eq('exam_id', examId)
        .eq('question_type', type)
        .eq('marks', marks);
      query = sectionName == null
        ? query.is('section_name', null)
        : query.eq('section_name', sectionName);
      const { count, error } = await query;
      if (error) throw error;
      const depth = count ?? 0;
      slotDepth.set(key, depth);
      return depth;
    };

    for (const [i, raw] of incoming.entries()) {
      const label = `Question ${i + 1}`;
      const body = String(raw?.body ?? '').trim();
      const type = String(raw?.question_type ?? 'mcq');
      const marks = Number(raw?.marks);
      const sectionName = raw?.section_name ? String(raw.section_name).trim() : null;
      const subject = String(raw?.subject ?? '').trim();

      if (body.length < 10) {
        rejected.push(`${label}: the question text must be at least 10 characters.`);
        continue;
      }
      if (!subject) {
        rejected.push(`${label}: a subject is required.`);
        continue;
      }
      if (!Number.isFinite(marks) || marks <= 0) {
        rejected.push(`${label}: marks must be a positive number.`);
        continue;
      }
      const shape = shapeError({ ...raw, question_type: type });
      if (shape) {
        rejected.push(`${label}: ${shape}.`);
        continue;
      }
      if (allowedSubjects && !allowedSubjects.includes(subject)) {
        rejected.push(
          `${label}: you are assigned to ${allowedSubjects.join(', ')} for this exam, not ${subject}.`
        );
        continue;
      }

      const misaligned = checkQuestionSlot(resolved, {
        section_name: sectionName,
        question_type: type,
        marks,
      });
      if (misaligned) {
        rejected.push(`${label}: ${misaligned}`);
        continue;
      }

      // Volume: this slot may hold what every paper set consumes, plus
      // headroom so the setter can still reject a weak question.
      const cap = slotCeiling(
        resolved,
        { section_name: sectionName, question_type: type, marks },
        setCount
      );
      if (cap) {
        const slotKey = `${sectionName ?? ''}|${type}|${marks}`;
        const depth = await depthFor(slotKey, sectionName, type, marks);
        if (depth >= cap.ceiling) {
          rejected.push(
            `${label}: ${sectionName} · ${type} · ${marks} marks is full — ${depth} already banked and the ceiling is ${cap.ceiling} (${cap.perPaper} per paper × ${cap.sets} set${cap.sets === 1 ? '' : 's'} × ${BANK_HEADROOM} for choice). Withdraw one before adding another.`
          );
          continue;
        }
        slotDepth.set(slotKey, depth + 1);
      }

      const options = Array.isArray(raw.options) ? raw.options.map((o) => String(o).trim()) : [];
      rows.push({
        teacher_id: req.user.id,
        exam_id: examId,
        subject,
        section_name: sectionName,
        topic: raw.topic ? String(raw.topic).trim() : null,
        difficulty: ['easy', 'medium', 'hard'].includes(raw.difficulty) ? raw.difficulty : 'medium',
        question_type: type,
        marks,
        source: raw.source === 'pdf' ? 'pdf' : 'manual',
        body,
        options: type === 'mcq' || type === 'msq' ? options : [],
        correct_index: type === 'mcq' ? Number(raw.correct_index) : null,
        correct_indices: type === 'msq' ? raw.correct_indices.map(Number) : null,
        answer_numeric: type === 'numerical' ? Number(raw.answer_numeric) : null,
        status: 'submitted',
      });
    }

    if (rows.length === 0) {
      return res.status(400).json({ error: rejected[0] ?? 'Nothing to save', rejected });
    }

    const { data: inserted, error } = await db.from('questions').insert(rows).select('id');
    if (error) throw error;

    await audit(req.user.id, 'QUESTIONS_ADDED', 'exam', examId, {
      accepted: inserted.length,
      rejected: rejected.length,
      format: resolved?.display_name ?? null,
    });

    res.json({ ok: true, accepted: inserted.length, rejected });
  } catch (err) {
    next(err);
  }
});

/**
 * Save one paper set's selection. Idempotent per (exam, set): re-saving
 * Set A rewrites that set's question list rather than creating a second
 * paper, which is what lets the setter build A, B, C… over several sittings.
 *
 * A draft may be short of the format's quota (that is what the progress
 * meters are for), but it may never exceed it, never hold a question the
 * blueprint has no slot for, and — unless the Admin turned reuse on — never
 * hold a question already committed to another set.
 *
 * Body: { examId, setLabel, title, questionIds: [] }
 */
app.post('/api/papers', requireRole('paper_setter'), async (req, res, next) => {
  try {
    const { examId, setLabel, title, questionIds } = req.body || {};
    const ids = Array.isArray(questionIds) ? Array.from(new Set(questionIds)) : [];
    if (!examId) return res.status(400).json({ error: 'examId is required' });
    if (!title || String(title).trim().length < 4) {
      return res.status(400).json({ error: 'Paper title must be at least 4 characters' });
    }
    if (ids.length === 0) return res.status(400).json({ error: 'Select at least one question' });

    const { exam, resolved } = await loadExamContext(examId);
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    if (exam.status !== 'scheduled') {
      return res.status(409).json({ error: `Exam is '${exam.status}' — papers can only be composed while it is scheduled` });
    }

    const labels = setLabels(exam.paper_set_count);
    const label = String(setLabel ?? labels[0]);
    if (!labels.includes(label)) {
      return res.status(400).json({ error: `"${label}" is not a set of this exam. Available: ${labels.join(', ')}.` });
    }

    // An existing paper for this set is either revised (draft) or protected.
    const { data: existing } = await db
      .from('papers')
      .select('*')
      .eq('exam_id', examId)
      .eq('set_label', label)
      .maybeSingle();
    if (existing && existing.status !== 'draft') {
      return res.status(409).json({ error: `${label} is already '${existing.status}' and can no longer be edited.` });
    }
    if (existing && existing.setter_id !== req.user.id) {
      return res.status(403).json({ error: `${label} is being composed by another paper setter.` });
    }

    const { data: picked } = await db
      .from('questions')
      .select('id, exam_id, status, section_name, subject, question_type, marks')
      .in('id', ids);
    const chosen = picked ?? [];
    if (chosen.length !== ids.length) {
      return res.status(400).json({ error: 'Some selected questions no longer exist' });
    }
    const foreign = chosen.find((q) => q.exam_id !== examId);
    if (foreign) return res.status(400).json({ error: 'A selected question belongs to a different exam' });

    // Every set is an independent paper: by default a question belongs to one
    // set only. The Admin can lift this with allow_question_reuse.
    if (!exam.allow_question_reuse) {
      const usage = await questionUsageBySet(examId, existing?.id ?? null);
      const clashes = chosen.filter((q) => usage[q.id]);
      if (clashes.length > 0) {
        const detail = clashes
          .slice(0, 3)
          .map((q) => `one is already in ${usage[q.id]}`)
          .join('; ');
        return res.status(409).json({
          error: `${clashes.length} selected question(s) are already used in another set (${detail}). Turn on "Allow question reuse across sets" in the exam settings, or pick different questions.`,
        });
      }
    }

    // A draft may be short of the quota, but never over it and never holding a
    // question the blueprint has no slot for.
    const report = validateComposition(resolved, chosen);
    const blocking = [];
    for (const s of report.sections) {
      for (const r of s.requirements) {
        if (r.status === 'over') blocking.push(`${s.name} takes at most ${r.max} × ${r.label}`);
      }
      const claimed = s.requirements.reduce((n, r) => n + r.current, 0);
      if (s.current > claimed) {
        blocking.push(`${s.name} holds ${s.current - claimed} question(s) that fit none of its quotas`);
      }
    }
    if (resolved?.enforced) {
      const stray = chosen.filter((q) => !resolved.sections.some((s) => s.name === q.section_name));
      if (stray.length > 0) {
        blocking.push(`${stray.length} question(s) are not tagged with a section of ${resolved.display_name}`);
      }
    }
    if (blocking.length > 0) {
      return res.status(400).json({ error: `This selection breaks the exam format: ${blocking.join('; ')}.`, report });
    }

    // Order questions by blueprint section, then by the order they were picked,
    // so the draft already carries the final printed numbering.
    const sectionOrder = new Map((resolved?.sections ?? []).map((s, i) => [s.name, i]));
    const ordered = [...chosen].sort((a, b) => {
      const sa = sectionOrder.get(a.section_name ?? '') ?? 999;
      const sb = sectionOrder.get(b.section_name ?? '') ?? 999;
      return sa - sb || ids.indexOf(a.id) - ids.indexOf(b.id);
    });

    const subjects = Array.from(new Set(ordered.map((q) => q.subject)));
    const fields = {
      title: String(title).trim(),
      subject: subjects.length === 1 ? subjects[0] : 'Mixed',
      setter_id: req.user.id,
      exam_id: examId,
      set_label: label,
      status: 'draft',
      question_count: ordered.length,
      format_code: resolved?.code ?? null,
      format_year: resolved?.year ?? null,
    };

    let paper;
    if (existing) {
      const { data, error } = await db
        .from('papers')
        .update(fields)
        .eq('id', existing.id)
        .select('*')
        .single();
      if (error) throw error;
      paper = data;
      // Replacing the list also clears previewed_at via the patch-5 trigger.
      const { error: dErr } = await db.from('paper_questions').delete().eq('paper_id', paper.id);
      if (dErr) throw dErr;
    } else {
      const { data, error } = await db.from('papers').insert(fields).select('*').single();
      if (error) throw error;
      paper = data;
    }

    const { error: lErr } = await db.from('paper_questions').insert(
      ordered.map((q, index) => ({ paper_id: paper.id, question_id: q.id, position: index }))
    );
    if (lErr) {
      if (!existing) await db.from('papers').delete().eq('id', paper.id);
      throw lErr;
    }

    await audit(req.user.id, 'PAPER_DRAFTED', 'paper', paper.id, {
      title: paper.title,
      set: label,
      questions: ordered.length,
      format: resolved?.display_name ?? null,
      complete: report.ok,
    });

    res.json({ ok: true, paper, report });
  } catch (err) {
    next(err);
  }
});

/** Paper + exam + blueprint + its draft questions, or a typed failure. */
async function loadPaperForSetter(paperId, req) {
  const { data: paper } = await db.from('papers').select('*').eq('id', paperId).single();
  if (!paper) return { error: { status: 404, message: 'Paper not found' } };
  if (req.profile.role !== 'admin' && paper.setter_id !== req.user.id) {
    return { error: { status: 403, message: 'Not your paper' } };
  }

  const { data: rows, error } = await db
    .from('paper_questions')
    .select('position, question:questions(*)')
    .eq('paper_id', paperId)
    .order('position');
  if (error) throw error;

  const questions = (rows ?? [])
    .filter((r) => r.question)
    .map((r) => ({ ...r.question, position: r.position }));

  const { exam, resolved } = paper.exam_id
    ? await loadExamContext(paper.exam_id)
    : { exam: null, resolved: null };

  return { paper, exam, resolved, questions };
}

/** Live composition report: per-section counts, per-type quotas, blockers. */
app.get('/api/papers/:id/validate', requireRole('paper_setter', 'admin'), async (req, res, next) => {
  try {
    const ctx = await loadPaperForSetter(req.params.id, req);
    if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });
    const report = validateComposition(ctx.resolved, ctx.questions);
    res.json({ ok: true, report, previewed_at: ctx.paper.previewed_at, status: ctx.paper.status });
  } catch (err) {
    next(err);
  }
});

/**
 * The exact paper the students will receive — section order, final question
 * numbering, options, per-question marks and negative marking. Read-only:
 * previewing does not authorise anything, /confirm-preview does.
 */
app.get('/api/papers/:id/preview', requireRole('paper_setter', 'admin'), async (req, res, next) => {
  try {
    const ctx = await loadPaperForSetter(req.params.id, req);
    if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });
    const report = validateComposition(ctx.resolved, ctx.questions);
    const view = buildPaperView(ctx);
    res.json({ ok: true, view, report, previewed_at: ctx.paper.previewed_at });
  } catch (err) {
    next(err);
  }
});

/**
 * The setter's explicit "I have read this preview and it is the paper".
 * Sealing refuses to run without it, and attaching or removing a question
 * clears it again (trigger in patch-5), so the confirmation always refers to
 * the exact paper that gets encrypted.
 */
app.post('/api/papers/:id/confirm-preview', requireRole('paper_setter'), async (req, res, next) => {
  try {
    const ctx = await loadPaperForSetter(req.params.id, req);
    if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });
    if (ctx.paper.status !== 'draft') {
      return res.status(409).json({ error: `Paper is already '${ctx.paper.status}'` });
    }

    const report = validateComposition(ctx.resolved, ctx.questions);
    if (!report.ok) {
      return res.status(400).json({ error: report.errors[0] ?? 'Paper does not satisfy its exam format', report });
    }

    const clashes = await reuseConflicts(ctx.exam, ctx.paper.id, ctx.questions.map((q) => q.id));
    if (clashes.length > 0) {
      return res.status(409).json({
        error: `${clashes.length} question(s) in this set are also used in ${Array.from(new Set(clashes.map((c) => c.set))).join(', ')}. Each set must have its own questions.`,
        report,
      });
    }

    const confirmedAt = new Date().toISOString();
    const { error } = await db.from('papers').update({ previewed_at: confirmedAt }).eq('id', ctx.paper.id);
    if (error) throw error;

    await audit(req.user.id, 'PAPER_PREVIEW_CONFIRMED', 'paper', ctx.paper.id, {
      title: ctx.paper.title,
      questions: ctx.questions.length,
    });

    res.json({ ok: true, previewed_at: confirmedAt });
  } catch (err) {
    next(err);
  }
});

/**
 * Seal a draft paper. Setter-only, must own the paper.
 * Body: { passphrase }
 */
app.post('/api/papers/:id/seal', requireRole('paper_setter'), async (req, res, next) => {
  try {
    const paperId = req.params.id;
    const { passphrase } = req.body || {};
    if (!passphrase || String(passphrase).length < 8) {
      return res.status(400).json({ error: 'Passphrase must be at least 8 characters' });
    }

    const { data: paper } = await db.from('papers').select('*').eq('id', paperId).single();
    if (!paper) return res.status(404).json({ error: 'Paper not found' });
    if (paper.setter_id !== req.user.id) return res.status(403).json({ error: 'Not your paper' });
    if (paper.status !== 'draft') return res.status(409).json({ error: `Paper is already '${paper.status}'` });

    const { data: rows, error: qErr } = await db
      .from('paper_questions')
      .select('position, question:questions(*)')
      .eq('paper_id', paperId)
      .order('position');
    if (qErr) throw qErr;
    if (!rows || rows.length === 0) return res.status(400).json({ error: 'Paper has no questions' });

    const questions = rows.filter((r) => r.question).map((r) => ({ ...r.question, position: r.position }));
    const { exam, resolved } = paper.exam_id
      ? await loadExamContext(paper.exam_id)
      : { exam: null, resolved: null };

    // Nothing gets encrypted until the composition matches the exam format
    // and the setter has confirmed the preview of this exact paper.
    const report = validateComposition(resolved, questions);
    if (!report.ok) {
      return res.status(400).json({
        error: report.errors[0] ?? 'Paper does not satisfy its exam format',
        report,
      });
    }
    if (!paper.previewed_at) {
      return res.status(409).json({
        error: 'Preview the paper and confirm it before sealing — the confirmation is cleared whenever the question list changes.',
        report,
      });
    }
    const clashes = await reuseConflicts(exam, paper.id, questions.map((q) => q.id));
    if (clashes.length > 0) {
      return res.status(409).json({
        error: `${clashes.length} question(s) in this set are also used in ${Array.from(new Set(clashes.map((c) => c.set))).join(', ')}. Each set must have its own questions.`,
        report,
      });
    }

    // The sealed blob carries the rendered paper, so what is printed later is
    // byte-for-byte the document the setter confirmed.
    const view = buildPaperView({ paper, exam, resolved, questions });
    const payload = Buffer.from(
      JSON.stringify({
        paper: { id: paper.id, title: paper.title, subject: paper.subject },
        view,
        sealed_by: req.user.id,
        sealed_at: new Date().toISOString(),
        questions,
      }),
      'utf8'
    );

    // K = random key; shareA ^ shareB = K. One share alone reveals nothing.
    const key = crypto.randomBytes(32);
    const shareA = crypto.randomBytes(32);
    const shareB = xorBuffers(key, shareA);

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);

    const { error: sErr } = await db.from('paper_secrets').upsert({
      paper_id: paperId,
      ciphertext: b64(ciphertext),
      cipher_iv: b64(iv),
      cipher_tag: b64(cipher.getAuthTag()),
      share_setter: wrapShare(shareA, passphrase),
      share_admin: null,
      escrow_admin: wrapShare(shareB, escrowPassphrase(paperId)),
    });
    if (sErr) throw sErr;

    key.fill(0); shareA.fill(0); shareB.fill(0);

    const { error: pErr } = await db
      .from('papers')
      .update({ status: 'sealed', sealed_at: new Date().toISOString() })
      .eq('id', paperId);
    if (pErr) throw pErr;

    const questionIds = questions.map((q) => q.id);
    await db.from('questions').update({ status: 'used' }).in('id', questionIds);

    await audit(req.user.id, 'PAPER_SEALED', 'paper', paperId, {
      title: paper.title,
      questions: questionIds.length,
    });

    res.json({ ok: true, status: 'sealed', questions: questionIds.length });
  } catch (err) {
    next(err);
  }
});

/**
 * Admin co-sign: re-wraps the second share under the admin passphrase and
 * destroys the escrow copy. From here, dual control is fully active.
 * Body: { passphrase }
 */
app.post('/api/papers/:id/cosign', requireRole('admin'), async (req, res, next) => {
  try {
    const paperId = req.params.id;
    const { passphrase } = req.body || {};
    if (!passphrase || String(passphrase).length < 8) {
      return res.status(400).json({ error: 'Passphrase must be at least 8 characters' });
    }

    const { data: paper } = await db.from('papers').select('*').eq('id', paperId).single();
    if (!paper) return res.status(404).json({ error: 'Paper not found' });
    if (paper.status !== 'sealed') return res.status(409).json({ error: `Paper is '${paper.status}', expected 'sealed'` });

    const { data: secrets } = await db.from('paper_secrets').select('*').eq('paper_id', paperId).single();
    if (!secrets?.escrow_admin) return res.status(409).json({ error: 'No escrow share to co-sign' });

    const shareB = unwrapShare(secrets.escrow_admin, escrowPassphrase(paperId));
    const wrapped = wrapShare(shareB, passphrase);
    shareB.fill(0);

    const { error: sErr } = await db
      .from('paper_secrets')
      .update({ share_admin: wrapped, escrow_admin: null })
      .eq('paper_id', paperId);
    if (sErr) throw sErr;

    const { error: pErr } = await db
      .from('papers')
      .update({ status: 'sealed_dual', cosigned_at: new Date().toISOString() })
      .eq('id', paperId);
    if (pErr) throw pErr;

    await audit(req.user.id, 'PAPER_COSIGNED', 'paper', paperId, { title: paper.title });

    res.json({ ok: true, status: 'sealed_dual' });
  } catch (err) {
    next(err);
  }
});

/**
 * Print ceremony — the two-person rule in action.
 * Requires BOTH passphrases; decrypts in memory only; mints N uniquely
 * fingerprinted copies and opens their custody chains.
 * Body: { setterPassphrase, adminPassphrase, copies, location }
 */
app.post('/api/papers/:id/print', requireRole('admin'), async (req, res, next) => {
  try {
    const paperId = req.params.id;
    const { setterPassphrase, adminPassphrase, copies, location } = req.body || {};
    const copyCount = Math.max(1, Math.min(500, parseInt(copies, 10) || 0));
    if (!setterPassphrase || !adminPassphrase) {
      return res.status(400).json({ error: 'Both setter and admin passphrases are required' });
    }
    if (!copyCount) return res.status(400).json({ error: 'copies must be a number between 1 and 500' });

    const { data: paper } = await db.from('papers').select('*').eq('id', paperId).single();
    if (!paper) return res.status(404).json({ error: 'Paper not found' });
    if (paper.status !== 'sealed_dual') {
      return res.status(409).json({ error: `Paper is '${paper.status}', expected 'sealed_dual'` });
    }

    const { data: secrets } = await db.from('paper_secrets').select('*').eq('paper_id', paperId).single();
    if (!secrets?.share_setter || !secrets?.share_admin) {
      return res.status(409).json({ error: 'Key shares incomplete' });
    }

    let shareA, shareB;
    try {
      shareA = unwrapShare(secrets.share_setter, setterPassphrase);
    } catch {
      return res.status(400).json({ error: 'Setter passphrase is incorrect' });
    }
    try {
      shareB = unwrapShare(secrets.share_admin, adminPassphrase);
    } catch {
      shareA.fill(0);
      return res.status(400).json({ error: 'Admin passphrase is incorrect' });
    }

    const key = xorBuffers(shareA, shareB);
    shareA.fill(0); shareB.fill(0);

    // Decrypt to verify integrity (GCM tag) — proves both shares were right.
    let paperJson;
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, fromB64(secrets.cipher_iv));
      decipher.setAuthTag(fromB64(secrets.cipher_tag));
      const plain = Buffer.concat([decipher.update(fromB64(secrets.ciphertext)), decipher.final()]);
      paperJson = JSON.parse(plain.toString('utf8'));
      plain.fill(0);
    } finally {
      key.fill(0);
    }

    const printLocation = (location || 'Central Government Press').trim();
    const copyRows = [];
    for (let n = 1; n <= copyCount; n++) {
      const copyId = crypto.randomUUID();
      const fp = await registerFingerprint(copyId);
      copyRows.push({
        id: copyId,
        paper_id: paperId,
        copy_number: n,
        qr_payload: JSON.stringify({ c: copyId, p: paperId, n, sig: signQr(copyId, paperId, n) }),
        trace_code: traceCode(copyId),
        fingerprint_hash: fp.hash,
        fingerprint_method: fp.method,
        current_location: printLocation,
        status: 'printed',
      });
    }

    // Exam name (for the printed paper header) — best effort.
    let examName = null;
    if (paper.exam_id) {
      const { data: exam } = await db.from('exams').select('name').eq('id', paper.exam_id).single();
      examName = exam?.name ?? null;
    }

    const { error: cErr } = await db.from('paper_copies').insert(copyRows);
    if (cErr) {
      // A missing column here means a migration has not been applied. Say so
      // precisely — nothing has been written yet (the paper is still
      // 'sealed_dual'), so the ceremony can simply be re-run afterwards.
      const missing = missingColumnHint(cErr.message);
      if (missing) return res.status(409).json({ error: missing });
      throw cErr;
    }

    const { error: eErr } = await db.from('custody_events').insert(
      copyRows.map((c) => ({
        copy_id: c.id,
        event_type: 'printed',
        location: printLocation,
        note: 'Printed, QR-signed and fingerprinted',
        actor_id: req.user.id,
      }))
    );
    if (eErr) throw eErr;

    const { error: pErr } = await db
      .from('papers')
      .update({ status: 'printed', printed_at: new Date().toISOString() })
      .eq('id', paperId);
    if (pErr) throw pErr;

    await audit(req.user.id, 'PRINT_CEREMONY', 'paper', paperId, {
      title: paperJson?.paper?.title ?? paper.title,
      copies: copyCount,
      location: printLocation,
    });

    // Shape the decrypted questions for the printable preview (no answer keys).
    const questions = (paperJson?.questions ?? []).map((q) => ({
      question_type: q.question_type ?? (Array.isArray(q.options) && q.options.length ? 'mcq' : 'theoretical'),
      body: q.body,
      options: Array.isArray(q.options) ? q.options : [],
      correct_index: q.correct_index ?? null,
      marks: typeof q.marks === 'number' ? q.marks : 1,
      subject: q.subject ?? null,
      topic: q.topic ?? null,
      difficulty: q.difficulty ?? null,
    }));
    const totalMarks = questions.reduce((sum, q) => sum + (q.marks || 0), 0);

    // Papers sealed with a format carry the exact rendered document the setter
    // confirmed; older sealed papers fall back to the flat question list.
    const view = paperJson?.view ?? null;

    // One QR per question, so the tokens have to be minted against the count
    // the printed layout will actually render.
    const taggedQuestionCount = Array.isArray(view?.sections) && view.sections.length
      ? view.sections.reduce((n, s) => n + (Number(s.question_count) || 0), 0)
      : questions.length;

    res.json({
      ok: true,
      status: 'printed',
      copies: copyCount,
      location: printLocation,
      paper: {
        id: paper.id,
        title: paperJson?.paper?.title ?? paper.title,
        subject: paper.subject,
        exam_name: examName,
        total_marks: view?.total_marks ?? totalMarks,
        questions,
        sections: view?.sections ?? null,
        instructions: view?.instructions ?? null,
        duration_minutes: view?.duration_minutes ?? null,
        format_display_name: view?.format_display_name ?? null,
        set_label: view?.set_label ?? paper.set_label ?? null,
      },
      // Each copy's per-question tokens, aligned so frames[n - 1] is printed
      // beside question n. Only this server can mint them (they are
      // HMAC-tagged), so they travel with the ceremony result rather than
      // being derived client-side.
      copyList: copyRows.map((c) => ({
        id: c.id,
        copy_number: c.copy_number,
        qr_payload: c.qr_payload,
        trace_code: c.trace_code,
        frames: questionFrameTokens(c.trace_code, c.id, taggedQuestionCount),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Leak forensics. Identifies the copy from whichever trace survives in the
 * material that surfaced, marks it leaked (which fires a CRITICAL alert to
 * every admin dashboard in real time via the custody trigger) and returns
 * its full chain of custody.
 *
 * Body — any one of:
 *   { trace_code }    a QR from the page watermark, or the printed code.
 *                     Works from a photo of ANY fragment of the sheet.
 *   { qr_payload }    the full signed header QR.
 *   { copy_id }       when the copy is already known.
 *   { image_base64 }  a page photo, decoded by the AI service's watermark.
 */
app.post('/api/forensics/identify', requireRole('admin'), async (req, res, next) => {
  try {
    let {
      copy_id: copyId,
      image_base64: imageBase64,
      trace_code: traceRaw,
      qr_payload: qrPayload,
    } = req.body || {};
    let via = 'copy id';

    // A watermark scan: short code tiled across the page.
    if (!copyId && traceRaw) {
      const code = normaliseTraceCode(traceRaw);
      if (!code) {
        return res.status(400).json({
          error: `"${traceRaw}" is not a valid trace code — expected ${TRACE_LENGTH} characters, optionally prefixed with SAE:`,
        });
      }
      const { data: match } = await db
        .from('paper_copies')
        .select('id')
        .eq('trace_code', code)
        .maybeSingle();
      if (!match) {
        return res.status(404).json({ error: `No printed copy carries the trace code ${code}` });
      }
      copyId = match.id;
      via = 'page watermark';
    }

    // The full header QR.
    if (!copyId && qrPayload) {
      let parsed;
      try {
        parsed = typeof qrPayload === 'string' ? JSON.parse(qrPayload) : qrPayload;
      } catch {
        return res.status(400).json({ error: 'QR payload is not valid JSON' });
      }
      const { c, p, n, sig } = parsed || {};
      if (!c || !p || sig !== signQr(c, p, n)) {
        return res.status(400).json({ error: 'QR signature invalid — possible forged copy' });
      }
      copyId = c;
      via = 'header QR';
    }

    if (!copyId && imageBase64) {
      const r = await fetch(`${AI_SERVICE_URL}/fingerprint/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: imageBase64 }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) return res.status(422).json({ error: 'No fingerprint found in image' });
      const extracted = await r.json();
      copyId = extracted.copy_id;
      via = 'steganographic fingerprint';
    }
    if (!copyId) {
      return res.status(400).json({ error: 'Provide trace_code, qr_payload, copy_id or image_base64' });
    }

    const { data: copy } = await db
      .from('paper_copies')
      .select('*, paper:papers(title, subject)')
      .eq('id', copyId)
      .single();
    if (!copy) return res.status(404).json({ error: 'No copy matches this trace' });

    await db.from('custody_events').insert({
      copy_id: copyId,
      event_type: 'leaked',
      location: 'Forensic identification',
      note: `Identified via ${via}`,
      actor_id: req.user.id,
    });

    const { data: chain } = await db
      .from('custody_events')
      .select('*')
      .eq('copy_id', copyId)
      .order('created_at', { ascending: true });

    await audit(req.user.id, 'LEAK_IDENTIFIED', 'paper_copy', copyId, {
      paper: copy.paper?.title,
      copy_number: copy.copy_number,
      via,
    });

    res.json({ ok: true, via, copy, custody_chain: chain });
  } catch (err) {
    next(err);
  }
});

/* --------------------------- QR detection events -------------------------- */

/**
 * Monitoring clients (camera rigs, invigilator phones) authenticate with a
 * shared key rather than a user JWT. Falls back to an admin/invigilator
 * session so the app can report a sighting too.
 */
async function requireDetector(req, res, next) {
  const key = req.get('x-detector-key');
  if (DETECTOR_KEY && key && crypto.timingSafeEqual(
    Buffer.from(String(key).padEnd(64).slice(0, 64)),
    Buffer.from(String(DETECTOR_KEY).padEnd(64).slice(0, 64))
  )) {
    req.detector = true;
    return next();
  }
  return requireRole('admin', 'invigilator')(req, res, next);
}

/**
 * Record a QR watermark sighting.
 *
 * Verifies the token was minted by this server, resolves it to copy / paper /
 * exam / page / frame, folds repeat sightings into one row, and raises a live
 * alert on the admin dashboard for genuinely new events.
 *
 * Body: { qr_token, scanner_id?, device_info?, confidence?, image_ref?,
 *         latitude?, longitude?, location_accuracy_m?, location_label?,
 *         timezone?, detected_at? }
 */
app.post('/api/detections', requireDetector, async (req, res, next) => {
  try {
    const body = req.body || {};
    const parsed = parseFrameToken(body.qr_token ?? body.trace_code);
    if (!parsed) {
      return res.status(400).json({ error: 'Not a recognisable SecureAIExam watermark token' });
    }

    const { data: copy } = await db
      .from('paper_copies')
      .select('*, paper:papers(id, title, set_label, exam_id)')
      .eq('trace_code', parsed.trace)
      .maybeSingle();
    if (!copy) {
      return res.status(404).json({ error: `No printed copy carries the trace code ${parsed.trace}` });
    }

    // A framed token must carry the tag this server would have minted.
    if (parsed.framed && parsed.tag !== frameTag(copy.id, parsed.page, parsed.frame)) {
      await audit(null, 'DETECTION_REJECTED', 'paper_copy', copy.id, {
        reason: 'frame tag mismatch',
        token: body.qr_token,
      });
      return res.status(400).json({ error: 'Watermark signature invalid — possible forged or altered copy' });
    }

    let examName = null;
    if (copy.paper?.exam_id) {
      const { data: exam } = await db.from('exams').select('name').eq('id', copy.paper.exam_id).single();
      examName = exam?.name ?? null;
    }

    const scannerId = body.scanner_id ? String(body.scanner_id).slice(0, 120) : null;
    const now = new Date();
    const detectedAt = Number.isFinite(Date.parse(body.detected_at))
      ? new Date(body.detected_at)
      : now;

    // Deduplicate: the same token seen by the same scanner inside the window
    // is the same sighting, not a new one.
    const since = new Date(now.getTime() - DETECTION_DEDUP_SEC * 1000).toISOString();
    let dedupQuery = db
      .from('qr_detections')
      .select('*')
      .eq('qr_token', body.qr_token ?? parsed.trace)
      .gte('last_detected_at', since)
      .order('last_detected_at', { ascending: false })
      .limit(1);
    dedupQuery = scannerId ? dedupQuery.eq('scanner_id', scannerId) : dedupQuery.is('scanner_id', null);
    const { data: recent } = await dedupQuery.maybeSingle();

    if (recent) {
      const { data: updated } = await db
        .from('qr_detections')
        .update({
          detection_count: recent.detection_count + 1,
          last_detected_at: detectedAt.toISOString(),
        })
        .eq('id', recent.id)
        .select('*')
        .single();
      return res.json({
        ok: true,
        deduplicated: true,
        dedup_window_sec: DETECTION_DEDUP_SEC,
        detection: updated,
      });
    }

    // How often this exact copy has been seen before decides how loud we are.
    const { count: priorForCopy } = await db
      .from('qr_detections')
      .select('*', { count: 'exact', head: true })
      .eq('copy_id', copy.id);

    const confidence = Number.isFinite(Number(body.confidence))
      ? Math.max(0, Math.min(1, Number(body.confidence)))
      : null;

    const row = {
      copy_id: copy.id,
      paper_id: copy.paper?.id ?? copy.paper_id,
      exam_id: copy.paper?.exam_id ?? null,
      exam_name: examName,
      set_label: copy.paper?.set_label ?? null,
      trace_code: parsed.trace,
      page_number: parsed.framed ? parsed.page : 1,
      frame_number: parsed.framed ? parsed.frame : 0,
      frame_label: parsed.framed ? frameLabel(parsed.frame, parsed.legacy) : null,
      qr_token: body.qr_token ?? parsed.trace,
      detected_at: detectedAt.toISOString(),
      timezone: body.timezone ? String(body.timezone).slice(0, 64) : null,
      scanner_id: scannerId,
      device_info: body.device_info ? String(body.device_info).slice(0, 400) : null,
      ip_address: (req.ip || '').replace(/^::ffff:/, '') || null,
      user_agent: (req.get('user-agent') || '').slice(0, 400) || null,
      reported_by: req.user?.id ?? null,
      latitude: Number.isFinite(Number(body.latitude)) ? Number(body.latitude) : null,
      longitude: Number.isFinite(Number(body.longitude)) ? Number(body.longitude) : null,
      location_accuracy_m: Number.isFinite(Number(body.location_accuracy_m))
        ? Number(body.location_accuracy_m)
        : null,
      location_label: body.location_label ? String(body.location_label).slice(0, 200) : null,
      confidence,
      image_ref: body.image_ref ? String(body.image_ref).slice(0, 500) : null,
      detection_count: 1,
      first_detected_at: detectedAt.toISOString(),
      last_detected_at: detectedAt.toISOString(),
      alert_level: (priorForCopy ?? 0) > 0 ? 'warning' : 'critical',
    };

    const { data: detection, error } = await db
      .from('qr_detections')
      .insert(row)
      .select('*')
      .single();
    if (error) {
      const missing = missingColumnHint(error.message);
      if (missing) return res.status(409).json({ error: missing });
      throw error;
    }

    // Live push to every admin dashboard.
    const where = row.location_label ? ` near ${row.location_label}` : '';
    const which = !parsed.framed
      ? 'an untagged trace code'
      : parsed.legacy
        ? `page ${row.page_number}, frame ${row.frame_number} (${row.frame_label})`
        : `page ${row.page_number}, question ${row.frame_number}`;
    await db.from('alerts').insert({
      severity: row.alert_level,
      type: 'QR_WATERMARK_DETECTED',
      message: `Copy #${copy.copy_number} of "${copy.paper?.title ?? 'a paper'}" photographed — ${which}${where}`,
      paper_id: row.paper_id,
      copy_id: copy.id,
    });

    await audit(req.user?.id ?? null, 'QR_DETECTION', 'paper_copy', copy.id, {
      exam: examName,
      set: row.set_label,
      page: row.page_number,
      frame: row.frame_number,
      scanner: scannerId,
      confidence,
    });

    res.json({
      ok: true,
      deduplicated: false,
      dedup_window_sec: DETECTION_DEDUP_SEC,
      detection,
      copy: { id: copy.id, copy_number: copy.copy_number, status: copy.status },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Detection feed for the admin dashboard, newest first, with each event's
 * prior sightings of the same copy for context.
 */
app.get('/api/detections', requireRole('admin'), async (req, res, next) => {
  try {
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
    let query = db
      .from('qr_detections')
      .select('*')
      .order('detected_at', { ascending: false })
      .limit(limit);
    if (req.query.copy_id) query = query.eq('copy_id', req.query.copy_id);
    if (req.query.exam_id) query = query.eq('exam_id', req.query.exam_id);

    const { data, error } = await query;
    if (error) {
      const missing = missingColumnHint(error.message);
      if (missing) return res.status(409).json({ error: missing });
      throw error;
    }

    res.json({
      ok: true,
      dedup_window_sec: DETECTION_DEDUP_SEC,
      detections: data ?? [],
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Provision an exam center + its invigilator login account. Admin-only.
 * Creates a pre-confirmed auth user (role 'invigilator') whose email is
 * derived from the center code, so the center logs in with code + password.
 * Body: { examId, slotId, name, code, password }
 */
app.post('/api/centers', requireRole('admin'), async (req, res, next) => {
  try {
    const { examId, slotId, name, code, password, capacity } = req.body || {};
    if (!examId) return res.status(400).json({ error: 'examId is required' });
    const seats = Math.max(0, Math.min(100000, Math.trunc(Number(capacity) || 0)));
    if (!name || String(name).trim().length < 2)
      return res.status(400).json({ error: 'Center name is required' });
    if (!code || !/^[A-Za-z0-9][A-Za-z0-9 \-_/]*$/.test(String(code).trim()))
      return res.status(400).json({ error: 'Center code: letters, digits, space, - _ / only' });
    if (!password || String(password).length < 6)
      return res.status(400).json({ error: 'Center password must be at least 6 characters' });

    // Slot drives the center start time used by the reconciliation sweep.
    let startsAt = new Date().toISOString();
    if (slotId) {
      const { data: slot } = await db
        .from('exam_slots')
        .select('start_at, exam_id')
        .eq('id', slotId)
        .single();
      if (!slot) return res.status(404).json({ error: 'Slot not found' });
      startsAt = slot.start_at;
    }

    const email = centerEmail(code);
    const { data: created, error: aErr } = await db.auth.admin.createUser({
      email,
      password: String(password),
      email_confirm: true,
      user_metadata: { full_name: `${String(name).trim()} (${String(code).trim()})`, role: 'invigilator' },
    });
    if (aErr) {
      const dup = /already|registered|exists/i.test(aErr.message);
      return res.status(dup ? 409 : 400).json({
        error: dup ? `Center code "${code}" is already in use — pick another` : aErr.message,
      });
    }

    const { data: center, error: cErr } = await db
      .from('exam_centers')
      .insert({
        exam_id: examId,
        slot_id: slotId || null,
        name: String(name).trim(),
        code: String(code).trim().toUpperCase(),
        starts_at: startsAt,
        capacity: seats,
        auth_user_id: created.user.id,
        created_by: req.user.id,
      })
      .select('*')
      .single();
    if (cErr) {
      // Roll back the orphaned auth account so the code can be reused.
      await db.auth.admin.deleteUser(created.user.id).catch(() => {});
      throw cErr;
    }

    await audit(req.user.id, 'CENTER_PROVISIONED', 'exam_center', center.id, {
      name: center.name,
      code: center.code,
    });

    res.json({ ok: true, center, login: { code: center.code, email } });
  } catch (err) {
    next(err);
  }
});

/**
 * Allocate up to N as-yet-unallocated printed copies of an exam's paper(s)
 * to a center. Admin-only. Tags copies with center_id (centerwise QR set).
 * Body: { count }
 */
app.post('/api/centers/:id/allocate', requireRole('admin'), async (req, res, next) => {
  try {
    const centerId = req.params.id;
    const count = Math.max(1, Math.min(1000, parseInt(req.body?.count, 10) || 0));
    if (!count) return res.status(400).json({ error: 'count must be a number >= 1' });

    const { data: center } = await db.from('exam_centers').select('*').eq('id', centerId).single();
    if (!center) return res.status(404).json({ error: 'Center not found' });

    const { data: papers } = await db.from('papers').select('id').eq('exam_id', center.exam_id);
    const paperIds = (papers || []).map((p) => p.id);
    if (paperIds.length === 0) {
      return res.status(409).json({ error: 'No papers for this exam yet' });
    }

    const { data: copies } = await db
      .from('paper_copies')
      .select('id')
      .in('paper_id', paperIds)
      .is('center_id', null)
      .order('copy_number', { ascending: true })
      .limit(count);
    if (!copies || copies.length === 0) {
      return res.status(409).json({
        error: 'No unallocated copies available. Run a print ceremony for this exam first.',
      });
    }

    const ids = copies.map((c) => c.id);
    const { error } = await db
      .from('paper_copies')
      .update({ center_id: centerId, current_location: `${center.name} (${center.code})` })
      .in('id', ids);
    if (error) throw error;

    await audit(req.user.id, 'COPIES_ALLOCATED', 'exam_center', centerId, {
      count: ids.length,
      center: center.name,
    });

    res.json({ ok: true, allocated: ids.length, requested: count });
  } catch (err) {
    next(err);
  }
});

/**
 * Invigilator scan-in. Verifies the QR signature, then marks the copy
 * scanned (scanned_at) so it leaves the center's pending-scan set, and
 * records a hash-chained custody event. Rejects forged QRs and re-scans.
 * Body: { qr_payload } (the raw QR JSON string) or { copy_id }
 */
app.post('/api/copies/scan', requireRole('admin', 'invigilator'), async (req, res, next) => {
  try {
    const { qr_payload: qrPayload, copy_id: copyIdRaw } = req.body || {};
    let copyId = copyIdRaw;

    if (!copyId && qrPayload) {
      let parsed;
      try {
        parsed = typeof qrPayload === 'string' ? JSON.parse(qrPayload) : qrPayload;
      } catch {
        return res.status(400).json({ error: 'QR payload is not valid JSON' });
      }
      const { c, p, n, sig } = parsed || {};
      if (!c || !p || sig !== signQr(c, p, n)) {
        return res.status(400).json({ error: 'QR signature invalid — possible forged copy' });
      }
      copyId = c;
    }
    if (!copyId) return res.status(400).json({ error: 'Provide qr_payload or copy_id' });

    const { data: copy } = await db.from('paper_copies').select('*').eq('id', copyId).single();
    if (!copy) return res.status(404).json({ error: 'No copy matches this QR' });
    if (copy.scanned_at) {
      return res.status(409).json({
        error: `Copy #${copy.copy_number} was already scanned at ${new Date(copy.scanned_at).toLocaleString()}`,
      });
    }

    // An invigilator may only scan copies allocated to their own center.
    let center = null;
    if (req.profile.role === 'invigilator') {
      const { data: myCenter } = await db
        .from('exam_centers')
        .select('id, name, code')
        .eq('auth_user_id', req.user.id)
        .single();
      if (!myCenter) return res.status(403).json({ error: 'No center is linked to this login' });
      if (copy.center_id !== myCenter.id) {
        return res.status(403).json({ error: 'This copy is not allocated to your center' });
      }
      center = myCenter;
    } else if (copy.center_id) {
      const { data: c } = await db
        .from('exam_centers')
        .select('id, name, code')
        .eq('id', copy.center_id)
        .single();
      center = c ?? null;
    }

    const now = new Date().toISOString();
    const { error: uErr } = await db
      .from('paper_copies')
      .update({ scanned_at: now, scanned_by: req.user.id, status: 'delivered' })
      .eq('id', copyId);
    if (uErr) throw uErr;

    await db.from('custody_events').insert({
      copy_id: copyId,
      event_type: 'delivered',
      location: center ? `${center.name} (${center.code}) — scan-in` : 'Invigilator scan-in',
      note: 'QR verified, scanned in at center',
      actor_id: req.user.id,
    });

    // Notify the admin in real time that a copy was scanned at a center.
    await db.from('alerts').insert({
      severity: 'info',
      type: 'COPY_SCANNED',
      message: center
        ? `Copy #${copy.copy_number} scanned in at ${center.name} (${center.code})`
        : `Copy #${copy.copy_number} scanned in`,
      paper_id: copy.paper_id,
      copy_id: copyId,
    });

    await audit(req.user.id, 'COPY_SCANNED', 'paper_copy', copyId, {
      copy_number: copy.copy_number,
      center: center?.code ?? null,
    });

    res.json({ ok: true, copy_number: copy.copy_number, scanned_at: now });
  } catch (err) {
    next(err);
  }
});

/* --------------------- pre-exam reconciliation sweep ---------------------- */

/**
 * Every minute: for any center whose start time is within
 * RECONCILE_WINDOW_MIN and that hasn't been checked yet, flag unscanned
 * copies with a CRITICAL alert (streamed live to admin dashboards).
 * reconciled_at makes it fire exactly once per center.
 */
async function reconcileCenters() {
  try {
    const cutoff = new Date(Date.now() + Number(RECONCILE_WINDOW_MIN) * 60 * 1000).toISOString();
    const { data: centers } = await db
      .from('exam_centers')
      .select('*')
      .is('reconciled_at', null)
      .lte('starts_at', cutoff);

    for (const center of centers || []) {
      // Claim it first so a slow count can't cause a duplicate alert.
      await db
        .from('exam_centers')
        .update({ reconciled_at: new Date().toISOString() })
        .eq('id', center.id);

      const [{ count: unscanned }, { count: total }] = await Promise.all([
        db
          .from('paper_copies')
          .select('*', { count: 'exact', head: true })
          .eq('center_id', center.id)
          .is('scanned_at', null),
        db.from('paper_copies').select('*', { count: 'exact', head: true }).eq('center_id', center.id),
      ]);

      if ((unscanned ?? 0) > 0) {
        await db.from('alerts').insert({
          severity: 'critical',
          type: 'UNSCANNED_COPIES',
          message: `Center ${center.name} (${center.code}): ${unscanned} of ${total} copies UNSCANNED ~${RECONCILE_WINDOW_MIN} min before exam start`,
        });
        criticalAlertsTotal.inc({ type: 'UNSCANNED_COPIES' });
        await audit(null, 'RECONCILE_UNSCANNED', 'exam_center', center.id, {
          center: center.name,
          unscanned,
          total,
        });
      }
    }
  } catch (err) {
    console.error('reconcile sweep failed:', err.message);
  }
}

/* ------------------------------ AI integration ---------------------------- */

async function registerFingerprint(copyId) {
  try {
    const r = await fetch(`${AI_SERVICE_URL}/fingerprint/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ copy_id: copyId }),
      signal: AbortSignal.timeout(3000),
    });
    if (r.ok) {
      const json = await r.json();
      if (json.fingerprint_hash) return { hash: json.fingerprint_hash, method: 'ai-service' };
    }
  } catch {
    /* AI service offline — fall back so the demo still works */
  }
  return {
    hash: crypto.createHmac('sha256', SERVER_SECRET).update(`fp:${copyId}`).digest('hex'),
    method: 'local-hmac',
  };
}

/* -------------------------------- error trap ------------------------------ */

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`SecureAIExam crypto service listening on http://0.0.0.0:${PORT}`);
  console.log(`AI service expected at ${AI_SERVICE_URL}`);
  console.log(`Center reconciliation sweep every 60s (window ${RECONCILE_WINDOW_MIN} min)`);
  void checkSchema();
  void reconcileCenters();
  setInterval(reconcileCenters, 60 * 1000);
});
