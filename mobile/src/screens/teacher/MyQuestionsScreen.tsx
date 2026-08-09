import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Badge, Button, Card, EmptyState, Pagination, Screen } from '../../components/UI';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { showAlert } from '../../lib/alert';
import { fetchAll } from '../../lib/db';
import { timeAgo } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { labelFor, spacing, ThemeColors } from '../../lib/theme';
import { Question } from '../../lib/types';
import { usePagination } from '../../lib/usePagination';

export default function MyQuestionsScreen() {
  const { profile } = useAuth();
  const teacherId = profile?.id;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [questions, setQuestions] = useState<Question[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!teacherId) return;
    // Paged: a prolific teacher's bank can run past PostgREST's max-rows.
    const { rows, error } = await fetchAll<Question>(() =>
      supabase
        .from('questions')
        .select('*, exam:exams(name)')
        .eq('teacher_id', teacherId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
    );
    setQuestions(rows);
    setLoadError(error ? error.message : null);
  }, [teacherId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  /**
   * Withdraw a question that is not yet sealed into a paper. Sections are
   * capped at exactly what the exam format requires, so a full section can
   * only be changed by taking a question back out first.
   */
  const withdraw = async (question: Question) => {
    const { error } = await supabase.from('questions').delete().eq('id', question.id);
    if (error) {
      showAlert('Could not withdraw', error.message);
      return;
    }
    setQuestions((prev) => prev.filter((q) => q.id !== question.id));
  };

  const pager = usePagination(questions, 25);

  return (
    <Screen>
      {loadError ? (
        <Text style={styles.error}>Could not load your questions: {loadError}</Text>
      ) : questions.length > 0 ? (
        <Text style={styles.count}>
          {questions.length} question{questions.length === 1 ? '' : 's'} in the bank
        </Text>
      ) : null}

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
            icon="document-text-outline"
            title="No questions yet"
            subtitle="Questions you type or import from a PDF appear here with their lifecycle status."
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
                {item.source === 'pdf' ? (
                  <View style={styles.typePill}>
                    <Text style={styles.typePillText}>PDF</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
            </View>
            <Text style={styles.body}>{item.body}</Text>
            {item.question_type === 'mcq' || item.question_type === 'msq' ? (
              item.options.map((option, index) => {
                const isKey =
                  item.question_type === 'mcq'
                    ? index === item.correct_index
                    : (item.correct_indices ?? []).includes(index);
                return (
                  <Text key={index} style={[styles.option, isKey && styles.correctOption]}>
                    {String.fromCharCode(65 + index)}. {option}
                    {isKey ? '  ✓' : ''}
                  </Text>
                );
              })
            ) : item.question_type === 'numerical' ? (
              <Text style={styles.option}>Answer: {item.answer_numeric ?? '—'}</Text>
            ) : (
              <Text style={styles.theoryHint}>Theory question · model answer set offline</Text>
            )}
            <Text style={styles.meta}>
              {item.exam?.name ? `${item.exam.name} · ` : ''}
              {item.section_name ? `${item.section_name} · ` : ''}
              {item.subject}
              {item.topic ? ` · ${item.topic}` : ''} · {item.difficulty} · {item.marks} mark
              {item.marks === 1 ? '' : 's'}
            </Text>
            {item.status !== 'used' ? (
              <Button
                title="Withdraw from bank"
                variant="ghost"
                icon="trash-outline"
                onPress={() => void withdraw(item)}
                style={{ marginTop: spacing.md }}
              />
            ) : null}
          </Card>
        )}
      />
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    count: { color: colors.textDim, fontSize: 12, fontWeight: '700', marginBottom: spacing.sm },
    error: { color: colors.danger, fontSize: 12, fontWeight: '700', marginBottom: spacing.sm },
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
      marginBottom: spacing.sm,
    },
    option: {
      color: colors.textDim,
      fontSize: 13,
      lineHeight: 20,
    },
    correctOption: {
      color: colors.success,
      fontWeight: '600',
    },
    theoryHint: {
      color: colors.textFaint,
      fontSize: 12,
      fontStyle: 'italic',
    },
    meta: {
      color: colors.textDim,
      fontSize: 12,
      marginTop: spacing.sm,
      opacity: 0.85,
    },
  });
