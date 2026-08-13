/**
 * QR Detections — the security event feed, presented as a static open book.
 *
 * Every question on a printed copy carries its own HMAC-tagged QR. When a
 * monitoring client (or an admin pasting a code) reports a sighting, the
 * server resolves it to an exact copy, page and question and records it here.
 * Repeat sightings of the same code by the same scanner fold into one row's
 * counter rather than flooding the feed.
 */
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArchiveBackground,
  ArchiveHeader,
  ArchiveIndexOverlay,
  ArchivePalette,
  ArchiveSidebar,
  OpenBook,
  PageScroll,
  PageTitle,
  Rule,
  useArchiveLayout,
  useArchivePalette,
} from '../../components/ArchiveBook';
import { BookButton, BookField, CenteredHeading, Seal } from '../../components/ArchiveControls';
import { useTheme } from '../../context/ThemeContext';
import { showAlert } from '../../lib/alert';
import { fetchDetections, reportDetection } from '../../lib/api';
import { fmtDateTime, timeAgo } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { serif, toneFor } from '../../lib/theme';
import { QrDetection } from '../../lib/types';
import { useAdminIndex } from './useAdminIndex';

const SELF = 'Detections';

/** One label/value line, rendered only when the value is actually present. */
function Field({
  label,
  value,
  styles,
}: {
  label: string;
  value: string | number | null | undefined;
  styles: ReturnType<typeof makeStyles>;
}) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{String(value)}</Text>
    </View>
  );
}

export default function DetectionsScreen() {
  const { colors } = useTheme();
  const p = useArchivePalette();
  const styles = useMemo(() => makeStyles(p), [p]);
  const { stacked, outerPad, sidebarMode } = useArchiveLayout();
  const insets = useSafeAreaInsets();

  const [indexOpen, setIndexOpen] = useState(false);

  const [detections, setDetections] = useState<QrDetection[]>([]);
  const [dedupWindow, setDedupWindow] = useState(120);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [token, setToken] = useState('');
  const [reporting, setReporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetchDetections(100);
      setDetections(res.detections);
      setDedupWindow(res.dedup_window_sec);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load detections');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // Live: a sighting anywhere shows up here without a refresh.
  useEffect(() => {
    const channel = supabase
      .channel('qr-detections')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'qr_detections' },
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

  /** Report a code read off a captured image, from this device. */
  const report = async () => {
    const value = token.trim();
    if (!value) {
      showAlert('Nothing to report', 'Paste the token decoded from the captured frame.');
      return;
    }
    setReporting(true);
    try {
      const res = await reportDetection({
        qr_token: value,
        scanner_id: 'admin-console',
        device_info: 'Admin dashboard (manual entry)',
        confidence: 1,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        detected_at: new Date().toISOString(),
      });
      setToken('');
      showAlert(
        res.deduplicated ? 'Already recorded' : 'Security event raised',
        res.deduplicated
          ? `Counted against the existing event (${res.detection.detection_count} sightings within ${res.dedup_window_sec}s).`
          : `Copy traced to page ${res.detection.page_number}, ${
              res.detection.frame_label ?? `frame ${res.detection.frame_number}`
            }. A critical alert is on the dashboard.`
      );
      void load();
    } catch (e) {
      showAlert('Could not record', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setReporting(false);
    }
  };

  /** Prior sightings of the same copy, for the "detection history" line. */
  const historyFor = (item: QrDetection) =>
    detections.filter(
      (d) => d.copy_id && d.copy_id === item.copy_id && d.detected_at < item.detected_at
    );

  const { items, onSelect } = useAdminIndex({
    active: SELF,
    onBeforeSelect: () => setIndexOpen(false),
  });

  /* -------------------------------- pages -------------------------------- */

  const leftPage = (
    <PageScroll>
      <PageTitle center size={[19, 27]}>
        Frame Watermark Monitoring
      </PageTitle>
      <Rule ornament gap={12} />

      <Text style={styles.intro}>
        Every question carries its own unique QR code, printed beside its answer area, so a
        photograph of even a single question identifies the copy, the page and the exact question.
        Repeat sightings of the same code by the same scanner within {dedupWindow}s are counted
        once.
      </Text>

      <Rule gap={16} />

      <CenteredHeading>Report a Decoded Token</CenteredHeading>
      <View style={styles.block}>
        <BookField
          label="Token"
          placeholder="SAE:VFMHENF8BRJB0107G9NP"
          autoCapitalize="characters"
          value={token}
          onChangeText={setToken}
        />
      </View>

      <View style={styles.reportBtn}>
        <BookButton
          title="Record security event"
          icon="scan-outline"
          variant="gold"
          loading={reporting}
          onPress={() => void report()}
        />
      </View>

      {loadError ? <Text style={styles.error}>{loadError}</Text> : null}
    </PageScroll>
  );

  const rightPage = (
    <PageScroll>
      <PageTitle center size={[19, 27]}>
        Security Events
      </PageTitle>
      <Rule ornament gap={12} />

      {detections.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="shield-checkmark-outline" size={26} color={p.inkFaint} />
          <Text style={styles.emptyTitle}>No watermark detections</Text>
          <Text style={styles.emptyText}>
            Nothing has reported seeing a printed page. Events appear here the moment a frame QR
            is read anywhere.
          </Text>
        </View>
      ) : (
        detections.map((item) => {
          const history = historyFor(item);
          const located = item.latitude != null && item.longitude != null;
          return (
            <View key={item.id} style={styles.card}>
              <View style={styles.cardHead}>
                <Seal label={item.alert_level.toUpperCase()} tone={toneFor(colors, item.alert_level)} />
                <Text style={styles.time}>{timeAgo(item.detected_at)}</Text>
              </View>

              <Text style={styles.title}>
                {item.exam_name ?? 'Unknown exam'}
                {item.set_label ? ` · ${item.set_label}` : ''}
              </Text>
              <Text style={styles.locator}>
                Page {item.page_number} · {item.frame_label ?? `Frame ${item.frame_number}`}
              </Text>

              <View style={styles.fields}>
                <Field label="Trace code" value={item.trace_code} styles={styles} />
                <Field label="QR token" value={item.qr_token} styles={styles} />
                <Field label="Exam ID" value={item.exam_id} styles={styles} />
                <Field label="Paper ID" value={item.paper_id} styles={styles} />
                <Field label="Copy ID" value={item.copy_id} styles={styles} />
                <Field label="Detected" value={fmtDateTime(item.detected_at)} styles={styles} />
                <Field label="Timezone" value={item.timezone} styles={styles} />
                <Field label="Scanner" value={item.scanner_id} styles={styles} />
                <Field label="Device" value={item.device_info} styles={styles} />
                <Field label="IP address" value={item.ip_address} styles={styles} />
                <Field label="User agent" value={item.user_agent} styles={styles} />
                <Field
                  label="Location"
                  value={
                    located
                      ? `${item.latitude!.toFixed(5)}, ${item.longitude!.toFixed(5)}${
                          item.location_accuracy_m ? ` ±${Math.round(item.location_accuracy_m)}m` : ''
                        }`
                      : item.location_label
                  }
                  styles={styles}
                />
                <Field
                  label="Confidence"
                  value={item.confidence != null ? `${Math.round(item.confidence * 100)}%` : null}
                  styles={styles}
                />
                <Field label="Image reference" value={item.image_ref} styles={styles} />
              </View>

              <View style={styles.counts}>
                <Ionicons name="repeat-outline" size={13} color={p.warning} />
                <Text style={styles.countsText}>
                  Seen {item.detection_count}×{' '}
                  {item.detection_count > 1
                    ? `(first ${fmtDateTime(item.first_detected_at)}, last ${fmtDateTime(
                        item.last_detected_at
                      )})`
                    : ''}
                  {history.length > 0
                    ? ` · ${history.length} earlier event(s) for this copy`
                    : ' · first event for this copy'}
                </Text>
              </View>
            </View>
          );
        })
      )}
    </PageScroll>
  );

  // One static open book, visible from the moment the page loads — no cover,
  // no tap-to-open, no reveal animation.
  const book = (
    <OpenBook
      left={leftPage}
      right={rightPage}
      leftFolio="Frame monitoring"
      rightFolio={`${detections.length} event${detections.length === 1 ? '' : 's'} on file`}
    />
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ArchiveBackground />
      <ArchiveHeader
        title="SECUREAI EXAM ARCHIVE"
        shortTitle="ARCHIVE"
        subtitle="Admin · QR Detections"
        onMenu={sidebarMode === 'overlay' ? () => setIndexOpen(true) : undefined}
      />

      <View style={styles.body}>
        {sidebarMode === 'overlay' ? null : (
          <ArchiveSidebar items={items} activeRoute={SELF} onSelect={onSelect} />
        )}

        {stacked ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingHorizontal: outerPad, paddingBottom: 20 + insets.bottom },
            ]}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={p.gold} />
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
    </View>
  );
}

/* --------------------------------- styles --------------------------------- */

const makeStyles = (p: ArchivePalette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: p.backdrop },
    body: { flex: 1, flexDirection: 'row' },
    scrollContent: { paddingVertical: 16 },
    stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },

    /* left page */
    intro: { fontFamily: serif, fontSize: 12.5, color: p.inkDim, lineHeight: 19 },
    block: { marginTop: 10, marginBottom: 4 },
    reportBtn: { alignItems: 'center', marginTop: 14 },
    error: { fontFamily: serif, fontSize: 11.5, color: p.danger, marginTop: 12, lineHeight: 16 },

    /* right page */
    empty: { alignItems: 'center', gap: 8, paddingVertical: 28, paddingHorizontal: 10 },
    emptyTitle: { fontFamily: serif, fontSize: 15, fontWeight: '700', color: p.ink },
    emptyText: {
      fontFamily: serif,
      fontSize: 12.5,
      lineHeight: 18,
      color: p.inkDim,
      textAlign: 'center',
    },
    card: {
      borderWidth: 1,
      borderColor: p.rule,
      backgroundColor: p.pageShade,
      borderRadius: 3,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginBottom: 10,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.12,
      shadowRadius: 5,
      elevation: 1,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    time: { fontFamily: serif, fontSize: 10.5, color: p.inkFaint },
    title: { fontFamily: serif, fontSize: 13.5, fontWeight: '700', color: p.ink, marginTop: 7 },
    locator: {
      fontFamily: serif,
      fontSize: 11.5,
      fontWeight: '700',
      color: p.gold,
      marginTop: 2,
      marginBottom: 8,
    },
    fields: { borderTopWidth: 1, borderTopColor: p.rule, paddingTop: 8, gap: 3 },
    field: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
    fieldLabel: { fontFamily: serif, fontSize: 10.5, color: p.inkFaint, width: 96 },
    fieldValue: { fontFamily: serif, fontSize: 10.5, color: p.inkDim, flex: 1, lineHeight: 15 },
    counts: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      marginTop: 9,
      borderRadius: 3,
      backgroundColor: `${p.pageDeep}33`,
      padding: 8,
    },
    countsText: { fontFamily: serif, fontSize: 10.5, lineHeight: 15, color: p.inkDim, flex: 1 },
  });
