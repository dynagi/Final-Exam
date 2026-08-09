import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Badge, Button, Card, Chips, EmptyState, Input, Screen } from '../../components/UI';
import { useTheme } from '../../context/ThemeContext';
import { showAlert } from '../../lib/alert';
import { identifyLeak } from '../../lib/api';
import { shortHash, timeAgo } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { radius, spacing, ThemeColors } from '../../lib/theme';
import { CopyStatus, CustodyEvent, PaperCopy } from '../../lib/types';

type CopyWithPaper = PaperCopy & { paper?: { title: string } | null };
type EventWithCopy = CustodyEvent & { copy?: { copy_number: number; paper_id: string } | null };

const NEXT_STEP: Partial<
  Record<CopyStatus, { next: CopyStatus; label: string; defaultLocation: string }>
> = {
  printed: {
    next: 'in_transit',
    label: 'Dispatch → In Transit',
    defaultLocation: 'GPS-tracked secure transport',
  },
  in_transit: {
    next: 'at_center',
    label: 'Arrive → District Center Vault',
    defaultLocation: 'District exam center strong room',
  },
  at_center: {
    next: 'delivered',
    label: 'Deliver → Exam Hall',
    defaultLocation: 'Exam hall, sealed box opened',
  },
};

export default function CustodyScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [view, setView] = useState('Live Feed');
  const [events, setEvents] = useState<EventWithCopy[]>([]);
  const [copies, setCopies] = useState<CopyWithPaper[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const [target, setTarget] = useState<CopyWithPaper | null>(null);
  const [location, setLocation] = useState('');
  const [working, setWorking] = useState(false);

  // Leak forensics: resolve a code lifted from a photographed page fragment.
  const [traceInput, setTraceInput] = useState('');
  const [tracing, setTracing] = useState(false);
  const [traceResult, setTraceResult] = useState<{
    via: string;
    copyNumber: number;
    paper: string;
    location: string;
    chain: CustodyEvent[];
  } | null>(null);

  const load = useCallback(async () => {
    const [{ data: eventRows }, { data: copyRows }] = await Promise.all([
      supabase
        .from('custody_events')
        .select('*, copy:paper_copies(copy_number, paper_id)')
        .order('created_at', { ascending: false })
        .limit(40),
      supabase
        .from('paper_copies')
        .select('*, paper:papers(title)')
        .order('created_at', { ascending: false })
        .limit(100),
    ]);
    setEvents((eventRows as EventWithCopy[] | null) ?? []);
    setCopies((copyRows as CopyWithPaper[] | null) ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // Live custody feed: every checkpoint scan anywhere appears here instantly.
  useEffect(() => {
    const channel = supabase
      .channel('custody-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'custody_events' },
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

  const openCopy = (copy: CopyWithPaper) => {
    setTarget(copy);
    setLocation(NEXT_STEP[copy.status]?.defaultLocation ?? '');
  };

  const recordEvent = async (eventType: CopyStatus, eventLocation: string) => {
    if (!target) return;
    setWorking(true);
    const { error } = await supabase.from('custody_events').insert({
      copy_id: target.id,
      event_type: eventType,
      location: eventLocation.trim() || 'Unspecified checkpoint',
      note: 'Checkpoint scan (QR verified)',
    });
    setWorking(false);
    if (error) {
      showAlert('Scan failed', error.message);
      return;
    }
    setTarget(null);
    void load();
  };

  const reportMissing = () => {
    if (!target) return;
    showAlert(
      'Report copy missing?',
      `Copy #${target.copy_number} will be flagged MISSING and a CRITICAL alert will fire on every admin dashboard in real time.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report Missing',
          style: 'destructive',
          onPress: () => void recordEvent('missing', location || 'Last checkpoint'),
        },
      ]
    );
  };

  /**
   * Resolve a code scanned off a leaked page. The server marks the copy
   * leaked, which fires a CRITICAL alert to every admin dashboard via the
   * custody trigger, and returns the full chain of custody.
   */
  const runTrace = async () => {
    const code = traceInput.trim();
    if (!code) {
      showAlert('Nothing to trace', 'Scan or type the code from the page watermark.');
      return;
    }
    setTracing(true);
    setTraceResult(null);
    try {
      // A photo may yield either the tiled watermark code or the header QR.
      const res = await identifyLeak(
        code.trim().startsWith('{') ? { qr_payload: code } : { trace_code: code }
      );
      setTraceResult({
        via: res.via,
        copyNumber: res.copy.copy_number,
        paper: res.copy.paper?.title ?? 'Unknown paper',
        location: res.copy.current_location,
        chain: res.custody_chain ?? [],
      });
      setTraceInput('');
      void load();
    } catch (e) {
      showAlert('Could not trace', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setTracing(false);
    }
  };

  const advance = NEXT_STEP[target?.status ?? 'delivered'];

  return (
    <Screen scroll={view === 'Leak Trace'}>
      <View style={{ marginBottom: spacing.md }}>
        <Chips options={['Live Feed', 'Copies', 'Leak Trace']} value={view} onChange={setView} />
      </View>

      {view === 'Leak Trace' ? (
        <>
          <Card>
            <Text style={styles.traceTitle}>Identify a leaked copy</Text>
            <Text style={styles.traceBlurb}>
              Every printed page is tiled with its own QR watermark, so a photo of any part of the
              sheet identifies the copy. Scan one of the faint codes (or read the TRACE line in the
              footer) and enter it here — the full header QR payload works too.
            </Text>
            <Input
              label="Trace code from the page"
              placeholder="SAE:ABCD2345EFGH"
              autoCapitalize="characters"
              value={traceInput}
              onChangeText={setTraceInput}
            />
            <Button
              title="Identify & raise alert"
              icon="search-outline"
              variant="danger"
              loading={tracing}
              onPress={() => void runTrace()}
            />
          </Card>

          {traceResult ? (
            <Card>
              <Text style={styles.traceHit}>🔴 Copy #{traceResult.copyNumber} identified</Text>
              <Text style={styles.traceLine}>Paper: {traceResult.paper}</Text>
              <Text style={styles.traceLine}>Identified via: {traceResult.via}</Text>
              <Text style={styles.traceLine}>Last known location: {traceResult.location}</Text>
              <Text style={styles.traceLine}>
                A critical alert has been pushed to every admin dashboard.
              </Text>
              <Text style={styles.traceChainTitle}>Chain of custody</Text>
              {traceResult.chain.map((event) => (
                <Text key={event.id} style={styles.traceChain}>
                  · {event.event_type} — {event.location} ({timeAgo(event.created_at)})
                </Text>
              ))}
            </Card>
          ) : null}
        </>
      ) : null}

      {view === 'Live Feed' ? (
        <FlatList
          data={events}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={colors.text}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="location-outline"
              title="No custody events yet"
              subtitle="Run a print ceremony — every copy's journey is tracked here live."
            />
          }
          renderItem={({ item }) => (
            <Card>
              <View style={styles.eventHeader}>
                <Badge status={item.event_type} />
                <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
              </View>
              <Text style={styles.eventText}>
                Copy #{item.copy?.copy_number ?? '?'} · {item.location}
              </Text>
              {item.note ? <Text style={styles.note}>{item.note}</Text> : null}
              <View style={styles.hashRow}>
                <Ionicons name="link" size={12} color={colors.textDim} />
                <Text style={styles.hash}>
                  {shortHash(item.prev_hash)} → {shortHash(item.hash)}
                </Text>
              </View>
            </Card>
          )}
        />
      ) : view === 'Copies' ? (
        <FlatList
          data={copies}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={colors.text}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="qr-code-outline"
              title="No copies printed yet"
              subtitle="Copies appear after a print ceremony, each with a unique QR + fingerprint."
            />
          }
          renderItem={({ item }) => (
            <Pressable onPress={() => openCopy(item)}>
              <Card>
                <View style={styles.eventHeader}>
                  <Text style={styles.copyTitle}>
                    Copy #{item.copy_number} — {item.paper?.title ?? 'Paper'}
                  </Text>
                  <Badge status={item.status} />
                </View>
                <Text style={styles.note}>📍 {item.current_location}</Text>
                <View style={styles.hashRow}>
                  <Ionicons name="finger-print" size={12} color={colors.textDim} />
                  <Text style={styles.hash}>fp {item.fingerprint_hash.slice(0, 16)}…</Text>
                </View>
              </Card>
            </Pressable>
          )}
        />
      ) : null}

      {/* Checkpoint scan modal (simulates the invigilator / transport scans) */}
      <Modal transparent visible={!!target} animationType="fade" onRequestClose={() => setTarget(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Copy #{target?.copy_number} — checkpoint scan</Text>
            <Text style={styles.modalSubtitle}>
              Current: {target ? `${target.status} @ ${target.current_location}` : ''}
            </Text>

            <Input
              label="Checkpoint location"
              placeholder="e.g. District vault, Sector 12"
              value={location}
              onChangeText={setLocation}
            />

            {advance ? (
              <Button
                title={advance.label}
                onPress={() => void recordEvent(advance.next, location)}
                loading={working}
              />
            ) : (
              <Text style={styles.terminal}>
                This copy is at a terminal state ({target?.status}).
              </Text>
            )}

            {target && !['missing', 'leaked'].includes(target.status) ? (
              <Button
                title="🚨 Report MISSING (fires live alert)"
                variant="danger"
                onPress={reportMissing}
                style={{ marginTop: spacing.sm }}
              />
            ) : null}

            <Button
              title="Close"
              variant="ghost"
              onPress={() => setTarget(null)}
              style={{ marginTop: spacing.sm }}
            />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    traceTitle: { color: colors.text, fontSize: 15, fontWeight: '800', marginBottom: 4 },
    traceBlurb: {
      color: colors.textDim,
      fontSize: 12,
      lineHeight: 18,
      marginBottom: spacing.md,
    },
    traceHit: { color: colors.danger, fontSize: 15, fontWeight: '800', marginBottom: spacing.sm },
    traceLine: { color: colors.textDim, fontSize: 13, lineHeight: 19 },
    traceChainTitle: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '800',
      marginTop: spacing.md,
      marginBottom: 4,
    },
    traceChain: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
    eventHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    time: {
      color: colors.textDim,
      fontSize: 12,
    },
    eventText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    copyTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '700',
      flex: 1,
    },
    note: {
      color: colors.textDim,
      fontSize: 12,
      marginTop: 4,
    },
    hashRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: spacing.sm,
    },
    hash: {
      color: colors.textDim,
      fontSize: 11,
      fontFamily: 'monospace',
      opacity: 0.7,
    },
    terminal: {
      color: colors.textDim,
      fontSize: 13,
      fontStyle: 'italic',
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: colors.backdrop,
      justifyContent: 'center',
      padding: spacing.xl,
    },
    modalCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.xl,
    },
    modalTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '800',
      marginBottom: 4,
    },
    modalSubtitle: {
      color: colors.textDim,
      fontSize: 13,
      marginBottom: spacing.lg,
    },
  });
