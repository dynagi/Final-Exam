import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Card, EmptyState, Screen } from '../../components/UI';
import { useTheme } from '../../context/ThemeContext';
import { shortHash, timeAgo } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { radius, spacing, ThemeColors } from '../../lib/theme';
import { AuditEntry } from '../../lib/types';

export default function AuditLogScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('audit_log')
      .select('*')
      .order('id', { ascending: false })
      .limit(60);
    setEntries((data as AuditEntry[] | null) ?? []);
  }, []);

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

  return (
    <Screen>
      <View style={styles.banner}>
        <Ionicons name="link" size={16} color={colors.gold} />
        <Text style={styles.bannerText}>
          Hash-chained & append-only: every entry's hash covers the previous one. Tampering with
          any record breaks every hash after it.
        </Text>
      </View>

      <FlatList
        data={entries}
        keyExtractor={(item) => String(item.id)}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={colors.text}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon="reader-outline"
            title="No audit entries yet"
            subtitle="Every seal, co-sign, print and custody scan is recorded here permanently."
          />
        }
        renderItem={({ item }) => (
          <Card style={styles.entry}>
            <View style={styles.header}>
              <Text style={styles.action}>{item.action}</Text>
              <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
            </View>
            <Text style={styles.detail}>
              {item.actor_name ?? 'system'} · {item.entity}
              {item.details && typeof item.details.title === 'string'
                ? ` · "${item.details.title}"`
                : ''}
            </Text>
            <View style={styles.hashRow}>
              <Text style={styles.hash}>{shortHash(item.prev_hash)}</Text>
              <Ionicons name="arrow-forward" size={11} color={colors.gold} />
              <Text style={styles.hash}>{shortHash(item.hash)}</Text>
            </View>
          </Card>
        )}
      />
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    banner: {
      flexDirection: 'row',
      gap: spacing.sm,
      alignItems: 'flex-start',
      backgroundColor: `${colors.gold}10`,
      borderColor: `${colors.gold}44`,
      borderWidth: 1,
      borderRadius: radius.sm,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    bannerText: {
      color: colors.textDim,
      fontSize: 12,
      lineHeight: 17,
      flex: 1,
    },
    entry: {
      marginBottom: spacing.sm,
      padding: spacing.md,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    action: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.3,
      flex: 1,
    },
    time: {
      color: colors.textDim,
      fontSize: 11,
    },
    detail: {
      color: colors.textDim,
      fontSize: 12,
      marginTop: 4,
    },
    hashRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: spacing.sm,
    },
    hash: {
      color: colors.textDim,
      fontSize: 10,
      fontFamily: 'monospace',
      opacity: 0.7,
    },
  });
