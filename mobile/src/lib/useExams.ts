import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from './supabase';
import { Exam } from './types';

/**
 * Scheduled exams, kept fresh via realtime — drives the exam pickers on
 * the teacher upload, setter pool and compose screens.
 *
 * A paper setter only sees exams in one of their granted domains (their
 * exam-category assignment, see setter_domains / patch-10-setter-domains.sql)
 * — an exam scheduled in a category they don't hold never appears here, on
 * top of the same rule being enforced again server-side at POST /api/papers.
 * Every other role sees every scheduled exam, unfiltered.
 */
export function useScheduledExams() {
  const { profile } = useAuth();
  const [exams, setExams] = useState<Exam[]>([]);
  // Unique channel topic per mounted screen (tabs stay mounted together).
  const topic = useRef(`exams-${Math.random().toString(36).slice(2)}`);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('exams')
      .select('*')
      .eq('status', 'scheduled')
      .order('exam_date', { ascending: true });
    let rows = (data as Exam[] | null) ?? [];

    if (profile?.role === 'paper_setter') {
      const { data: domainRows } = await supabase
        .from('setter_domains')
        .select('subject')
        .eq('setter_id', profile.id);
      const allowed = new Set((domainRows ?? []).map((r) => r.subject));
      // No category (a custom/unenforced format) is left visible — there is
      // nothing to check the setter's domains against.
      rows = rows.filter((e) => !e.format_blueprint?.category || allowed.has(e.format_blueprint.category));
    }

    setExams(rows);
  }, [profile?.id, profile?.role]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(topic.current)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exams' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'setter_domains' }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  return { exams, reload: load };
}
