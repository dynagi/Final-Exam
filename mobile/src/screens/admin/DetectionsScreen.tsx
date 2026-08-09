/**
 * QR Detections — the security event feed.
 *
 * Every printed page is divided into a grid of frames, each carrying its own
 * HMAC-tagged QR. When a monitoring client (or an admin pasting a code)
 * reports a sighting, the server resolves it to an exact copy, page and
 * frame and records it here. Repeat sightings of the same frame by the same
 * scanner fold into one row's counter rather than flooding the feed.
 */
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Badge, Button, Card, EmptyState, Input, Screen, SectionTitle } from '../../components/UI';
import { useTheme } from '../../context/ThemeContext';
import { showAlert } from '../../lib/alert';
import { fetchDetections, reportDetection } from '../../lib/api';
import { fmtDateTime, timeAgo } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { radius, spacing, ThemeColors } from '../../lib/theme';
import { QrDetection } from '../../lib/types';

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
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [detections, setDetections] = useState<QrDetection[]>([]);
  const [grid, setGrid] = useState({ cols: 5, rows: 7 });
  const [dedupWindow, setDedupWindow] = useState(120);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [token, setToken] = useState('');
  const [reporting, setReporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetchDetections(100);
      setDetections(res.detections);
      setGrid(res.grid);
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
          : `Copy traced to page ${res.detection.page_number}, frame ${res.detection.frame_number}. A critical alert is on the dashboard.`
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

  return (
    <Screen>
      <FlatList
        data={detections}
        keyExtractor={(item) => item.id}
        initialNumToRender={12}
        removeClippedSubviews={false}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={colors.text}
          />
        }
        ListHeaderComponent={
          <>
            <Card>
              <Text style={styles.introTitle}>Frame watermark monitoring</Text>
              <Text style={styles.intro}>
                Each printed page carries a {grid.cols} × {grid.rows} grid of unique QR codes, so a
                photograph of any part of a sheet identifies the copy, the page and the frame.
                Repeat sightings of the same frame by the same scanner within {dedupWindow}s are
                counted once.
              </Text>
              <Input
                label="Report a decoded token"
                placeholder="SAE:VFMHENF8BRJB0107G9NP"
                autoCapitalize="characters"
                value={token}
                onChangeText={setToken}
              />
              <Button
                title="Record security event"
                icon="scan-outline"
                variant="danger"
                loading={reporting}
                onPress={() => void report()}
              />
            </Card>
            {loadError ? <Text style={styles.error}>{loadError}</Text> : null}
            <SectionTitle title={`Security events (${detections.length})`} />
          </>
        }
        ListEmptyComponent={
          loadError ? null : (
            <EmptyState
              icon="shield-checkmark-outline"
              title="No watermark detections"
              subtitle="Nothing has reported seeing a printed page. Events appear here the moment a frame QR is read anywhere."
            />
          )
        }
        renderItem={({ item }) => {
          const history = historyFor(item);
          const located = item.latitude != null && item.longitude != null;
          return (
            <Card>
              <View style={styles.header}>
                <Badge status={item.alert_level} />
                <Text style={styles.time}>{timeAgo(item.detected_at)}</Text>
              </View>

              <Text style={styles.title}>
                {item.exam_name ?? 'Unknown exam'}
                {item.set_label ? ` · ${item.set_label}` : ''}
              </Text>
              <Text style={styles.locator}>
                Page {item.page_number} · Frame {item.frame_number}
                {item.frame_label ? ` (${item.frame_label})` : ''}
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
                <Ionicons name="repeat-outline" size={14} color={colors.warning} />
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
            </Card>
          );
        }}
      />
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    introTitle: { color: colors.text, fontSize: 15, fontWeight: '800', marginBottom: 4 },
    intro: { color: colors.textDim, fontSize: 12, lineHeight: 18, marginBottom: spacing.md },
    error: { color: colors.danger, fontSize: 12, fontWeight: '700', marginTop: spacing.sm },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.sm,
    },
    time: { color: colors.textDim, fontSize: 12 },
    title: { color: colors.text, fontSize: 15, fontWeight: '700' },
    locator: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: '800',
      marginTop: 2,
      marginBottom: spacing.sm,
    },
    fields: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: spacing.sm,
      gap: 3,
    },
    field: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
    fieldLabel: { color: colors.textFaint, fontSize: 11, width: 106 },
    fieldValue: { color: colors.textDim, fontSize: 11, flex: 1, lineHeight: 16 },
    counts: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      marginTop: spacing.sm,
      borderRadius: radius.sm,
      backgroundColor: colors.surfaceAlt,
      padding: spacing.sm,
    },
    countsText: { color: colors.textDim, fontSize: 11, lineHeight: 16, flex: 1 },
  });
