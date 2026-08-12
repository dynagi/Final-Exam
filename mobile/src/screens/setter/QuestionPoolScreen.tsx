import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  ArchivePalette,
  ArchiveSidebar,
  OpenBook,
  PageTitle,
  Rule,
  fluid,
  useArchiveLayout,
  useArchivePalette,
  usePageTurn,
} from '../../components/ArchiveBook';
import {
  ApproveButton,
  ArchiveNote,
  BookPagination,
  CenteredHeading,
  ExamPamphlet,
  NoteLine,
  PamphletOption,
  PillRow,
  PlaqueButton,
  Seal,
  TeacherBlackboard,
} from '../../components/ArchiveControls';
import { showAlert } from '../../lib/alert';
import { fetchAll } from '../../lib/db';
import { timeAgo } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { labelFor, serif, toneFor } from '../../lib/theme';
import { Question, QuestionStatus } from '../../lib/types';
import { useScheduledExams } from '../../lib/useExams';
import { PAGE_SIZES, usePagination } from '../../lib/usePagination';
import { useTheme } from '../../context/ThemeContext';
import { useSetterIndex } from './useSetterIndex';

type PoolQuestion = Question & { teacher?: { full_name: string } | null };

const SELF = 'QuestionPool';

const TYPE_FILTERS = ['All types', 'MCQ', 'MSQ', 'Numerical', 'Theory'] as const;
const FILTER_TYPE: Record<string, Question['question_type']> = {
  MCQ: 'mcq',
  MSQ: 'msq',
  Numerical: 'numerical',
  Theory: 'theoretical',
};

const STATUS_FILTERS = ['All', 'Pending approval', 'Approved', 'Used in a paper'] as const;
const FILTER_STATUS: Record<string, QuestionStatus> = {
  'Pending approval': 'submitted',
  Approved: 'approved',
  'Used in a paper': 'used',
};

const ALL_TEACHERS = 'All teachers';

export default function QuestionPoolScreen() {
  const { exams } = useScheduledExams();
  const p = useArchivePalette();
  // The status tones are defined once in the app theme; reuse them so a
  // "SUBMITTED" seal here means the same colour it does everywhere else.
  const { colors } = useTheme();
  const { stacked, outerPad, sidebarMode, pageWidth } = useArchiveLayout();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(p), [p]);

  const [questions, setQuestions] = useState<PoolQuestion[]>([]);
  const [examId, setExamId] = useState<string | null>(null);
  const [subjectFilter, setSubjectFilter] = useState('All');
  const [teacherFilter, setTeacherFilter] = useState(ALL_TEACHERS);
  const [typeFilter, setTypeFilter] = useState<string>('All types');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [approving, setApproving] = useState<string | null>(null);

  const [indexOpen, setIndexOpen] = useState(false);
  const [pamphletOpen, setPamphletOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);

  /**
   * The whole bank, paged. A single request would silently stop at
   * PostgREST's max-rows and the setter would approve from a truncated list
   * without ever being told.
   */
  const load = useCallback(async () => {
    const { rows, error } = await fetchAll<PoolQuestion>(() =>
      supabase
        .from('questions')
        .select('*, teacher:profiles(full_name), exam:exams(name)')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
    );
    setQuestions(rows);
    setLoadError(error ? error.message : null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // Realtime: new teacher uploads land in the pool instantly.
  useEffect(() => {
    const channel = supabase
      .channel('questions-pool')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'questions' },
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

  const approve = async (question: PoolQuestion) => {
    setApproving(question.id);
    const { error } = await supabase
      .from('questions')
      .update({ status: 'approved' })
      .eq('id', question.id);
    setApproving(null);
    if (error) {
      showAlert('Failed', error.message);
      return;
    }
    setQuestions((prev) =>
      prev.map((q) => (q.id === question.id ? { ...q, status: 'approved' } : q))
    );
  };

  /** Everything for the chosen exam — the base every other filter narrows. */
  const examScoped = useMemo(
    () => questions.filter((q) => (examId ? q.exam_id === examId : true)),
    [questions, examId]
  );

  // Subjects and teachers are derived from the questions that actually exist
  // for this exam — no hardcoded lists.
  const subjectFilters = useMemo(
    () => ['All', ...Array.from(new Set(examScoped.map((q) => q.subject))).sort()],
    [examScoped]
  );
  const teacherFilters = useMemo(
    () => [
      ALL_TEACHERS,
      ...Array.from(new Set(examScoped.map((q) => q.teacher?.full_name ?? 'Unknown'))).sort(),
    ],
    [examScoped]
  );

  /**
   * Switching exams used to leave a subject or teacher chip selected that the
   * new exam has no questions for, collapsing the list to nothing with no
   * explanation. Drop any selection the current exam cannot satisfy.
   */
  useEffect(() => {
    if (subjectFilter !== 'All' && !subjectFilters.includes(subjectFilter)) setSubjectFilter('All');
    if (teacherFilter !== ALL_TEACHERS && !teacherFilters.includes(teacherFilter)) {
      setTeacherFilter(ALL_TEACHERS);
    }
  }, [subjectFilters, teacherFilters, subjectFilter, teacherFilter]);

  /**
   * Memoised deliberately: the paginator slices this array, and the leaf holds
   * the sliced rows in state while a page turns. A fresh array every render
   * would give `pageItems` a new identity each time, re-fire that state update
   * and spin the screen in an endless render loop.
   */
  const visible = useMemo(
    () =>
      examScoped
        .filter((q) => subjectFilter === 'All' || q.subject === subjectFilter)
        .filter(
          (q) =>
            teacherFilter === ALL_TEACHERS ||
            (q.teacher?.full_name ?? 'Unknown') === teacherFilter
        )
        .filter((q) => typeFilter === 'All types' || q.question_type === FILTER_TYPE[typeFilter])
        .filter((q) => statusFilter === 'All' || q.status === FILTER_STATUS[statusFilter]),
    [examScoped, subjectFilter, teacherFilter, typeFilter, statusFilter]
  );

  const pendingCount = visible.filter((q) => q.status === 'submitted').length;
  const anyFilter =
    !!examId ||
    subjectFilter !== 'All' ||
    teacherFilter !== ALL_TEACHERS ||
    typeFilter !== 'All types' ||
    statusFilter !== 'All';

  const clearFilters = () => {
    setExamId(null);
    setSubjectFilter('All');
    setTeacherFilter(ALL_TEACHERS);
    setTypeFilter('All types');
    setStatusFilter('All');
  };

  // Page the filtered list. Approving a question mutates it in place, so the
  // current page stays put instead of jumping back to the top.
  const pager = usePagination(visible, 25);

  /* ------------------------------ page turns ------------------------------ */

  const pageTurn = usePageTurn({ duration: 720, angle: 88 });
  // The rows the leaf is currently showing. Held one render behind the pager
  // so the outgoing page keeps its questions until the leaf is edge-on — no
  // flash of the next page's content, and no empty frame mid-turn.
  const [shownItems, setShownItems] = useState<PoolQuestion[]>(pager.pageItems);
  const turning = useRef(false);

  // Filter changes (and approvals) must show immediately; only an explicit
  // page turn is allowed to hold the old rows back.
  useEffect(() => {
    if (!turning.current) setShownItems(pager.pageItems);
  }, [pager.pageItems]);

  const turnToPage = useCallback(
    (next: number, direction: 1 | -1) => {
      turning.current = true;
      pageTurn.turn(direction, () => {
        pager.setPage(next);
        turning.current = false;
      });
    },
    [pageTurn, pager]
  );

  /* --------------------------------- index -------------------------------- */

  const { items, onSelect } = useSetterIndex({
    active: SELF,
    onBeforeSelect: () => setIndexOpen(false),
  });

  /* ------------------------------- pamphlet ------------------------------- */

  const examOptions = useMemo<PamphletOption[]>(
    () => [
      { id: null, label: 'All examinations' },
      ...exams.map((e) => ({ id: e.id, label: e.name, hint: e.exam_date })),
    ],
    [exams]
  );
  const examLabel = examId ? (exams.find((e) => e.id === examId)?.name ?? 'All exams') : 'All exams';

  /* -------------------------------- pages -------------------------------- */

  const leftPage = (
    <ScrollViewIfSpread stacked={stacked}>
      <PageTitle eyebrow="Question archive">Pool</PageTitle>
      <Rule ornament gap={14} />

      <CenteredHeading>All exams</CenteredHeading>
      <View style={styles.controlBlock}>
        <PlaqueButton
          value={examLabel}
          icon="albums-outline"
          accessibilityLabel="Choose examination"
          onPress={() => setPamphletOpen(true)}
        />
      </View>

      <CenteredHeading>All subject</CenteredHeading>
      <View style={styles.controlBlock}>
        <PillRow options={subjectFilters} value={subjectFilter} onChange={setSubjectFilter} />
      </View>

      <CenteredHeading>All teachers</CenteredHeading>
      <View style={styles.controlBlock}>
        <PlaqueButton
          value={teacherFilter}
          icon="people-outline"
          accessibilityLabel="Choose teacher"
          onPress={() => setBoardOpen(true)}
        />
      </View>

      <CenteredHeading>All types</CenteredHeading>
      <View style={styles.controlBlock}>
        <PillRow options={TYPE_FILTERS} value={typeFilter} onChange={setTypeFilter} />
      </View>

      <CenteredHeading>All</CenteredHeading>
      <View style={styles.controlBlock}>
        <PillRow options={STATUS_FILTERS} value={statusFilter} onChange={setStatusFilter} />
      </View>

      <Rule gap={14} />

      {loadError ? (
        <Text style={styles.error}>Could not load the bank: {loadError}</Text>
      ) : (
        <ArchiveNote>
          <NoteLine
            value={`${visible.length} of ${examScoped.length}`}
            label={examId ? 'shown in this exam' : 'shown in the archive'}
          />
          <NoteLine value={`${questions.length}`} label="in the bank" />
          <NoteLine
            value={`${pendingCount}`}
            label="awaiting approval"
            tone={pendingCount > 0 ? p.warning : undefined}
          />
        </ArchiveNote>
      )}

      {anyFilter ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear filters"
          onPress={clearFilters}
          hitSlop={8}
          style={styles.clearWrap}
        >
          <Text style={styles.clear}>Clear filters</Text>
        </Pressable>
      ) : null}
    </ScrollViewIfSpread>
  );

  const rightPage = (
    <View style={stacked ? undefined : styles.flex}>
      {/* Pinned to the top of the leaf; the questions scroll beneath it. */}
      <BookPagination
        page={pager.page}
        pageCount={pager.pageCount}
        from={pager.from}
        to={pager.to}
        total={pager.total}
        pageSize={pager.pageSize}
        onTurn={turnToPage}
        onPageSize={pager.setPageSize}
        sizes={PAGE_SIZES}
      />
      <Rule gap={10} />

      <ScrollViewIfSpread stacked={stacked}>
        <Animated.View style={pageTurn.style}>
          {shownItems.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="library-outline" size={26} color={p.inkFaint} />
              <Text style={styles.emptyTitle}>
                {questions.length === 0 ? 'The pool is empty' : 'Nothing matches these filters'}
              </Text>
              <Text style={styles.emptyText}>
                {questions.length === 0
                  ? 'Questions uploaded by teachers appear here in real time.'
                  : `${questions.length} question(s) are in the bank — clear a filter on the left page to see them.`}
              </Text>
            </View>
          ) : (
            shownItems.map((item) => (
              <QuestionSheet
                key={item.id}
                item={item}
                palette={p}
                statusTone={toneFor(colors, item.status)}
                pageWidth={pageWidth}
                busy={approving === item.id}
                onApprove={() => void approve(item)}
              />
            ))
          )}
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.turnShade, pageTurn.shadeStyle]}
          />
        </Animated.View>
      </ScrollViewIfSpread>
    </View>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ArchiveBackground />
      <ArchiveHeader
        title="SECUREAI EXAM ARCHIVE"
        shortTitle="ARCHIVE"
        subtitle="Paper Setter · Question Pool"
        onMenu={sidebarMode === 'overlay' ? () => setIndexOpen(true) : undefined}
      />

      <View style={styles.body}>
        {sidebarMode === 'overlay' ? null : (
          <ArchiveSidebar items={items} activeRoute={SELF} onSelect={onSelect} />
        )}
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.scrollContent,
            !stacked && styles.scrollContentWide,
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
            leftFolio="Filters & Tally"
            rightFolio={`Questions · page ${pager.page} of ${pager.pageCount}`}
          />
        </ScrollView>
      </View>

      <ArchiveIndexOverlay
        visible={indexOpen}
        items={items}
        activeRoute={SELF}
        onSelect={onSelect}
        onClose={() => setIndexOpen(false)}
      />

      <ExamPamphlet
        visible={pamphletOpen}
        options={examOptions}
        selected={examId}
        onSelect={(id) => {
          setExamId(id);
          setPamphletOpen(false);
        }}
        onClose={() => setPamphletOpen(false)}
      />

      <TeacherBlackboard
        visible={boardOpen}
        teachers={teacherFilters}
        selected={teacherFilter}
        onSelect={(name) => {
          setTeacherFilter(name);
          setBoardOpen(false);
        }}
        onClose={() => setBoardOpen(false)}
      />
    </View>
  );
}

/**
 * A leaf scrolls its own content on the spread, and simply flows it when the
 * pages are stacked — otherwise a `flex: 1` scroller inside a content-sized
 * page collapses to nothing.
 */
function ScrollViewIfSpread({
  children,
  stacked,
}: {
  children: React.ReactNode;
  stacked: boolean;
}) {
  if (stacked) return <View>{children}</View>;
  return (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}

/* ------------------------------ question card ----------------------------- */

/** One question, set as a printed slip on the page. */
function QuestionSheet({
  item,
  palette: p,
  statusTone,
  pageWidth,
  busy,
  onApprove,
}: {
  item: PoolQuestion;
  palette: ArchivePalette;
  statusTone: string;
  pageWidth: number;
  busy: boolean;
  onApprove: () => void;
}) {
  const styles = useMemo(() => makeStyles(p), [p]);
  return (
    <View style={styles.qSheet}>
      <View style={styles.qHead}>
        <View style={styles.qHeadLeft}>
          <Seal label={labelFor(item.status).toUpperCase()} tone={statusTone} />
          <View style={[styles.qType, { borderColor: p.rule }]}>
            <Text style={styles.qTypeText}>{labelFor(item.question_type)}</Text>
          </View>
        </View>
        <Text style={styles.qTime}>{timeAgo(item.created_at)}</Text>
      </View>

      <Text style={[styles.qBody, { fontSize: fluid(pageWidth, 13, 15) }]}>{item.body}</Text>

      <Text style={styles.qMeta}>
        {item.exam?.name ? `${item.exam.name} · ` : ''}
        {item.section_name ? `${item.section_name} · ` : ''}
        {item.subject} · {item.difficulty} · {item.marks} mk · by{' '}
        {item.teacher?.full_name ?? 'Unknown'}
      </Text>

      {item.status === 'submitted' ? (
        <View style={styles.qActions}>
          <ApproveButton onPress={onApprove} busy={busy} />
        </View>
      ) : null}
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
    scrollContentWide: { flexGrow: 1, justifyContent: 'center' },

    /* left page */
    controlBlock: { marginTop: 10, marginBottom: 16 },
    error: { fontFamily: serif, fontSize: 12, color: p.danger, textAlign: 'center', lineHeight: 18 },
    clearWrap: { alignSelf: 'center', marginTop: 12, paddingVertical: 4, paddingHorizontal: 10 },
    clear: {
      fontFamily: serif,
      fontSize: 11,
      color: p.gold,
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      fontWeight: '700',
    },

    /* question sheets */
    qSheet: {
      borderWidth: 1,
      borderColor: p.rule,
      backgroundColor: p.pageShade,
      borderRadius: 3,
      paddingVertical: 13,
      paddingHorizontal: 14,
      marginBottom: 12,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.14,
      shadowRadius: 6,
      elevation: 2,
    },
    qHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      marginBottom: 9,
    },
    qHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
    qType: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    qTypeText: {
      fontFamily: serif,
      fontSize: 9.5,
      fontWeight: '700',
      letterSpacing: 1,
      color: p.inkDim,
    },
    qTime: { fontFamily: serif, fontSize: 10.5, color: p.inkFaint },
    qBody: { fontFamily: serif, color: p.ink, lineHeight: 21 },
    qMeta: { fontFamily: serif, fontSize: 11, color: p.inkDim, marginTop: 9, lineHeight: 16 },
    qActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 11 },

    /* shared */
    empty: { alignItems: 'center', gap: 8, paddingVertical: 34, paddingHorizontal: 10 },
    emptyTitle: { fontFamily: serif, fontSize: 15, fontWeight: '700', color: p.ink },
    emptyText: {
      fontFamily: serif,
      fontSize: 12.5,
      lineHeight: 18,
      color: p.inkDim,
      textAlign: 'center',
    },
    turnShade: { backgroundColor: '#000' },
  });
