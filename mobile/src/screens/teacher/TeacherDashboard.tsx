import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
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
  StatBlock,
  fluid,
  useArchiveLayout,
  useArchivePalette,
  useFitScale,
} from '../../components/ArchiveBook';
import { Seal } from '../../components/ArchiveControls';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { fetchAll } from '../../lib/db';
import { timeAgo } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { labelFor, serif, toneFor } from '../../lib/theme';
import { Question } from '../../lib/types';
import { useTeacherIndex } from './useTeacherIndex';

const SELF = 'TeacherDashboard';

export default function TeacherDashboard() {
  const { profile } = useAuth();
  const teacherId = profile?.id;

  const p = useArchivePalette();
  // Status tones come from the app theme, so a "USED IN PAPER" seal means the
  // same colour here as everywhere else.
  const { colors } = useTheme();
  const { stacked, outerPad, sidebarMode, pageWidth } = useArchiveLayout();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(p), [p]);

  const [questions, setQuestions] = useState<Question[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [indexOpen, setIndexOpen] = useState(false);

  const load = useCallback(async () => {
    if (!teacherId) return;
    const { rows } = await fetchAll<Question>(() =>
      supabase
        .from('questions')
        .select('*')
        .eq('teacher_id', teacherId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
    );
    setQuestions(rows);
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

  const count = (status: Question['status']) =>
    questions.filter((q) => q.status === status).length;
  const mcqCount = questions.filter((q) => q.question_type === 'mcq').length;
  const theoryCount = questions.length - mcqCount;

  const { items, onSelect } = useTeacherIndex({
    active: SELF,
    onBeforeSelect: () => setIndexOpen(false),
  });

  const recent = useMemo(() => questions.slice(0, 5), [questions]);
  // Re-fit whenever the questions or the leaf's width change.
  const fit = useFitScale(
    `${recent.map((q) => q.id).join(',')}|${Math.round(pageWidth)}`,
    { min: 0.5 }
  );

  /* -------------------------------- pages -------------------------------- */

  const leftPage = (
    <View style={styles.leftPage}>
      <PageTitle eyebrow="Question archive" size={[22, 32]}>
        Namaste, {profile?.full_name ?? 'Teacher'} 👋
      </PageTitle>
      <Text style={styles.sub}>Your contributions to the secure question bank</Text>

      <Rule ornament gap={16} />

      <View style={styles.statGrid}>
        <StatBlock label="Total" value={questions.length} caption="Questions you have written" />
        <StatBlock label="MCQ" value={mcqCount} caption="Multiple choice" tone={p.info} />
        <StatBlock
          label="Theory"
          value={theoryCount}
          caption="All non-MCQ types"
          tone={p.warning}
        />
        <StatBlock
          label="In Papers"
          value={count('used')}
          caption="Sealed into a paper"
          tone={p.gold}
        />
      </View>

      <Rule gap={16} />

      <View style={[styles.note, { borderColor: p.rule, backgroundColor: `${p.pageShade}99` }]}>
        <Ionicons name="lock-closed" size={15} color={p.info} style={styles.noteIcon} />
        <Text style={styles.noteText}>
          Once a Paper Setter uses your question, it is sealed inside an encrypted paper that no
          single person — not even an admin — can open alone.
        </Text>
      </View>
    </View>
  );

  const rightPage = (
    <View style={stacked ? undefined : styles.flex}>
      <PageTitle center size={[19, 27]}>
        Recent Questions
      </PageTitle>
      <Rule ornament gap={14} />

      {questions.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="document-text-outline" size={26} color={p.inkFaint} />
          <Text style={styles.emptyTitle}>Nothing written yet</Text>
          <Text style={styles.emptyText}>
            Open Upload to type questions or import them from a PDF. They appear here as soon as
            they are saved.
          </Text>
        </View>
      ) : stacked ? (
        // Phones flow at full size — the page grows and the outer view scrolls.
        <View>
          {recent.map((q) => (
            <QuestionSlip
              key={q.id}
              q={q}
              palette={p}
              statusTone={toneFor(colors, q.status)}
              pageWidth={pageWidth}
              scale={1}
            />
          ))}
        </View>
      ) : (
        // Spread: shrink the type until every question fits the leaf, so the
        // whole list is readable at once with nothing cut off.
        <View style={styles.flex}>
          <ScrollView
            style={styles.flex}
            // The height budget is read here rather than from a wrapper View —
            // see the note on FitScale.onAvailable.
            onLayout={fit.onAvailable}
            showsVerticalScrollIndicator={false}
            // Scrolling is only unlocked if the type would have to go below the
            // legible floor — otherwise everything is on the page already.
            scrollEnabled={fit.overflowing}
          >
            <View onLayout={fit.onContent}>
              {recent.map((q) => (
                <QuestionSlip
                  key={q.id}
                  q={q}
                  palette={p}
                  statusTone={toneFor(colors, q.status)}
                  pageWidth={pageWidth}
                  scale={fit.scale}
                />
              ))}
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  );

  const book = (
    <OpenBook
      left={leftPage}
      right={rightPage}
      leftFolio="The Record"
      rightFolio={`${questions.length} question${questions.length === 1 ? '' : 's'} written`}
    />
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ArchiveBackground />
      <ArchiveHeader
        title="SECUREAI EXAM ARCHIVE"
        shortTitle="ARCHIVE"
        subtitle="Teacher · Volume I"
        onMenu={sidebarMode === 'overlay' ? () => setIndexOpen(true) : undefined}
      />

      <View style={styles.body}>
        {sidebarMode === 'overlay' ? null : (
          <ArchiveSidebar items={items} activeRoute={SELF} onSelect={onSelect} />
        )}

        {/* The spread never scrolls as a page: the book is centred and fixed,
            and only the question list moves. Stacked phones keep an outer
            scroll (and with it pull-to-refresh), where there is no option. */}
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
            {book}
          </ScrollView>
        ) : (
          <View style={[styles.fixedStage, { paddingHorizontal: outerPad }]}>{book}</View>
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

/* ------------------------------ page pieces ------------------------------- */

/**
 * One of the teacher's own questions, as an archived slip.
 *
 * `scale` comes from useFitScale and multiplies every size on the slip — type,
 * padding and gaps together — so the block shrinks evenly rather than turning
 * into small text floating in full-size boxes.
 */
function QuestionSlip({
  q,
  palette: p,
  statusTone,
  pageWidth,
  scale,
}: {
  q: Question;
  palette: ArchivePalette;
  statusTone: string;
  pageWidth: number;
  scale: number;
}) {
  const styles = useMemo(() => makeStyles(p), [p]);
  const s = (n: number) => Math.round(n * scale * 10) / 10;
  const body = fluid(pageWidth, 12.5, 14.5) * scale;

  return (
    <View
      style={[
        styles.slip,
        { paddingVertical: s(12), paddingHorizontal: s(14), marginBottom: s(11) },
      ]}
    >
      <View style={[styles.slipHead, { marginBottom: s(9), gap: s(8) }]}>
        <View style={[styles.slipHeadLeft, { gap: s(7) }]}>
          <Seal label={labelFor(q.status).toUpperCase()} tone={statusTone} scale={scale} />
          <View
            style={[
              styles.slipPill,
              { borderColor: p.rule, paddingHorizontal: s(8), paddingVertical: s(2) },
            ]}
          >
            <Text style={[styles.slipPillText, { fontSize: s(9.5) }]}>
              {labelFor(q.question_type)}
            </Text>
          </View>
        </View>
        <Text style={[styles.slipTime, { fontSize: s(10.5) }]}>{timeAgo(q.created_at)}</Text>
      </View>

      <Text style={[styles.slipBody, { fontSize: body, lineHeight: body * 1.38 }]}>{q.body}</Text>

      <Text style={[styles.slipMeta, { fontSize: s(11), marginTop: s(9) }]}>
        {q.subject} · {q.difficulty} · {q.marks} mark{q.marks === 1 ? '' : 's'}
      </Text>
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
    fixedStage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 16 },

    /* left page */
    leftPage: { flex: 1 },
    sub: {
      fontFamily: serif,
      fontSize: 12.5,
      color: p.inkDim,
      marginTop: 4,
      fontStyle: 'italic',
    },
    statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    note: { flexDirection: 'row', gap: 10, borderWidth: 1, borderRadius: 3, padding: 13 },
    noteIcon: { marginTop: 1 },
    noteText: { flex: 1, fontFamily: serif, fontSize: 12, lineHeight: 18, color: p.inkDim },

    /* right page */
    slip: {
      borderWidth: 1,
      borderColor: p.rule,
      backgroundColor: p.pageShade,
      borderRadius: 3,
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginBottom: 11,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.14,
      shadowRadius: 6,
      elevation: 2,
    },
    slipHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      marginBottom: 9,
    },
    slipHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
    slipPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    slipPillText: {
      fontFamily: serif,
      fontSize: 9.5,
      fontWeight: '700',
      letterSpacing: 1,
      color: p.inkDim,
    },
    slipTime: { fontFamily: serif, fontSize: 10.5, color: p.inkFaint },
    slipBody: { fontFamily: serif, color: p.ink, lineHeight: 20 },
    slipMeta: { fontFamily: serif, fontSize: 11, color: p.inkDim, marginTop: 9 },

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
  });
