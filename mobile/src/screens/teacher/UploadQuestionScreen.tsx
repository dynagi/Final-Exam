import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
  OpenBook,
  PageTitle,
  Rule,
  fluid,
  useArchiveLayout,
  useArchivePalette,
  usePageTurn,
  useReducedMotion,
} from '../../components/ArchiveBook';
import { CenteredHeading, PillRow, PlaqueButton, Seal } from '../../components/ArchiveControls';
import {
  ArchiveWorking,
  BookArrow,
  KingsScroll,
  PageIndicator,
  PopupRow,
  QuillButton,
  UploadDropZone,
  VintagePopup,
} from '../../components/ArchiveUpload';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { showAlert } from '../../lib/alert';
import { extractQuestions, submitQuestions } from '../../lib/api';
import { fetchAll } from '../../lib/db';
import {
  CompositionInput,
  FormatSection,
  sectionsForTeacher,
  TYPE_SHORT,
} from '../../lib/examFormats';
import { pickPdf } from '../../lib/pdf';
import { supabase } from '../../lib/supabase';
import { serif } from '../../lib/theme';
import { ExtractedQuestion, NewQuestionInput, QuestionType } from '../../lib/types';
import { useScheduledExams } from '../../lib/useExams';
import { useTeacherIndex } from './useTeacherIndex';

const SELF = 'Upload';

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const OPTION_LABELS = ['A', 'B', 'C', 'D'] as const;
/** Every answer style the bank accepts, for exams with no enforced quota. */
const FREE_TYPES: { key: QuestionType; label: string }[] = [
  { key: 'mcq', label: 'MCQ' },
  { key: 'msq', label: 'MSQ' },
  { key: 'numerical', label: 'Numerical' },
  { key: 'theoretical', label: 'Theory' },
];
// Seed suggestions, used only when the exam has no format to drive subjects.
const SEED_SUBJECTS = ['Physics', 'Chemistry', 'Biology', 'Mathematics', 'General Studies'];
/** Above this, an import is split into batches and worth showing progress for. */
const QUESTION_BATCH_HINT = 200;
/** Extracted questions shown per leaf in the review book. */
const PER_LEAF = 3;

/**
 * Headroom on the bank — must match BANK_HEADROOM in server/src/examFormats.js.
 * The server is authoritative; mirroring it here only lets the UI show a slot
 * filling up and stop a doomed upload before it costs a round trip.
 */
const BANK_HEADROOM = 2;

/**
 * One writable slot in the format: a (section, type, marks) triple.
 *
 * `banked` is how many such questions already exist for the exam, `perPaper`
 * how many each paper set takes, `target` what every set consumes together,
 * and `ceiling` the point at which the slot stops accepting more. The gap
 * between target and ceiling is deliberate slack, so the setter can reject a
 * weak question without the section becoming unfillable. The exact-count rule
 * still applies when a set is composed.
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
  target: number;
  ceiling: number;
}

/** Which archive the teacher is working in. */
type Stage = 'manual' | 'pdf';

export default function UploadQuestionScreen() {
  const { profile } = useAuth();
  const { exams } = useScheduledExams();
  const { colors } = useTheme();
  const p = useArchivePalette();
  const { stacked, outerPad, sidebarMode, pageWidth } = useArchiveLayout();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(p), [p]);

  const [stage, setStage] = useState<Stage>('manual');
  // The scroll is the way in: the page opens by asking how to add questions.
  const [scrollOpen, setScrollOpen] = useState(true);
  const [indexOpen, setIndexOpen] = useState(false);
  const [subjectPopup, setSubjectPopup] = useState(false);

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
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewPage, setReviewPage] = useState(1);

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

  /** Everything already in this exam's bank, paged — it runs to thousands of rows. */
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
          const target = requirement.max * setCount;
          out.push({
            key: `${section.name}|${i}|${type}`,
            sectionName: section.name,
            subject: section.subject,
            type,
            marks: requirement.marks_correct,
            label: `${section.name} · ${TYPE_SHORT[type]} · ${requirement.marks_correct} mark${requirement.marks_correct === 1 ? '' : 's'}`,
            banked: bankDepth.get(`${section.name}|${type}|${requirement.marks_correct}`) ?? 0,
            perPaper: requirement.max,
            target,
            ceiling: target * BANK_HEADROOM,
          });
        }
      });
    }
    return out;
  }, [enforced, mySections, bankDepth, setCount]);

  const slot = slots.find((s) => s.key === slotKey) ?? null;

  // Picking a quota fixes the subject, the question type and the marks — the
  // teacher cannot change the format's marking scheme.
  useEffect(() => {
    if (!slot) return;
    setSubject(slot.subject);
    setQType(slot.type);
    setMarks(String(slot.marks));
  }, [slot]);

  /** Without an enforced format the subject stays a free choice, as before. */
  const freeSubjects = useMemo(() => {
    const base = format ? format.subjects : subjectSuggestions;
    return assigned ? base.filter((s) => assigned.includes(s)) : base;
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
    if (slot && slot.banked >= slot.ceiling) {
      showAlert(
        'Slot full',
        `${slot.label} already holds ${slot.banked} questions — the ceiling is ${slot.ceiling} (${slot.target} needed across ${setCount === 1 ? 'the paper' : `${setCount} sets`}, doubled for choice). Withdraw one from My Questions before adding another.`
      );
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
      } else {
        // The archive opens a second volume for reviewing what was found.
        setReviewPage(1);
        setReviewOpen(true);
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

    // Under an enforced format the quota fixes the answer style. Silently
    // recasting an extracted question to the quota's type would relabel a
    // subjective question as an MCQ and then fail server-side with a shape
    // error that never mentions the real problem, so name it here instead.
    const chosen = extracted.filter((_, i) => picked[i]);
    const mismatched = enforced && slot ? chosen.filter((q) => q.question_type !== slot.type) : [];
    if (mismatched.length && slot) {
      const found = Array.from(new Set(mismatched.map((q) => TYPE_SHORT[q.question_type] ?? q.question_type)));
      showAlert(
        'Wrong question type',
        `${mismatched.length} selected question${mismatched.length === 1 ? ' is' : 's are'} ${found.join('/')}, but "${slot.label}" only accepts ${TYPE_SHORT[slot.type]}. Deselect ${mismatched.length === 1 ? 'it' : 'them'}, or choose a quota that takes ${found.join('/')}.`
      );
      return;
    }

    const rows: NewQuestionInput[] = chosen
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
      setReviewOpen(false);
      await loadBank();
      void loadSubjects();
    } catch (e) {
      showAlert('Import failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  const { items, onSelect } = useTeacherIndex({
    active: 'Upload',
    onBeforeSelect: () => setIndexOpen(false),
  });

  // Choosing "Upload" while already here re-opens the scroll, as specified.
  const onIndexSelect = (item: (typeof items)[number]) => {
    if (item.route === 'Upload') {
      setIndexOpen(false);
      setScrollOpen(true);
      return;
    }
    onSelect(item);
  };

  const activeType = enforced && slot ? slot.type : qType;
  const marksLocked = enforced;

  /* --------------------------------- pages -------------------------------- */

  const examChosen = !!examId;

  /** Shared left leaf: exam, then everything the exam unlocks. */
  const leftPage = (
    <LeafScroll stacked={stacked}>
      <PageTitle eyebrow={stage === 'pdf' ? 'Import from PDF' : 'Write a question'} size={[20, 28]}>
        {stage === 'pdf' ? 'PDF Import' : 'Manual Entry'}
      </PageTitle>
      <Rule ornament gap={13} />

      <CenteredHeading>Exam</CenteredHeading>

      {!examChosen ? (
        // STATE A — nothing is chosen yet, so only the exams are offered.
        <View style={styles.examList}>
          {exams.map((e) => (
            <Pressable
              key={e.id}
              accessibilityRole="button"
              accessibilityLabel={`${e.name}, ${e.exam_date}`}
              onPress={() => setExamId(e.id)}
              style={({ pressed }) => [
                styles.examRow,
                { borderColor: p.rule },
                pressed && { backgroundColor: p.goldSoft },
              ]}
            >
              <Ionicons name="calendar-outline" size={15} color={p.gold} />
              <View style={styles.flex}>
                <Text style={styles.examName} numberOfLines={2}>
                  {e.name}
                </Text>
                <Text style={styles.examDate}>{e.exam_date}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : (
        // STATE B — the leaf becomes the exam's requirement page.
        <View style={styles.block}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${exam?.name}. Choose a different exam`}
            onPress={() => setExamId(null)}
            style={[styles.chosenExam, { borderColor: p.gold, backgroundColor: p.goldSoft }]}
          >
            <View style={styles.flex}>
              <Text style={styles.chosenName} numberOfLines={2}>
                {format?.display_name ?? exam?.name}
              </Text>
              {format ? (
                <Text style={styles.chosenMeta}>
                  {format.body} · {format.mode}
                  {format.duration_minutes ? ` · ${format.duration_minutes} min` : ''}
                </Text>
              ) : null}
            </View>
            <Ionicons name="swap-horizontal" size={15} color={p.gold} />
          </Pressable>

          {format && enforced ? (
            <>
              <Text style={styles.reqLine}>
                Each paper set: {format.totals.questions ?? '—'} questions ·{' '}
                {format.totals.marks ?? '—'} marks · {setCount} set{setCount === 1 ? '' : 's'}
              </Text>
              {assigned ? (
                <Text style={styles.assigned}>You are assigned to: {assigned.join(', ')}.</Text>
              ) : null}
              <Text style={styles.bankNote}>
                These counts show how deep the bank is against what{' '}
                {setCount === 1 ? 'the paper needs' : `${setCount} sets need`}. You may bank up to
                twice that, so the setter has questions to choose between; past the ceiling a slot
                stops accepting more.
              </Text>

              <View style={styles.quotaList}>
                {slots.map((s) => {
                  const full = s.banked >= s.ceiling;
                  const ok = s.banked >= s.target;
                  return (
                    <View key={s.key} style={[styles.quota, { borderColor: p.rule }]}>
                      <Text style={styles.quotaLabel} numberOfLines={2}>
                        {s.label}
                      </Text>
                      <View style={styles.quotaFigures}>
                        <Text
                          style={[
                            styles.quotaCount,
                            { color: full ? p.danger : ok ? p.success : p.warning },
                          ]}
                        >
                          {s.banked}/{s.target} {full ? '● FULL' : ok ? '✓' : '⚠'}
                        </Text>
                        <Text style={styles.quotaPer}>
                          per set {s.perPaper} · ceiling {s.ceiling}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          ) : format ? (
            <Text style={styles.bankNote}>
              This format&apos;s pattern is set by the yearly brochure, so no per-section quota is
              enforced. Subjects: {format.subjects.join(', ')}.
            </Text>
          ) : null}
        </View>
      )}

      {examChosen ? (
        <>
          <CenteredHeading>Subject</CenteredHeading>
          <View style={styles.block}>
            <PlaqueButton
              value={
                enforced
                  ? (slot?.label ?? 'Section quota')
                  : subject || 'Choose a subject'
              }
              icon="pricetag-outline"
              accessibilityLabel="Choose subject"
              onPress={() => setSubjectPopup(true)}
            />
            {enforced && slot ? (
              <Text style={styles.slotNote}>
                {slot.banked} banked of {slot.target} needed · ceiling {slot.ceiling}
                {slot.banked >= slot.ceiling ? ' · FULL' : ''} · marks fixed at {slot.marks}
              </Text>
            ) : null}
          </View>

          {stage === 'manual' ? (
            <>
              {!enforced ? (
                <>
                  <CenteredHeading>Question type</CenteredHeading>
                  <View style={styles.block}>
                    <PillRow
                      options={FREE_TYPES.map((t) => t.label)}
                      value={FREE_TYPES.find((t) => t.key === qType)?.label ?? 'MCQ'}
                      onChange={(label) => {
                        const next = FREE_TYPES.find((t) => t.label === label)!.key;
                        setQType(next);
                        setMarks(next === 'mcq' ? '1' : '5');
                      }}
                    />
                  </View>
                </>
              ) : null}

              <CenteredHeading>Difficulty</CenteredHeading>
              <View style={styles.block}>
                <PillRow options={DIFFICULTIES} value={difficulty} onChange={setDifficulty} />
              </View>
            </>
          ) : null}
        </>
      ) : null}
    </LeafScroll>
  );

  /** Right leaf — the question form, or the drop zone. */
  const rightPage =
    stage === 'manual' ? (
      <LeafScroll stacked={stacked}>
        <PageTitle center size={[19, 27]}>
          Question
        </PageTitle>
        <Rule ornament gap={13} />

        {/* Topic and marks share a row; marks is read-only once the format
            fixes the marking scheme. */}
        <View style={styles.row}>
          <View style={styles.rowMain}>
            <Field
              label="Topic (optional)"
              placeholder="e.g. Thermodynamics"
              value={topic}
              onChangeText={setTopic}
              palette={p}
            />
          </View>
          <View style={styles.rowSide}>
            {marksLocked ? (
              <View>
                <Text style={styles.fieldLabel}>
                  Marks <Ionicons name="lock-closed" size={9} color={p.inkFaint} />
                </Text>
                <View style={[styles.lockedBox, { borderColor: p.rule, backgroundColor: `${p.pageShade}99` }]}>
                  {/* Until a quota is chosen the format has not told us the
                      marking scheme yet — saying "1 mark" would be a guess. */}
                  <Text style={[styles.lockedText, !slot && styles.lockedPending]}>
                    {slot ? `${slot.marks} mark${slot.marks === 1 ? '' : 's'}` : 'Set by quota'}
                  </Text>
                </View>
              </View>
            ) : (
              <Field
                label="Marks"
                placeholder="1"
                value={marks}
                onChangeText={setMarks}
                keyboardType="number-pad"
                palette={p}
              />
            )}
          </View>
        </View>

        <Field
          label="Question text"
          placeholder="Type the full question…"
          value={body}
          onChangeText={setBody}
          multiline
          palette={p}
          // Roughly a quarter of the leaf: enough to write in, not so much
          // that it swallows the options below.
          inputStyle={{ height: Math.max(88, Math.round((pageWidth || 420) * 0.28)) }}
        />

        <View style={styles.addRow}>
          <QuillButton
            title="Add question"
            onPress={() => void submitManual()}
            loading={busy}
            disabled={enforced && !slot}
          />
        </View>

        {activeType === 'mcq' || activeType === 'msq' ? (
          <>
            <Rule gap={12} />
            {/* A/B on one line, C/D on the next. */}
            {[0, 2].map((start) => (
              <View key={start} style={styles.row}>
                {[start, start + 1].map((i) => (
                  <View key={i} style={styles.rowHalf}>
                    <Field
                      label={`Option ${OPTION_LABELS[i]}`}
                      placeholder={`Answer choice ${OPTION_LABELS[i]}`}
                      value={options[i]}
                      onChangeText={(text) => setOption(i, text)}
                      palette={p}
                    />
                  </View>
                ))}
              </View>
            ))}

            <Text style={styles.fieldLabel}>
              {activeType === 'msq' ? 'Correct options (one or more)' : 'Correct option'}
            </Text>
            <View style={styles.correctRow}>
              {OPTION_LABELS.map((label) => {
                const on =
                  activeType === 'msq' ? !!correctMulti[label] : correct === label;
                return (
                  <Pressable
                    key={label}
                    accessibilityRole="button"
                    accessibilityLabel={`Option ${label}`}
                    accessibilityState={{ selected: on }}
                    onPress={() =>
                      activeType === 'msq'
                        ? setCorrectMulti((prev) => ({ ...prev, [label]: !prev[label] }))
                        : setCorrect(label)
                    }
                    style={[
                      styles.correctKey,
                      { borderColor: on ? p.gold : p.rule },
                      on && { backgroundColor: p.goldSoft, borderWidth: 2 },
                    ]}
                  >
                    <Text style={[styles.correctKeyText, { color: on ? p.ink : p.inkDim }]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : activeType === 'numerical' ? (
          <Field
            label="Numeric answer"
            placeholder="e.g. 9.8"
            value={numericAnswer}
            onChangeText={setNumericAnswer}
            keyboardType="numeric"
            palette={p}
          />
        ) : (
          <Text style={styles.theoryNote}>
            Subjective question — no options needed. Model answers are graded offline.
          </Text>
        )}

        <Rule gap={12} />
        <QuillButton
          title="Submit to Secure Bank"
          onPress={() => void submitManual()}
          loading={busy}
          disabled={enforced && !slot}
        />
      </LeafScroll>
    ) : (
      <View style={stacked ? styles.dropStacked : styles.flex}>
        <PageTitle center size={[19, 27]}>
          Question Upload
        </PageTitle>
        <Rule ornament gap={13} />
        {extracting ? (
          <ArchiveWorking label="Reading the manuscript…" />
        ) : (
          <UploadDropZone
            title="Question Upload"
            fileName={pdfName}
            busy={extracting}
            onPress={() => void onPickPdf()}
          />
        )}
        {engine ? (
          <Text style={styles.engineNote}>
            Parsed by{' '}
            {engine === 'claude'
              ? 'Claude NLP'
              : engine === 'offline-fallback'
                ? 'the offline parser (LLM unavailable)'
                : 'the offline parser'}
          </Text>
        ) : null}
      </View>
    );

  /* -------------------------------- render -------------------------------- */

  // Questions can only target an exam the Admin has scheduled.
  const noExams = exams.length === 0;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ArchiveBackground />
      <ArchiveHeader
        title="SECUREAI EXAM ARCHIVE"
        shortTitle="ARCHIVE"
        subtitle={`Teacher · ${stage === 'pdf' ? 'Import PDF' : 'Type manually'}`}
        onMenu={sidebarMode === 'overlay' ? () => setIndexOpen(true) : undefined}
      />

      <View style={styles.body}>
        {sidebarMode === 'overlay' ? null : (
          <ArchiveSidebar items={items} activeRoute={SELF} onSelect={onIndexSelect} />
        )}

        {noExams ? (
          <View style={styles.fixedStage}>
            <View style={[styles.noExams, { borderColor: p.rule, backgroundColor: p.page }]}>
              <Ionicons name="calendar-clear-outline" size={28} color={p.inkFaint} />
              <Text style={styles.noExamsTitle}>No exams scheduled yet</Text>
              <Text style={styles.noExamsText}>
                Questions can only be submitted for an exam scheduled by the Admin. This page
                unlocks the moment one is scheduled.
              </Text>
            </View>
          </View>
        ) : stacked ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingHorizontal: outerPad, paddingBottom: 20 + insets.bottom },
            ]}
            showsVerticalScrollIndicator={false}
          >
            <OpenBook
              left={leftPage}
              right={rightPage}
              leftFolio={exam ? exam.name : 'Choose an exam'}
              rightFolio={stage === 'pdf' ? 'PDF import' : 'Question sheet'}
            />
          </ScrollView>
        ) : (
          <View style={[styles.fixedStage, { paddingHorizontal: outerPad }]}>
            <OpenBook
              left={leftPage}
              right={rightPage}
              leftFolio={exam ? exam.name : 'Choose an exam'}
              rightFolio={stage === 'pdf' ? 'PDF import' : 'Question sheet'}
            />
          </View>
        )}
      </View>

      <ArchiveIndexOverlay
        visible={indexOpen}
        items={items}
        activeRoute={SELF}
        onSelect={onIndexSelect}
        onClose={() => setIndexOpen(false)}
      />

      <KingsScroll
        visible={scrollOpen}
        title="How will you add questions?"
        choices={[
          {
            key: 'manual',
            label: 'Type manually',
            hint: 'Write one question at a time into the bank.',
            icon: 'brush',
          },
          {
            key: 'pdf',
            label: 'Import PDF',
            hint: 'Extract questions from a paper and review them.',
            icon: 'document-text',
          },
        ]}
        onSelect={(key) => {
          setStage(key as Stage);
          setScrollOpen(false);
        }}
        onClose={() => setScrollOpen(false)}
      />

      {/* Subject / section-quota picker. */}
      <VintagePopup
        visible={subjectPopup}
        title={enforced ? 'Section quota' : 'Subject'}
        onClose={() => setSubjectPopup(false)}
      >
        <ScrollView style={styles.popupScroll} showsVerticalScrollIndicator={false}>
          {enforced ? (
            slots.length === 0 ? (
              <Text style={styles.popupEmpty}>
                No quota is open to you for this exam. Ask the Admin about your subject assignment.
              </Text>
            ) : (
              slots.map((s) => (
                <PopupRow
                  key={s.key}
                  label={s.label}
                  hint={`${s.banked} of ${s.target} needed · ceiling ${s.ceiling}`}
                  tag={
                    s.banked >= s.ceiling
                      ? 'FULL'
                      : s.banked < s.target
                        ? 'NEEDS MORE'
                        : undefined
                  }
                  active={s.key === slotKey}
                  onPress={() => {
                    setSlotKey(s.key);
                    setSubjectPopup(false);
                  }}
                />
              ))
            )
          ) : freeSubjects.length === 0 ? (
            <Text style={styles.popupEmpty}>No subjects to choose from yet.</Text>
          ) : (
            freeSubjects.map((s) => (
              <PopupRow
                key={s}
                label={s}
                active={s === subject}
                onPress={() => {
                  setSubject(s);
                  setSubjectPopup(false);
                }}
              />
            ))
          )}
        </ScrollView>
      </VintagePopup>

      <ReviewBook
        visible={reviewOpen}
        questions={extracted}
        picked={picked}
        onToggle={(i) => setPicked((prev) => ({ ...prev, [i]: !prev[i] }))}
        page={reviewPage}
        onPage={setReviewPage}
        onBack={() => setReviewOpen(false)}
        onImport={() => void importSelected()}
        importing={importing}
        importProgress={importProgress}
        selectedCount={selectedCount}
        palette={p}
        statusTone={colors.info}
      />
    </View>
  );
}

/* ------------------------------ leaf helpers ------------------------------ */

/** A leaf scrolls its own content on the spread; phones let the page flow. */
function LeafScroll({ children, stacked }: { children: React.ReactNode; stacked: boolean }) {
  if (stacked) return <View>{children}</View>;
  return (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}

/** A ruled writing line on the page. */
function Field({
  label,
  palette: p,
  multiline,
  inputStyle,
  ...rest
}: {
  label: string;
  palette: ArchivePalette;
  multiline?: boolean;
  inputStyle?: object;
} & React.ComponentProps<typeof TextInput>) {
  const styles = useMemo(() => makeStyles(p), [p]);
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={`${p.inkFaint}CC`}
        multiline={multiline}
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          {
            borderBottomColor: focused ? p.gold : p.rule,
            borderBottomWidth: focused ? 2 : 1,
            backgroundColor: focused ? p.goldSoft : 'transparent',
          },
          inputStyle,
        ]}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        {...rest}
      />
    </View>
  );
}

/* ------------------------------- review book ------------------------------ */

/**
 * The second volume: everything the parser found, laid across both leaves,
 * with antique arrows at the corners and a folio you can type into.
 */
function ReviewBook({
  visible,
  questions,
  picked,
  onToggle,
  page,
  onPage,
  onBack,
  onImport,
  importing,
  importProgress,
  selectedCount,
  palette: p,
  statusTone,
}: {
  visible: boolean;
  questions: ExtractedQuestion[];
  picked: Record<number, boolean>;
  onToggle: (index: number) => void;
  page: number;
  onPage: (page: number) => void;
  onBack: () => void;
  onImport: () => void;
  importing: boolean;
  importProgress: string | null;
  selectedCount: number;
  palette: ArchivePalette;
  statusTone: string;
}) {
  const styles = useMemo(() => makeStyles(p), [p]);
  const { isDark } = useTheme();
  const { stacked, pageWidth } = useArchiveLayout();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  // Room for the back arrow above and the folio + import control below.
  const bookHeight = stacked ? undefined : Math.max(320, Math.min(winHeight - 250, 560));
  // Arrows flank the book, so leave them their gutters.
  const bookWidth = Math.min(winWidth - 140, 1080);
  const reduced = useReducedMotion();
  const turn = usePageTurn({ duration: 760, angle: 88 });
  const slide = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) setMounted(true);
    if (reduced) {
      slide.setValue(visible ? 1 : 0);
      if (!visible) setMounted(false);
      return;
    }
    Animated.timing(slide, {
      toValue: visible ? 1 : 0,
      duration: visible ? 620 : 320,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      if (!visible) setMounted(false);
    });
  }, [visible, slide, reduced]);

  const perSpread = PER_LEAF * 2;
  const pageCount = Math.max(1, Math.ceil(questions.length / perSpread));
  const start = (Math.min(page, pageCount) - 1) * perSpread;
  // Held one render behind so the outgoing leaf keeps its questions mid-turn.
  const [shown, setShown] = useState(start);
  const turning = useRef(false);
  useEffect(() => {
    if (!turning.current) setShown(start);
  }, [start]);

  const goto = (next: number, direction: 1 | -1) => {
    if (next < 1 || next > pageCount || next === page) return;
    turning.current = true;
    turn.turn(direction, () => {
      onPage(next);
      turning.current = false;
    });
  };

  const leafItems = (side: 0 | 1) =>
    questions.slice(shown + side * PER_LEAF, shown + (side + 1) * PER_LEAF);

  const leaf = (side: 0 | 1) => (
    <View style={styles.flex}>
      <Animated.View style={turn.style}>
        {leafItems(side).length === 0 ? (
          <Text style={styles.reviewEmpty}>—</Text>
        ) : (
          leafItems(side).map((q, i) => {
            const index = shown + side * PER_LEAF + i;
            const on = !!picked[index];
            return (
              <Pressable
                key={index}
                accessibilityRole="checkbox"
                accessibilityLabel={q.body}
                accessibilityState={{ checked: on }}
                onPress={() => onToggle(index)}
                style={[
                  styles.reviewCard,
                  { borderColor: on ? p.gold : p.rule },
                  on && { backgroundColor: p.goldSoft, borderWidth: 2 },
                ]}
              >
                <View style={styles.reviewHead}>
                  <Ionicons
                    name={on ? 'checkbox' : 'square-outline'}
                    size={17}
                    color={on ? p.gold : p.inkFaint}
                  />
                  <Seal label={TYPE_SHORT[q.question_type] ?? 'Q'} tone={statusTone} />
                  <Text style={styles.reviewNo}>#{index + 1}</Text>
                </View>
                <Text
                  style={[styles.reviewBody, { fontSize: fluid(pageWidth, 11.5, 13) }]}
                  numberOfLines={4}
                >
                  {q.body}
                </Text>
              </Pressable>
            );
          })
        )}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.turnShade, turn.shadeStyle]}
        />
      </Animated.View>
    </View>
  );

  const translateX = slide.interpolate({ inputRange: [0, 1], outputRange: [520, 0] });

  return (
    <Modal transparent visible={mounted} animationType="none" onRequestClose={onBack} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: slide }]}>
        <BlurView intensity={isDark ? 32 : 24} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.reviewScrim]} />
      </Animated.View>

      <Animated.View
        style={[styles.reviewStage, { opacity: slide, transform: [{ translateX }] }]}
        pointerEvents="box-none"
      >
        {/* Back out of this volume, above the book — not a page turn. */}
        <View style={styles.reviewTopRow}>
          <BookArrow direction="back" variant="back" label="Back to the PDF upload" onPress={onBack} />
          <Text style={styles.reviewCount}>
            {selectedCount} of {questions.length} selected
          </Text>
        </View>

        <View style={styles.reviewBookRow}>
          <View style={styles.reviewArrowSlot}>
            <BookArrow
              direction="prev"
              label="Previous page"
              disabled={page <= 1}
              onPress={() => goto(page - 1, -1)}
            />
          </View>

          <View style={styles.reviewBook}>
            <OpenBook
              left={leaf(0)}
              right={leaf(1)}
              leftFolio="Extracted questions"
              rightFolio={`Folio ${page} of ${pageCount}`}
              // The stage also carries the back arrow, the folio and the
              // import control, so the book takes what is left rather than
              // the full-screen height and pushing them off the bottom.
              height={bookHeight}
              width={bookWidth}
            />
          </View>

          <View style={styles.reviewArrowSlot}>
            <BookArrow
              direction="next"
              label="Next page"
              disabled={page >= pageCount}
              onPress={() => goto(page + 1, 1)}
            />
          </View>
        </View>

        <View style={styles.reviewFoot}>
          <PageIndicator page={Math.min(page, pageCount)} pageCount={pageCount} onGo={(n) => goto(n, n > page ? 1 : -1)} />
          {/* The import control sits below the book, attached to the archive. */}
          <View style={stacked ? undefined : styles.importWrap}>
            <QuillButton
              title={
                importProgress
                  ? `Importing ${importProgress}…`
                  : `Import ${selectedCount} question${selectedCount === 1 ? '' : 's'}`
              }
              onPress={onImport}
              loading={importing}
              disabled={selectedCount === 0}
            />
          </View>
        </View>
      </Animated.View>
    </Modal>
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

    /* left leaf */
    block: { marginTop: 8, marginBottom: 12 },
    examList: { marginTop: 10, gap: 7, marginBottom: 12 },
    examRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      borderWidth: 1,
      borderRadius: 3,
      paddingVertical: 9,
      paddingHorizontal: 11,
    },
    examName: { fontFamily: serif, fontSize: 13, fontWeight: '600', color: p.ink },
    examDate: { fontFamily: serif, fontSize: 10.5, color: p.inkFaint, marginTop: 1 },
    chosenExam: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      borderWidth: 1,
      borderRadius: 3,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginBottom: 10,
    },
    chosenName: { fontFamily: serif, fontSize: 14, fontWeight: '700', color: p.ink },
    chosenMeta: { fontFamily: serif, fontSize: 10.5, color: p.inkDim, marginTop: 2 },
    reqLine: { fontFamily: serif, fontSize: 12, color: p.ink, lineHeight: 17 },
    assigned: { fontFamily: serif, fontSize: 11.5, color: p.gold, marginTop: 4, fontWeight: '700' },
    bankNote: { fontFamily: serif, fontSize: 11, color: p.inkDim, lineHeight: 16, marginTop: 5 },
    quotaList: { marginTop: 10, gap: 7 },
    quota: { borderWidth: 1, borderRadius: 3, paddingVertical: 8, paddingHorizontal: 10 },
    quotaLabel: { fontFamily: serif, fontSize: 11.5, color: p.ink, fontWeight: '600' },
    quotaFigures: { alignItems: 'flex-end', marginTop: 3 },
    quotaCount: { fontFamily: serif, fontSize: 13, fontWeight: '700' },
    quotaPer: { fontFamily: serif, fontSize: 10, color: p.inkFaint },
    slotNote: {
      fontFamily: serif,
      fontSize: 10.5,
      color: p.inkDim,
      textAlign: 'center',
      marginTop: 7,
      lineHeight: 15,
    },

    /* right leaf — form */
    row: { flexDirection: 'row', gap: 12 },
    rowMain: { flex: 2 },
    rowSide: { flex: 1, minWidth: 96 },
    rowHalf: { flex: 1 },
    field: { marginBottom: 11 },
    fieldLabel: {
      fontFamily: serif,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 1.3,
      textTransform: 'uppercase',
      color: p.inkFaint,
      marginBottom: 3,
    },
    input: {
      fontFamily: serif,
      fontSize: 13.5,
      color: p.ink,
      paddingVertical: 7,
      paddingHorizontal: 8,
      borderRadius: 2,
    },
    inputMultiline: { textAlignVertical: 'top', paddingTop: 8 },
    lockedBox: { borderWidth: 1, borderRadius: 3, paddingVertical: 8, paddingHorizontal: 10 },
    lockedText: { fontFamily: serif, fontSize: 13, fontWeight: '700', color: p.ink },
    lockedPending: { color: p.inkFaint, fontWeight: '400', fontStyle: 'italic' },
    addRow: { alignItems: 'center', marginVertical: 4 },
    correctRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
    correctKey: {
      width: 40,
      height: 34,
      borderWidth: 1,
      borderRadius: 3,
      alignItems: 'center',
      justifyContent: 'center',
    },
    correctKeyText: { fontFamily: serif, fontSize: 14, fontWeight: '700' },
    theoryNote: {
      fontFamily: serif,
      fontSize: 12,
      fontStyle: 'italic',
      color: p.inkDim,
      lineHeight: 18,
    },

    /* right leaf — pdf */
    dropStacked: { minHeight: 380 },
    engineNote: {
      fontFamily: serif,
      fontSize: 10.5,
      color: p.gold,
      textAlign: 'center',
      marginTop: 9,
    },

    /* popup */
    popupScroll: { maxHeight: 320 },
    popupEmpty: {
      fontFamily: serif,
      fontSize: 12,
      color: p.pamphletInkDim,
      lineHeight: 17,
      textAlign: 'center',
      paddingVertical: 8,
    },

    /* review book */
    reviewScrim: { backgroundColor: 'rgba(0,0,0,0.42)' },
    reviewStage: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, gap: 10 },
    reviewTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      alignSelf: 'stretch',
      justifyContent: 'center',
    },
    reviewCount: {
      fontFamily: serif,
      fontSize: 12,
      color: p.onCover,
      letterSpacing: 1,
    },
    reviewBookRow: { flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: '100%' },
    reviewArrowSlot: { justifyContent: 'flex-start', paddingTop: 8 },
    reviewBook: { flexShrink: 1 },
    reviewFoot: { alignItems: 'center', gap: 12 },
    importWrap: { marginTop: 2 },
    reviewCard: {
      borderWidth: 1,
      borderRadius: 3,
      backgroundColor: p.pageShade,
      paddingVertical: 9,
      paddingHorizontal: 10,
      marginBottom: 8,
    },
    reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 5 },
    reviewNo: { fontFamily: serif, fontSize: 10, color: p.inkFaint, marginLeft: 'auto' },
    reviewBody: { fontFamily: serif, color: p.ink, lineHeight: 17 },
    reviewEmpty: { fontFamily: serif, fontSize: 14, color: p.inkFaint, textAlign: 'center', paddingVertical: 20 },
    turnShade: { backgroundColor: '#000' },

    /* empty */
    noExams: {
      alignItems: 'center',
      gap: 9,
      borderWidth: 1,
      borderRadius: 4,
      paddingVertical: 30,
      paddingHorizontal: 26,
      maxWidth: 420,
    },
    noExamsTitle: { fontFamily: serif, fontSize: 16, fontWeight: '700', color: p.ink },
    noExamsText: {
      fontFamily: serif,
      fontSize: 12.5,
      color: p.inkDim,
      lineHeight: 18,
      textAlign: 'center',
    },
  });
