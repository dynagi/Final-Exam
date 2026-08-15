import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArchiveBackground,
  ArchiveHeader,
  ArchiveIndexOverlay,
  ArchivePalette,
  ArchiveSidebar,
  FlipBook,
  FlipBookHandle,
  PageScroll,
  PageTitle,
  Rule,
  fluid,
  useArchiveLayout,
  useArchivePalette,
} from '../../components/ArchiveBook';
import { BookArrow, PageIndicator } from '../../components/ArchiveUpload';
import { EmptyState, CeremonyModal } from '../../components/UI';
import { KeyBlackboard, Seal } from '../../components/ArchiveControls';
import PaperPreview from '../../components/PaperPreview';
import { useAuth } from '../../context/AuthContext';
import { showAlert } from '../../lib/alert';
import { confirmPaperPreview, previewPaper, sealPaper, validatePaper } from '../../lib/api';
import { CompositionReport, sectionProgressLabel } from '../../lib/examFormats';
import { fmtDateTime, timeAgo } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { labelFor, serif } from '../../lib/theme';
import { Paper, PaperView } from '../../lib/types';
import { useSetterIndex } from './useSetterIndex';

const SELF = 'MyPapers';
/** Records per leaf — a spread (left + right) holds twice this many. */
const PER_LEAF = 3;
const PER_SPREAD = PER_LEAF * 2;

const STATUS_HINT: Partial<Record<Paper['status'], string>> = {
  draft: 'Draft. Preview and confirm it to unlock sealing.',
  sealed: 'Waiting for Admin co-signature (key share 2/2)…',
  sealed_dual: 'Dual-sealed. Ready for the two-person print ceremony.',
  printed: 'Printed. Copies are under live chain-of-custody tracking.',
};

function statusTone(p: ArchivePalette, status: Paper['status']): string {
  if (status === 'sealed') return p.warning;
  if (status === 'sealed_dual') return p.info;
  if (status === 'printed' || status === 'distributed' || status === 'completed') return p.success;
  return p.inkFaint;
}

export default function MyPapersScreen() {
  const { profile } = useAuth();
  const setterId = profile?.id;
  const p = useArchivePalette();
  const { stacked, outerPad, sidebarMode, pageWidth } = useArchiveLayout();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(p), [p]);
  const [indexOpen, setIndexOpen] = useState(false);

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

  const [spread, setSpread] = useState(0);
  const book = useRef<FlipBookHandle>(null);

  // Blackboard popup announcing a paper that just got the Admin's
  // co-signature — surfaced once, the moment cosigned_at first appears.
  const [cosignNotice, setCosignNotice] = useState<Paper | null>(null);
  const prevPapersRef = useRef<Paper[]>([]);
  const initializedRef = useRef(false);

  const load = useCallback(async () => {
    if (!setterId) return;
    const { data } = await supabase
      .from('papers')
      .select('*, exam:exams!papers_exam_id_fkey(name)')
      .eq('setter_id', setterId)
      .order('created_at', { ascending: false });
    const rows = (data as Paper[] | null) ?? [];
    setPapers(rows);

    // Detect a draft→cosigned transition since the last load — skipped on the
    // very first load so reopening the screen with already-cosigned papers
    // doesn't spuriously pop the board.
    if (initializedRef.current) {
      const prevById = new Map(prevPapersRef.current.map((pp) => [pp.id, pp]));
      const justCosigned = rows.find((pp) => pp.cosigned_at && !prevById.get(pp.id)?.cosigned_at);
      if (justCosigned) setCosignNotice(justCosigned);
    }
    initializedRef.current = true;
    prevPapersRef.current = rows;

    // Show each draft's per-section progress against its exam format.
    const reports = await Promise.all(
      rows
        .filter((pp) => pp.status === 'draft')
        .map((pp) =>
          validatePaper(pp.id)
            .then((res) => [pp.id, res.report] as const)
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

  const { items, onSelect } = useSetterIndex({
    active: SELF,
    onPreview: undefined,
    onBeforeSelect: () => setIndexOpen(false),
  });

  const spreadCount = Math.max(1, Math.ceil(papers.length / PER_SPREAD));
  const current = Math.min(spread, spreadCount - 1);
  const start = current * PER_SPREAD;
  const leftPapers = papers.slice(start, start + PER_LEAF);
  const rightPapers = papers.slice(start + PER_LEAF, start + PER_SPREAD);

  const renderSide = useCallback(
    (spreadIndex: number, side: 'left' | 'right') => {
      const base = spreadIndex * PER_SPREAD + (side === 'right' ? PER_LEAF : 0);
      const rows = papers.slice(base, base + PER_LEAF);
      return (
        <PageScroll>
          <PageTitle center size={[19, 27]}>
            {side === 'left' ? 'My Papers' : 'Continued'}
          </PageTitle>
          <Rule ornament gap={12} />
          {rows.length === 0 ? (
            side === 'left' && papers.length === 0 ? (
              <EmptyState
                icon="documents-outline"
                title="No papers yet"
                subtitle="Compose a paper from the question pool to get started."
              />
            ) : (
              <Text style={styles.emptyNote}>No further papers on this spread.</Text>
            )
          ) : (
            rows.map((item) => (
              <View key={item.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <Text
                    style={[styles.cardTitle, { fontSize: fluid(pageWidth, 12.5, 14) }]}
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                  <Seal label={labelFor(item.status).toUpperCase()} tone={statusTone(p, item.status)} />
                </View>
                <Text style={styles.cardMeta}>
                  {item.exam?.name ? `${item.exam.name} · ` : ''}
                  {item.set_label ? `${item.set_label} · ` : ''}
                  {item.subject} · {item.question_count} questions · created {timeAgo(item.created_at)}
                </Text>

                {item.sealed_at ? (
                  <Text style={styles.timeline}>
                    <Ionicons name="lock-closed" size={12} color={p.warning} /> Sealed{' '}
                    {fmtDateTime(item.sealed_at)}
                  </Text>
                ) : null}
                {item.cosigned_at ? (
                  <Text style={styles.timeline}>
                    <Ionicons name="shield-checkmark" size={12} color={p.info} /> Co-signed{' '}
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
                          { color: section.complete ? p.success : p.warning },
                        ]}
                      >
                        {sectionProgressLabel(section)}
                      </Text>
                    ))}
                  </View>
                ) : null}

                {item.status === 'draft' && (
                  <>
                    <ActionButton
                      label="Preview Paper"
                      icon="eye-outline"
                      palette={p}
                      onPress={() => void openPreview(item)}
                    />
                    {item.previewed_at ? (
                      <ActionButton
                        label="Seal this paper (Share 1/2)"
                        icon="lock-closed-outline"
                        palette={p}
                        tone={p.gold}
                        onPress={() => setSealTarget(item)}
                      />
                    ) : (
                      <Text style={styles.hint}>
                        Sealing unlocks once you preview and confirm the paper.
                      </Text>
                    )}
                  </>
                )}
              </View>
            ))
          )}
        </PageScroll>
      );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [papers, drafts, p, styles, pageWidth]
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ArchiveBackground />
      <ArchiveHeader
        title="SECUREAI EXAM ARCHIVE"
        shortTitle="ARCHIVE"
        subtitle="Paper Setter · My Papers"
        onMenu={sidebarMode === 'overlay' ? () => setIndexOpen(true) : undefined}
      />

      <View style={styles.body}>
        {sidebarMode === 'overlay' ? null : (
          <ArchiveSidebar items={items} activeRoute={SELF} onSelect={onSelect} />
        )}

        <View style={[styles.stage, { paddingHorizontal: outerPad }]}>
          <View style={styles.bookArea}>
            <View style={styles.bookRow}>
              <View style={styles.arrowSlot}>
                <BookArrow
                  direction="prev"
                  label="Previous papers spread"
                  disabled={current <= 0}
                  onPress={() => book.current?.prev()}
                />
              </View>

              <View style={styles.bookWrap}>
                <FlipBook
                  ref={book}
                  spread={current}
                  spreadCount={spreadCount}
                  onSpread={setSpread}
                  renderSide={renderSide}
                  leftFolio={`Papers ${papers.length ? start + 1 : 0}–${start + leftPapers.length}`}
                  rightFolio={
                    rightPapers.length
                      ? `Papers ${start + PER_LEAF + 1}–${start + PER_LEAF + rightPapers.length}`
                      : 'End of spread'
                  }
                />
              </View>

              <View style={styles.arrowSlot}>
                <BookArrow
                  direction="next"
                  label="Next papers spread"
                  disabled={current >= spreadCount - 1}
                  onPress={() => book.current?.next()}
                />
              </View>
            </View>

            <View style={styles.pageIndicator}>
              <PageIndicator page={current + 1} pageCount={spreadCount} onGo={(n) => book.current?.goTo(n - 1)} />
            </View>
          </View>
        </View>
      </View>

      <ArchiveIndexOverlay
        visible={indexOpen}
        items={items}
        activeRoute={SELF}
        onSelect={onSelect}
        onClose={() => setIndexOpen(false)}
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

      <KeyBlackboard
        visible={!!cosignNotice}
        title="Paper Co-Signed 🛡️"
        subtitle={`"${cosignNotice?.title ?? ''}" now carries both key shares. Dual control is active — it cannot be decrypted without both your passphrase and the Admin's. It's ready for the two-person print ceremony.`}
        fields={[]}
        submitLabel="Got it"
        onSubmit={() => setCosignNotice(null)}
        onClose={() => setCosignNotice(null)}
      />
    </View>
  );
}

/* ------------------------------ page pieces ------------------------------- */

function ActionButton({
  label,
  icon,
  onPress,
  palette: p,
  tone,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  palette: ArchivePalette;
  tone?: string;
}) {
  const styles = useMemo(() => makeStyles(p), [p]);
  const accent = tone ?? p.gold;
  return (
    <View style={[styles.actionBtn, { borderColor: accent }]}>
      <Ionicons name={icon} size={13} color={accent} />
      <Text style={[styles.actionBtnText, { color: accent }]} onPress={onPress}>
        {label}
      </Text>
    </View>
  );
}

/* --------------------------------- styles --------------------------------- */

const makeStyles = (p: ArchivePalette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.backdrop },
    body: { flex: 1, flexDirection: 'row' },
    stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
    bookArea: { width: '100%', alignItems: 'center' },
    bookRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, width: '100%', maxWidth: 1180 },
    arrowSlot: { paddingTop: 14 },
    bookWrap: { flex: 1, alignItems: 'center' },
    pageIndicator: { alignItems: 'center', marginTop: 12 },

    emptyNote: {
      fontFamily: serif,
      fontSize: 12,
      color: p.inkFaint,
      fontStyle: 'italic',
      textAlign: 'center',
      marginTop: 20,
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
    cardTitle: { flex: 1, fontFamily: serif, fontWeight: '700', color: p.ink },
    cardMeta: { fontFamily: serif, fontSize: 10.5, color: p.inkDim, marginTop: 5, lineHeight: 15 },
    timeline: { fontFamily: serif, fontSize: 10.5, color: p.inkDim, marginTop: 4 },
    hint: { fontFamily: serif, fontSize: 11, color: p.info, fontStyle: 'italic', marginTop: 8 },
    progress: { marginTop: 8, gap: 2 },
    progressLine: { fontFamily: serif, fontSize: 11, fontWeight: '700' },

    actionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      borderWidth: 1,
      borderRadius: 3,
      paddingHorizontal: 10,
      paddingVertical: 6,
      marginTop: 9,
    },
    actionBtnText: { fontFamily: serif, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  });
