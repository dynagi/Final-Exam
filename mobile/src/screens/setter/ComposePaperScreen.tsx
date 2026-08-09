import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import PaperPreview from '../../components/PaperPreview';
import ScrollAlert, { ScrollAlertContent } from '../../components/ScrollAlert';
import {
  Button,
  Card,
  CeremonyModal,
  Chips,
  EmptyState,
  ExamPicker,
  Input,
  Pagination,
  Screen,
  SectionProgress,
  SectionTitle,
  Select,
  SelectOption,
} from '../../components/UI';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
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
import { labelFor, radius, spacing, ThemeColors } from '../../lib/theme';
import { ExamSetSummary, PaperView, Question } from '../../lib/types';
import { useScheduledExams } from '../../lib/useExams';
import { usePagination } from '../../lib/usePagination';

export default function ComposePaperScreen() {
  const { profile } = useAuth();
  const setterId = profile?.id;
  const { exams } = useScheduledExams();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

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

  const exam = exams.find((e) => e.id === examId) ?? null;
  const format = exam?.format_blueprint ?? null;
  const enforced = !!format?.enforced;

  /**
   * The whole bank for this exam — unlimited, so it is paged rather than
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
      setSetLabel((prev) => (prev && res.sets.some((s) => s.label === prev) ? prev : res.sets[0]?.label ?? null));
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

  const visiblePool = examPool.filter((q) => subject === 'All subjects' || q.subject === subject);

  /**
   * Page the bank. Selection lives in `selected` keyed by id, so ticking a
   * question on page 1 and another on page 8 builds one set — turning pages
   * never drops a choice, and the progress meters count the whole selection.
   */
  const pager = usePagination(visiblePool, 25);

  const setOptions: SelectOption[] = sets.map((s) => ({
    value: s.label,
    label: s.label,
    hint:
      s.status === 'not_started'
        ? 'Not started'
        : s.ready
          ? `${s.report.totals.current} questions · ready`
          : `${s.report.totals.current}/${s.report.totals.required ?? '—'} questions · incomplete`,
    tag:
      s.status === 'not_started'
        ? undefined
        : s.status !== 'draft'
          ? s.status.toUpperCase()
          : s.ready
            ? 'READY'
            : 'INCOMPLETE',
  }));

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
      showAlert('No questions', 'Select questions from the bank below.');
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
      showAlert('Weak passphrase', 'Use at least 8 characters. You will need it again at the print ceremony.');
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

  if (exams.length === 0) {
    return (
      <Screen>
        <EmptyState
          icon="calendar-clear-outline"
          title="No exams scheduled yet"
          subtitle="Papers are composed for a specific exam. Ask the Admin to schedule one — this screen unlocks automatically."
        />
      </Screen>
    );
  }

  const canPreview = report.ok && title.trim().length >= 4 && !!setLabel && !locked;
  const shortfall = report.errors[0] ?? null;

  return (
    <Screen scroll>
      <SectionTitle title="Exam" />
      <ExamPicker
        exams={exams}
        value={examId}
        onChange={(id) => {
          setExamId(id);
          setSelected({});
          setTitle('');
          setSubject('All subjects');
          setPendingPaperId(null);
          setView(null);
        }}
      />

      {examId ? (
        <>
          <SectionTitle title="Paper set" />
          <Card>
            <Select
              label="Which set are you building?"
              placeholder={sets.length ? 'Choose a paper set…' : 'Loading sets…'}
              value={setLabel}
              options={setOptions}
              onChange={switchSet}
              searchable={false}
              emptyText="The Admin has not configured any paper sets for this exam yet."
            />
            {locked ? (
              <Text style={styles.lockedNote}>
                🔒 {setLabel} is already {labelFor(activeSet!.status)} and can no longer be edited.
              </Text>
            ) : (
              <Text style={styles.setHint}>
                Each set is an independent paper.{' '}
                {allowReuse
                  ? 'Question reuse across sets is allowed for this exam.'
                  : 'A question used in one set cannot be used in another.'}
              </Text>
            )}
            {sets.length > 1 ? (
              <View style={styles.setSummary}>
                {sets.map((s) => (
                  <Pressable
                    key={s.label}
                    onPress={() => switchSet(s.label)}
                    style={[styles.setPill, s.label === setLabel && styles.setPillActive]}
                  >
                    <Text
                      style={[
                        styles.setPillText,
                        {
                          color:
                            s.status === 'not_started'
                              ? colors.textDim
                              : s.ready
                                ? colors.success
                                : colors.warning,
                        },
                      ]}
                    >
                      {s.label} {s.status === 'not_started' ? '—' : s.ready ? '✓' : '⚠'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </Card>
        </>
      ) : null}

      <SectionTitle title="Paper details" />
      <Card>
        <Input
          label="Paper title"
          placeholder={setLabel ? `e.g. "${exam?.name ?? 'Exam'} — ${setLabel}"` : 'e.g. "NEET 2026 — Set A"'}
          value={title}
          onChangeText={(t) => {
            setTitle(t);
            setPendingPaperId(null);
          }}
          editable={!locked}
        />
        <Text style={styles.fieldLabel}>Filter the bank by subject</Text>
        <Chips options={subjectOptions} value={subject} onChange={setSubject} />
      </Card>

      {examId && format ? (
        <>
          <SectionTitle
            title={enforced ? `${setLabel ?? 'Set'} requirements` : 'Exam format'}
            right={
              locked ? null : (
                <Pressable onPress={autoFill} hitSlop={8}>
                  <Text style={styles.autoFill}>Auto-fill</Text>
                </Pressable>
              )
            }
          />
          <Card>
            <Text style={styles.formatLine}>
              {format.display_name} · {format.body}
            </Text>
            {enforced ? (
              <>
                <Text style={styles.formatTotals}>
                  {report.totals.current}/{report.totals.required ?? '—'} questions ·{' '}
                  {report.totals.marks_current}/{report.totals.marks_required ?? '—'} marks
                </Text>
                <View style={styles.progressWrap}>
                  {report.sections.map((section) => (
                    <SectionProgress
                      key={section.name}
                      name={section.name}
                      current={section.current}
                      target={
                        section.required != null
                          ? `${section.required}`
                          : `${section.required_min}–${section.required_max}`
                      }
                      complete={section.complete}
                      over={section.over}
                      detail={section.requirements.map((r) => ({
                        label: r.label.replace(/^\d+(–\d+)?\s*/, ''),
                        current: r.current,
                        target: r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`,
                        ok: r.status === 'ok',
                      }))}
                      warning={sectionWarning(section)}
                    />
                  ))}
                </View>
              </>
            ) : (
              <Text style={styles.poolError}>
                ⚠ This exam has no question-count blueprint, so a paper cannot be composed or
                sealed for it. Ask the Admin to set the questions per section on the exam.
              </Text>
            )}
          </Card>
        </>
      ) : null}

      <SectionTitle
        title={`Question bank (${visiblePool.length}${
          visiblePool.length !== examPool.length ? ` of ${examPool.length}` : ''
        } available · ${selectedIds.length} selected)`}
      />
      {examId && examPool.length > 0 ? (
        <Card>
          <Text style={styles.bankBreakdownTitle}>In the bank for this exam</Text>
          <View style={styles.bankBreakdown}>
            {Object.entries(
              examPool.reduce<Record<string, number>>((acc, q) => {
                acc[q.subject] = (acc[q.subject] ?? 0) + 1;
                return acc;
              }, {})
            )
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([name, n]) => (
                <Pressable
                  key={name}
                  onPress={() => setSubject(subject === name ? 'All subjects' : name)}
                  style={[styles.bankChip, subject === name && styles.bankChipActive]}
                >
                  <Text
                    style={[styles.bankChipText, subject === name && { color: colors.primary }]}
                  >
                    {name} · {n}
                  </Text>
                </Pressable>
              ))}
          </View>
        </Card>
      ) : null}
      {poolError ? (
        <Card>
          <Text style={styles.poolError}>Could not load the bank: {poolError}</Text>
        </Card>
      ) : null}
      {!examId ? (
        <Card>
          <Text style={styles.emptyText}>
            Pick an exam above — only that exam's question bank can go into this paper.
          </Text>
        </Card>
      ) : visiblePool.length === 0 ? (
        <Card>
          <Text style={styles.emptyText}>
            No questions in the bank for this exam/subject yet. Teachers' uploads appear here as
            they arrive — the bank is unlimited, so build up as many as you like.
          </Text>
        </Card>
      ) : (
        <>
        <Pagination
          page={pager.page}
          pageCount={pager.pageCount}
          from={pager.from}
          to={pager.to}
          total={pager.total}
          pageSize={pager.pageSize}
          onPage={pager.setPage}
          onPageSize={pager.setPageSize}
        />
        {pager.pageItems.map((q) => {
          const isSelected = !!selected[q.id];
          const owner = ownedBy(q);
          // Nothing is disabled or dimmed: the whole bank is offered, and a
          // selection that would break the format is refused on tap instead.
          return (
            <Pressable key={q.id} onPress={() => toggle(q)}>
              <Card style={isSelected ? styles.cardSelected : undefined}>
                <View style={styles.qRow}>
                  <Ionicons
                    name={isSelected ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={isSelected ? colors.primary : colors.textDim}
                  />
                  <View style={{ flex: 1 }}>
                    <View style={styles.qTags}>
                      <View style={styles.typePill}>
                        <Text style={styles.typePillText}>{labelFor(q.question_type)}</Text>
                      </View>
                      {q.section_name ? (
                        <View style={styles.sectionPill}>
                          <Text style={styles.sectionPillText}>{q.section_name}</Text>
                        </View>
                      ) : null}
                      <Text style={styles.qMeta}>
                        {q.subject} · {q.difficulty} · {q.marks} mk
                      </Text>
                    </View>
                    <Text style={styles.qBody} numberOfLines={3}>
                      {q.body}
                    </Text>
                    {owner ? (
                      <Text
                        style={[
                          styles.qStatus,
                          { color: allowReuse ? colors.textDim : colors.warning },
                        ]}
                      >
                        Already used in {owner}
                        {allowReuse ? ' · reuse allowed' : ''}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </Card>
            </Pressable>
          );
        })}
        <Pagination
          page={pager.page}
          pageCount={pager.pageCount}
          from={pager.from}
          to={pager.to}
          total={pager.total}
          pageSize={pager.pageSize}
          onPage={pager.setPage}
        />
        </>
      )}

      <View style={styles.actions}>
        {enforced && !report.ok && selectedIds.length > 0 && shortfall ? (
          <View style={styles.blockerBox}>
            <Text style={styles.blockerTitle}>Cannot finalize paper</Text>
            <Text style={styles.blockerLine}>{shortfall}</Text>
            {report.errors.length > 1 ? (
              <Text style={styles.blockerLine}>+{report.errors.length - 1} more to resolve.</Text>
            ) : null}
          </View>
        ) : null}
        <Button
          title={`Save ${setLabel ?? 'Set'} as Draft`}
          variant="ghost"
          icon="save-outline"
          onPress={() => void onSaveDraft()}
          disabled={busy || locked}
          style={{ marginBottom: spacing.sm }}
        />
        <Button
          title="Preview Paper"
          icon="eye-outline"
          onPress={() => void openPreview()}
          loading={busy}
          disabled={!canPreview}
        />
        <Text style={styles.actionHint}>
          {locked
            ? 'This set is sealed. Pick another set to continue.'
            : canPreview
              ? 'Review the final paper, then confirm to encrypt this set.'
              : 'Every section must hold exactly the questions the format requires before this set can be previewed.'}
        </Text>
      </View>

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
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    fieldLabel: {
      color: colors.textDim,
      fontSize: 13,
      fontWeight: '600',
      marginBottom: spacing.sm,
    },
    autoFill: { color: colors.primary, fontSize: 13, fontWeight: '700' },
    formatLine: { color: colors.text, fontSize: 13, fontWeight: '700' },
    formatTotals: { color: colors.accent, fontSize: 12, fontWeight: '700', marginTop: 4 },
    progressWrap: { marginTop: spacing.md },
    setHint: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
    lockedNote: { color: colors.warning, fontSize: 12, lineHeight: 17 },
    setSummary: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
    setPill: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sm,
      paddingHorizontal: 10,
      paddingVertical: 5,
      backgroundColor: colors.surfaceAlt,
    },
    setPillActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
    setPillText: { fontSize: 12, fontWeight: '800' },
    emptyText: {
      color: colors.textDim,
      fontSize: 14,
      lineHeight: 20,
    },
    poolError: { color: colors.danger, fontSize: 13, fontWeight: '700', lineHeight: 19 },
    bankBreakdownTitle: {
      color: colors.textDim,
      fontSize: 12,
      fontWeight: '700',
      marginBottom: spacing.sm,
    },
    bankBreakdown: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    bankChip: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 5,
      backgroundColor: colors.surfaceAlt,
    },
    bankChipActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
    bankChipText: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
    cardSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
      borderRadius: radius.lg,
    },
    qRow: {
      flexDirection: 'row',
      gap: spacing.md,
      alignItems: 'flex-start',
    },
    qTags: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginBottom: 4,
    },
    typePill: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    typePillText: {
      color: colors.textDim,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.4,
    },
    sectionPill: {
      backgroundColor: colors.primarySoft,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    sectionPillText: { color: colors.primary, fontSize: 10, fontWeight: '800' },
    qBody: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
    },
    qMeta: {
      color: colors.textDim,
      fontSize: 12,
    },
    qStatus: { color: colors.textFaint, fontSize: 11, marginTop: 4, fontWeight: '600' },
    actions: {
      marginTop: spacing.lg,
    },
    blockerBox: {
      borderWidth: 1,
      borderColor: colors.warning,
      borderRadius: radius.sm,
      padding: spacing.md,
      marginBottom: spacing.md,
      backgroundColor: colors.surface,
    },
    blockerTitle: { color: colors.warning, fontSize: 13, fontWeight: '800', marginBottom: 4 },
    blockerLine: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
    actionHint: {
      color: colors.textDim,
      fontSize: 12,
      lineHeight: 17,
      textAlign: 'center',
      marginTop: spacing.sm,
    },
  });
