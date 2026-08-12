import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Animated,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArchiveBackground,
  ArchiveHeader,
  ArchiveIndexOverlay,
  ArchivePalette,
  ArchiveSidebar,
  PageGrain,
  useArchiveLayout,
  useArchivePalette,
  usePageTurn,
} from '../../components/ArchiveBook';
import { Badge, Button, Card, EmptyState, Input } from '../../components/UI';
import { useTheme } from '../../context/ThemeContext';
import { showAlert } from '../../lib/alert';
import { identifyLeak } from '../../lib/api';
import { shortHash, timeAgo } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { radius, serif, spacing, ThemeColors } from '../../lib/theme';
import { CopyStatus, CustodyEvent, PaperCopy } from '../../lib/types';
import { useAdminIndex } from './useAdminIndex';

const SELF = 'Custody';

/** The three physical pages bound into the custody book, in order. */
const PAGES = ['Live Feed', 'Copies', 'Leak Trace'] as const;
type PageName = (typeof PAGES)[number];

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
  const p = useArchivePalette();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const bookStyles = useMemo(() => makeBookStyles(p), [p]);
  const { stacked, outerPad, sidebarMode } = useArchiveLayout();
  const insets = useSafeAreaInsets();
  // Wide enough to bind all three pages open side by side, as one book.
  const wide = !stacked;
  const [indexOpen, setIndexOpen] = useState(false);

  const [view, setView] = useState<PageName>('Live Feed');
  // A physical page turn between the three bound sections (narrow screens only).
  const pageTurn = usePageTurn({ duration: 620, angle: 80 });
  const switchView = (next: PageName) => {
    if (next === view) return;
    const from = PAGES.indexOf(view);
    const to = PAGES.indexOf(next);
    pageTurn.turn(to > from ? 1 : -1, () => setView(next));
  };
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

  const { items, onSelect } = useAdminIndex({
    active: SELF,
    onBeforeSelect: () => setIndexOpen(false),
  });

  /** Content for one of the three bound pages — identical to the original views. */
  const renderPageContent = (name: PageName) => {
    if (name === 'Leak Trace') {
      return (
        <ScrollView showsVerticalScrollIndicator={false}>
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
        </ScrollView>
      );
    }

    if (name === 'Live Feed') {
      return (
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
      );
    }

    return (
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
    );
  };

  const bookArea = (
    <>
      {/* Three tabs bound as the edges of the same physical book — selecting
          one focuses that page without leaving the other two behind. */}
      <View style={bookStyles.tabRow}>
        {PAGES.map((name, i) => {
          const active = name === view;
          return (
            <Pressable
              key={name}
              onPress={() => switchView(name)}
              style={[bookStyles.tab, { zIndex: PAGES.length - i }, active && bookStyles.tabActive]}
            >
              <Text style={[bookStyles.tabText, active && bookStyles.tabTextActive]}>{name}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* ONE open book. Wide screens bind all three pages side by side, with
          the selected one focused; narrow screens show the focused page full
          width and turn to the others like a real page flip. */}
      <View style={bookStyles.book}>
        {wide ? (
          <View style={bookStyles.spread}>
            {PAGES.map((name, i) => (
              <React.Fragment key={name}>
                {i > 0 ? <PageGutter palette={p} /> : null}
                <Pressable
                  onPress={() => switchView(name)}
                  style={[
                    bookStyles.panel,
                    name === view ? bookStyles.panelFocused : bookStyles.panelDim,
                  ]}
                >
                  <PageGrain />
                  <View style={bookStyles.panelInner}>
                    <Text style={bookStyles.panelTitle}>{name}</Text>
                    <View style={bookStyles.panelBody}>{renderPageContent(name)}</View>
                  </View>
                </Pressable>
              </React.Fragment>
            ))}
          </View>
        ) : (
          <Animated.View style={[bookStyles.leaf, pageTurn.style]}>
            <PageGrain />
            <View style={bookStyles.leafInner}>{renderPageContent(view)}</View>
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, bookStyles.turnShade, pageTurn.shadeStyle]}
            />
          </Animated.View>
        )}
      </View>
    </>
  );

  return (
    <View style={[bookStyles.screen, { paddingTop: insets.top }]}>
      <ArchiveBackground />
      <ArchiveHeader
        title="SECUREAI EXAM ARCHIVE"
        shortTitle="ARCHIVE"
        subtitle="Admin · Custody"
        onMenu={sidebarMode === 'overlay' ? () => setIndexOpen(true) : undefined}
      />

      <View style={bookStyles.body}>
        {sidebarMode === 'overlay' ? null : (
          <ArchiveSidebar items={items} activeRoute={SELF} onSelect={onSelect} />
        )}

        <View style={[bookStyles.stage, { paddingHorizontal: outerPad, paddingBottom: insets.bottom }]}>
          {bookArea}
        </View>
      </View>

      <ArchiveIndexOverlay
        visible={indexOpen}
        items={items}
        activeRoute={SELF}
        onSelect={onSelect}
        onClose={() => setIndexOpen(false)}
      />

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
    </View>
  );
}

/** A bound seam between two pages of the same book — mirrors the book spine. */
function PageGutter({ palette: p }: { palette: ArchivePalette }) {
  return (
    <View style={{ width: 9, backgroundColor: p.coverEdge }}>
      <LinearGradient
        colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0.08)', 'rgba(0,0,0,0.5)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
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

/** The three-page custody book: tab spine + parchment leaf with stacked page edges. */
const makeBookStyles = (p: ArchivePalette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.backdrop },
    body: { flex: 1, flexDirection: 'row' },
    stage: { flex: 1, paddingVertical: 14 },
    tabRow: { flexDirection: 'row', marginBottom: 2, paddingHorizontal: 6 },
    tab: {
      flex: 1,
      marginRight: -1,
      borderWidth: 1,
      borderColor: p.pamphletEdge,
      borderBottomWidth: 0,
      borderTopLeftRadius: 5,
      borderTopRightRadius: 5,
      paddingVertical: 8,
      alignItems: 'center',
      backgroundColor: `${p.pageDeep}55`,
    },
    tabActive: {
      backgroundColor: p.page,
      paddingVertical: 10,
    },
    tabText: {
      fontFamily: serif,
      fontSize: 11.5,
      fontWeight: '700',
      letterSpacing: 0.8,
      color: p.inkFaint,
      textTransform: 'uppercase',
    },
    tabTextActive: { color: p.ink },
    // The book cover: one continuous mahogany frame binding all three pages.
    book: {
      flex: 1,
      backgroundColor: p.cover,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: p.coverEdge,
      padding: 6,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.35,
      shadowRadius: 16,
      elevation: 8,
    },
    spread: { flex: 1, flexDirection: 'row' },
    panel: {
      flex: 1,
      backgroundColor: p.page,
      overflow: 'hidden',
    },
    // The tab-selected page reads as the one currently open/focused.
    panelFocused: { opacity: 1 },
    panelDim: { opacity: 0.72 },
    panelInner: { flex: 1, padding: spacing.md },
    panelTitle: {
      fontFamily: serif,
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.6,
      color: p.ink,
      textTransform: 'uppercase',
      textAlign: 'center',
      marginBottom: spacing.sm,
    },
    panelBody: { flex: 1 },
    leaf: {
      flex: 1,
      backgroundColor: p.page,
      borderRadius: 4,
      overflow: 'hidden',
    },
    leafInner: { flex: 1, padding: spacing.md },
    turnShade: { backgroundColor: '#000' },
  });
