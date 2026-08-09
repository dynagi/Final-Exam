import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import PaperPreview from '../../components/PaperPreview';
import { Badge, Button, Card, CeremonyModal, EmptyState, Screen } from '../../components/UI';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { showAlert } from '../../lib/alert';
import { confirmPaperPreview, previewPaper, sealPaper, validatePaper } from '../../lib/api';
import { CompositionReport, sectionProgressLabel } from '../../lib/examFormats';
import { fmtDateTime, timeAgo } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { spacing, ThemeColors } from '../../lib/theme';
import { Paper, PaperView } from '../../lib/types';

const STATUS_HINT: Partial<Record<Paper['status'], string>> = {
  draft: 'Draft. Preview and confirm it to unlock sealing.',
  sealed: 'Waiting for Admin co-signature (key share 2/2)…',
  sealed_dual: 'Dual-sealed. Ready for the two-person print ceremony.',
  printed: 'Printed. Copies are under live chain-of-custody tracking.',
};

export default function MyPapersScreen() {
  const { profile } = useAuth();
  const setterId = profile?.id;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [papers, setPapers] = useState<Paper[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [sealTarget, setSealTarget] = useState<Paper | null>(null);
  const [sealing, setSealing] = useState(false);

  // Preview → confirm → seal, the same gate the Compose screen uses.
  const [previewTarget, setPreviewTarget] = useState<Paper | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [view, setView] = useState<PaperView | null>(null);
  const [report, setReport] = useState<CompositionReport | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** paper id -> its live composition report, for the draft progress lines. */
  const [drafts, setDrafts] = useState<Record<string, CompositionReport>>({});

  const load = useCallback(async () => {
    if (!setterId) return;
    const { data } = await supabase
      .from('papers')
      .select('*, exam:exams!papers_exam_id_fkey(name)')
      .eq('setter_id', setterId)
      .order('created_at', { ascending: false });
    const rows = (data as Paper[] | null) ?? [];
    setPapers(rows);

    // Show each draft's per-section progress against its exam format.
    const reports = await Promise.all(
      rows
        .filter((p) => p.status === 'draft')
        .map((p) =>
          validatePaper(p.id)
            .then((res) => [p.id, res.report] as const)
            .catch(() => null)
        )
    );
    setDrafts(Object.fromEntries(reports.filter((r): r is [string, CompositionReport] => !!r)));
  }, [setterId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // Live status updates (e.g. Admin co-signs while you watch).
  useEffect(() => {
    if (!setterId) return;
    const channel = supabase
      .channel(`papers-list-${setterId}`)
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

  const openPreview = async (paper: Paper) => {
    setPreviewTarget(paper);
    setPreviewLoading(true);
    setView(null);
    setReport(null);
    try {
      const res = await previewPaper(paper.id);
      setView(res.view);
      setReport(res.report);
    } catch (e) {
      setPreviewTarget(null);
      showAlert('Preview failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setPreviewLoading(false);
    }
  };

  /** Confirming the preview is what unlocks the sealing ceremony. */
  const confirmAndSeal = async () => {
    if (!previewTarget) return;
    setConfirming(true);
    try {
      await confirmPaperPreview(previewTarget.id);
      const target = previewTarget;
      setPreviewTarget(null);
      setSealTarget(target);
      void load();
    } catch (e) {
      showAlert('Cannot confirm', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setConfirming(false);
    }
  };

  const handleSeal = async (values: Record<string, string>) => {
    const passphrase = values.passphrase ?? '';
    if (passphrase.length < 8) {
      showAlert('Weak passphrase', 'Use at least 8 characters.');
      return;
    }
    if (!sealTarget) return;
    setSealing(true);
    try {
      await sealPaper(sealTarget.id, passphrase);
      setSealTarget(null);
      showAlert('Paper sealed 🔐', 'The Admin can now co-sign. Status updates live below.');
      void load();
    } catch (e) {
      showAlert('Sealing failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSealing(false);
    }
  };

  return (
    <Screen>
      <FlatList
        data={papers}
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
            icon="documents-outline"
            title="No papers yet"
            subtitle="Compose a paper from the question pool to get started."
          />
        }
        renderItem={({ item }) => (
          <Card>
            <View style={styles.header}>
              <Text style={styles.title} numberOfLines={1}>
                {item.title}
              </Text>
              <Badge status={item.status} />
            </View>
            <Text style={styles.meta}>
              {item.exam?.name ? `${item.exam.name} · ` : ''}
              {item.set_label ? `${item.set_label} · ` : ''}
              {item.subject} · {item.question_count} questions · created {timeAgo(item.created_at)}
            </Text>

            {item.sealed_at ? (
              <Text style={styles.timeline}>
                <Ionicons name="lock-closed" size={12} color={colors.warning} /> Sealed{' '}
                {fmtDateTime(item.sealed_at)}
              </Text>
            ) : null}
            {item.cosigned_at ? (
              <Text style={styles.timeline}>
                <Ionicons name="shield-checkmark" size={12} color={colors.info} /> Co-signed{' '}
                {fmtDateTime(item.cosigned_at)}
              </Text>
            ) : null}

            {STATUS_HINT[item.status] ? (
              <Text style={styles.hint}>{STATUS_HINT[item.status]}</Text>
            ) : null}

            {item.status === 'draft' && drafts[item.id]?.enforced ? (
              <View style={styles.progress}>
                {drafts[item.id].sections.map((section) => (
                  <Text
                    key={section.name}
                    style={[
                      styles.progressLine,
                      { color: section.complete ? colors.success : colors.warning },
                    ]}
                  >
                    {sectionProgressLabel(section)}
                  </Text>
                ))}
              </View>
            ) : null}

            {item.status === 'draft' && (
              <>
                <Button
                  title="Preview Paper"
                  icon="eye-outline"
                  onPress={() => void openPreview(item)}
                  style={{ marginTop: spacing.md }}
                />
                {item.previewed_at ? (
                  <Button
                    title="Seal this paper (Share 1/2)"
                    variant="ghost"
                    icon="lock-closed-outline"
                    onPress={() => setSealTarget(item)}
                    style={{ marginTop: spacing.sm }}
                  />
                ) : (
                  <Text style={styles.hint}>
                    Sealing unlocks once you preview and confirm the paper.
                  </Text>
                )}
              </>
            )}
          </Card>
        )}
      />

      <PaperPreview
        visible={!!previewTarget}
        view={view}
        report={report}
        loading={previewLoading}
        busy={confirming}
        onBack={() => setPreviewTarget(null)}
        onConfirm={() => void confirmAndSeal()}
      />

      <CeremonyModal
        visible={!!sealTarget}
        title="Sealing Ceremony — Key Share 1/2"
        subtitle={`Sealing "${sealTarget?.title ?? ''}". Your passphrase wraps the first half of the key. You'll need it again at the print ceremony.`}
        fields={[
          {
            key: 'passphrase',
            label: 'Setter passphrase (min 8 chars)',
            placeholder: 'Secret passphrase',
            secure: true,
          },
        ]}
        submitLabel="Encrypt & Seal Paper"
        busy={sealing}
        onSubmit={(values) => void handleSeal(values)}
        onClose={() => setSealTarget(null)}
      />
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: spacing.sm,
    },
    title: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
      flex: 1,
    },
    meta: {
      color: colors.textDim,
      fontSize: 12,
      marginTop: spacing.sm,
    },
    timeline: {
      color: colors.textDim,
      fontSize: 12,
      marginTop: 4,
    },
    hint: {
      color: colors.info,
      fontSize: 12,
      marginTop: spacing.sm,
      fontStyle: 'italic',
    },
    progress: { marginTop: spacing.sm, gap: 2 },
    progressLine: { fontSize: 12, fontWeight: '700' },
  });
