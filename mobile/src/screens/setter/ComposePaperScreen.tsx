import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArchiveBackground,
  ArchiveHeader,
  ArchiveIndexOverlay,
  ArchivePalette,
  ArchiveSidebar,
  OpenBook,
  Rule,
  fluid,
  useArchiveLayout,
  useArchivePalette,
  usePageTurn,
} from '../../components/ArchiveBook';
import {
  BookButton,
  BookField,
  BookPagination,
  CenteredHeading,
  ExamScale,
  PillRow,
  PlaqueButton,
  RequirementsBookmark,
  Seal,
} from '../../components/ArchiveControls';
import PaperPreview from '../../components/PaperPreview';
import ScrollAlert, { ScrollAlertContent } from '../../components/ScrollAlert';
import { CeremonyModal } from '../../components/UI';
import { useAuth } from '../../context/AuthContext';
import { showAlert } from '../../lib/alert';
import {
  confirmPaperPreview,
  fetchExamSets,
  previewPaper,
  savePaperSet,
  sealPaper,
} from '../../lib/api';
import { fetchAll } from '../../lib/db';
import { CompositionReport, sectionWarning, validateComposition } from '../../lib/examFormats';
import { supabase } from '../../lib/supabase';
import { labelFor, serif } from '../../lib/theme';
import { ExamSetSummary, PaperView, Question } from '../../lib/types';
import { useScheduledExams } from '../../lib/useExams';
import { PAGE_SIZES, usePagination } from '../../lib/usePagination';
import { useSetterIndex } from './useSetterIndex';

const SELF = 'Compose';

export default function ComposePaperScreen() {
  const { profile } = useAuth();
  const setterId = profile?.id;
  const { exams } = useScheduledExams();

  const p = useArchivePalette();
  const { stacked, outerPad, sidebarMode, pageWidth } = useArchiveLayout();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(p), [p]);

  const [examId, setExamId] = useState<string | null>(null);
  const [setLabel, setSetLabel] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState<string>('All subjects');
  const [pool, setPool] = useState<Question[]>([]);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  // Per-set state from the server: completion, and which set owns which question.
  const [sets, setSets] = useState<ExamSetSummary[]>([]);
  const [usage, setUsage] = useState<Record<string, string>>({});
  const [allowReuse, setAllowReuse] = useState(false);

  // Preview → confirm → seal
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [view, setView] = useState<PaperView | null>(null);
  const [serverReport, setServerReport] = useState<CompositionReport | null>(null);
  const [sealModal, setSealModal] = useState(false);
  const [pendingPaperId, setPendingPaperId] = useState<string | null>(null);
  const [sealing, setSealing] = useState(false);
  /** Centre-screen royal-decree popup for a refused selection. */
  const [decree, setDecree] = useState<ScrollAlertContent | null>(null);

  // Book furniture
  const [indexOpen, setIndexOpen] = useState(false);
  const [scaleOpen, setScaleOpen] = useState(false);
  const [reqOpen, setReqOpen] = useState(false);

  const exam = exams.find((e) => e.id === examId) ?? null;
  const format = exam?.format_blueprint ?? null;
  const enforced = !!format?.enforced;

  /**
   * The whole bank for this exam — large, so it is paged rather than
   * fetched in one shot (a single request stops at PostgREST's max-rows and
   * would hide questions from the setter without saying so).
   */
  const loadPool = useCallback(async () => {
    if (!examId) {
      setPool([]);
      setPoolError(null);
      return;
    }
    const { rows, error } = await fetchAll<Question>(() =>
      supabase
        .from('questions')
        .select('*')
        .eq('exam_id', examId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
    );
    setPool(rows);
    setPoolError(error ? error.message : null);
  }, [examId]);

  const loadSets = useCallback(async () => {
    if (!examId) {
      setSets([]);
      setUsage({});
      return;
    }
    try {
      const res = await fetchExamSets(examId);
      setSets(res.sets);
      setUsage(res.usage);
      setAllowReuse(res.exam.allow_question_reuse);
      setSetLabel((prev) =>
        prev && res.sets.some((s) => s.label === prev) ? prev : (res.sets[0]?.label ?? null)
      );
    } catch {
      setSets([]);
    }
  }, [examId]);

  useFocusEffect(
    useCallback(() => {
      void loadPool();
      void loadSets();
    }, [loadPool, loadSets])
  );

  const activeSet = sets.find((s) => s.label === setLabel) ?? null;
  const locked = !!activeSet && activeSet.status !== 'not_started' && activeSet.status !== 'draft';

  /** Load a set's saved selection when the setter switches to it. */
  const switchSet = (label: string) => {
    setSetLabel(label);
    const target = sets.find((s) => s.label === label);
    setSelected(Object.fromEntries((target?.question_ids ?? []).map((id) => [id, true])));
    setTitle(target?.title ?? '');
    setPendingPaperId(target?.paper_id ?? null);
    setView(null);
  };

  const selectedIds = Object.keys(selected).filter((id) => selected[id]);
  const examPool = pool;
  const selectedQuestions = useMemo(
    () => examPool.filter((q) => selected[q.id]),
    [examPool, selected]
  );

  /**
   * Live composition report for the CURRENT SET. The server re-runs the
   * identical check when the set is saved, previewed, confirmed and sealed —
   * this only drives the meters and the disabled states.
   */
  const report = useMemo(
    () =>
      validateComposition(
        format,
        selectedQuestions.map((q) => ({
          id: q.id,
          section_name: q.section_name,
          question_type: q.question_type,
          marks: q.marks,
        }))
      ),
    [format, selectedQuestions]
  );

  /** Which other set already owns this question (null when free to use). */
  const ownedBy = (q: Question): string | null => {
    const owner = usage[q.id];
    return owner && owner !== setLabel ? owner : null;
  };

  /** Subject counts in this exam's bank, used to label the filter pills. */
  const subjectCounts = useMemo(
    () =>
      examPool.reduce<Record<string, number>>((acc, q) => {
        acc[q.subject] = (acc[q.subject] ?? 0) + 1;
        return acc;
      }, {}),
    [examPool]
  );

  const subjectOptions = useMemo(() => {
    const fromFormat = format?.subjects ?? [];
    const fromPool = Array.from(new Set(examPool.map((q) => q.subject)));
    return ['All subjects', ...Array.from(new Set([...fromFormat, ...fromPool])).sort()];
  }, [format, examPool]);

  // Never leave a subject selected that this exam has no questions for —
  // that reads as "the bank is empty" when it is only mis-filtered.
  useEffect(() => {
    if (subject !== 'All subjects' && !subjectOptions.includes(subject)) setSubject('All subjects');
  }, [subjectOptions, subject]);

  /**
   * Memoised: the paginator slices this, and the right leaf holds the sliced
   * rows in state across a page turn. A new array identity every render would
   * re-fire that state update and spin the screen.
   */
  const visiblePool = useMemo(
    () => examPool.filter((q) => subject === 'All subjects' || q.subject === subject),
    [examPool, subject]
  );

  /**
   * Page the bank. Selection lives in `selected` keyed by id, so ticking a
   * question on page 1 and another on page 8 builds one set — turning pages
   * never drops a choice, and the progress meters count the whole selection.
   */
  const pager = usePagination(visiblePool, 25);

  /** Fill the current set with what each quota still needs, skipping other sets' questions. */
  const autoFill = () => {
    if (!enforced || !format) {
      setSelected(Object.fromEntries(examPool.map((q) => [q.id, true])));
      return;
    }
    const next: Record<string, boolean> = {};
    for (const section of format.sections) {
      const available = examPool.filter(
        (q) => q.section_name === section.name && (allowReuse || !ownedBy(q))
      );
      const taken = new Set<string>();
      for (const requirement of section.requirements) {
        const matches = available
          .filter(
            (q) =>
              !taken.has(q.id) &&
              requirement.types.includes(q.question_type) &&
              q.marks === requirement.marks_correct
          )
          .slice(0, requirement.max);
        for (const q of matches) {
          taken.add(q.id);
          next[q.id] = true;
        }
      }
    }
    setSelected(next);
  };

  /**
   * Every question in the bank stays visible and tappable. A selection that
   * would break the format is refused at the moment of the tap, with the
   * reason unfurled in the centre of the screen — nothing is hidden or
   * greyed out beforehand.
   */
  const toggle = (q: Question) => {
    // Deselecting is always allowed.
    if (selected[q.id]) {
      setSelected((prev) => ({ ...prev, [q.id]: false }));
      setPendingPaperId(null);
      return;
    }

    if (locked) {
      setDecree({
        title: 'This set is sealed',
        message: `${setLabel} has already been encrypted and can no longer be edited. Choose another paper set to carry on composing.`,
      });
      return;
    }

    const owner = ownedBy(q);
    if (owner && !allowReuse) {
      setDecree({
        title: 'Question already committed',
        message: `Every paper set must hold its own questions, and this one already belongs to ${owner}. Pick a different question, or ask the Admin to enable “Allow question reuse across sets”.`,
        detail: `Already used in ${owner}`,
      });
      return;
    }

    // No blueprint means no limit can be applied, so composing is refused
    // outright rather than silently accepting any number of questions.
    if (!enforced) {
      setDecree({
        title: 'This exam has no question limits',
        message:
          'No question-count blueprint is attached to this exam, so a paper cannot be limited or sealed. Ask the Admin to set the questions per section for it.',
      });
      return;
    }

    const section = report.sections.find((s) => s.name === q.section_name);
    const requirement = section?.requirements.find(
      (r) => r.types.includes(q.question_type) && r.marks_correct === q.marks
    );

    if (!section || !requirement) {
      setDecree({
        title: 'Not part of this format',
        message: `${format?.display_name ?? 'This exam format'} has no slot for a ${labelFor(
          q.question_type
        )} worth ${q.marks} mark${q.marks === 1 ? '' : 's'} in ${q.section_name ?? 'that section'}.`,
      });
      return;
    }

    if (requirement.current >= requirement.max) {
      setDecree({
        title: 'You are not allowed to select more questions',
        message: `${section.name} takes exactly ${requirement.max} × ${requirement.label} in every paper set. Deselect one before choosing another.`,
        detail: `${section.name}  ${requirement.current} / ${requirement.max}`,
      });
      return;
    }

    setSelected((prev) => ({ ...prev, [q.id]: true }));
    setPendingPaperId(null);
  };

  const resetAfterSeal = () => {
    setSelected({});
    setTitle('');
    setPendingPaperId(null);
    setView(null);
    setServerReport(null);
    void loadPool();
    void loadSets();
  };

  /** Persist the current set's selection; returns the paper id. */
  const saveSet = async (announce: boolean): Promise<string | null> => {
    if (!setterId || !examId || !setLabel) {
      showAlert('Pick an exam and set', 'Choose the exam and which paper set you are building.');
      return null;
    }
    if (title.trim().length < 4) {
      showAlert('Missing title', 'Give the paper a title (e.g. "JEE Main 2026 — Set A").');
      return null;
    }
    if (selectedIds.length === 0) {
      showAlert('No questions', 'Select questions from the bank on the right page.');
      return null;
    }
    try {
      const res = await savePaperSet({
        examId,
        setLabel,
        title: title.trim(),
        questionIds: selectedQuestions.map((q) => q.id),
      });
      setPendingPaperId(res.paper.id);
      await loadSets();
      if (announce) {
        showAlert(
          `${setLabel} saved`,
          res.report.ok
            ? 'Complete. Preview it to confirm, then encrypt.'
            : 'Saved as a draft — finish the remaining questions before it can be previewed.'
        );
      }
      return res.paper.id;
    } catch (e) {
      showAlert('Could not save the set', e instanceof Error ? e.message : 'Unknown error');
      return null;
    }
  };

  const onSaveDraft = async () => {
    setBusy(true);
    await saveSet(true);
    setBusy(false);
  };

  /** Save, then render the server's version of the final paper. */
  const openPreview = async () => {
    setBusy(true);
    try {
      const paperId = await saveSet(false);
      if (!paperId) return;
      setPreviewOpen(true);
      setPreviewLoading(true);
      const res = await previewPaper(paperId);
      setView(res.view);
      setServerReport(res.report);
    } catch (e) {
      setPreviewOpen(false);
      showAlert('Preview failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
      setPreviewLoading(false);
    }
  };

  const confirmAndSeal = async () => {
    if (!pendingPaperId) return;
    setBusy(true);
    try {
      await confirmPaperPreview(pendingPaperId);
      setPreviewOpen(false);
      setSealModal(true);
    } catch (e) {
      showAlert('Cannot confirm', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const handleSeal = async (values: Record<string, string>) => {
    const passphrase = values.passphrase ?? '';
    if (passphrase.length < 8) {
      showAlert(
        'Weak passphrase',
        'Use at least 8 characters. You will need it again at the print ceremony.'
      );
      return;
    }
    if (!pendingPaperId) return;
    setSealing(true);
    try {
      await sealPaper(pendingPaperId, passphrase);
      setSealModal(false);
      showAlert(
        `${setLabel} sealed 🔐`,
        'Encrypted with AES-256. You hold key share 1 of 2. Switch to the next set to carry on.'
      );
      resetAfterSeal();
    } catch (e) {
      showAlert('Sealing failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSealing(false);
    }
  };

  /* ------------------------------ page turns ------------------------------ */

  const pageTurn = usePageTurn({ duration: 720, angle: 88 });
  // The rows the leaf currently shows, held back until the leaf is edge-on so
  // no question is seen twice mid-turn.
  const [shownItems, setShownItems] = useState<Question[]>(pager.pageItems);
  const turning = useRef(false);

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

  /* -------------------------------- derived ------------------------------- */

  const canPreview = report.ok && title.trim().length >= 4 && !!setLabel && !locked;
  const shortfall = report.errors[0] ?? null;
  const reqStatus = enforced
    ? `${report.totals.current}/${report.totals.required ?? '—'} ${report.ok ? '✓' : '⚠'}`
    : undefined;
  const reqTone = !enforced ? p.warning : report.ok ? p.success : p.warning;

  const onPickExam = (id: string) => {
    setScaleOpen(false);
    if (id === examId) return;
    setExamId(id);
    setSelected({});
    setTitle('');
    setSubject('All subjects');
    setPendingPaperId(null);
    setView(null);
  };

  /* --------------------------------- pages -------------------------------- */

  const leftPage = (
    <View style={styles.leftPage}>
      <CenteredHeading>Exam</CenteredHeading>
      <View style={styles.block}>
        <PlaqueButton
          value={exam?.name ?? 'Choose an examination'}
          icon="reader-outline"
          accessibilityLabel="Choose examination"
          onPress={() => setScaleOpen(true)}
        />
      </View>

      <CenteredHeading>Paper set</CenteredHeading>
      <View style={styles.block}>
        {sets.length === 0 ? (
          <Text style={styles.hint}>
            {examId
              ? 'The Admin has not configured any paper sets for this exam yet.'
              : 'Pick an examination to see its paper sets.'}
          </Text>
        ) : (
          <>
            <View style={styles.setTabs}>
              {sets.map((s) => {
                const active = s.label === setLabel;
                const tone =
                  s.status === 'not_started' ? p.inkFaint : s.ready ? p.success : p.warning;
                return (
                  <Pressable
                    key={s.label}
                    accessibilityRole="button"
                    accessibilityLabel={`${s.label}, ${s.status.replace(/_/g, ' ')}`}
                    accessibilityState={{ selected: active }}
                    onPress={() => switchSet(s.label)}
                    style={[
                      styles.setTab,
                      { borderColor: active ? p.gold : p.rule },
                      active && { backgroundColor: p.goldSoft, borderWidth: 2 },
                    ]}
                  >
                    <Text style={[styles.setTabText, { color: active ? p.ink : p.inkDim }]}>
                      {s.label}
                    </Text>
                    <Text style={[styles.setTabMark, { color: tone }]}>
                      {s.status === 'not_started' ? '—' : s.ready ? '✓' : '⚠'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.hint}>
              {locked
                ? `🔒 ${setLabel} is already ${labelFor(activeSet!.status)} and can no longer be edited.`
                : allowReuse
                  ? 'Each set is an independent paper. Question reuse across sets is allowed.'
                  : 'Each set is an independent paper. A question used in one set cannot be used in another.'}
            </Text>
          </>
        )}
      </View>

      <CenteredHeading>Paper details</CenteredHeading>
      <View style={styles.block}>
        <View style={[styles.detailCard, { borderColor: p.rule, backgroundColor: `${p.pageShade}99` }]}>
          <BookField
            label="Paper title"
            placeholder={
              setLabel ? `${exam?.name ?? 'Exam'} — ${setLabel}` : 'e.g. NEET 2026 — Set A'
            }
            value={title}
            onChangeText={(t) => {
              setTitle(t);
              setPendingPaperId(null);
            }}
            editable={!locked}
          />
          <Text style={[styles.detailLabel, { color: p.inkFaint }]}>Filter the bank by subject</Text>
          <PillRow
            options={subjectOptions.map((s) =>
              s !== 'All subjects' && subjectCounts[s] ? `${s} · ${subjectCounts[s]}` : s
            )}
            value={
              subject !== 'All subjects' && subjectCounts[subject]
                ? `${subject} · ${subjectCounts[subject]}`
                : subject
            }
            onChange={(v) => setSubject(v.split(' · ')[0])}
          />
        </View>
      </View>

      {/* Set requirements live entirely on the bookmark at the top of the
          book — see RequirementsBookmark below. */}

      <CenteredHeading>Question bank</CenteredHeading>
      <View style={styles.bankLine}>
        <Text style={styles.bankCount}>
          {visiblePool.length}
          {visiblePool.length !== examPool.length ? ` of ${examPool.length}` : ''}
        </Text>
        <Text style={styles.bankLabel}>available ·</Text>
        <Text style={[styles.bankCount, { color: selectedIds.length > 0 ? p.success : p.ink }]}>
          {selectedIds.length}
        </Text>
        <Text style={styles.bankLabel}>selected</Text>
      </View>
      {poolError ? <Text style={styles.error}>Could not load the bank: {poolError}</Text> : null}
    </View>
  );

  const rightPage = (
    <View style={stacked ? undefined : styles.flex}>
      {/* Pagination left, actions right, one row — except on a stacked phone
          leaf, where there is not room for both and they wrap instead. */}
      <View style={[styles.topBar, stacked && styles.topBarStacked]}>
        <View style={[styles.topBarPager, stacked && styles.topBarPagerStacked]}>
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
        </View>
        <View style={styles.topBarActions}>
          <BookButton
            title={`Save ${setLabel ?? 'Set'} as Draft`}
            icon="save-outline"
            onPress={() => void onSaveDraft()}
            disabled={busy || locked}
            compact
          />
          <BookButton
            title="Preview Paper"
            icon="eye-outline"
            variant="gold"
            onPress={() => void openPreview()}
            loading={busy}
            disabled={!canPreview}
            compact
          />
        </View>
      </View>
      <Rule gap={10} />

      <ScrollIfSpread stacked={stacked}>
        <Animated.View style={pageTurn.style}>
          {!examId ? (
            <Empty
              icon="reader-outline"
              title="No examination chosen"
              text="Pick an exam on the left page — only that exam's question bank can go into this paper."
              palette={p}
            />
          ) : shownItems.length === 0 ? (
            <Empty
              icon="library-outline"
              title="Nothing in the bank yet"
              text="No questions for this exam and subject. Teachers' uploads appear here as they arrive."
              palette={p}
            />
          ) : (
            shownItems.map((q) => (
              <QuestionSlip
                key={q.id}
                q={q}
                palette={p}
                pageWidth={pageWidth}
                selected={!!selected[q.id]}
                owner={ownedBy(q)}
                allowReuse={allowReuse}
                onPress={() => toggle(q)}
              />
            ))
          )}
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.turnShade, pageTurn.shadeStyle]}
          />
        </Animated.View>
      </ScrollIfSpread>
    </View>
  );

  /* ------------------------------- requirements ---------------------------- */

  const requirementsInsert = (
    <>
      <View style={styles.insertHead}>
        <Text style={[styles.insertTitle, { color: p.pamphletInk }]}>
          {enforced ? `${setLabel ?? 'Set'} requirements` : 'Exam format'}
        </Text>
        {!locked && examId ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Auto-fill this set" onPress={autoFill} hitSlop={8}>
            <Text style={[styles.autoFill, { color: p.pamphletEdge }]}>Auto-fill</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={[styles.insertRule, { backgroundColor: `${p.pamphletEdge}66` }]} />

      {!format ? (
        <Text style={[styles.insertNote, { color: p.pamphletInkDim }]}>
          Pick an examination to see what its paper sets require.
        </Text>
      ) : !enforced ? (
        <Text style={[styles.insertNote, { color: p.warning }]}>
          ⚠ This exam has no question-count blueprint, so a paper cannot be composed or sealed for
          it. Ask the Admin to set the questions per section on the exam.
        </Text>
      ) : (
        <ScrollView style={styles.insertScroll} showsVerticalScrollIndicator={false}>
          <Text style={[styles.insertFormat, { color: p.pamphletInkDim }]}>
            {format.display_name} · {format.body}
          </Text>
          {report.sections.map((section) => {
            const warn = sectionWarning(section);
            return (
              <View key={section.name} style={styles.reqRow}>
                <View style={styles.reqRowHead}>
                  <Text style={[styles.reqName, { color: p.pamphletInk }]} numberOfLines={1}>
                    {section.name}
                  </Text>
                  <Text
                    style={[styles.reqCount, { color: section.complete ? p.success : p.warning }]}
                  >
                    {section.current} /{' '}
                    {section.required != null
                      ? section.required
                      : `${section.required_min}–${section.required_max}`}{' '}
                    {section.complete ? '✓' : '⚠'}
                  </Text>
                </View>
                <View style={styles.reqChips}>
                  {section.requirements.map((r) => (
                    <Text
                      key={r.label}
                      style={[
                        styles.reqChip,
                        { color: r.status === 'ok' ? p.pamphletInkDim : p.warning },
                      ]}
                    >
                      {r.label.replace(/^\d+(–\d+)?\s*/, '')} {r.current}/
                      {r.min === r.max ? r.min : `${r.min}–${r.max}`}
                    </Text>
                  ))}
                </View>
                {warn ? <Text style={[styles.reqWarn, { color: p.warning }]}>⚠ {warn}</Text> : null}
              </View>
            );
          })}

          <View style={[styles.insertRule, { backgroundColor: `${p.pamphletEdge}66` }]} />
          <View style={styles.reqTotals}>
            <Text style={[styles.reqTotalLabel, { color: p.pamphletInkDim }]}>Total</Text>
            <Text style={[styles.reqTotalValue, { color: report.ok ? p.success : p.pamphletInk }]}>
              {report.totals.current} / {report.totals.required ?? '—'} questions ·{' '}
              {report.totals.marks_current} / {report.totals.marks_required ?? '—'} marks
            </Text>
          </View>

          {enforced && !report.ok && selectedIds.length > 0 && shortfall ? (
            <View style={[styles.blocker, { borderColor: p.warning }]}>
              <Text style={[styles.blockerTitle, { color: p.warning }]}>Cannot finalize paper</Text>
              <Text style={[styles.blockerLine, { color: p.pamphletInkDim }]}>{shortfall}</Text>
              {report.errors.length > 1 ? (
                <Text style={[styles.blockerLine, { color: p.pamphletInkDim }]}>
                  +{report.errors.length - 1} more to resolve.
                </Text>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      )}
    </>
  );

  /* --------------------------------- render -------------------------------- */

  const book = (
    <View style={styles.bookWrap}>
      <RequirementsBookmark
        open={reqOpen}
        onToggle={() => setReqOpen((v) => !v)}
        label="Requirements"
        status={reqStatus}
        tone={reqTone}
      >
        {requirementsInsert}
      </RequirementsBookmark>

      <OpenBook
        left={leftPage}
        right={rightPage}
        leftFolio={exam ? `${exam.name} · ${setLabel ?? 'No set'}` : 'Composition'}
        rightFolio={`Question bank · page ${pager.page} of ${pager.pageCount}`}
      />
    </View>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ArchiveBackground />
      <ArchiveHeader
        title="SECUREAI EXAM ARCHIVE"
        shortTitle="ARCHIVE"
        subtitle="Paper Setter · Compose"
        onMenu={sidebarMode === 'overlay' ? () => setIndexOpen(true) : undefined}
      />

      <View style={styles.body}>
        {sidebarMode === 'overlay' ? null : (
          <ArchiveSidebar items={items} activeRoute={SELF} onSelect={onSelect} />
        )}

        {/* Composing must not scroll the page: on the spread the book is
            centred and fixed, and only the question list scrolls. Stacked
            phones keep an outer scroll, where there is no other option. */}
        {stacked ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingHorizontal: outerPad, paddingBottom: 20 + insets.bottom },
            ]}
            showsVerticalScrollIndicator={false}
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

      <ExamScale
        visible={scaleOpen}
        exams={exams.map((e) => ({ id: e.id, name: e.name, exam_date: e.exam_date }))}
        selectedId={examId}
        onSelect={onPickExam}
        onClose={() => setScaleOpen(false)}
      />

      <ScrollAlert content={decree} onClose={() => setDecree(null)} />

      <PaperPreview
        visible={previewOpen}
        view={view}
        report={serverReport}
        loading={previewLoading}
        busy={busy}
        onBack={() => setPreviewOpen(false)}
        onConfirm={() => void confirmAndSeal()}
      />

      <CeremonyModal
        visible={sealModal}
        title={`Sealing Ceremony — ${setLabel ?? 'Paper'} · Key Share 1/2`}
        subtitle="You have confirmed the preview. Your passphrase wraps the first half of the encryption key. Without it (plus the Admin's share), this paper can never be decrypted. Do not forget it."
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
        onClose={() => setSealModal(false)}
      />
    </View>
  );
}

/* ------------------------------ page pieces ------------------------------- */

function ScrollIfSpread({ children, stacked }: { children: React.ReactNode; stacked: boolean }) {
  if (stacked) return <View>{children}</View>;
  return (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}

function Empty({
  icon,
  title,
  text,
  palette: p,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  text: string;
  palette: ArchivePalette;
}) {
  const styles = useMemo(() => makeStyles(p), [p]);
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={26} color={p.inkFaint} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

/** One bank question, as a tickable slip on the page. */
function QuestionSlip({
  q,
  palette: p,
  pageWidth,
  selected,
  owner,
  allowReuse,
  onPress,
}: {
  q: Question;
  palette: ArchivePalette;
  pageWidth: number;
  selected: boolean;
  owner: string | null;
  allowReuse: boolean;
  onPress: () => void;
}) {
  const styles = useMemo(() => makeStyles(p), [p]);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={q.body}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[
        styles.slip,
        { borderColor: selected ? p.gold : p.rule },
        selected && { backgroundColor: p.goldSoft, borderWidth: 2 },
      ]}
    >
      <Ionicons
        name={selected ? 'checkbox' : 'square-outline'}
        size={19}
        color={selected ? p.gold : p.inkFaint}
        style={styles.slipBox}
      />
      <View style={styles.flex}>
        <View style={styles.slipTags}>
          <View style={[styles.slipPill, { borderColor: p.rule }]}>
            <Text style={styles.slipPillText}>{labelFor(q.question_type)}</Text>
          </View>
          {q.section_name ? (
            <View style={[styles.slipPill, { borderColor: `${p.gold}77` }]}>
              <Text style={[styles.slipPillText, { color: p.gold }]}>{q.section_name}</Text>
            </View>
          ) : null}
          <Text style={styles.slipMeta}>
            {q.subject} · {q.difficulty} · {q.marks} mk
          </Text>
        </View>
        {/* No line clamp: the slip grows to whatever the question needs, so
            nothing is hidden from the setter choosing it. */}
        <Text style={[styles.slipBody, { fontSize: fluid(pageWidth, 12.5, 14.5) }]}>{q.body}</Text>
        {owner ? (
          <View style={styles.slipOwner}>
            <Seal
              label={`USED IN ${owner.toUpperCase()}`}
              tone={allowReuse ? p.inkFaint : p.warning}
            />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/* --------------------------------- styles --------------------------------- */

const makeStyles = (p: ArchivePalette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: p.backdrop },
    body: { flex: 1, flexDirection: 'row' },
    scrollContent: { paddingVertical: 16 },
    // The spread stage never scrolls: the book is centred and fixed in it.
    fixedStage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 16 },
    // Positioning context for the bookmark tab and its insert.
    bookWrap: { alignSelf: 'center', maxWidth: '100%' },

    /* left page */
    leftPage: { flex: 1 },
    block: { marginTop: 8, marginBottom: 12 },
    hint: {
      fontFamily: serif,
      fontSize: 11,
      lineHeight: 16,
      color: p.inkDim,
      textAlign: 'center',
      marginTop: 8,
      fontStyle: 'italic',
    },
    setTabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
    setTab: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderWidth: 1,
      borderRadius: 3,
      paddingVertical: 7,
      paddingHorizontal: 14,
    },
    setTabText: { fontFamily: serif, fontSize: 13, fontWeight: '700', letterSpacing: 0.8 },
    setTabMark: { fontFamily: serif, fontSize: 12, fontWeight: '700' },
    detailCard: { borderWidth: 1, borderRadius: 3, paddingVertical: 11, paddingHorizontal: 12, gap: 9 },
    detailLabel: {
      fontFamily: serif,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
    },
    bankLine: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'center',
      gap: 5,
      marginTop: 10,
      flexWrap: 'wrap',
    },
    bankCount: {
      fontFamily: serif,
      fontSize: 17,
      fontWeight: '700',
      color: p.ink,
      fontVariant: ['tabular-nums'],
    },
    bankLabel: { fontFamily: serif, fontSize: 11.5, color: p.inkDim },
    error: {
      fontFamily: serif,
      fontSize: 11.5,
      color: p.danger,
      textAlign: 'center',
      marginTop: 8,
      lineHeight: 17,
    },

    /* right page */
    // Deliberately nowrap: the spec puts the actions on the pagination's own
    // row. Both cells shrink instead of the actions dropping to a second line.
    // Deliberately nowrap: the spec puts the actions on the pagination's own
    // row. The pager must not flex-grow, or it eats the space the buttons need
    // and drops them onto a second line.
    topBar: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, flexWrap: 'nowrap' },
    topBarStacked: { flexWrap: 'wrap' },
    topBarPager: { flexShrink: 1, flexGrow: 0, minWidth: 148 },
    topBarPagerStacked: { flexBasis: '100%', minWidth: 0 },
    topBarActions: {
      flexDirection: 'row',
      gap: 6,
      flex: 1,
      flexWrap: 'nowrap',
      justifyContent: 'flex-end',
    },

    /* question slips */
    slip: {
      flexDirection: 'row',
      gap: 10,
      borderWidth: 1,
      borderRadius: 3,
      backgroundColor: p.pageShade,
      paddingVertical: 11,
      paddingHorizontal: 12,
      marginBottom: 10,
    },
    slipBox: { marginTop: 1 },
    slipTags: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 5 },
    slipPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 },
    slipPillText: {
      fontFamily: serif,
      fontSize: 9,
      fontWeight: '700',
      letterSpacing: 0.8,
      color: p.inkDim,
    },
    slipMeta: { fontFamily: serif, fontSize: 10.5, color: p.inkFaint },
    slipBody: { fontFamily: serif, color: p.ink, lineHeight: 19 },
    slipOwner: { marginTop: 7, alignSelf: 'flex-start' },

    /* requirements insert */
    insertHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    insertTitle: {
      fontFamily: serif,
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 2,
      textTransform: 'uppercase',
    },
    autoFill: {
      fontFamily: serif,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    insertRule: { height: 1, marginVertical: 10 },
    insertNote: { fontFamily: serif, fontSize: 12, lineHeight: 18 },
    insertScroll: { maxHeight: 300 },
    insertFormat: { fontFamily: serif, fontSize: 11, marginBottom: 10, fontStyle: 'italic' },
    reqRow: { marginBottom: 11 },
    reqRowHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
    reqName: { fontFamily: serif, fontSize: 13.5, fontWeight: '700', flexShrink: 1 },
    reqCount: { fontFamily: serif, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
    reqChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 3 },
    reqChip: { fontFamily: serif, fontSize: 10.5 },
    reqWarn: { fontFamily: serif, fontSize: 10.5, marginTop: 4, lineHeight: 15 },
    reqTotals: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
    reqTotalLabel: {
      fontFamily: serif,
      fontSize: 10.5,
      letterSpacing: 1.4,
      textTransform: 'uppercase',
    },
    reqTotalValue: { fontFamily: serif, fontSize: 12.5, fontWeight: '700' },
    blocker: { borderWidth: 1, borderRadius: 3, padding: 10, marginTop: 12 },
    blockerTitle: { fontFamily: serif, fontSize: 12, fontWeight: '700', marginBottom: 3 },
    blockerLine: { fontFamily: serif, fontSize: 11, lineHeight: 16 },

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
