import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArchiveBackground,
  ArchiveHeader,
  ArchiveIndexOverlay,
  ArchivePalette,
  ArchiveSidebar,
  OpenBook,
  PageTitle,
  Rule,
  fluid,
  useArchiveLayout,
  useArchivePalette,
  useReducedMotion,
} from '../../components/ArchiveBook';
import { Seal } from '../../components/ArchiveControls';
import GuideOverlay from '../../components/guide/GuideOverlay';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { timeAgo } from '../../lib/format';
import { GuideStep, useDashboardGuide } from '../../lib/guide/useDashboardGuide';
import { supabase } from '../../lib/supabase';
import { serif, toneFor } from '../../lib/theme';
import { AlertRow } from '../../lib/types';
import { useAdminIndex } from './useAdminIndex';

const SELF = 'AdminDashboard';

/** Real dashboard elements only — see AdminDashboard's JSX for each target. */
function adminGuideSteps(sidebarMode: 'full' | 'slim' | 'overlay'): GuideStep[] {
  return [
    {
      id: 'stats',
      title: 'Security at a Glance',
      description:
        'These figures track papers awaiting a co-signature, fully dual-sealed sets, copies being tracked, and currently open alerts.',
    },
    {
      id: 'refresh',
      title: 'Live Alerts',
      description: 'Tap here anytime to pull the latest alert feed on demand.',
    },
    {
      id: 'alerts',
      title: 'Alert Feed',
      description:
        'New security alerts appear here in real time — critical ones need your attention first. Use Acknowledge once you\'ve handled one.',
    },
    {
      id: sidebarMode === 'overlay' ? 'navHeader' : 'navSidebar',
      title: 'Getting Around',
      description:
        sidebarMode === 'overlay'
          ? 'Tap this menu icon anytime to reach Approvals, Papers, Exams, Centers, Custody, Detections and the Audit log.'
          : 'Use this menu to reach Approvals, Papers, Exams, Centers, Custody, Detections and the Audit log.',
    },
  ];
}

export default function AdminDashboard() {
  const { profile } = useAuth();
  const { colors } = useTheme();
  const p = useArchivePalette();
  const { stacked, outerPad, sidebarMode, pageWidth } = useArchiveLayout();
  const { height: winHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(p), [p]);

  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [stats, setStats] = useState({ awaiting: 0, ready: 0, copies: 0, openAlerts: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const [indexOpen, setIndexOpen] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const guideSteps = useMemo(() => adminGuideSteps(sidebarMode), [sidebarMode]);
  const guide = useDashboardGuide('admin', profile?.id, guideSteps);
  const guideStep = guide.step;

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

  const { items, onSelect } = useAdminIndex({
    active: SELF,
    onBeforeSelect: () => setIndexOpen(false),
  });

  const bookHeight = stacked ? undefined : Math.max(420, Math.min(winHeight - 130, 760));

  /* --------------------------------- pages -------------------------------- */

  const leftPage = (
    <View style={styles.leftPage}>
      <PageTitle center eyebrow="Command centre" size={[20, 29]}>
        National Exam Security
      </PageTitle>
      <Text style={styles.sub}>Live operational picture · updates in real time</Text>

      <Rule ornament gap={14} />

      {/* The four figures are distributed over the whole leaf rather than
          bunched at the top, so the page reads as a printed summary. */}
      <View
        style={styles.statGrid}
        ref={guide.refFor('stats')}
        collapsable={false}
      >
        <View style={styles.statRow}>
          <SecurityStat
            label="Awaiting Co-sign"
            value={stats.awaiting}
            icon="hourglass-outline"
            tone={p.warning}
            palette={p}
            pageWidth={pageWidth}
          />
          <View style={[styles.vRule, { backgroundColor: p.rule }]} />
          <SecurityStat
            label="Dual-Sealed"
            value={stats.ready}
            icon="shield-checkmark-outline"
            tone={p.info}
            palette={p}
            pageWidth={pageWidth}
          />
        </View>

        <View style={[styles.hRule, { backgroundColor: p.rule }]} />

        <View style={styles.statRow}>
          <SecurityStat
            label="Copies Tracked"
            value={stats.copies}
            icon="location-outline"
            tone={p.gold}
            palette={p}
            pageWidth={pageWidth}
          />
          <View style={[styles.vRule, { backgroundColor: p.rule }]} />
          <SecurityStat
            label="Open Alerts"
            value={stats.openAlerts}
            icon="warning-outline"
            tone={stats.openAlerts > 0 ? p.danger : p.success}
            palette={p}
            pageWidth={pageWidth}
          />
        </View>
      </View>
    </View>
  );

  const rightPage = (
    <View style={stacked ? undefined : styles.flex}>
      <View style={styles.feedHead}>
        <PageTitle center size={[17, 24]}>
          Live Alert Feed
        </PageTitle>
        <View
          style={styles.livePill}
          ref={guide.refFor('refresh')}
          collapsable={false}
        >
          <LivePulse palette={p} />
          <Text style={styles.liveText}>Live</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh the alert feed"
            onPress={() => void onRefresh()}
            hitSlop={8}
            style={styles.refreshBtn}
          >
            <Ionicons name="refresh" size={13} color={p.inkDim} />
          </Pressable>
        </View>
      </View>
      <Rule ornament gap={11} />

      {/* Only this list scrolls — the book itself stays put. */}
      <View
        style={stacked ? undefined : styles.flex}
        ref={guide.refFor('alerts')}
        collapsable={false}
      >
        <FeedScroll stacked={stacked}>
          {alerts.length === 0 ? (
            <View style={[styles.allClear, { borderColor: p.rule, backgroundColor: `${p.pageShade}99` }]}>
              <Ionicons name="checkmark-circle" size={20} color={p.success} />
              <Text style={styles.allClearText}>
                All clear. Alerts stream here instantly — try reporting a copy missing from the
                Custody page to see it live.
              </Text>
            </View>
          ) : (
            alerts.map((alert) => (
              <AlertEntry
                key={alert.id}
                alert={alert}
                palette={p}
                tone={toneFor(colors, alert.severity)}
                pageWidth={pageWidth}
                onAcknowledge={() => void acknowledge(alert)}
              />
            ))
          )}
        </FeedScroll>
      </View>
    </View>
  );

  const book = (
    <OpenBook
      left={leftPage}
      right={rightPage}
      leftFolio="Operational picture"
      rightFolio={`${alerts.length} alert${alerts.length === 1 ? '' : 's'} on file`}
      height={bookHeight}
    />
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ArchiveBackground />
      <View ref={guide.refFor('navHeader')} collapsable={false}>
        <ArchiveHeader
          title="SECUREAI EXAM ARCHIVE"
          shortTitle="ARCHIVE"
          subtitle="Admin · Command Centre"
          onMenu={sidebarMode === 'overlay' ? () => setIndexOpen(true) : undefined}
        />
      </View>

      <View style={styles.body}>
        {sidebarMode === 'overlay' ? null : (
          <View ref={guide.refFor('navSidebar')} collapsable={false}>
            <ArchiveSidebar items={items} activeRoute={SELF} onSelect={onSelect} />
          </View>
        )}

        {stacked ? (
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingHorizontal: outerPad, paddingBottom: 20 + insets.bottom },
            ]}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void onRefresh()}
                tintColor={p.gold}
              />
            }
          >
            {book}
          </ScrollView>
        ) : (
          <View style={[styles.stage, { paddingHorizontal: outerPad }]}>{book}</View>
        )}
      </View>

      <ArchiveIndexOverlay
        visible={indexOpen}
        items={items}
        activeRoute={SELF}
        onSelect={onSelect}
        onClose={() => setIndexOpen(false)}
      />

      {guideStep ? (
        <GuideOverlay
          visible={guide.visible}
          title={guideStep.title}
          description={guideStep.description}
          stepIndex={guide.stepIndex}
          totalSteps={guide.totalSteps}
          targetNode={guide.getTarget(guideStep.id)}
          scrollRef={stacked ? scrollRef : undefined}
          onNext={guide.next}
          onSkip={guide.skip}
          isLast={guide.isLast}
        />
      ) : null}
    </View>
  );
}

/* ------------------------------ page pieces ------------------------------- */

/** The feed scrolls inside the leaf; on a phone the page flows instead. */
function FeedScroll({ children, stacked }: { children: React.ReactNode; stacked: boolean }) {
  if (stacked) return <View>{children}</View>;
  return (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}

/** A slow breathing dot — the feed is open and listening. */
function LivePulse({ palette: p }: { palette: ArchivePalette }) {
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [t, reduced]);

  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] });
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [1, 0.45] });

  return (
    <Animated.View
      style={[styles0.pulse, { backgroundColor: p.success, transform: [{ scale }], opacity }]}
    />
  );
}

/** One figure, engraved into its quarter of the leaf. */
function SecurityStat({
  label,
  value,
  icon,
  tone,
  palette: p,
  pageWidth,
}: {
  label: string;
  value: number;
  icon: keyof typeof Ionicons.glyphMap;
  tone: string;
  palette: ArchivePalette;
  pageWidth: number;
}) {
  const styles = useMemo(() => makeStyles(p), [p]);
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={15} color={tone} />
      <Text
        style={[
          styles.statValue,
          {
            color: tone,
            fontSize: fluid(pageWidth, 34, 54),
            lineHeight: fluid(pageWidth, 40, 62),
          },
        ]}
      >
        {value}
      </Text>
      <Text style={[styles.statLabel, { fontSize: fluid(pageWidth, 10.5, 13) }]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

/** One alert, as an archival record on the feed. */
function AlertEntry({
  alert,
  palette: p,
  tone,
  pageWidth,
  onAcknowledge,
}: {
  alert: AlertRow;
  palette: ArchivePalette;
  tone: string;
  pageWidth: number;
  onAcknowledge: () => void;
}) {
  const styles = useMemo(() => makeStyles(p), [p]);
  const urgent = alert.severity === 'critical' && !alert.acknowledged;

  return (
    <View
      style={[
        styles.alert,
        { borderColor: urgent ? p.danger : p.rule },
        urgent && { backgroundColor: `${p.danger}12`, borderWidth: 2 },
      ]}
    >
      <View style={styles.alertHead}>
        <Seal label={alert.severity.toUpperCase()} tone={tone} />
        <Text style={styles.alertTime}>{timeAgo(alert.created_at)}</Text>
      </View>

      <Text style={styles.alertType}>{alert.type}</Text>
      <Text style={[styles.alertMessage, { fontSize: fluid(pageWidth, 12, 13.5) }]}>
        {alert.message}
      </Text>

      {!alert.acknowledged ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Acknowledge: ${alert.message}`}
          onPress={onAcknowledge}
          style={({ pressed }) => [
            styles.ack,
            { borderColor: p.success },
            pressed && { backgroundColor: `${p.success}1A` },
          ]}
        >
          <Ionicons name="checkmark" size={12} color={p.success} />
          <Text style={[styles.ackText, { color: p.success }]}>Acknowledge</Text>
        </Pressable>
      ) : (
        <Text style={styles.acked}>✓ Acknowledged</Text>
      )}
    </View>
  );
}

/* --------------------------------- styles --------------------------------- */

/** Palette-free bits used by components that take no palette prop. */
const styles0 = StyleSheet.create({
  pulse: { width: 7, height: 7, borderRadius: 4 },
});

const makeStyles = (p: ArchivePalette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: p.backdrop },
    body: { flex: 1, flexDirection: 'row' },
    scrollContent: { paddingVertical: 16 },
    stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },

    /* left leaf */
    leftPage: { flex: 1 },
    sub: {
      fontFamily: serif,
      fontSize: 12,
      color: p.inkDim,
      textAlign: 'center',
      marginTop: 4,
      fontStyle: 'italic',
    },
    // The grid takes the rest of the leaf and shares it out evenly.
    statGrid: { flex: 1, justifyContent: 'space-evenly' },
    statRow: { flexDirection: 'row', alignItems: 'stretch', flex: 1 },
    stat: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 6 },
    statValue: { fontFamily: serif, fontWeight: '700', fontVariant: ['tabular-nums'] },
    statLabel: {
      fontFamily: serif,
      color: p.inkDim,
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      textAlign: 'center',
    },
    vRule: { width: 1, alignSelf: 'stretch', marginVertical: 10 },
    hRule: { height: 1, marginHorizontal: 6 },

    /* right leaf */
    feedHead: { alignItems: 'center', gap: 6 },
    livePill: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    liveText: {
      fontFamily: serif,
      fontSize: 9.5,
      fontWeight: '700',
      letterSpacing: 1.8,
      textTransform: 'uppercase',
      color: p.inkFaint,
    },
    refreshBtn: { paddingHorizontal: 2 },

    allClear: {
      flexDirection: 'row',
      gap: 10,
      alignItems: 'flex-start',
      borderWidth: 1,
      borderRadius: 3,
      padding: 13,
    },
    allClearText: { flex: 1, fontFamily: serif, fontSize: 12, lineHeight: 18, color: p.inkDim },

    alert: {
      borderWidth: 1,
      borderRadius: 3,
      backgroundColor: p.pageShade,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginBottom: 9,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.12,
      shadowRadius: 5,
      elevation: 1,
    },
    alertHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    alertTime: { fontFamily: serif, fontSize: 10, color: p.inkFaint },
    alertType: {
      fontFamily: serif,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 1.3,
      color: p.inkFaint,
      marginTop: 7,
    },
    alertMessage: { fontFamily: serif, color: p.ink, lineHeight: 18, marginTop: 3 },
    ack: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      alignSelf: 'flex-start',
      borderWidth: 1,
      borderRadius: 3,
      paddingHorizontal: 9,
      paddingVertical: 4,
      marginTop: 9,
    },
    ackText: { fontFamily: serif, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.8 },
    acked: { fontFamily: serif, fontSize: 10.5, color: p.inkFaint, marginTop: 9 },
  });
