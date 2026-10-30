import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { Exam } from './types';

/**
 * Scheduled exams, kept fresh via realtime — drives the exam pickers on
 * the teacher upload, setter pool and compose screens.
 *
 * Which rows come back is enforced by Postgres RLS ("scoped read exams",
 * patch-12-scope-exam-reads.sql), not client-side filtering: an admin sees
 * every exam, a teacher only exams an Admin assigned them to (teacher_
 * subjects), and a paper setter only exams in one of their granted domains
 * (setter_domains) — the same rule POST /api/papers enforces again at write
 * time.
 */
export function useScheduledExams() {
  const [exams, setExams] = useState<Exam[]>([]);
  // Unique channel topic per mounted screen (tabs stay mounted together).
  const topic = useRef(`exams-${Math.random().toString(36).slice(2)}`);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('exams')
      .select('*')
      .eq('status', 'scheduled')
      .order('exam_date', { ascending: true });
    setExams((data as Exam[] | null) ?? []);
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(topic.current)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exams' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'setter_domains' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teacher_subjects' }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  return { exams, reload: load };
}
