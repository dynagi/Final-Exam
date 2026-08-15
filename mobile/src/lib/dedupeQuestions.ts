import { Question } from './types';

/** Collapse whitespace/case so near-identical retyped text still matches. */
function normalizeBody(body: string): string {
  return body.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Two teachers assigned to the same subject can independently submit the
 * same question. Both rows are kept in the bank (each teacher's own
 * submission counts against their own quota), but the paper setter should
 * only ever see it once when browsing or composing — never as two entries
 * to approve or pick from separately.
 *
 * Duplicates are matched on (exam, subject, section, type, marks, body text)
 * and collapsed to one representative: prefer an already-approved copy, then
 * the earliest submitted, so approving one teacher's copy doesn't get
 * shadowed by a later duplicate.
 */
export function dedupeQuestions<T extends Question>(questions: T[]): T[] {
  const bySlot = new Map<string, T>();
  const order: string[] = [];

  for (const q of questions) {
    const key = [
      q.exam_id ?? '',
      q.subject,
      q.section_name ?? '',
      q.question_type,
      q.marks,
      normalizeBody(q.body),
    ].join('|');

    const existing = bySlot.get(key);
    if (!existing) {
      bySlot.set(key, q);
      order.push(key);
      continue;
    }
    const existingApproved = existing.status === 'approved' || existing.status === 'used';
    const candidateApproved = q.status === 'approved' || q.status === 'used';
    if (candidateApproved && !existingApproved) {
      bySlot.set(key, q);
    } else if (candidateApproved === existingApproved && q.created_at < existing.created_at) {
      bySlot.set(key, q);
    }
  }

  return order.map((key) => bySlot.get(key) as T);
}
