import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Badge, Card, Screen, SectionTitle, Stat } from '../../components/UI';
import { useTheme } from '../../context/ThemeContext';
import { timeAgo } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { spacing, ThemeColors } from '../../lib/theme';
import { AlertRow } from '../../lib/types';

export default function AdminDashboard() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [stats, setStats] = useState({ awaiting: 0, ready: 0, copies: 0, openAlerts: 0 });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [alertRows, awaiting, ready, copies, openAlerts] = await Promise.all([
      supabase.from('alerts').select('*').order('created_at', { ascending: false }).limit(15),
      supabase.from('papers').select('*', { count: 'exact', head: true }).eq('status', 'sealed'),
      supabase.from('papers').select('*', { count: 'exact', head: true }).eq('status', 'sealed_dual'),
      supabase.from('paper_copies').select('*', { count: 'exact', head: true }),
      supabase.from('alerts').select('*', { count: 'exact', head: true }).eq('acknowledged', false),
    ]);
    setAlerts((alertRows.data as AlertRow[] | null) ?? []);
    setStats({
      awaiting: awaiting.count ?? 0,
      ready: ready.count ?? 0,
      copies: copies.count ?? 0,
      openAlerts: openAlerts.count ?? 0,
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // Realtime: critical alerts (missing/leaked copies) appear the moment they fire.
  useEffect(() => {
    const channel = supabase
      .channel('alerts-admin')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'alerts' },
        (payload) => {
          setAlerts((prev) => [payload.new as AlertRow, ...prev].slice(0, 30));
          setStats((prev) => ({ ...prev, openAlerts: prev.openAlerts + 1 }));
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const acknowledge = async (alert: AlertRow) => {
    await supabase.from('alerts').update({ acknowledged: true }).eq('id', alert.id);
    setAlerts((prev) =>
      prev.map((a) => (a.id === alert.id ? { ...a, acknowledged: true } : a))
    );
    setStats((prev) => ({ ...prev, openAlerts: Math.max(0, prev.openAlerts - 1) }));
  };

  return (
    <Screen scroll refreshing={refreshing} onRefresh={() => void onRefresh()}>
      <Text style={styles.title}>National Exam Security</Text>
      <Text style={styles.sub}>Live operational picture · updates in real time</Text>

      <View style={styles.statsRow}>
        <Stat label="Awaiting Co-sign" value={stats.awaiting} tone={colors.warning} />
        <Stat label="Dual-Sealed" value={stats.ready} tone={colors.info} />
        <Stat label="Copies Tracked" value={stats.copies} tone={colors.primary} />
        <Stat
          label="Open Alerts"
          value={stats.openAlerts}
          tone={stats.openAlerts > 0 ? colors.danger : colors.success}
        />
      </View>

      <SectionTitle
        title="Live alert feed"
        right={<Ionicons name="pulse" size={18} color={colors.success} />}
      />

      {alerts.length === 0 ? (
        <Card>
          <View style={styles.allClear}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            <Text style={styles.allClearText}>
              All clear. Alerts stream here instantly — try reporting a copy missing from the
              Custody tab to see it live.
            </Text>
          </View>
        </Card>
      ) : (
        alerts.map((alert) => (
          <Card
            key={alert.id}
            style={[
              styles.alertCard,
              alert.severity === 'critical' && !alert.acknowledged
                ? styles.alertCritical
                : undefined,
            ]}
          >
            <View style={styles.alertHeader}>
              <Badge status={alert.severity} />
              <Text style={styles.alertTime}>{timeAgo(alert.created_at)}</Text>
            </View>
            <Text style={styles.alertType}>{alert.type}</Text>
            <Text style={styles.alertMessage}>{alert.message}</Text>
            {!alert.acknowledged ? (
              <Pressable onPress={() => void acknowledge(alert)} style={styles.ackBtn}>
                <Ionicons name="checkmark" size={14} color={colors.success} />
                <Text style={styles.ackText}>Acknowledge</Text>
              </Pressable>
            ) : (
              <Text style={styles.ackedText}>✓ Acknowledged</Text>
            )}
          </Card>
        ))
      )}
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    title: {
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
    allClear: {
      flexDirection: 'row',
      gap: spacing.md,
      alignItems: 'flex-start',
    },
    allClearText: {
      color: colors.textDim,
      fontSize: 13,
      lineHeight: 19,
      flex: 1,
    },
    alertCard: {
      marginBottom: spacing.sm,
    },
    alertCritical: {
      borderColor: colors.danger,
      backgroundColor: `${colors.danger}10`,
    },
    alertHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.sm,
    },
    alertTime: {
      color: colors.textDim,
      fontSize: 12,
    },
    alertType: {
      color: colors.textDim,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.6,
      marginBottom: 2,
    },
    alertMessage: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
    },
    ackBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: spacing.sm,
      alignSelf: 'flex-start',
    },
    ackText: {
      color: colors.success,
      fontSize: 13,
      fontWeight: '600',
    },
    ackedText: {
      color: colors.textDim,
      fontSize: 12,
      marginTop: spacing.sm,
    },
  });
