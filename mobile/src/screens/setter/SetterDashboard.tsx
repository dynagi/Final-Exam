import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Animated,
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
  ArchiveLoader,
  ArchivePalette,
  ArchiveSidebar,
  OpenBook,
  PageScroll,
  PageTitle,
  Rule,
  SectionHeading,
  SmallCaps,
  StatBlock,
  TurnButton,
  fluid,
  useArchiveLayout,
  useArchivePalette,
  useArrowKeys,
  usePageTurn,
} from '../../components/ArchiveBook';
import { Seal } from '../../components/ArchiveControls';
import PaperPreview from '../../components/PaperPreview';
import { useAuth } from '../../context/AuthContext';
import { CompositionReport } from '../../lib/examFormats';
import { fetchExamSets, previewPaper } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { serif } from '../../lib/theme';
import { ExamSetSummary, Paper, PaperView } from '../../lib/types';
import { useScheduledExams } from '../../lib/useExams';
import { useSetterIndex } from './useSetterIndex';

/** This screen's own route name, used to mark the active index entry. */
const SELF = 'SetterDashboard';

/** "10 October 2026" — day-month-year, as printed on an examination cover. */
function longDate(value: string | null | undefined): string {
  if (!value) return 'Date not set';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** "25" for a fixed quota, "22–26" for the formats published as a range. */
function targetOf(section: { required: number | null; required_min: number; required_max: number }) {
  return section.required != null ? `${section.required}` : `${section.required_min}–${section.required_max}`;
}

export default function SetterDashboard() {
  const { profile } = useAuth();
  const setterId = profile?.id;
  const navigation = useNavigation();
  const go = (screen: string) =>
    (navigation as unknown as { navigate: (s: string) => void }).navigate(screen);

  const p = useArchivePalette();
  const { stacked, outerPad, sidebarMode, pageWidth } = useArchiveLayout();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(p), [p]);

  const { exams } = useScheduledExams();
  const [papers, setPapers] = useState<Paper[]>([]);
  const [poolCount, setPoolCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [indexOpen, setIndexOpen] = useState(false);

  // Which exam ("paper") and which of its sets the right-hand page is showing.
  const [examIdx, setExamIdx] = useState(0);
  const [setIdx, setSetIdx] = useState(0);
  const [sets, setSets] = useState<ExamSetSummary[]>([]);
  const [setsLoading, setSetsLoading] = useState(false);

  // Read-only preview of the set currently open on the right page.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewView, setPreviewView] = useState<PaperView | null>(null);
  const [previewReport, setPreviewReport] = useState<CompositionReport | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const exam = exams[examIdx] ?? null;
  const examId = exam?.id ?? null;
  const set = sets[setIdx] ?? null;

  // A realtime exam insert/delete must never leave the pointer past the end.
  useEffect(() => {
    if (examIdx > 0 && examIdx >= exams.length) setExamIdx(Math.max(0, exams.length - 1));
  }, [exams.length, examIdx]);
  useEffect(() => {
    if (setIdx > 0 && setIdx >= sets.length) setSetIdx(Math.max(0, sets.length - 1));
  }, [sets.length, setIdx]);

  const load = useCallback(async () => {
    if (!setterId) return;
    const [{ data: paperRows }, { count }] = await Promise.all([
      supabase
        .from('papers')
        .select('*')
        .eq('setter_id', setterId)
        .order('created_at', { ascending: false }),
      supabase.from('questions').select('*', { count: 'exact', head: true }),
    ]);
    setPapers((paperRows as Paper[] | null) ?? []);
    setPoolCount(count ?? 0);
  }, [setterId]);

  const loadSets = useCallback(async () => {
    if (!examId) {
      setSets([]);
      return;
    }
    setSetsLoading(true);
    try {
      const res = await fetchExamSets(examId);
      setSets(res.sets);
    } catch {
      setSets([]);
    } finally {
      setSetsLoading(false);
    }
  }, [examId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      void loadSets();
    }, [load, loadSets])
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
    await Promise.all([load(), loadSets()]);
    setRefreshing(false);
  };

  const count = (status: Paper['status']) => papers.filter((s) => s.status === status).length;

  /* ------------------------------ page turns ------------------------------ */

  // Turning to another exam is the full page turn; changing set is a shorter,
  // faster leaf movement so the two read as different gestures.
  const paperTurn = usePageTurn({ duration: 760, angle: 88 });
  const setTurn = usePageTurn({ duration: 460, angle: 52 });

  const goExam = useCallback(
    (delta: 1 | -1) => {
      const next = examIdx + delta;
      if (next < 0 || next >= exams.length) return;
      paperTurn.turn(delta, () => {
        setExamIdx(next);
        // A new exam owns a different set list — start at its first set.
        setSetIdx(0);
      });
    },
    [examIdx, exams.length, paperTurn]
  );

  const goSet = useCallback(
    (delta: 1 | -1) => {
      const next = setIdx + delta;
      if (next < 0 || next >= sets.length) return;
      setTurn.turn(delta, () => setSetIdx(next));
    },
    [setIdx, sets.length, setTurn]
  );

  const prevExam = useCallback(() => goExam(-1), [goExam]);
  const nextExam = useCallback(() => goExam(1), [goExam]);
  useArrowKeys(prevExam, nextExam, exams.length > 1 && !previewOpen && !indexOpen);

  /* -------------------------------- preview ------------------------------- */

  /**
   * Opens the set on the right page in the same preview the Compose and My
   * Papers screens use. Read-only here: `onConfirm` is omitted, so confirming
   * the paper stays where the sealing ceremony lives.
   */
  const openPreview = useCallback(async () => {
    const paperId = set?.paper_id;
    if (!paperId) return;
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewView(null);
    setPreviewReport(null);
    try {
      const res = await previewPaper(paperId);
      setPreviewView(res.view);
      setPreviewReport(res.report);
    } catch (e) {
      // Close first: PaperPreview is a Modal, so a banner left underneath it
      // would never be seen and the sheet would sit on "Building…" forever.
      setPreviewOpen(false);
      setPreviewError(e instanceof Error ? e.message : 'Could not open the preview.');
    } finally {
      setPreviewLoading(false);
    }
  }, [set?.paper_id]);

  // The failure notice clears itself; it is informational, not a decision.
  useEffect(() => {
    if (!previewError) return;
    const id = setTimeout(() => setPreviewError(null), 6000);
    return () => clearTimeout(id);
  }, [previewError]);

  /* --------------------------------- index -------------------------------- */

  const { items, onSelect: onSelectIndex } = useSetterIndex({
    active: SELF,
    onPreview: () => void openPreview(),
    // Nothing to show until the open set has a saved paper behind it.
    previewDisabled: !set?.paper_id,
    onBeforeSelect: () => setIndexOpen(false),
  });

  /* -------------------------------- pages -------------------------------- */

  const leftPage = (
    <PageScroll>
      <PageTitle eyebrow={profile?.full_name ?? 'Paper Setter'}>Dashboard</PageTitle>
      <Rule ornament gap={16} />

      <View style={styles.statGrid}>
        <StatBlock
          label="Question Bank"
          value={poolCount}
          caption="Questions in the pool"
          tone={p.info}
        />
        <StatBlock label="Drafts" value={count('draft')} caption="Papers in progress" />
        <StatBlock
          label="Awaiting Co-sign"
          value={count('sealed')}
          caption="Sealed, pending Admin"
          tone={p.warning}
        />
        <StatBlock
          label="Dual-Sealed"
          value={count('sealed_dual') + count('printed')}
          caption="Sealed with both keys"
          tone={p.success}
        />
      </View>

      <Rule gap={18} />

      <SectionHeading>Recent activity</SectionHeading>
      {papers.length === 0 ? (
        <Text style={styles.emptyText}>
          No papers yet. Open Compose to assemble your first paper from the question pool.
        </Text>
      ) : (
        <View style={styles.paperList}>
          {papers.slice(0, 5).map((paper) => (
            <View key={paper.id} style={styles.paperRow}>
              <View style={styles.flex}>
                <Text
                  style={[styles.paperRowTitle, { fontSize: fluid(pageWidth, 13, 15) }]}
                  numberOfLines={1}
                >
                  {paper.title}
                </Text>
                <Text style={styles.paperRowMeta} numberOfLines={1}>
                  {paper.subject}
                  {paper.set_label ? ` · ${paper.set_label}` : ''} · {paper.question_count} questions
                </Text>
              </View>
              <Seal label={statusWord(paper.status)} tone={toneForPaper(paper.status, p)} />
            </View>
          ))}
        </View>
      )}
    </PageScroll>
  );

  const rightPage = (
    <PageScroll>
      <Animated.View style={paperTurn.style}>
        {exams.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="calendar-outline" size={26} color={p.inkFaint} />
            <Text style={styles.emptyTitle}>No examination scheduled</Text>
            <Text style={styles.emptyText}>
              Once the Admin schedules an examination it is bound into this volume, with its paper
              sets on this page.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.navRow}>
              <TurnButton
                direction="prev"
                label="Previous examination"
                onPress={prevExam}
                disabled={examIdx === 0}
              />
              <View style={styles.navTitleWrap}>
                <Text
                  style={[
                    styles.paperTitle,
                    { fontSize: fluid(pageWidth, 18, 26), lineHeight: fluid(pageWidth, 23, 32) },
                  ]}
                  numberOfLines={2}
                >
                  {exam?.name}
                </Text>
              </View>
              <TurnButton
                direction="next"
                label="Next examination"
                onPress={nextExam}
                disabled={examIdx >= exams.length - 1}
              />
            </View>
            <SmallCaps style={styles.centered}>
              Examination {examIdx + 1} of {exams.length}
            </SmallCaps>

            <View style={styles.metaBlock}>
              <Text style={[styles.metaLine, { fontSize: fluid(pageWidth, 13, 16) }]}>
                {longDate(exam?.exam_date)}
              </Text>
              <Text style={styles.metaDim}>
                {exam?.duration_min ? `${exam.duration_min} minutes` : 'Duration not set'}
                {exam?.format_blueprint?.display_name
                  ? ` · ${exam.format_blueprint.display_name}`
                  : ''}
              </Text>
            </View>

            <Rule ornament gap={16} />

            {setsLoading ? (
              <ArchiveLoader label="Opening paper sets…" />
            ) : sets.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="albums-outline" size={24} color={p.inkFaint} />
                <Text style={styles.emptyText}>
                  No paper sets configured for this examination yet — the Admin sets how many are
                  required.
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.navRow}>
                  <TurnButton
                    direction="prev"
                    label="Previous paper set"
                    onPress={() => goSet(-1)}
                    disabled={setIdx === 0}
                    size={34}
                  />
                  <View style={styles.navTitleWrap}>
                    <Text style={[styles.setTitle, { fontSize: fluid(pageWidth, 15, 19) }]}>
                      {set?.label}
                    </Text>
                  </View>
                  <TurnButton
                    direction="next"
                    label="Next paper set"
                    onPress={() => goSet(1)}
                    disabled={setIdx >= sets.length - 1}
                    size={34}
                  />
                </View>
                <SmallCaps style={styles.centered}>
                  Set {setIdx + 1} of {sets.length}
                </SmallCaps>

                <Animated.View style={[styles.setCardWrap, setTurn.style]}>
                  {set ? <SetSheet set={set} palette={p} pageWidth={pageWidth} /> : null}
                  <Animated.View
                    pointerEvents="none"
                    style={[StyleSheet.absoluteFill, styles.turnShade, setTurn.shadeStyle]}
                  />
                </Animated.View>
              </>
            )}

            <Rule gap={16} />

            <View style={styles.marginalia}>
              <Ionicons name="key" size={14} color={p.gold} />
              <Text style={styles.marginaliaText}>
                When you seal a paper you hold key share 1 of 2. The Admin&apos;s co-signature
                creates share 2. Decryption is mathematically impossible without both passphrases.
              </Text>
            </View>
          </>
        )}

        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.turnShade, paperTurn.shadeStyle]}
        />
      </Animated.View>
    </PageScroll>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ArchiveBackground />
      <ArchiveHeader
        title="SECUREAI EXAM ARCHIVE"
        shortTitle="ARCHIVE"
        subtitle="Paper Setter · Volume I"
        onMenu={sidebarMode === 'overlay' ? () => setIndexOpen(true) : undefined}
      />

      <View style={styles.body}>
        {sidebarMode === 'overlay' ? null : (
          <ArchiveSidebar items={items} activeRoute={SELF} onSelect={onSelectIndex} />
        )}
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.scrollContent,
            !stacked && styles.scrollContentWide,
            // Must match layout.outerPad: useArchiveLayout has already taken it
            // out of bookWidth, so any other value re-introduces overflow.
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
          <OpenBook
            left={leftPage}
            right={rightPage}
            leftFolio="The Record"
            rightFolio={exam ? `${exam.name} · ${set?.label ?? 'No sets'}` : 'No examination'}
          />
        </ScrollView>
      </View>

      <ArchiveIndexOverlay
        visible={indexOpen}
        items={items}
        activeRoute={SELF}
        onSelect={onSelectIndex}
        onClose={() => setIndexOpen(false)}
      />

      <PaperPreview
        visible={previewOpen}
        view={previewView}
        report={previewReport}
        loading={previewLoading}
        onBack={() => setPreviewOpen(false)}
      />
      {previewError ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss preview error"
          onPress={() => setPreviewError(null)}
          style={styles.previewError}
        >
          <Ionicons name="alert-circle-outline" size={16} color="#fff" />
          <Text style={styles.previewErrorText}>{previewError}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ------------------------------ page pieces ------------------------------- */

/** The selected set, printed on the right page as a document section. */
function SetSheet({
  set,
  palette: p,
  pageWidth,
}: {
  set: ExamSetSummary;
  palette: ArchivePalette;
  pageWidth: number;
}) {
  const styles = useMemo(() => makeStyles(p), [p]);
  const started = set.status !== 'not_started';
  const statusText = !started
    ? 'NOT STARTED'
    : set.status !== 'draft'
      ? set.status.replace(/_/g, ' ').toUpperCase()
      : set.ready
        ? 'READY'
        : 'INCOMPLETE';
  const tone = !started ? p.inkFaint : set.ready || set.status !== 'draft' ? p.success : p.warning;

  return (
    <View style={styles.sheet}>
      <Text style={styles.sheetTitle}>{set.label}</Text>
      <View style={[styles.sheetRule, { backgroundColor: p.rule }]} />

      {set.report.enforced ? (
        <View style={styles.sheetLines}>
          {set.report.sections.map((section) => (
            <View key={section.name} style={styles.sheetLine}>
              <Text
                style={[styles.sheetSubject, { fontSize: fluid(pageWidth, 12.5, 15) }]}
                numberOfLines={1}
              >
                {section.name}
              </Text>
              <View style={[styles.sheetLeader, { borderBottomColor: p.rule }]} />
              <Text
                style={[
                  styles.sheetCount,
                  {
                    color: section.complete ? p.success : p.warning,
                    fontSize: fluid(pageWidth, 12.5, 15),
                  },
                ]}
              >
                {section.current}/{targetOf(section)} {section.complete ? '✓' : '⚠'}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.sheetPlain}>
          {set.report.totals.current} question(s) selected — this examination has no enforced
          blueprint.
        </Text>
      )}

      <View style={styles.sheetFoot}>
        <Text style={styles.sheetStatusLabel}>Status</Text>
        <Seal label={statusText} tone={tone} />
      </View>
    </View>
  );
}

function statusWord(status: Paper['status']): string {
  return status.replace(/_/g, ' ').toUpperCase();
}

function toneForPaper(status: Paper['status'], p: ArchivePalette): string {
  if (status === 'draft') return p.inkFaint;
  if (status === 'sealed') return p.warning;
  if (status === 'sealed_dual') return p.gold;
  return p.success;
}

/* --------------------------------- styles --------------------------------- */

const makeStyles = (p: ArchivePalette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: p.backdrop },
    body: { flex: 1, flexDirection: 'row' },
    scrollContent: { paddingVertical: 16 },
    scrollContentWide: { flexGrow: 1, justifyContent: 'center' },
    centered: { textAlign: 'center' },

    /* left page */
    statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },

    /* right page */
    navRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
    navTitleWrap: { flex: 1, alignItems: 'center' },
    paperTitle: {
      fontFamily: serif,
      fontWeight: '700',
      color: p.ink,
      textAlign: 'center',
      letterSpacing: 0.3,
    },
    setTitle: {
      fontFamily: serif,
      fontWeight: '700',
      color: p.ink,
      letterSpacing: 1.8,
      textTransform: 'uppercase',
    },
    metaBlock: { alignItems: 'center', marginTop: 10, gap: 2 },
    metaLine: { fontFamily: serif, color: p.ink },
    metaDim: { fontFamily: serif, fontSize: 11.5, color: p.inkDim, textAlign: 'center' },
    marginalia: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
    marginaliaText: {
      flex: 1,
      fontFamily: serif,
      fontSize: 11.5,
      lineHeight: 17,
      color: p.inkDim,
      fontStyle: 'italic',
    },

    /* set sheet */
    setCardWrap: { marginTop: 12, overflow: 'hidden', borderRadius: 4 },
    sheet: {
      borderWidth: 1,
      borderColor: p.rule,
      backgroundColor: p.pageShade,
      borderRadius: 3,
      paddingVertical: 16,
      paddingHorizontal: 18,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.16,
      shadowRadius: 7,
      elevation: 2,
    },
    sheetTitle: {
      fontFamily: serif,
      fontSize: 15,
      fontWeight: '700',
      color: p.ink,
      letterSpacing: 2.4,
      textAlign: 'center',
      textTransform: 'uppercase',
    },
    sheetRule: { height: 1, marginTop: 8, marginBottom: 12 },
    sheetLines: { gap: 9 },
    sheetLine: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
    sheetSubject: { fontFamily: serif, color: p.ink, maxWidth: '55%' },
    sheetLeader: { flex: 1, borderBottomWidth: 1, borderStyle: 'dotted', marginBottom: 4, minWidth: 8 },
    sheetCount: { fontFamily: serif, fontWeight: '700', fontVariant: ['tabular-nums'] },
    sheetPlain: { fontFamily: serif, fontSize: 12.5, color: p.inkDim, lineHeight: 18 },
    sheetFoot: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      marginTop: 16,
    },
    sheetStatusLabel: {
      fontFamily: serif,
      fontSize: 11,
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      color: p.inkFaint,
    },

    /* recent activity */
    paperList: { marginTop: 10, gap: 2 },
    paperRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: p.rule,
    },
    paperRowTitle: { fontFamily: serif, fontWeight: '600', color: p.ink },
    paperRowMeta: { fontFamily: serif, fontSize: 11, color: p.inkDim, marginTop: 2 },

    /* shared */
    empty: { alignItems: 'center', gap: 8, paddingVertical: 26, paddingHorizontal: 8 },
    emptyTitle: { fontFamily: serif, fontSize: 15, fontWeight: '700', color: p.ink },
    emptyText: {
      fontFamily: serif,
      fontSize: 12.5,
      lineHeight: 18,
      color: p.inkDim,
      marginTop: 8,
    },
    turnShade: { backgroundColor: '#000' },
    previewError: {
      position: 'absolute',
      left: 20,
      right: 20,
      bottom: 28,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      backgroundColor: p.danger,
      borderRadius: 6,
      paddingVertical: 11,
      paddingHorizontal: 14,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.4,
      shadowRadius: 14,
      elevation: 10,
    },
    previewErrorText: { flex: 1, fontFamily: serif, fontSize: 12.5, color: '#fff', lineHeight: 18 },
  });
