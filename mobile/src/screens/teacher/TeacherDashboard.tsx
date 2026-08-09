import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Badge, Card, Screen, SectionTitle, Stat } from '../../components/UI';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { fetchAll } from '../../lib/db';
import { timeAgo } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { labelFor, spacing, ThemeColors } from '../../lib/theme';
import { Question } from '../../lib/types';

export default function TeacherDashboard() {
  const { profile } = useAuth();
  const teacherId = profile?.id;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [questions, setQuestions] = useState<Question[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!teacherId) return;
    const { rows } = await fetchAll<Question>(() =>
      supabase
        .from('questions')
        .select('*')
        .eq('teacher_id', teacherId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
    );
    setQuestions(rows);
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

  const count = (status: Question['status']) =>
    questions.filter((q) => q.status === status).length;
  const mcqCount = questions.filter((q) => q.question_type === 'mcq').length;
  const theoryCount = questions.length - mcqCount;

  return (
    <Screen scroll refreshing={refreshing} onRefresh={() => void onRefresh()}>
      <Text style={styles.greeting}>Namaste, {profile?.full_name ?? 'Teacher'} 👋</Text>
      <Text style={styles.sub}>Your contributions to the secure question bank</Text>

      <View style={styles.statsRow}>
        <Stat label="Total" value={questions.length} />
        <Stat label="MCQ" value={mcqCount} tone={colors.info} />
        <Stat label="Theory" value={theoryCount} tone={colors.violet} />
        <Stat label="In Papers" value={count('used')} tone={colors.gold} />
      </View>

      <Card style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Ionicons name="lock-closed" size={18} color={colors.primary} />
          <Text style={styles.infoText}>
            Once a Paper Setter uses your question, it is sealed inside an encrypted paper that
            no single person — not even an admin — can open alone.
          </Text>
        </View>
      </Card>

      <SectionTitle title="Recent questions" />
      {questions.length === 0 ? (
        <Card>
          <Text style={styles.emptyText}>
            No questions yet. Use the Upload tab to type questions or import a PDF.
          </Text>
        </Card>
      ) : (
        questions.slice(0, 5).map((q) => (
          <Card key={q.id}>
            <View style={styles.qHeader}>
              <View style={styles.qHeaderLeft}>
                <Badge status={q.status} />
                <View style={styles.typePill}>
                  <Text style={styles.typePillText}>{labelFor(q.question_type)}</Text>
                </View>
              </View>
              <Text style={styles.qTime}>{timeAgo(q.created_at)}</Text>
            </View>
            <Text style={styles.qBody} numberOfLines={2}>
              {q.body}
            </Text>
            <Text style={styles.qMeta}>
              {q.subject} · {q.difficulty} · {q.marks} mark{q.marks === 1 ? '' : 's'}
            </Text>
          </Card>
        ))
      )}
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    greeting: {
      color: colors.text,
      fontSize: 22,
      fontWeight: '800',
    },
    sub: {
      color: colors.textDim,
      fontSize: 13,
      marginTop: 2,
      marginBottom: spacing.lg,
    },
    statsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    infoCard: {
      backgroundColor: colors.primarySoft,
      borderColor: `${colors.primary}44`,
    },
    infoRow: {
      flexDirection: 'row',
      gap: spacing.md,
      alignItems: 'flex-start',
    },
    infoText: {
      color: colors.textDim,
      fontSize: 13,
      lineHeight: 19,
      flex: 1,
    },
    emptyText: {
      color: colors.textDim,
      fontSize: 14,
      lineHeight: 20,
    },
    qHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.sm,
    },
    qHeaderLeft: {
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
    qTime: {
      color: colors.textDim,
      fontSize: 12,
    },
    qBody: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
    },
    qMeta: {
      color: colors.textDim,
      fontSize: 12,
      marginTop: spacing.sm,
    },
  });
