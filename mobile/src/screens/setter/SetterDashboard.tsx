import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Badge, Card, ExamPicker, Screen, SectionTitle, Stat } from '../../components/UI';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { fetchExamSets } from '../../lib/api';
import { sectionProgressLabel } from '../../lib/examFormats';
import { timeAgo } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { radius, spacing, ThemeColors } from '../../lib/theme';
import { ExamSetSummary, Paper } from '../../lib/types';
import { useScheduledExams } from '../../lib/useExams';

export default function SetterDashboard() {
  const { profile } = useAuth();
  const setterId = profile?.id;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const { exams } = useScheduledExams();
  const [papers, setPapers] = useState<Paper[]>([]);
  const [poolCount, setPoolCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Per-set completion for the exam being tracked.
  const [examId, setExamId] = useState<string | null>(null);
  const [sets, setSets] = useState<ExamSetSummary[]>([]);

  const load = useCallback(async () => {
    if (!setterId) return;
    const [{ data: paperRows }, { count }] = await Promise.all([
      supabase
        .from('papers')
        .select('*')
        .eq('setter_id', setterId)
        .order('created_at', { ascending: false }),
      supabase.from('questions').select('*', { count: 'exact', head: true }),
    ]);
    setPapers((paperRows as Paper[] | null) ?? []);
    setPoolCount(count ?? 0);
  }, [setterId]);

  const loadSets = useCallback(async () => {
    if (!examId) {
      setSets([]);
      return;
    }
    try {
      const res = await fetchExamSets(examId);
      setSets(res.sets);
    } catch {
      setSets([]);
    }
  }, [examId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      void loadSets();
    }, [load, loadSets])
  );

  // Default to the first scheduled exam so the set board is never empty.
  useEffect(() => {
    if (!examId && exams.length > 0) setExamId(exams[0].id);
  }, [exams, examId]);

  // Realtime: when the Admin co-signs (or prints), the status flips live here.
  useEffect(() => {
    if (!setterId) return;
    const channel = supabase
      .channel(`papers-setter-${setterId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'papers', filter: `setter_id=eq.${setterId}` },
        () => void load()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [setterId, load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([load(), loadSets()]);
    setRefreshing(false);
  };

  const count = (status: Paper['status']) => papers.filter((p) => p.status === status).length;

  return (
    <Screen scroll refreshing={refreshing} onRefresh={() => void onRefresh()}>
      <Text style={styles.greeting}>{profile?.full_name ?? 'Paper Setter'}</Text>
      <Text style={styles.sub}>Paper composition · dual-control sealing</Text>

      <View style={styles.statsRow}>
        <Stat label="Question Bank" value={poolCount} tone={colors.info} />
        <Stat label="Drafts" value={count('draft')} />
        <Stat label="Awaiting Co-sign" value={count('sealed')} tone={colors.warning} />
        <Stat label="Dual-Sealed" value={count('sealed_dual') + count('printed')} tone={colors.success} />
      </View>

      {exams.length > 0 ? (
        <>
          <SectionTitle title="Paper sets" />
          <View style={{ marginBottom: spacing.md }}>
            <ExamPicker exams={exams} value={examId} onChange={setExamId} />
          </View>
          {sets.length === 0 ? (
            <Card>
              <Text style={styles.emptyText}>
                No paper sets configured for this exam yet — the Admin sets how many are required.
              </Text>
            </Card>
          ) : (
            sets.map((set) => {
              const started = set.status !== 'not_started';
              const tone = !started ? colors.textDim : set.ready ? colors.success : colors.warning;
              return (
                <Card key={set.label} style={[styles.setCard, { borderColor: `${tone}66` }]}>
                  <View style={styles.paperHeader}>
                    <Text style={styles.setLabel}>{set.label}</Text>
                    <Badge status={started ? set.status : 'draft'} />
                  </View>
                  {set.report.enforced ? (
                    <View style={styles.setLines}>
                      {set.report.sections.map((section) => (
                        <Text
                          key={section.name}
                          style={[
                            styles.setLine,
                            { color: section.complete ? colors.success : colors.warning },
                          ]}
                        >
                          {sectionProgressLabel(section)}
                        </Text>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.paperMeta}>
                      {set.report.totals.current} question(s) selected
                    </Text>
                  )}
                  <Text style={[styles.setStatus, { color: tone }]}>
                    Status:{' '}
                    {!started
                      ? 'NOT STARTED'
                      : set.status !== 'draft'
                        ? set.status.toUpperCase()
                        : set.ready
                          ? 'READY'
                          : 'INCOMPLETE'}
                  </Text>
                </Card>
              );
            })
          )}
        </>
      ) : null}

      <Card style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Ionicons name="key" size={18} color={colors.gold} />
          <Text style={styles.infoText}>
            When you seal a paper, you hold key share 1 of 2. The Admin's co-signature creates
            share 2. Decryption is mathematically impossible without both passphrases.
          </Text>
        </View>
      </Card>

      <SectionTitle title="My papers (live status)" />
      {papers.length === 0 ? (
        <Card>
          <Text style={styles.emptyText}>
            No papers yet. Open the Compose tab to assemble your first paper from the question
            pool.
          </Text>
        </Card>
      ) : (
        papers.slice(0, 6).map((paper) => (
          <Card key={paper.id}>
            <View style={styles.paperHeader}>
              <Text style={styles.paperTitle} numberOfLines={1}>
                {paper.title}
              </Text>
              <Badge status={paper.status} />
            </View>
            <Text style={styles.paperMeta}>
              {paper.subject} · {paper.question_count} questions · {timeAgo(paper.created_at)}
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
      backgroundColor: `${colors.gold}10`,
      borderColor: `${colors.gold}44`,
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
    paperHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: spacing.sm,
    },
    paperTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
      flex: 1,
    },
    paperMeta: {
      color: colors.textDim,
      fontSize: 12,
      marginTop: spacing.sm,
    },
    setCard: { borderWidth: 1, borderRadius: radius.lg },
    setLabel: { color: colors.text, fontSize: 16, fontWeight: '800', flex: 1 },
    setLines: { marginTop: spacing.sm, gap: 2 },
    setLine: { fontSize: 13, fontWeight: '700' },
    setStatus: { fontSize: 12, fontWeight: '800', marginTop: spacing.sm, letterSpacing: 0.5 },
  });
