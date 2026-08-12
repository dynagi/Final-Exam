import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
  FlipBook,
  FlipBookHandle,
  fluid,
  useArchiveLayout,
  useArchivePalette,
} from '../../components/ArchiveBook';
import { Seal } from '../../components/ArchiveControls';
import { BookArrow, PageIndicator } from '../../components/ArchiveUpload';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { showAlert } from '../../lib/alert';
import { fetchAll } from '../../lib/db';
import { timeAgo } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { labelFor, serif, toneFor } from '../../lib/theme';
import { Question } from '../../lib/types';
import { useTeacherIndex } from './useTeacherIndex';

const SELF = 'MyQuestions';
/** Printed height of one question slip incl. its gap — sizes a leaf's capacity. */
const SLIP_HEIGHT = 186;
/** pageInner's vertical padding, which is not usable leaf space. */
const LEAF_PADDING = 58;

export default function MyQuestionsScreen() {
  const { profile } = useAuth();
  const teacherId = profile?.id;
  const { colors } = useTheme();
  const p = useArchivePalette();
  const { stacked, outerPad, sidebarMode, pageWidth } = useArchiveLayout();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(p), [p]);

  const [questions, setQuestions] = useState<Question[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [indexOpen, setIndexOpen] = useState(false);
  const [spread, setSpread] = useState(0);

  const book = useRef<FlipBookHandle>(null);

  const load = useCallback(async () => {
    if (!teacherId) return;
    // Paged: a prolific teacher's bank can run past PostgREST's max-rows.
    const { rows, error } = await fetchAll<Question>(() =>
      supabase
        .from('questions')
        .select('*, exam:exams(name)')
        .eq('teacher_id', teacherId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
    );
    setQuestions(rows);
    setLoadError(error ? error.message : null);
  }, [teacherId]);

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

  /**
   * Withdraw a question that is not yet sealed into a paper. Sections are
   * capped at exactly what the exam format requires, so a full section can
   * only be changed by taking a question back out first.
   */
  const withdraw = async (question: Question) => {
    const { error } = await supabase.from('questions').delete().eq('id', question.id);
    if (error) {
      showAlert('Could not withdraw', error.message);
      return;
    }
    setQuestions((prev) => prev.filter((q) => q.id !== question.id));
  };

  /* ------------------------------ book paging ----------------------------- */

  // Height available to a leaf, and therefore how many slips fit on one. The
  // reserve covers the chapter head above and the folio below.
  const bookHeight = stacked ? undefined : Math.max(340, Math.min(winHeight - 190, 700));
  const perSide = stacked
    ? 3
    : Math.max(1, Math.min(5, Math.floor(((bookHeight ?? 560) - LEAF_PADDING) / SLIP_HEIGHT)));
  const perSpread = perSide * 2;
  const spreadCount = Math.max(1, Math.ceil(questions.length / perSpread));
  const bookWidth = Math.min(winWidth - (sidebarMode === 'overlay' ? 120 : 340), 1120);

  // Withdrawing the last question on the last spread must not strand the
  // reader past the end of the volume.
  useEffect(() => {
    if (spread > spreadCount - 1) setSpread(Math.max(0, spreadCount - 1));
  }, [spread, spreadCount]);

  const sideItems = useCallback(
    (spreadIndex: number, side: 'left' | 'right') => {
      const base = spreadIndex * perSpread + (side === 'right' ? perSide : 0);
      return questions.slice(base, base + perSide);
    },
    [questions, perSpread, perSide]
  );

  const renderSide = useCallback(
    (spreadIndex: number, side: 'left' | 'right') => {
      const items = sideItems(spreadIndex, side);
      if (items.length === 0) {
        return (
          <View style={styles.blankLeaf}>
            <Text style={styles.blankMark}>❧</Text>
          </View>
        );
      }
      return (
        <View style={styles.leafBody}>
          {items.map((q) => (
            <QuestionSlip
              key={q.id}
              q={q}
              palette={p}
              statusTone={toneFor(colors, q.status)}
              pageWidth={pageWidth}
              onWithdraw={() => void withdraw(q)}
            />
          ))}
        </View>
      );
    },
    // `withdraw` is stable enough for this render path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sideItems, p, colors, pageWidth, styles]
  );

  const { items, onSelect } = useTeacherIndex({
    active: SELF,
    onBeforeSelect: () => setIndexOpen(false),
  });

  const first = spread * perSpread + 1;
  const last = Math.min(questions.length, (spread + 1) * perSpread);

  /* -------------------------------- render -------------------------------- */

  const chapter = (
    <View style={styles.chapter}>
      <Text style={[styles.chapterTitle, { fontSize: fluid(pageWidth, 20, 30) }]}>
        My Questions
      </Text>
      {loadError ? (
        <Text style={styles.error}>Could not load your questions: {loadError}</Text>
      ) : (
        <Text style={styles.chapterSub}>
          {questions.length} question{questions.length === 1 ? '' : 's'} in the bank
          {questions.length > 0 ? ` · showing ${first}–${last}` : ''}
        </Text>
      )}
    </View>
  );

  const bookRow = (
    <View style={styles.bookRow}>
      <View style={styles.arrowSlot}>
        <BookArrow
          direction="prev"
          label="Previous page"
          disabled={spread <= 0}
          onPress={() => book.current?.prev()}
        />
      </View>

      <View style={styles.bookWrap}>
        <FlipBook
          ref={book}
          spread={spread}
          spreadCount={spreadCount}
          onSpread={setSpread}
          renderSide={renderSide}
          leftFolio="My Questions"
          rightFolio={`Page ${spread + 1} of ${spreadCount}`}
          height={bookHeight}
          width={bookWidth}
        />
      </View>

      <View style={styles.arrowSlot}>
        <BookArrow
          direction="next"
          label="Next page"
          disabled={spread >= spreadCount - 1}
          onPress={() => book.current?.next()}
        />
      </View>
    </View>
  );

  const foot = (
    <View style={styles.foot}>
      <PageIndicator
        page={spread + 1}
        pageCount={spreadCount}
        onGo={(n) => book.current?.goTo(n - 1)}
      />
    </View>
  );

  const empty = (
    <View style={[styles.empty, { borderColor: p.rule, backgroundColor: p.page }]}>
      <Ionicons name="document-text-outline" size={28} color={p.inkFaint} />
      <Text style={styles.emptyTitle}>No questions yet</Text>
      <Text style={styles.emptyText}>
        Questions you type or import from a PDF appear here with their lifecycle status.
      </Text>
    </View>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ArchiveBackground />
      <ArchiveHeader
        title="SECUREAI EXAM ARCHIVE"
        shortTitle="ARCHIVE"
        subtitle="Teacher · My Questions"
        onMenu={sidebarMode === 'overlay' ? () => setIndexOpen(true) : undefined}
      />

      <View style={styles.body}>
        {sidebarMode === 'overlay' ? null : (
          <ArchiveSidebar items={items} activeRoute={SELF} onSelect={onSelect} />
        )}

        {/* The book stays put in the viewport; turning a leaf is what moves,
            not the page. Phones keep an outer scroll and pull-to-refresh. */}
        {stacked ? (
          <ScrollView
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
            {chapter}
            {questions.length === 0 && !loadError ? empty : bookRow}
            {questions.length > 0 ? foot : null}
          </ScrollView>
        ) : (
          <View style={[styles.stage, { paddingHorizontal: outerPad }]}>
            {chapter}
            {questions.length === 0 && !loadError ? empty : bookRow}
            {questions.length > 0 ? foot : null}
          </View>
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

/* ------------------------------ question slip ----------------------------- */

/** One of the teacher's questions, printed on the leaf. */
function QuestionSlip({
  q,
  palette: p,
  statusTone,
  pageWidth,
  onWithdraw,
}: {
  q: Question;
  palette: ArchivePalette;
  statusTone: string;
  pageWidth: number;
  onWithdraw: () => void;
}) {
  const styles = useMemo(() => makeStyles(p), [p]);
  const hasOptions = q.question_type === 'mcq' || q.question_type === 'msq';

  return (
    <View style={styles.slip}>
      <View style={styles.slipHead}>
        <Seal label={labelFor(q.status).toUpperCase()} tone={statusTone} />
        <View style={[styles.pill, { borderColor: p.rule }]}>
          <Text style={styles.pillText}>{labelFor(q.question_type)}</Text>
        </View>
        {q.source === 'pdf' ? (
          <View style={[styles.pill, { borderColor: p.rule }]}>
            <Text style={styles.pillText}>PDF</Text>
          </View>
        ) : null}
        <Text style={styles.time}>{timeAgo(q.created_at)}</Text>
      </View>

      <Text style={[styles.slipBody, { fontSize: fluid(pageWidth, 11.5, 13.5) }]} numberOfLines={3}>
        {q.body}
      </Text>

      {hasOptions ? (
        <View style={styles.options}>
          {q.options.map((option, index) => {
            const isKey =
              q.question_type === 'mcq'
                ? index === q.correct_index
                : (q.correct_indices ?? []).includes(index);
            return (
              <Text
                key={index}
                style={[styles.option, isKey && { color: p.success, fontWeight: '700' }]}
                numberOfLines={1}
              >
                {String.fromCharCode(65 + index)}. {option}
                {isKey ? '  ✓' : ''}
              </Text>
            );
          })}
        </View>
      ) : q.question_type === 'numerical' ? (
        <Text style={styles.option}>Answer: {q.answer_numeric ?? '—'}</Text>
      ) : (
        <Text style={styles.theory}>Theory question · model answer set offline</Text>
      )}

      <View style={styles.slipFoot}>
        <Text style={styles.meta} numberOfLines={2}>
          {q.exam?.name ? `${q.exam.name} · ` : ''}
          {q.section_name ? `${q.section_name} · ` : ''}
          {q.subject}
          {q.topic ? ` · ${q.topic}` : ''} · {q.difficulty} · {q.marks} mark
          {q.marks === 1 ? '' : 's'}
        </Text>
        {q.status !== 'used' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Withdraw from bank: ${q.body.slice(0, 40)}`}
            onPress={onWithdraw}
            hitSlop={6}
            style={({ pressed }) => [
              styles.withdraw,
              { borderColor: p.danger },
              pressed && { backgroundColor: `${p.danger}18` },
            ]}
          >
            <Ionicons name="trash-outline" size={11} color={p.danger} />
            <Text style={[styles.withdrawText, { color: p.danger }]}>Withdraw</Text>
          </Pressable>
        ) : null}
      </View>
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
    stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, gap: 10 },

    /* chapter head */
    chapter: { alignItems: 'center', gap: 3 },
    chapterTitle: {
      fontFamily: serif,
      fontWeight: '700',
      color: p.onCover,
      letterSpacing: 2.4,
    },
    chapterSub: { fontFamily: serif, fontSize: 11.5, color: p.coverHighlight, letterSpacing: 0.8 },
    error: { fontFamily: serif, fontSize: 11.5, color: p.danger, textAlign: 'center' },

    /* book */
    // Arrows sit near the top corners of the book, not halfway down it.
    bookRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, maxWidth: '100%' },
    arrowSlot: { paddingTop: 14 },
    bookWrap: { flexShrink: 1 },
    foot: { alignItems: 'center' },
    leafBody: { flex: 1, gap: 9 },
    blankLeaf: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    blankMark: { fontFamily: serif, fontSize: 22, color: p.inkFaint, opacity: 0.5 },

    /* slip */
    slip: {
      borderWidth: 1,
      borderColor: p.rule,
      backgroundColor: p.pageShade,
      borderRadius: 3,
      paddingVertical: 9,
      paddingHorizontal: 11,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.12,
      shadowRadius: 5,
      elevation: 1,
    },
    slipHead: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 },
    pillText: {
      fontFamily: serif,
      fontSize: 8.5,
      fontWeight: '700',
      letterSpacing: 0.9,
      color: p.inkDim,
    },
    time: { fontFamily: serif, fontSize: 9.5, color: p.inkFaint, marginLeft: 'auto' },
    slipBody: { fontFamily: serif, color: p.ink, lineHeight: 18, marginTop: 6 },
    options: { marginTop: 5, gap: 1 },
    option: { fontFamily: serif, fontSize: 11, color: p.inkDim, lineHeight: 16 },
    theory: { fontFamily: serif, fontSize: 10.5, color: p.inkFaint, fontStyle: 'italic', marginTop: 5 },
    slipFoot: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 8,
      marginTop: 7,
    },
    meta: { flex: 1, fontFamily: serif, fontSize: 9.5, color: p.inkFaint, lineHeight: 13 },
    withdraw: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderWidth: 1,
      borderRadius: 3,
      paddingHorizontal: 7,
      paddingVertical: 3,
    },
    withdrawText: { fontFamily: serif, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.6 },

    /* empty */
    empty: {
      alignItems: 'center',
      gap: 9,
      borderWidth: 1,
      borderRadius: 4,
      paddingVertical: 32,
      paddingHorizontal: 26,
      maxWidth: 420,
    },
    emptyTitle: { fontFamily: serif, fontSize: 16, fontWeight: '700', color: p.ink },
    emptyText: {
      fontFamily: serif,
      fontSize: 12.5,
      color: p.inkDim,
      lineHeight: 18,
      textAlign: 'center',
    },
  });
