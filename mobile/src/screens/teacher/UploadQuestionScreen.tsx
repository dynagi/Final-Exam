import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Button,
  Card,
  Chips,
  EmptyState,
  ExamPicker,
  Input,
  Screen,
  SectionProgress,
  SectionTitle,
  Select,
  SelectOption,
} from '../../components/UI';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { showAlert } from '../../lib/alert';
import { extractQuestions, submitQuestions } from '../../lib/api';
import { fetchAll } from '../../lib/db';
import { CompositionInput, FormatSection, sectionsForTeacher, TYPE_SHORT } from '../../lib/examFormats';
import { pickPdf } from '../../lib/pdf';
import { supabase } from '../../lib/supabase';
import { radius, spacing, ThemeColors } from '../../lib/theme';
import { ExtractedQuestion, NewQuestionInput, QuestionType } from '../../lib/types';
import { useScheduledExams } from '../../lib/useExams';

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const OPTION_LABELS = ['A', 'B', 'C', 'D'] as const;
const FREE_TYPES: { key: QuestionType; label: string }[] = [
  { key: 'mcq', label: 'MCQ' },
  { key: 'theoretical', label: 'Theory' },
];
// Seed suggestions, used only when the exam has no format to drive subjects.
const SEED_SUBJECTS = ['Physics', 'Chemistry', 'Biology', 'Mathematics', 'General Studies'];
/** Above this, an import is split into batches and worth showing progress for. */
const QUESTION_BATCH_HINT = 200;

/**
 * One writable slot in the format: a (section, type, marks) triple.
 *
 * `banked` is how many such questions already exist for the exam and
 * `perPaper` how many each paper set needs. The bank is UNLIMITED, so a slot
 * is never "full" — banking 500 questions for a 25-question section is the
 * point. The exact-count rule applies when a set is composed.
 */
interface Slot {
  key: string;
  sectionName: string;
  subject: string;
  type: QuestionType;
  marks: number;
  label: string;
  banked: number;
  perPaper: number;
}

export default function UploadQuestionScreen() {
  const { profile } = useAuth();
  const { exams } = useScheduledExams();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [mode, setMode] = useState<'manual' | 'pdf'>('manual');
  const [examId, setExamId] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [subjectSuggestions, setSubjectSuggestions] = useState<string[]>(SEED_SUBJECTS);

  // Format-driven state
  const [assigned, setAssigned] = useState<string[] | null>(null);
  const [bank, setBank] = useState<CompositionInput[]>([]);
  const [slotKey, setSlotKey] = useState<string | null>(null);

  // Manual form
  const [qType, setQType] = useState<QuestionType>('mcq');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState<string>('medium');
  const [marks, setMarks] = useState('1');
  const [body, setBody] = useState('');
  const [options, setOptions] = useState<string[]>(['', '', '', '']);
  const [correct, setCorrect] = useState<string>('A');
  /** MSQ answer key — several options may be correct. */
  const [correctMulti, setCorrectMulti] = useState<Record<string, boolean>>({ A: true });
  const [numericAnswer, setNumericAnswer] = useState('');
  const [busy, setBusy] = useState(false);

  // PDF import
  const [pdfName, setPdfName] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [engine, setEngine] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedQuestion[]>([]);
  const [picked, setPicked] = useState<Record<number, boolean>>({});
  const [importing, setImporting] = useState(false);
  /** "400/1000" while a large import streams through in batches. */
  const [importProgress, setImportProgress] = useState<string | null>(null);

  const exam = exams.find((e) => e.id === examId) ?? null;
  const format = exam?.format_blueprint ?? null;
  const enforced = !!format?.enforced;
  // How many independent papers the bank has to supply.
  const setCount = exam?.paper_set_count ?? 1;

  // Dynamically grow the subject quick-picks (only used without a format).
  const loadSubjects = useCallback(async () => {
    const { data } = await supabase.from('questions').select('subject').limit(500);
    const fromDb = (data as { subject: string }[] | null)?.map((r) => r.subject) ?? [];
    setSubjectSuggestions(Array.from(new Set([...SEED_SUBJECTS, ...fromDb])).sort());
  }, []);

  /** Everything already in this exam's bank, paged — the bank is unbounded. */
  const loadBank = useCallback(async () => {
    if (!examId) {
      setBank([]);
      return;
    }
    const { rows } = await fetchAll<CompositionInput>(() =>
      supabase
        .from('questions')
        .select('id, section_name, question_type, marks')
        .eq('exam_id', examId)
        .order('id', { ascending: false })
    );
    setBank(rows);
  }, [examId]);

  /** Subject assignment, if the Admin restricted this teacher for this exam. */
  const loadAssignment = useCallback(async () => {
    if (!examId || !profile) {
      setAssigned(null);
      return;
    }
    const { data } = await supabase
      .from('teacher_subjects')
      .select('subject')
      .eq('exam_id', examId)
      .eq('teacher_id', profile.id);
    const rows = (data as { subject: string }[] | null) ?? [];
    setAssigned(rows.length ? rows.map((r) => r.subject) : null);
  }, [examId, profile]);

  useEffect(() => {
    void loadSubjects();
  }, [loadSubjects]);

  useEffect(() => {
    void loadBank();
    void loadAssignment();
    setSlotKey(null);
  }, [loadBank, loadAssignment]);

  /** Sections this teacher may write for. */
  const mySections: FormatSection[] = useMemo(
    () => sectionsForTeacher(format, assigned),
    [format, assigned]
  );

  /** How deep the bank already is for each (section, type, marks) triple. */
  const bankDepth = useMemo(() => {
    const depth = new Map<string, number>();
    for (const q of bank) {
      const key = `${q.section_name ?? ''}|${q.question_type}|${q.marks}`;
      depth.set(key, (depth.get(key) ?? 0) + 1);
    }
    return depth;
  }, [bank]);

  /** One writable slot per (section, type, marks) the teacher may contribute to. */
  const slots: Slot[] = useMemo(() => {
    if (!enforced) return [];
    const out: Slot[] = [];
    for (const section of mySections) {
      section.requirements.forEach((requirement, i) => {
        for (const type of requirement.types) {
          out.push({
            key: `${section.name}|${i}|${type}`,
            sectionName: section.name,
            subject: section.subject,
            type,
            marks: requirement.marks_correct,
            label: `${section.name} · ${TYPE_SHORT[type]} · ${requirement.marks_correct} mark${requirement.marks_correct === 1 ? '' : 's'}`,
            banked: bankDepth.get(`${section.name}|${type}|${requirement.marks_correct}`) ?? 0,
            perPaper: requirement.max,
          });
        }
      });
    }
    return out;
  }, [enforced, mySections, bankDepth]);

  const slot = slots.find((s) => s.key === slotKey) ?? null;

  // Picking a quota fixes the subject, the question type and the marks — the
  // teacher cannot change the format's marking scheme.
  useEffect(() => {
    if (!slot) return;
    setSubject(slot.subject);
    setQType(slot.type);
    setMarks(String(slot.marks));
  }, [slot]);

  const slotOptions: SelectOption[] = slots.map((s) => ({
    value: s.key,
    label: s.label,
    hint: `${s.banked} in the bank · each paper set uses ${s.perPaper}`,
    group: s.sectionName,
    tag: s.banked < s.perPaper * setCount ? 'NEEDS MORE' : undefined,
  }));

  /** Without an enforced format the subject stays free text, as before. */
  const freeSubjectOptions: SelectOption[] = useMemo(() => {
    const base = format ? format.subjects : subjectSuggestions;
    const scoped = assigned ? base.filter((s) => assigned.includes(s)) : base;
    return scoped.map((s) => ({ value: s, label: s }));
  }, [format, subjectSuggestions, assigned]);

  const setOption = (index: number, text: string) =>
    setOptions((prev) => prev.map((o, i) => (i === index ? text : o)));

  const resetManual = () => {
    setTopic('');
    setBody('');
    setOptions(['', '', '', '']);
    setCorrect('A');
    setCorrectMulti({ A: true });
    setNumericAnswer('');
    if (!enforced) setMarks(qType === 'mcq' ? '1' : '5');
  };

  const examName = exam?.name ?? 'the exam';

  /** Turn the form into the payload the server validates. */
  const buildQuestion = (): NewQuestionInput | string => {
    if (!subject.trim()) return 'Choose a subject for this question.';
    if (enforced && !slot) return 'Choose which section quota this question fills.';
    if (body.trim().length < 10) return 'Write the full question text (at least 10 characters).';

    const marksNum = enforced && slot ? slot.marks : Math.max(1, parseInt(marks, 10) || 1);
    const type = enforced && slot ? slot.type : qType;

    if ((type === 'mcq' || type === 'msq') && options.some((o) => !o.trim())) {
      return 'Fill in all four options.';
    }
    const msqKeys = OPTION_LABELS.filter((label) => correctMulti[label]);
    if (type === 'msq' && msqKeys.length === 0) {
      return 'Mark at least one option as correct.';
    }
    if (type === 'numerical' && !numericAnswer.trim()) {
      return 'Enter the numeric answer for this question.';
    }
    if (type === 'numerical' && !Number.isFinite(Number(numericAnswer))) {
      return 'The numeric answer must be a number.';
    }

    return {
      subject: subject.trim(),
      section_name: slot?.sectionName ?? null,
      topic: topic.trim() || null,
      difficulty: difficulty as 'easy' | 'medium' | 'hard',
      question_type: type,
      marks: marksNum,
      source: 'manual',
      body: body.trim(),
      options: type === 'mcq' || type === 'msq' ? options.map((o) => o.trim()) : [],
      correct_index:
        type === 'mcq' ? OPTION_LABELS.indexOf(correct as (typeof OPTION_LABELS)[number]) : null,
      correct_indices: type === 'msq' ? msqKeys.map((label) => OPTION_LABELS.indexOf(label)) : null,
      answer_numeric: type === 'numerical' ? Number(numericAnswer) : null,
    };
  };

  const submitManual = async () => {
    if (!profile) return;
    if (!examId) {
      showAlert('Pick an exam', 'Questions must belong to an exam scheduled by the Admin.');
      return;
    }
    const built = buildQuestion();
    if (typeof built === 'string') {
      showAlert('Incomplete', built);
      return;
    }

    setBusy(true);
    try {
      // The server re-checks the quota; the UI gating above only saves a round trip.
      const res = await submitQuestions(examId, [built]);
      if (res.rejected.length) showAlert('Rejected', res.rejected.join('\n'));
      else showAlert('Question secured 🔐', `Added to the bank for "${examName}".`);
      resetManual();
      await loadBank();
      void loadSubjects();
    } catch (e) {
      showAlert('Upload failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const onPickPdf = async () => {
    try {
      const file = await pickPdf();
      if (!file) return;
      setPdfName(file.name);
      setExtracted([]);
      setPicked({});
      setExtracting(true);
      const res = await extractQuestions(file.base64, file.name);
      setEngine(res.engine);
      setExtracted(res.questions);
      const all: Record<number, boolean> = {};
      res.questions.forEach((_, i) => (all[i] = true));
      setPicked(all);
      if (res.questions.length === 0) {
        showAlert('No questions found', 'The parser could not detect questions in that PDF.');
      }
    } catch (e) {
      showAlert('Extraction failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setExtracting(false);
    }
  };

  const selectedCount = Object.values(picked).filter(Boolean).length;

  const importSelected = async () => {
    if (!profile) return;
    if (!examId) {
      showAlert('Pick an exam', 'Choose the exam these questions belong to.');
      return;
    }
    if (enforced && !slot) {
      showAlert('Pick a quota', 'Choose which section quota these imported questions fill.');
      return;
    }
    if (!enforced && !subject.trim()) {
      showAlert('Pick a subject', 'Choose a default subject for questions the PDF did not label.');
      return;
    }

    const rows: NewQuestionInput[] = extracted
      .filter((_, i) => picked[i])
      .map((q) => ({
        // Under an enforced format the chosen quota wins: an imported PDF
        // cannot introduce a type or marks value the format does not define.
        subject: (enforced && slot ? slot.subject : q.subject || subject).trim(),
        section_name: slot?.sectionName ?? null,
        topic: q.topic?.trim() || null,
        difficulty: q.difficulty || 'medium',
        question_type: enforced && slot ? slot.type : q.question_type,
        marks: enforced && slot ? slot.marks : q.marks || (q.question_type === 'mcq' ? 1 : 5),
        source: 'pdf',
        body: q.body.trim(),
        options: q.question_type === 'mcq' ? q.options : [],
        correct_index: q.question_type === 'mcq' ? (q.correct_index ?? 0) : null,
        answer_numeric: null,
        correct_indices: null,
      }));

    if (rows.length === 0) {
      showAlert('Nothing selected', 'Select at least one question to import.');
      return;
    }

    setImporting(true);
    setImportProgress(rows.length > QUESTION_BATCH_HINT ? `0/${rows.length}` : null);
    try {
      const res = await submitQuestions(examId, rows, (sent, total) =>
        setImportProgress(total > QUESTION_BATCH_HINT ? `${sent}/${total}` : null)
      );
      showAlert(
        res.rejected.length ? 'Partially imported' : 'Imported 🔐',
        [
          `${res.accepted} question(s) added to the bank for "${examName}".`,
          ...res.rejected.slice(0, 5),
          res.rejected.length > 5 ? `…and ${res.rejected.length - 5} more.` : '',
        ]
          .filter(Boolean)
          .join('\n')
      );
      setExtracted([]);
      setPicked({});
      setPdfName(null);
      await loadBank();
      void loadSubjects();
    } catch (e) {
      showAlert('Import failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  // Questions can only target an exam the Admin has scheduled.
  if (exams.length === 0) {
    return (
      <Screen>
        <EmptyState
          icon="calendar-clear-outline"
          title="No exams scheduled yet"
          subtitle="Questions can only be submitted for an exam scheduled by the Admin. This screen unlocks automatically the moment one is scheduled."
        />
      </Screen>
    );
  }

  const activeType = enforced && slot ? slot.type : qType;
  const visibleSlots = slots;

  return (
    <Screen scroll>
      <View style={styles.modeRow}>
        <Chips
          options={['Type one', 'Import PDF']}
          value={mode === 'manual' ? 'Type one' : 'Import PDF'}
          onChange={(v) => setMode(v === 'Type one' ? 'manual' : 'pdf')}
        />
      </View>

      <SectionTitle title="Exam" />
      <ExamPicker exams={exams} value={examId} onChange={setExamId} />
      {!examId ? <Text style={styles.hint}>Select the exam these questions are for.</Text> : null}

      {examId && format ? (
        <>
          <SectionTitle title={format.display_name} />
          <Card>
            <Text style={styles.formatMeta}>
              {format.body} · {format.mode}
              {format.duration_minutes ? ` · ${format.duration_minutes} min` : ''}
            </Text>
            {enforced ? (
              <>
                <Text style={styles.formatMeta}>
                  Each paper set: {format.totals.questions ?? '—'} questions ·{' '}
                  {format.totals.marks ?? '—'} marks · {setCount} set{setCount === 1 ? '' : 's'}
                </Text>
                {assigned ? (
                  <Text style={styles.assignedNote}>
                    You are assigned to: {assigned.join(', ')}.
                  </Text>
                ) : null}
                <Text style={styles.bankNote}>
                  The bank is unlimited — write as many as you like. These counts show how deep it
                  is against what {setCount === 1 ? 'the paper needs' : `${setCount} sets need`}.
                </Text>
                <View style={styles.progressWrap}>
                  {visibleSlots.map((s) => {
                    const target = s.perPaper * setCount;
                    return (
                      <SectionProgress
                        key={s.key}
                        name={s.label}
                        current={s.banked}
                        target={`${target}`}
                        complete={s.banked >= target}
                        detail={[
                          { label: 'per set', current: s.perPaper, target: `${s.perPaper}`, ok: true },
                        ]}
                        warning={
                          s.banked < target
                            ? `Bank ${target - s.banked} more so every set can draw its own ${s.perPaper}.`
                            : null
                        }
                      />
                    );
                  })}
                </View>
              </>
            ) : (
              <Text style={styles.freeFormNote}>
                This format's pattern is set by the yearly brochure, so no per-section quota is
                enforced. Subjects: {format.subjects.join(', ')}.
              </Text>
            )}
          </Card>
        </>
      ) : null}

      <SectionTitle title="Subject" />
      <Card>
        {enforced ? (
          <>
            <Select
              label="Section quota"
              placeholder={slots.length ? 'Choose a section, type and marks…' : 'No quota available'}
              value={slotKey}
              options={slotOptions}
              onChange={setSlotKey}
              emptyText="Every quota you are assigned to is already full."
            />
            {slot ? (
              <Text style={styles.slotNote}>
                Subject <Text style={styles.slotStrong}>{slot.subject}</Text> · type{' '}
                <Text style={styles.slotStrong}>{TYPE_SHORT[slot.type]}</Text> · marks{' '}
                <Text style={styles.slotStrong}>{slot.marks}</Text> — fixed by the exam format.
                {'\n'}
                {slot.banked} banked; each paper set uses {slot.perPaper}.
              </Text>
            ) : null}
          </>
        ) : (
          <>
            <Select
              label="Subject"
              placeholder="Choose a subject…"
              value={subject || null}
              options={freeSubjectOptions}
              onChange={setSubject}
            />
            <Input
              label="Or type another subject"
              placeholder="e.g. Physics"
              value={subject}
              onChangeText={setSubject}
            />
          </>
        )}
      </Card>

      {mode === 'manual' ? (
        <>
          {!enforced ? (
            <>
              <SectionTitle title="Question type" />
              <Chips
                options={FREE_TYPES.map((t) => t.label)}
                value={FREE_TYPES.find((t) => t.key === qType)?.label ?? 'MCQ'}
                onChange={(label) => {
                  const next = FREE_TYPES.find((t) => t.label === label)!.key;
                  setQType(next);
                  setMarks(next === 'mcq' ? '1' : '5');
                }}
              />
            </>
          ) : null}

          <SectionTitle title="Difficulty" />
          <Chips options={DIFFICULTIES} value={difficulty} onChange={setDifficulty} />

          <SectionTitle title="Question" />
          <Card>
            <Input label="Topic (optional)" placeholder="e.g. Thermodynamics" value={topic} onChangeText={setTopic} />
            {enforced ? (
              <Text style={styles.lockedMarks}>
                <Ionicons name="lock-closed" size={12} /> Marks: {marks} (set by the format)
              </Text>
            ) : (
              <Input
                label="Marks"
                placeholder="1"
                keyboardType="number-pad"
                value={marks}
                onChangeText={setMarks}
              />
            )}
            <Input
              label="Question text"
              placeholder="Type the full question…"
              value={body}
              onChangeText={setBody}
              multiline
              numberOfLines={4}
              style={styles.multiline}
            />
            {activeType === 'mcq' || activeType === 'msq' ? (
              <>
                {OPTION_LABELS.map((label, index) => (
                  <Input
                    key={label}
                    label={`Option ${label}`}
                    placeholder={`Answer choice ${label}`}
                    value={options[index]}
                    onChangeText={(text) => setOption(index, text)}
                  />
                ))}
                <Text style={styles.correctLabel}>
                  {activeType === 'msq' ? 'Correct options (one or more)' : 'Correct option'}
                </Text>
                {activeType === 'msq' ? (
                  <View style={styles.msqRow}>
                    {OPTION_LABELS.map((label) => {
                      const on = !!correctMulti[label];
                      return (
                        <Pressable
                          key={label}
                          onPress={() => setCorrectMulti((prev) => ({ ...prev, [label]: !prev[label] }))}
                          style={[styles.msqChip, on && styles.msqChipOn]}
                        >
                          <Ionicons
                            name={on ? 'checkbox' : 'square-outline'}
                            size={16}
                            color={on ? colors.primary : colors.textDim}
                          />
                          <Text style={[styles.msqChipText, on && { color: colors.primary }]}>{label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <Chips options={OPTION_LABELS} value={correct} onChange={setCorrect} />
                )}
              </>
            ) : activeType === 'numerical' ? (
              <Input
                label="Numeric answer"
                placeholder="e.g. 9.8"
                keyboardType="numeric"
                value={numericAnswer}
                onChangeText={setNumericAnswer}
              />
            ) : (
              <Text style={styles.theoryNote}>
                Subjective question — no options needed. Model answers are graded offline.
              </Text>
            )}
          </Card>

          <Button
            title="Submit to Secure Bank"
            icon="lock-closed-outline"
            onPress={() => void submitManual()}
            loading={busy}
            disabled={enforced && !slot}
          />
        </>
      ) : (
        <>
          <SectionTitle title="Import from PDF (NLP)" />
          <Card>
            <Text style={styles.pdfBlurb}>
              Upload a PDF of questions. The AI service extracts and structures them for review —
              nothing is saved until you confirm, and every question still has to fit the exam
              format's quota.
            </Text>
            <Button
              title={pdfName ? `Re-pick PDF (${pdfName})` : 'Choose PDF file'}
              variant="ghost"
              icon="document-attach-outline"
              onPress={() => void onPickPdf()}
              loading={extracting}
            />
            {engine ? (
              <Text style={styles.engineNote}>
                Parsed by: {engine === 'claude' ? 'Claude NLP' : engine === 'offline-fallback' ? 'offline parser (LLM unavailable)' : 'offline parser'}
              </Text>
            ) : null}
          </Card>

          {extracted.length > 0 ? (
            <>
              <SectionTitle title={`Review (${selectedCount}/${extracted.length} selected)`} />
              {extracted.map((q, i) => {
                const isSel = !!picked[i];
                return (
                  <Pressable key={i} onPress={() => setPicked((p) => ({ ...p, [i]: !p[i] }))}>
                    <Card style={isSel ? styles.cardSelected : undefined}>
                      <View style={styles.reviewRow}>
                        <Ionicons
                          name={isSel ? 'checkbox' : 'square-outline'}
                          size={22}
                          color={isSel ? colors.primary : colors.textDim}
                        />
                        <View style={{ flex: 1 }}>
                          <View style={styles.reviewTags}>
                            <View style={styles.typePill}>
                              <Text style={styles.typePillText}>
                                {TYPE_SHORT[enforced && slot ? slot.type : q.question_type]}
                              </Text>
                            </View>
                            <Text style={styles.reviewMeta}>
                              {enforced && slot ? slot.subject : q.subject || subject || 'subject?'} ·{' '}
                              {enforced && slot ? slot.marks : q.marks} mk
                            </Text>
                          </View>
                          <Text style={styles.reviewBody}>{q.body}</Text>
                          {q.question_type === 'mcq'
                            ? q.options.map((o, oi) => (
                                <Text
                                  key={oi}
                                  style={[
                                    styles.reviewOption,
                                    oi === q.correct_index && styles.reviewCorrect,
                                  ]}
                                >
                                  {String.fromCharCode(65 + oi)}. {o || '—'}
                                  {oi === q.correct_index ? '  ✓' : ''}
                                </Text>
                              ))
                            : null}
                        </View>
                      </View>
                    </Card>
                  </Pressable>
                );
              })}

              <Button
                title={
                  importProgress
                    ? `Importing ${importProgress}…`
                    : `Import ${selectedCount} question(s)`
                }
                icon="cloud-upload-outline"
                onPress={() => void importSelected()}
                loading={importing}
                disabled={enforced && !slot}
                style={{ marginTop: spacing.sm }}
              />
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    modeRow: {
      marginBottom: spacing.sm,
    },
    hint: {
      color: colors.warning,
      fontSize: 12,
      marginTop: spacing.sm,
    },
    formatMeta: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
    assignedNote: { color: colors.accent, fontSize: 12, marginTop: 4, fontWeight: '600' },
    bankNote: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: 6 },
    progressWrap: { marginTop: spacing.md },
    freeFormNote: { color: colors.textDim, fontSize: 12, lineHeight: 18, marginTop: 6 },
    slotNote: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
    slotStrong: { color: colors.text, fontWeight: '700' },
    lockedMarks: {
      color: colors.textDim,
      fontSize: 13,
      fontWeight: '600',
      marginBottom: spacing.md,
    },
    multiline: {
      minHeight: 96,
      textAlignVertical: 'top',
    },
    correctLabel: {
      color: colors.textDim,
      fontSize: 13,
      fontWeight: '600',
      marginBottom: spacing.sm,
    },
    theoryNote: {
      color: colors.textDim,
      fontSize: 13,
      fontStyle: 'italic',
      lineHeight: 18,
    },
    msqRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    msqChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: colors.surfaceAlt,
    },
    msqChipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
    msqChipText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
    pdfBlurb: {
      color: colors.textDim,
      fontSize: 13,
      lineHeight: 19,
      marginBottom: spacing.md,
    },
    engineNote: {
      color: colors.accent,
      fontSize: 12,
      marginTop: spacing.sm,
      textAlign: 'center',
    },
    cardSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
      borderRadius: radius.lg,
    },
    reviewRow: {
      flexDirection: 'row',
      gap: spacing.md,
      alignItems: 'flex-start',
    },
    reviewTags: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: 6,
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
    reviewMeta: {
      color: colors.textDim,
      fontSize: 12,
    },
    reviewBody: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
    },
    reviewOption: {
      color: colors.textDim,
      fontSize: 13,
      lineHeight: 20,
      marginTop: 2,
    },
    reviewCorrect: {
      color: colors.success,
      fontWeight: '600',
    },
  });
