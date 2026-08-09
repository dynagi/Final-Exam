import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import {
  Badge,
  Button,
  Card,
  Chips,
  EmptyState,
  ExamPicker,
  Pagination,
  Screen,
} from '../../components/UI';
import { useTheme } from '../../context/ThemeContext';
import { showAlert } from '../../lib/alert';
import { fetchAll } from '../../lib/db';
import { timeAgo } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { labelFor, spacing, ThemeColors } from '../../lib/theme';
import { Question, QuestionStatus } from '../../lib/types';
import { useScheduledExams } from '../../lib/useExams';
import { usePagination } from '../../lib/usePagination';

type PoolQuestion = Question & { teacher?: { full_name: string } | null };

const TYPE_FILTERS = ['All types', 'MCQ', 'MSQ', 'Numerical', 'Theory'] as const;
const FILTER_TYPE: Record<string, Question['question_type']> = {
  MCQ: 'mcq',
  MSQ: 'msq',
  Numerical: 'numerical',
  Theory: 'theoretical',
};

const STATUS_FILTERS = ['All', 'Pending approval', 'Approved', 'Used in a paper'] as const;
const FILTER_STATUS: Record<string, QuestionStatus> = {
  'Pending approval': 'submitted',
  Approved: 'approved',
  'Used in a paper': 'used',
};

export default function QuestionPoolScreen() {
  const { exams } = useScheduledExams();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [questions, setQuestions] = useState<PoolQuestion[]>([]);
  const [examId, setExamId] = useState<string | null>(null);
  const [subjectFilter, setSubjectFilter] = useState('All');
  const [teacherFilter, setTeacherFilter] = useState('All teachers');
  const [typeFilter, setTypeFilter] = useState<string>('All types');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * The whole bank, paged. A single request would silently stop at
   * PostgREST's max-rows and the setter would approve from a truncated list
   * without ever being told.
   */
  const load = useCallback(async () => {
    const { rows, error } = await fetchAll<PoolQuestion>(() =>
      supabase
        .from('questions')
        .select('*, teacher:profiles(full_name), exam:exams(name)')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
    );
    setQuestions(rows);
    setLoadError(error ? error.message : null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // Realtime: new teacher uploads land in the pool instantly.
  useEffect(() => {
    const channel = supabase
      .channel('questions-pool')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'questions' },
        () => void load()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const approve = async (question: PoolQuestion) => {
    const { error } = await supabase
      .from('questions')
      .update({ status: 'approved' })
      .eq('id', question.id);
    if (error) {
      showAlert('Failed', error.message);
      return;
    }
    setQuestions((prev) =>
      prev.map((q) => (q.id === question.id ? { ...q, status: 'approved' } : q))
    );
  };

  /** Everything for the chosen exam — the base every other filter narrows. */
  const examScoped = useMemo(
    () => questions.filter((q) => (examId ? q.exam_id === examId : true)),
    [questions, examId]
  );

  // Subjects and teachers are derived from the questions that actually exist
  // for this exam — no hardcoded lists.
  const subjectFilters = useMemo(
    () => ['All', ...Array.from(new Set(examScoped.map((q) => q.subject))).sort()],
    [examScoped]
  );
  const teacherFilters = useMemo(
    () => [
      'All teachers',
      ...Array.from(new Set(examScoped.map((q) => q.teacher?.full_name ?? 'Unknown'))).sort(),
    ],
    [examScoped]
  );

  /**
   * Switching exams used to leave a subject or teacher chip selected that the
   * new exam has no questions for, collapsing the list to nothing with no
   * explanation. Drop any selection the current exam cannot satisfy.
   */
  useEffect(() => {
    if (subjectFilter !== 'All' && !subjectFilters.includes(subjectFilter)) setSubjectFilter('All');
    if (teacherFilter !== 'All teachers' && !teacherFilters.includes(teacherFilter)) {
      setTeacherFilter('All teachers');
    }
  }, [subjectFilters, teacherFilters, subjectFilter, teacherFilter]);

  const visible = examScoped
    .filter((q) => subjectFilter === 'All' || q.subject === subjectFilter)
    .filter(
      (q) => teacherFilter === 'All teachers' || (q.teacher?.full_name ?? 'Unknown') === teacherFilter
    )
    .filter((q) => typeFilter === 'All types' || q.question_type === FILTER_TYPE[typeFilter])
    .filter((q) => statusFilter === 'All' || q.status === FILTER_STATUS[statusFilter]);

  const pendingCount = visible.filter((q) => q.status === 'submitted').length;
  const anyFilter =
    !!examId ||
    subjectFilter !== 'All' ||
    teacherFilter !== 'All teachers' ||
    typeFilter !== 'All types' ||
    statusFilter !== 'All';

  const clearFilters = () => {
    setExamId(null);
    setSubjectFilter('All');
    setTeacherFilter('All teachers');
    setTypeFilter('All types');
    setStatusFilter('All');
  };

  // Page the filtered list. Approving a question mutates it in place, so the
  // current page stays put instead of jumping back to the top.
  const pager = usePagination(visible, 25);

  return (
    <Screen>
      <View style={styles.filterWrap}>
        <ExamPicker exams={exams} value={examId} onChange={setExamId} allowAll />
      </View>
      <View style={styles.filterWrap}>
        <Chips options={subjectFilters} value={subjectFilter} onChange={setSubjectFilter} />
      </View>
      <View style={styles.filterWrap}>
        <Chips options={teacherFilters} value={teacherFilter} onChange={setTeacherFilter} />
      </View>
      <View style={styles.filterWrap}>
        <Chips options={TYPE_FILTERS} value={typeFilter} onChange={setTypeFilter} />
      </View>
      <View style={styles.filterWrap}>
        <Chips options={STATUS_FILTERS} value={statusFilter} onChange={setStatusFilter} />
      </View>

      {loadError ? (
        <Text style={styles.error}>Could not load the bank: {loadError}</Text>
      ) : (
        <View style={styles.countRow}>
          <Text style={styles.count}>
            Showing {visible.length} of {examScoped.length}
            {examId ? ' in this exam' : ''}
            {questions.length !== examScoped.length ? ` · ${questions.length} in the bank` : ''}
            {pendingCount > 0 ? ` · ${pendingCount} awaiting approval` : ''}
          </Text>
          {anyFilter ? (
            <Pressable onPress={clearFilters} hitSlop={8}>
              <Text style={styles.clear}>Clear filters</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      <Pagination
        page={pager.page}
        pageCount={pager.pageCount}
        from={pager.from}
        to={pager.to}
        total={pager.total}
        pageSize={pager.pageSize}
        onPage={pager.setPage}
        onPageSize={pager.setPageSize}
      />

      <FlatList
        data={pager.pageItems}
        keyExtractor={(item) => item.id}
        // A page is small, but never clip mounted rows — the whole point is
        // that every question on the page is actually on screen.
        initialNumToRender={25}
        maxToRenderPerBatch={25}
        windowSize={21}
        removeClippedSubviews={false}
        contentContainerStyle={styles.listContent}
        ListFooterComponent={
          pager.pageCount > 1 ? (
            <Pagination
              page={pager.page}
              pageCount={pager.pageCount}
              from={pager.from}
              to={pager.to}
              total={pager.total}
              pageSize={pager.pageSize}
              onPage={pager.setPage}
            />
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={colors.text}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon="library-outline"
            title={questions.length === 0 ? 'Pool is empty' : 'Nothing matches these filters'}
            subtitle={
              questions.length === 0
                ? examId
                  ? "No questions submitted for this exam yet — teachers' uploads appear here in real time."
                  : 'Questions uploaded by teachers appear here in real time.'
                : `${questions.length} question(s) are in the bank — clear the exam, subject, type or status filter above to see them.`
            }
          />
        }
        renderItem={({ item }) => (
          <Card>
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <Badge status={item.status} />
                <View style={styles.typePill}>
                  <Text style={styles.typePillText}>{labelFor(item.question_type)}</Text>
                </View>
              </View>
              <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
            </View>
            <Text style={styles.body}>{item.body}</Text>
            <Text style={styles.meta}>
              {item.exam?.name ? `${item.exam.name} · ` : ''}
              {item.section_name ? `${item.section_name} · ` : ''}
              {item.subject} · {item.difficulty} · {item.marks} mk · by{' '}
              {item.teacher?.full_name ?? 'Unknown'}
            </Text>
            {item.status === 'submitted' && (
              <Button
                title="Approve for papers"
                variant="ghost"
                icon="checkmark-circle-outline"
                onPress={() => void approve(item)}
                style={styles.approveBtn}
              />
            )}
          </Card>
        )}
      />
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    filterWrap: {
      marginBottom: spacing.sm,
    },
    countRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    count: {
      color: colors.textDim,
      fontSize: 12,
      fontWeight: '700',
      flex: 1,
    },
    clear: { color: colors.primary, fontSize: 12, fontWeight: '800' },
    error: {
      color: colors.danger,
      fontSize: 12,
      fontWeight: '700',
      marginBottom: spacing.sm,
    },
    listContent: { paddingBottom: spacing.xl },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.sm,
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    typePill: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    typePillText: {
      color: colors.textDim,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.4,
    },
    time: {
      color: colors.textDim,
      fontSize: 12,
    },
    body: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
    },
    meta: {
      color: colors.accent,
      fontSize: 12,
      marginTop: spacing.sm,
    },
    approveBtn: {
      marginTop: spacing.md,
    },
  });
