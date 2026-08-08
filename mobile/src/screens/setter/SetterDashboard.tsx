import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Badge, Card, Screen, SectionTitle, Stat } from '../../components/UI';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { timeAgo } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { spacing, ThemeColors } from '../../lib/theme';
import { Paper } from '../../lib/types';

export default function SetterDashboard() {
  const { profile } = useAuth();
  const setterId = profile?.id;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [papers, setPapers] = useState<Paper[]>([]);
  const [poolCount, setPoolCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!setterId) return;
    const [{ data: paperRows }, { count }] = await Promise.all([
      supabase
        .from('papers')
        .select('*')
        .eq('setter_id', setterId)
        .order('created_at', { ascending: false }),
      supabase
        .from('questions')
        .select('*', { count: 'exact', head: true })
        .in('status', ['submitted', 'approved']),
    ]);
    setPapers((paperRows as Paper[] | null) ?? []);
    setPoolCount(count ?? 0);
  }, [setterId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

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
    await load();
    setRefreshing(false);
  };

  const count = (status: Paper['status']) => papers.filter((p) => p.status === status).length;

  return (
    <Screen scroll refreshing={refreshing} onRefresh={() => void onRefresh()}>
      <Text style={styles.greeting}>{profile?.full_name ?? 'Paper Setter'}</Text>
      <Text style={styles.sub}>Paper composition · dual-control sealing</Text>

      <View style={styles.statsRow}>
        <Stat label="Question Pool" value={poolCount} tone={colors.info} />
        <Stat label="Drafts" value={count('draft')} />
        <Stat label="Awaiting Co-sign" value={count('sealed')} tone={colors.warning} />
        <Stat label="Dual-Sealed" value={count('sealed_dual') + count('printed')} tone={colors.success} />
      </View>

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
  });
