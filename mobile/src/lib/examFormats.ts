/**
 * Client-side view of the examination format catalogue.
 *
 * The catalogue itself lives on the Node service (server/src/examFormats.js)
 * and is the single source of truth — this module only fetches it, caches it
 * for the session, and mirrors the composition validator so progress
 * indicators can update as fast as the setter taps. Every gate that actually
 * matters (adding a question, creating a draft, confirming a preview,
 * sealing) is re-checked on the backend, so a stale or tampered client can
 * never produce a paper that breaks the format.
 */
import { fetchExamFormat, fetchExamFormats } from './api';
import { QuestionType } from './types';

export interface FormatRequirement {
  /** e.g. "20 MCQ" or "22–26 MCQ" or "5 × 1-mark questions". */
  display_label: string;
  types: QuestionType[];
  /** Exact requirement, or null when the format publishes a range. */
  count: number | null;
  min: number;
  max: number;
  marks_correct: number;
  /** A number, or a per-type map when the penalty depends on the type used. */
  negative_marks: number | Record<string, number>;
  unattempted_marks: number;
}

export interface FormatSection {
  name: string;
  subject: string;
  /** Present when one section covers several subjects (e.g. AFCAT). */
  subjects?: string[];
  requirements: FormatRequirement[];
  free_form?: boolean;
}

export interface ResolvedFormat {
  code: string;
  name: string;
  display_name: string;
  body: string;
  category: string;
  mode: string;
  source_url: string | null;
  /** false = the reference leaves this pattern to the yearly brochure. */
  enforced: boolean;
  year: number;
  /** The year's pattern is carried forward, not officially published yet. */
  provisional: boolean;
  duration_minutes: number | null;
  notes: string[];
  total_questions: number | null;
  sections: FormatSection[];
  totals: {
    questions_min: number;
    questions_max: number;
    questions: number | null;
    marks_min: number;
    marks_max: number;
    marks: number | null;
  };
  subjects: string[];
}

export interface FormatSummary {
  code: string;
  year: number;
  display_name: string;
  name: string;
  body: string;
  category: string;
  mode: string;
  enforced: boolean;
  provisional: boolean;
  duration_minutes: number | null;
  total_questions: number | null;
  total_marks: number | null;
  section_count: number;
  subjects: string[];
}

export type RequirementStatus = 'ok' | 'short' | 'empty' | 'over';

export interface RequirementReport {
  label: string;
  types: QuestionType[];
  count: number | null;
  min: number;
  max: number;
  current: number;
  status: RequirementStatus;
  marks_correct: number;
  negative_marks: number | Record<string, number>;
  unattempted_marks: number;
}

export interface SectionReport {
  name: string;
  subject: string;
  subjects: string[];
  requirements: RequirementReport[];
  current: number;
  required_min: number;
  required_max: number;
  /** Fixed requirement when min === max, else null (ranged sections). */
  required: number | null;
  marks: number;
  complete: boolean;
  over: boolean;
}

export interface CompositionReport {
  enforced: boolean;
  ok: boolean;
  sections: SectionReport[];
  totals: {
    current: number;
    required: number | null;
    required_min?: number;
    required_max?: number;
    marks_current: number;
    marks_required: number | null;
  };
  errors: string[];
  warnings: string[];
}

/** A question as the validator needs to see it. */
export interface CompositionInput {
  id: string;
  section_name: string | null;
  question_type: QuestionType;
  marks: number;
}

export const TYPE_LABEL: Record<QuestionType, string> = {
  mcq: 'MCQ',
  msq: 'MSQ (multiple correct)',
  numerical: 'Numerical value',
  theoretical: 'Subjective / descriptive',
};

export const TYPE_SHORT: Record<QuestionType, string> = {
  mcq: 'MCQ',
  msq: 'MSQ',
  numerical: 'Numerical',
  theoretical: 'Subjective',
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Marks lost for a wrong answer of `type` under this requirement. */
export function negativeFor(
  negative: number | Record<string, number>,
  type: QuestionType
): number {
  if (negative && typeof negative === 'object') {
    return Number(negative[type] ?? negative.default ?? 0);
  }
  return Number(negative || 0);
}

/** "+4 / −1" style summary for a requirement. */
export function markingSummary(requirement: {
  marks_correct: number;
  negative_marks: number | Record<string, number>;
  types: QuestionType[];
}): string {
  const penalties = Array.from(
    new Set(requirement.types.map((t) => round2(negativeFor(requirement.negative_marks, t))))
  );
  const neg = penalties.every((p) => p === 0)
    ? 'no negative'
    : penalties.map((p) => (p === 0 ? '0' : `−${p}`)).join(' / ');
  return `+${requirement.marks_correct} · ${neg}`;
}

/* ------------------------------ catalogue cache ---------------------------- */

let summaryCache: FormatSummary[] | null = null;
const resolvedCache = new Map<string, ResolvedFormat>();

/** Every (format, year) pair, fetched once per app session. */
export async function loadFormatCatalogue(force = false): Promise<FormatSummary[]> {
  if (summaryCache && !force) return summaryCache;
  const res = await fetchExamFormats();
  summaryCache = res.formats;
  return summaryCache;
}

/** One resolved blueprint, cached by code+year. */
export async function loadFormat(code: string, year: number): Promise<ResolvedFormat> {
  const key = `${code}:${year}`;
  const hit = resolvedCache.get(key);
  if (hit) return hit;
  const res = await fetchExamFormat(code, year);
  resolvedCache.set(key, res.format);
  return res.format;
}

/* -------------------------------- validation ------------------------------- */

/**
 * UI mirror of validateComposition() in server/src/examFormats.js. Keep the
 * two in step: the backend is what decides, this only decides what to draw.
 */
export function validateComposition(
  format: ResolvedFormat | null,
  questions: CompositionInput[]
): CompositionReport {
  const marksOf = (list: CompositionInput[]) =>
    round2(list.reduce((n, q) => n + (Number(q.marks) || 0), 0));

  if (!format || !format.enforced) {
    return {
      enforced: false,
      ok: questions.length > 0,
      sections: [],
      totals: {
        current: questions.length,
        required: null,
        marks_current: marksOf(questions),
        marks_required: null,
      },
      errors: questions.length === 0 ? ['A paper must contain at least one question.'] : [],
      warnings: format
        ? ['This format has no enforced question quota — the composition is not checked against a blueprint.']
        : [],
    };
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  for (const q of questions) {
    if (!format.sections.some((s) => s.name === (q.section_name ?? ''))) {
      errors.push(
        `A question is tagged with section "${q.section_name || '(none)'}", which does not exist in ${format.display_name}.`
      );
    }
  }

  const sections: SectionReport[] = format.sections.map((section) => {
    const pool = questions.filter((q) => (q.section_name ?? '') === section.name);
    const claimed = new Set<string>();

    const requirements: RequirementReport[] = section.requirements.map((r) => {
      const matches = pool.filter(
        (q) =>
          !claimed.has(q.id) &&
          r.types.includes(q.question_type) &&
          Number(q.marks) === Number(r.marks_correct)
      );
      for (const q of matches) claimed.add(q.id);
      const current = matches.length;
      const status: RequirementStatus =
        current === 0 && r.min > 0
          ? 'empty'
          : current < r.min
            ? 'short'
            : current > r.max
              ? 'over'
              : 'ok';
      if (status === 'over') {
        errors.push(
          `${section.name}: ${r.display_label} — the format allows at most ${r.max}, but ${current} are attached.`
        );
      } else if (status !== 'ok') {
        errors.push(
          `${section.name} requires ${r.display_label} at ${r.marks_correct} mark${r.marks_correct === 1 ? '' : 's'} each. You currently have ${current}.`
        );
      }
      return {
        label: r.display_label,
        types: r.types,
        count: r.count,
        min: r.min,
        max: r.max,
        current,
        status,
        marks_correct: r.marks_correct,
        negative_marks: r.negative_marks,
        unattempted_marks: r.unattempted_marks,
      };
    });

    const strays = pool.filter((q) => !claimed.has(q.id));
    for (const q of strays) {
      errors.push(
        `${section.name}: a ${TYPE_SHORT[q.question_type] ?? q.question_type} worth ${q.marks} mark(s) does not fit any quota this section defines.`
      );
    }

    const requiredMin = requirements.reduce((n, r) => n + r.min, 0);
    const requiredMax = requirements.reduce((n, r) => n + r.max, 0);
    return {
      name: section.name,
      subject: section.subject,
      subjects: section.subjects ?? [section.subject],
      requirements,
      current: pool.length,
      required_min: requiredMin,
      required_max: requiredMax,
      required: requiredMin === requiredMax ? requiredMin : null,
      marks: marksOf(pool),
      complete: requirements.every((r) => r.status === 'ok') && strays.length === 0,
      over: pool.length > requiredMax,
    };
  });

  const fixedTotal = format.total_questions ?? format.totals.questions;
  if (fixedTotal != null && questions.length !== fixedTotal) {
    errors.push(
      `${format.display_name} is a ${fixedTotal}-question paper. You currently have ${questions.length}.`
    );
  }
  if (format.provisional) {
    warnings.push(
      `The ${format.year} pattern is carried forward from ${format.year - 1} and is not yet confirmed by an official notification.`
    );
  }

  return {
    enforced: true,
    ok: errors.length === 0 && sections.every((s) => s.complete),
    sections,
    totals: {
      current: questions.length,
      required: fixedTotal,
      required_min: format.totals.questions_min,
      required_max: format.totals.questions_max,
      marks_current: marksOf(questions),
      marks_required: format.totals.marks,
    },
    errors,
    warnings,
  };
}

/** `Physics 18/20 ⚠` — the compact progress label used across the app. */
export function sectionProgressLabel(section: SectionReport): string {
  const target =
    section.required != null ? `${section.required}` : `${section.required_min}–${section.required_max}`;
  return `${section.name} ${section.current}/${target} ${section.complete ? '✓' : '⚠'}`;
}

/** The human explanation shown under an incomplete section. */
export function sectionWarning(section: SectionReport): string | null {
  if (section.complete) return null;
  const over = section.requirements.find((r) => r.status === 'over');
  if (over) {
    return `${section.name} allows at most ${over.max} × ${over.label}. You currently have ${over.current}.`;
  }
  const short = section.requirements.find((r) => r.status === 'short' || r.status === 'empty');
  if (short) {
    const need = short.min === short.max ? `${short.min}` : `${short.min}–${short.max}`;
    return `${section.name} requires ${need} × ${short.label}. You currently have ${short.current}.`;
  }
  const claimed = section.requirements.reduce((n, r) => n + r.current, 0);
  if (section.current > claimed) {
    return `${section.name} holds ${section.current - claimed} question(s) that fit none of its quotas.`;
  }
  return `${section.name} does not yet satisfy the format.`;
}

/**
 * Sections a teacher may write for: the format's sections, narrowed to the
 * subjects they are assigned when an assignment exists.
 */
export function sectionsForTeacher(
  format: ResolvedFormat | null,
  assignedSubjects: string[] | null
): FormatSection[] {
  if (!format) return [];
  if (!assignedSubjects || assignedSubjects.length === 0) return format.sections;
  return format.sections.filter((s) =>
    (s.subjects ?? [s.subject]).some((subject) => assignedSubjects.includes(subject))
  );
}
