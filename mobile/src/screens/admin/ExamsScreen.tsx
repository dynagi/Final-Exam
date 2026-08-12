import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  RefreshControl,
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
  PageGrain,
  PageTitle,
  Rule,
  fluid,
  useArchiveLayout,
  useArchivePalette,
  useReducedMotion,
} from '../../components/ArchiveBook';
import { AnimatedPencilPaperModal, BookButton, CenteredHeading, Seal } from '../../components/ArchiveControls';
import {
  Badge,
  EmptyState,
  Input,
  SelectOption,
  Stepper,
  Toggle,
} from '../../components/UI';
import { useAuth } from '../../context/AuthContext';
import { showAlert } from '../../lib/alert';
import { createExam, updatePaperSets } from '../../lib/api';
import {
  FormatSummary,
  loadFormat,
  loadFormatCatalogue,
  markingSummary,
  ResolvedFormat,
} from '../../lib/examFormats';
import { supabase } from '../../lib/supabase';
import { serif } from '../../lib/theme';
import { Exam, ExamSlot, paperSetLabels, Paper, Profile, TeacherSubject } from '../../lib/types';
import { useAdminIndex } from './useAdminIndex';

const SELF = 'Exams';

type ExamWithPaper = Exam & { paper?: { title: string } | null };
type SlotDraft = { start: string; end: string };
/** One Admin-defined section quota, for formats the reference leaves open. */
type CustomSection = {
  name: string;
  subject: string;
  count: string;
  marks_correct: string;
  negative_marks: string;
};

const DEFAULT_SLOTS: SlotDraft[] = [
  { start: '09:00', end: '12:00' },
  { start: '14:00', end: '17:00' },
];

function minutesBetween(date: string, start: string, end: string): number {
  const s = new Date(`${date}T${start}:00`).getTime();
  const e = new Date(`${date}T${end}:00`).getTime();
  return Math.round((e - s) / 60000);
}

/** "09:00" + 180 min -> "12:00" (same day; slots never span midnight). */
function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export default function ExamsScreen() {
  const { profile } = useAuth();
  const p = useArchivePalette();
  const { stacked, outerPad, sidebarMode, pageWidth } = useArchiveLayout();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(p), [p]);
  const [indexOpen, setIndexOpen] = useState(false);

  const [exams, setExams] = useState<ExamWithPaper[]>([]);
  const [slots, setSlots] = useState<ExamSlot[]>([]);
  const [eligiblePapers, setEligiblePapers] = useState<Paper[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Notice board -> full form, two-stage exam creation.
  const [creating, setCreating] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);

  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [paperId, setPaperId] = useState<string | null>(null);
  const [slotDrafts, setSlotDrafts] = useState<SlotDraft[]>(DEFAULT_SLOTS);
  const [setCount, setSetCount] = useState(4);
  const [allowReuse, setAllowReuse] = useState(false);
  const [busy, setBusy] = useState(false);

  // Paper-set management for an already-created exam.
  const [setsTarget, setSetsTarget] = useState<ExamWithPaper | null>(null);
  const [setsDraft, setSetsDraft] = useState(1);
  const [reuseDraft, setReuseDraft] = useState(false);
  const [savingSets, setSavingSets] = useState(false);

  // Exam format catalogue (served by the crypto service, cached per session).
  const [catalogue, setCatalogue] = useState<FormatSummary[]>([]);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [formatKey, setFormatKey] = useState<string | null>(null);
  const [format, setFormat] = useState<ResolvedFormat | null>(null);
  const [loadingFormat, setLoadingFormat] = useState(false);
  const [customSections, setCustomSections] = useState<CustomSection[]>([]);

  // Subject assignment (teacher -> subjects, per exam).
  const [assignTarget, setAssignTarget] = useState<ExamWithPaper | null>(null);
  const [teachers, setTeachers] = useState<Profile[]>([]);
  const [assignments, setAssignments] = useState<TeacherSubject[]>([]);

  const load = useCallback(async () => {
    const [{ data: examRows }, { data: paperRows }, { data: slotRows }] = await Promise.all([
      supabase.from('exams').select('*, paper:papers!exams_paper_id_fkey(title)').order('exam_date', { ascending: true }),
      supabase
        .from('papers')
        .select('*')
        .in('status', ['sealed_dual', 'printed'])
        .order('created_at', { ascending: false }),
      supabase.from('exam_slots').select('*').order('slot_no', { ascending: true }),
    ]);
    setExams((examRows as ExamWithPaper[] | null) ?? []);
    setEligiblePapers((paperRows as Paper[] | null) ?? []);
    setSlots((slotRows as ExamSlot[] | null) ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    loadFormatCatalogue()
      .then(setCatalogue)
      .catch((e: unknown) =>
        setCatalogueError(e instanceof Error ? e.message : 'Could not load the exam format catalogue')
      );
  }, []);

  const formatOptions: SelectOption[] = useMemo(
    () =>
      catalogue.map((f) => ({
        value: `${f.code}:${f.year}`,
        label: f.display_name,
        hint: f.enforced
          ? `${f.body} · ${f.section_count} section${f.section_count === 1 ? '' : 's'} · ${f.total_questions ?? '—'} questions · ${f.total_marks ?? '—'} marks`
          : `${f.body} · pattern set by the yearly brochure — no enforced quota`,
        group: f.category,
        tag: f.provisional ? 'PROVISIONAL' : undefined,
      })),
    [catalogue]
  );

  /** Selecting a format loads its blueprint and pre-fills the exam details. */
  const pickFormat = async (key: string) => {
    setFormatKey(key);
    const [code, year] = key.split(':');
    setLoadingFormat(true);
    try {
      const resolved = await loadFormat(code, Number(year));
      setFormat(resolved);
      // Open formats need counts from the Admin; seed one row per subject.
      setCustomSections(
        resolved.enforced
          ? []
          : resolved.sections.map((s) => ({
              name: s.name,
              subject: s.subject,
              count: '25',
              marks_correct: '1',
              negative_marks: '0',
            }))
      );
      if (!name.trim()) setName(resolved.display_name);
      if (resolved.duration_minutes) {
        setSlotDrafts((prev) =>
          prev.map((s) => ({ ...s, end: addMinutes(s.start, resolved.duration_minutes!) }))
        );
      }
    } catch (e) {
      setFormat(null);
      showAlert('Format unavailable', e instanceof Error ? e.message : 'Could not load that format');
    } finally {
      setLoadingFormat(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const updateSlot = (i: number, key: keyof SlotDraft, value: string) =>
    setSlotDrafts((prev) => prev.map((s, idx) => (idx === i ? { ...s, [key]: value } : s)));
  const addSlot = () =>
    setSlotDrafts((prev) => {
      if (prev.length >= 3) return prev;
      const start = '18:00';
      return [...prev, { start, end: addMinutes(start, format?.duration_minutes ?? 180) }];
    });
  const removeSlot = (i: number) =>
    setSlotDrafts((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));

  const resetForm = () => {
    setName('');
    setDate('');
    setPaperId(null);
    setSlotDrafts(DEFAULT_SLOTS);
    setFormatKey(null);
    setFormat(null);
    setCustomSections([]);
    setSetCount(4);
    setAllowReuse(false);
  };

  const startCreating = () => {
    setCreating(true);
    setBoardOpen(true);
  };

  const cancelCreating = () => {
    setCreating(false);
    setBoardOpen(false);
    resetForm();
  };

  /** The notice board can close once a format is chosen and its counts (if any) are valid. */
  const boardComplete = !!format && (format.enforced || customSections.every((s) => {
    const count = parseInt(s.count, 10);
    const marks = Number(s.marks_correct);
    return Number.isFinite(count) && count >= 1 && Number.isFinite(marks) && marks > 0;
  }));

  const finishBoard = () => {
    if (!boardComplete) {
      showAlert(
        'Pin the blueprint first',
        'Choose an exam format' +
          (format && !format.enforced ? ', and fill in every section’s question count and marks.' : '.')
      );
      return;
    }
    setBoardOpen(false);
  };

  const create = async () => {
    if (!profile) return;
    if (!format) {
      return showAlert(
        'Pick an exam format',
        'Question counts come from the format — an exam without one cannot limit how many questions a paper holds.'
      );
    }
    if (name.trim().length < 3) return showAlert('Missing name', 'Give the exam a name, e.g. "NEET UG 2026".');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return showAlert('Invalid date', 'Use YYYY-MM-DD.');
    if (!format.enforced) {
      for (const s of customSections) {
        const count = parseInt(s.count, 10);
        const marks = Number(s.marks_correct);
        if (!Number.isFinite(count) || count < 1) {
          return showAlert('Missing question count', `${s.name}: enter how many questions this section holds.`);
        }
        if (!Number.isFinite(marks) || marks <= 0) {
          return showAlert('Missing marks', `${s.name}: enter the marks for a correct answer.`);
        }
      }
    }

    for (const [i, s] of slotDrafts.entries()) {
      if (!/^\d{2}:\d{2}$/.test(s.start) || !/^\d{2}:\d{2}$/.test(s.end)) {
        return showAlert('Invalid slot', `Slot ${i + 1}: use HH:MM (24h) for start and end.`);
      }
      if (minutesBetween(date.trim(), s.start, s.end) <= 0) {
        return showAlert('Invalid slot', `Slot ${i + 1}: end time must be after start time.`);
      }
    }

    setBusy(true);
    try {
      // The server re-resolves the blueprint from its catalogue and stores it —
      // the app only says which format + year was chosen.
      await createExam({
        formatCode: format.code,
        formatYear: format.year,
        name: name.trim(),
        examDate: date.trim(),
        paperId,
        paperSetCount: setCount,
        allowQuestionReuse: allowReuse,
        customSections: format.enforced
          ? undefined
          : customSections.map((s) => ({
              name: s.name,
              subject: s.subject,
              question_type: 'mcq' as const,
              count: parseInt(s.count, 10),
              marks_correct: Number(s.marks_correct),
              negative_marks: Number(s.negative_marks) || 0,
            })),
        slots: slotDrafts.map((s, i) => ({
          label: `Slot ${i + 1} (${s.start}–${s.end})`,
          startAt: new Date(`${date.trim()}T${s.start}:00`).toISOString(),
          endAt: new Date(`${date.trim()}T${s.end}:00`).toISOString(),
        })),
      });
      setCreating(false);
      setBoardOpen(false);
      resetForm();
      void load();
    } catch (e) {
      showAlert('Failed', e instanceof Error ? e.message : 'Could not create exam');
    } finally {
      setBusy(false);
    }
  };

  /** Apply a new set count / reuse policy. The server refuses to drop sealed sets. */
  const saveSets = async () => {
    if (!setsTarget) return;
    setSavingSets(true);
    try {
      const res = await updatePaperSets(setsTarget.id, {
        paperSetCount: setsDraft,
        allowQuestionReuse: reuseDraft,
      });
      setSetsTarget(null);
      if (res.dropped.length) {
        showAlert('Paper sets updated', `Discarded the unsealed selection in ${res.dropped.join(', ')}.`);
      }
      void load();
    } catch (e) {
      showAlert('Could not update sets', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSavingSets(false);
    }
  };

  /* --------------------------- subject assignment -------------------------- */

  const openAssign = async (exam: ExamWithPaper) => {
    setAssignTarget(exam);
    const [{ data: teacherRows }, { data: assignmentRows }] = await Promise.all([
      supabase.from('profiles').select('*').eq('role', 'teacher').order('full_name'),
      supabase.from('teacher_subjects').select('*').eq('exam_id', exam.id),
    ]);
    setTeachers((teacherRows as Profile[] | null) ?? []);
    setAssignments((assignmentRows as TeacherSubject[] | null) ?? []);
  };

  const toggleAssignment = async (teacherId: string, subject: string) => {
    if (!assignTarget || !profile) return;
    const existing = assignments.find((a) => a.teacher_id === teacherId && a.subject === subject);
    if (existing) {
      const { error } = await supabase
        .from('teacher_subjects')
        .delete()
        .eq('exam_id', assignTarget.id)
        .eq('teacher_id', teacherId)
        .eq('subject', subject);
      if (error) return showAlert('Failed', error.message);
      setAssignments((prev) =>
        prev.filter((a) => !(a.teacher_id === teacherId && a.subject === subject))
      );
      return;
    }
    const row = {
      exam_id: assignTarget.id,
      teacher_id: teacherId,
      subject,
      assigned_by: profile.id,
    };
    const { error } = await supabase.from('teacher_subjects').insert(row);
    if (error) return showAlert('Failed', error.message);
    setAssignments((prev) => [...prev, { ...row, created_at: new Date().toISOString() }]);
  };

  const slotsFor = (examId: string) => slots.filter((s) => s.exam_id === examId);
  const assignSubjects = assignTarget?.format_blueprint?.subjects ?? [];

  const { items, onSelect } = useAdminIndex({
    active: SELF,
    onBeforeSelect: () => setIndexOpen(false),
  });

  /* -------------------------------- pages -------------------------------- */

  const leftPage =
    !creating || boardOpen ? (
      <View style={styles.createCenter}>
        <PageTitle center size={[19, 27]}>
          Create Exam
        </PageTitle>
        <Rule ornament gap={12} />
        <Text style={styles.createHint}>
          Set the exam&apos;s blueprint on the notice board, then fill in its schedule.
        </Text>
        <BookButton
          title="Create Exam"
          icon="add-circle-outline"
          variant="gold"
          onPress={startCreating}
          disabled={boardOpen}
        />
      </View>
    ) : (
      <LeafScroll stacked={stacked}>
        <PageTitle center size={[19, 27]}>
          Create Exam
        </PageTitle>
        <Rule ornament gap={12} />

        {format ? (
          <Pressable onPress={() => setBoardOpen(true)} style={styles.summaryCard}>
            <View style={styles.summaryHead}>
              <Ionicons name="bookmark-outline" size={13} color={p.gold} />
              <Text style={styles.summaryTitle} numberOfLines={1}>
                {format.display_name}
              </Text>
              <Text style={styles.summaryEdit}>Edit</Text>
            </View>
            <Text style={styles.summaryMeta}>
              {format.enforced
                ? `${format.sections.length} sections · ${format.totals.questions ?? '—'} questions`
                : `${customSections.length} section${customSections.length === 1 ? '' : 's'} · ${customSections.reduce((n, s) => n + (parseInt(s.count, 10) || 0), 0)} questions`}
              {' · '}
              {setCount} paper set{setCount === 1 ? '' : 's'}
            </Text>
          </Pressable>
        ) : null}

        <Input label="Exam name" placeholder='e.g. "NEET UG 2026"' value={name} onChangeText={setName} />
        <Input
          label="Exam date (YYYY-MM-DD)"
          placeholder="2026-05-03"
          value={date}
          onChangeText={setDate}
          autoCapitalize="none"
        />

        <View style={styles.slotsHeader}>
          <Text style={styles.fieldLabel}>Slots ({slotDrafts.length}) — 2–3 per day</Text>
          {slotDrafts.length < 3 ? (
            <Pressable onPress={addSlot} style={styles.addSlot}>
              <Ionicons name="add" size={16} color={p.gold} />
              <Text style={styles.addSlotText}>Add slot</Text>
            </Pressable>
          ) : null}
        </View>

        {slotDrafts.map((s, i) => (
          <View key={i} style={styles.slotRow}>
            <View style={styles.slotInputs}>
              <View style={styles.slotInput}>
                <Input label={`Slot ${i + 1} start`} placeholder="09:00" value={s.start} onChangeText={(t) => updateSlot(i, 'start', t)} />
              </View>
              <View style={styles.slotInput}>
                <Input label="End" placeholder="12:00" value={s.end} onChangeText={(t) => updateSlot(i, 'end', t)} />
              </View>
            </View>
            {slotDrafts.length > 1 ? (
              <Pressable onPress={() => removeSlot(i)} hitSlop={8} style={styles.removeSlot}>
                <Ionicons name="trash-outline" size={18} color={p.danger} />
              </Pressable>
            ) : null}
          </View>
        ))}

        <Text style={styles.fieldLabel}>Attach paper (optional — dual-sealed/printed only)</Text>
        {eligiblePapers.length === 0 ? (
          <Text style={styles.noPapers}>No eligible papers yet.</Text>
        ) : (
          eligiblePapers.slice(0, 5).map((paper) => {
            const active = paperId === paper.id;
            return (
              <Pressable
                key={paper.id}
                onPress={() => setPaperId(active ? null : paper.id)}
                style={[styles.paperOption, active && styles.paperOptionActive]}
              >
                <Text style={[styles.paperOptionText, active && { color: p.gold }]}>{paper.title}</Text>
              </Pressable>
            );
          })
        )}

        <View style={styles.formActions}>
          <BookButton title="Create Exam" variant="gold" icon="checkmark-circle-outline" onPress={() => void create()} loading={busy} />
          <BookButton title="Cancel" onPress={cancelCreating} />
        </View>
      </LeafScroll>
    );

  const rightPage = (
    <LeafScroll stacked={stacked}>
      <PageTitle center size={[19, 27]}>
        Scheduled Exams
      </PageTitle>
      <Rule ornament gap={12} />

      {exams.length === 0 ? (
        <EmptyState
          icon="calendar-outline"
          title="No exams scheduled"
          subtitle="Create an exam, pick its examination format and year, and the paper structure is loaded automatically."
        />
      ) : (
        exams.map((item) => {
          const blueprint = item.format_blueprint;
          return (
            <View key={item.id} style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={[styles.cardTitle, { fontSize: fluid(pageWidth, 12.5, 14) }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Badge status={item.status} />
              </View>
              <Text style={styles.cardMeta}>📅 {item.exam_date} · ⏱ {item.duration_min} min</Text>
              <Text style={styles.cardMeta}>
                🧾 {blueprint ? blueprint.display_name : 'No exam format attached'}
                {blueprint?.enforced
                  ? ` · ${blueprint.totals.questions ?? '—'} questions · ${blueprint.totals.marks ?? '—'} marks`
                  : ''}
              </Text>
              <Text style={styles.cardMeta}>📄 {item.paper?.title ?? 'No paper attached yet'}</Text>
              <Text style={styles.cardMeta}>
                🗂 {item.paper_set_count} paper set{item.paper_set_count === 1 ? '' : 's'} ·{' '}
                {paperSetLabels(item.paper_set_count).join(', ')}
                {item.allow_question_reuse ? ' · reuse allowed' : ''}
              </Text>
              {blueprint?.provisional ? (
                <Text style={styles.provisional}>
                  ⓘ {blueprint.year} pattern carried forward from {blueprint.year - 1} — re-check the
                  official notification.
                </Text>
              ) : null}
              {slotsFor(item.id).length > 0 ? (
                <View style={styles.slotChips}>
                  {slotsFor(item.id).map((s) => (
                    <View key={s.id} style={styles.slotChip}>
                      <Ionicons name="time-outline" size={12} color={p.gold} />
                      <Text style={styles.slotChipText}>{s.label}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              <View style={styles.cardActions}>
                <ActionButton
                  label="Manage paper sets"
                  icon="albums-outline"
                  palette={p}
                  onPress={() => {
                    setSetsTarget(item);
                    setSetsDraft(item.paper_set_count);
                    setReuseDraft(item.allow_question_reuse);
                  }}
                />
                {blueprint ? (
                  <ActionButton
                    label="Assign subjects to teachers"
                    icon="people-outline"
                    palette={p}
                    onPress={() => void openAssign(item)}
                  />
                ) : null}
              </View>
            </View>
          );
        })
      )}
    </LeafScroll>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ArchiveBackground />
      <ArchiveHeader
        title="SECUREAI EXAM ARCHIVE"
        shortTitle="ARCHIVE"
        subtitle="Admin · Exams"
        onMenu={sidebarMode === 'overlay' ? () => setIndexOpen(true) : undefined}
      />

      <View style={styles.body}>
        {sidebarMode === 'overlay' ? null : (
          <ArchiveSidebar items={items} activeRoute={SELF} onSelect={onSelect} />
        )}

        {stacked ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingHorizontal: outerPad, paddingBottom: 20 + insets.bottom },
            ]}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={p.gold} />
            }
          >
            <OpenBook left={leftPage} right={rightPage} leftFolio="Create exam" rightFolio={`${exams.length} scheduled`} />
          </ScrollView>
        ) : (
          <View style={[styles.stage, { paddingHorizontal: outerPad }]}>
            <OpenBook left={leftPage} right={rightPage} leftFolio="Create exam" rightFolio={`${exams.length} scheduled`} />
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

      <NoticeBoard
        visible={creating && boardOpen}
        onClose={cancelCreating}
        onContinue={finishBoard}
        canContinue={boardComplete}
        catalogueError={catalogueError}
        formatOptions={formatOptions}
        formatKey={formatKey}
        onPickFormat={(key) => void pickFormat(key)}
        format={format}
        loadingFormat={loadingFormat}
        customSections={customSections}
        onCustomSections={setCustomSections}
        setCount={setCount}
        onSetCount={setSetCount}
        allowReuse={allowReuse}
        onAllowReuse={setAllowReuse}
      />

      {/* ---------------------------- paper sets ----------------------------- */}
      <AnimatedPencilPaperModal
        visible={!!setsTarget}
        title={`Paper Sets · ${setsTarget?.name ?? ''}`}
        onClose={() => setSetsTarget(null)}
      >
        <Text style={styles.assignBlurb}>
          Every set is an independent paper: the setter picks its own questions and each set must
          satisfy the exam format on its own. Sets can be added or removed at any time until their
          paper is sealed.
        </Text>
        <Stepper
          label="Number of paper sets"
          value={setsDraft}
          onChange={setSetsDraft}
          min={1}
          max={26}
          suffix={setsDraft === 1 ? 'set' : 'sets'}
        />
        <View style={styles.setChips}>
          {paperSetLabels(setsDraft).map((label) => (
            <View key={label} style={styles.setChip}>
              <Text style={styles.setChipText}>{label}</Text>
            </View>
          ))}
        </View>
        {setsTarget && setsDraft < setsTarget.paper_set_count ? (
          <Text style={styles.provisional}>
            ⚠ Reducing to {setsDraft} removes{' '}
            {paperSetLabels(setsTarget.paper_set_count)
              .slice(setsDraft)
              .join(', ')}
            . Any unsealed selection in those sets is discarded; sealed sets cannot be removed.
          </Text>
        ) : null}
        <Toggle
          label="Allow question reuse across sets"
          value={reuseDraft}
          onChange={setReuseDraft}
          hint={
            reuseDraft
              ? 'A question may appear in more than one set.'
              : 'Off — every set must use different questions.'
          }
        />
        <BookButton
          title="Save paper sets"
          variant="gold"
          loading={savingSets}
          onPress={() => void saveSets()}
        />
        <View style={{ height: 8 }} />
        <BookButton title="Cancel" onPress={() => setSetsTarget(null)} />
      </AnimatedPencilPaperModal>

      {/* -------------------------- subject assignment ----------------------- */}
      <AnimatedPencilPaperModal
        visible={!!assignTarget}
        title={`Subjects · ${assignTarget?.name ?? ''}`}
        onClose={() => setAssignTarget(null)}
      >
        <Text style={styles.assignBlurb}>
          A teacher with no subject selected here may write for every subject in the format.
          Select subjects to restrict them.
        </Text>
        {teachers.length === 0 ? (
          <Text style={styles.noPapers}>No teacher accounts yet.</Text>
        ) : (
          teachers.map((teacher) => (
            <View key={teacher.id} style={styles.assignRow}>
              <Text style={styles.assignName}>{teacher.full_name}</Text>
              <View style={styles.assignChips}>
                {assignSubjects.map((subject) => {
                  const on = assignments.some(
                    (a) => a.teacher_id === teacher.id && a.subject === subject
                  );
                  return (
                    <Pressable
                      key={subject}
                      onPress={() => void toggleAssignment(teacher.id, subject)}
                      style={[styles.assignChip, on && styles.assignChipOn]}
                    >
                      <Text style={[styles.assignChipText, on && { color: p.gold }]}>
                        {subject}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))
        )}
        <BookButton title="Done" variant="gold" onPress={() => setAssignTarget(null)} />
      </AnimatedPencilPaperModal>
    </View>
  );
}

/* ------------------------------ page pieces ------------------------------- */

function LeafScroll({ children, stacked }: { children: React.ReactNode; stacked: boolean }) {
  if (stacked) return <View>{children}</View>;
  return (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}

function ActionButton({
  label,
  icon,
  onPress,
  palette: p,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  palette: ArchivePalette;
}) {
  const styles = useMemo(() => makeStyles(p), [p]);
  return (
    <Pressable style={[styles.actionBtn, { borderColor: p.gold }]} onPress={onPress}>
      <Ionicons name={icon} size={13} color={p.gold} />
      <Text style={[styles.actionBtnText, { color: p.gold }]}>{label}</Text>
    </Pressable>
  );
}

/* ------------------------------ notice board ------------------------------- */

/** Static drawing-pin coordinates so the board never re-randomises. */
const PIN_TILT = ['-0.8deg', '0.6deg', '-0.4deg'] as const;

function NoticeBoard({
  visible,
  onClose,
  onContinue,
  canContinue,
  catalogueError,
  formatOptions,
  formatKey,
  onPickFormat,
  format,
  loadingFormat,
  customSections,
  onCustomSections,
  setCount,
  onSetCount,
  allowReuse,
  onAllowReuse,
}: {
  visible: boolean;
  onClose: () => void;
  onContinue: () => void;
  canContinue: boolean;
  catalogueError: string | null;
  formatOptions: SelectOption[];
  formatKey: string | null;
  onPickFormat: (key: string) => void;
  format: ResolvedFormat | null;
  loadingFormat: boolean;
  customSections: CustomSection[];
  onCustomSections: (fn: (prev: CustomSection[]) => CustomSection[]) => void;
  setCount: number;
  onSetCount: (n: number) => void;
  allowReuse: boolean;
  onAllowReuse: (v: boolean) => void;
}) {
  const p = useArchivePalette();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const board = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);
  const [archiveOpen, setArchiveOpen] = useState(false);

  useEffect(() => {
    if (visible) setMounted(true);
    if (reduced) {
      board.setValue(visible ? 1 : 0);
      if (!visible) setMounted(false);
      return;
    }
    Animated.timing(board, {
      toValue: visible ? 1 : 0,
      duration: visible ? 650 : 480,
      easing: visible ? Easing.out(Easing.back(1.2)) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      if (!visible) setMounted(false);
    });
  }, [visible, board, reduced]);

  const selectedFormatOption = formatOptions.find((o) => o.value === formatKey) ?? null;
  const boardWidth = Math.min(width - 32, 620);
  const translateY = board.interpolate({ inputRange: [0, 1], outputRange: [42, 0] });
  const scale = board.interpolate({ inputRange: [0, 1], outputRange: [0.93, 1] });

  let sectionNo = 1;
  const formatSectionNo = sectionNo++;
  const questionsSectionNo = format && !format.enforced ? sectionNo++ : null;
  const setsSectionNo = sectionNo++;

  return (
    <Modal transparent visible={mounted} animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, ncStyles.scrim, { opacity: board }]}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close notice board" onPress={onClose} />
      </Animated.View>

      <View style={ncStyles.center} pointerEvents="box-none">
        <Animated.View
          style={[
            ncStyles.frame,
            {
              width: boardWidth,
              borderColor: p.coverEdge,
              backgroundColor: p.cover,
              opacity: board,
              transform: [{ translateY }, { scale }],
            },
          ]}
        >
          <View style={ncStyles.surface}>
            <LinearGradient
              colors={['#3A4830', '#232D1E', '#2E3A27']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <Text style={ncStyles.title}>NOTICE BOARD</Text>
            <Text style={ncStyles.subtitle}>Pin the exam&apos;s blueprint before filling in its details</Text>
            <View style={ncStyles.underline} />

            <ScrollView style={ncStyles.scroll} showsVerticalScrollIndicator={false}>
              <View style={[ncStyles.pin, { transform: [{ rotate: PIN_TILT[0] }] }]}>
                <Ionicons name="pin" size={13} color="#C0392B" style={ncStyles.pinIcon} />
                <Text style={ncStyles.pinLabel}>{formatSectionNo}. Exam Format</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Choose exam format"
                  onPress={() => setArchiveOpen(true)}
                  style={ncStyles.archiveTrigger}
                >
                  <Ionicons name="library-outline" size={14} color="#6B4E12" />
                  <View style={{ flex: 1 }}>
                    <Text style={ncStyles.archiveTriggerValue} numberOfLines={1}>
                      {selectedFormatOption?.label ??
                        (formatOptions.length ? 'Choose an exam and year…' : 'Loading catalogue…')}
                    </Text>
                    {selectedFormatOption?.hint ? (
                      <Text style={ncStyles.archiveTriggerHint} numberOfLines={1}>
                        {selectedFormatOption.hint}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={14} color="#6B4E12" />
                </Pressable>
                <ExaminationArchive
                  visible={archiveOpen}
                  options={formatOptions}
                  value={formatKey}
                  onChange={onPickFormat}
                  onClose={() => setArchiveOpen(false)}
                  emptyText={catalogueError ?? 'Loading the exam format catalogue…'}
                />
                {catalogueError ? <Text style={ncStyles.error}>{catalogueError}</Text> : null}
                {loadingFormat ? <Text style={ncStyles.hint}>Loading structure…</Text> : null}
                {format ? (
                  <View style={ncStyles.blueprint}>
                    <Text style={ncStyles.blueprintMeta}>
                      {format.body} · {format.mode}
                      {format.duration_minutes ? ` · ${format.duration_minutes} min` : ''}
                    </Text>
                    {format.enforced ? (
                      <Text style={ncStyles.blueprintTotals}>
                        {format.sections.length} sections ·{' '}
                        {format.totals.questions ??
                          `${format.totals.questions_min}–${format.totals.questions_max}`}{' '}
                        questions · {format.totals.marks ?? '—'} marks
                      </Text>
                    ) : (
                      <Text style={ncStyles.blueprintFree}>
                        The reference does not publish question counts for this exam — set them below.
                      </Text>
                    )}
                    {format.provisional ? (
                      <Text style={ncStyles.blueprintNote}>
                        ⓘ The {format.year} pattern is carried forward from {format.year - 1}.
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>

              {format && !format.enforced ? (
                <View style={[ncStyles.pin, { transform: [{ rotate: PIN_TILT[1] }] }]}>
                  <Ionicons name="pin" size={13} color="#C0392B" style={ncStyles.pinIcon} />
                  <Text style={ncStyles.pinLabel}>{questionsSectionNo}. Questions per Section (Required)</Text>
                  <Text style={ncStyles.pinHint}>Every paper for this exam must hold exactly these counts.</Text>
                  {customSections.map((s, i) => (
                    <View key={s.name} style={ncStyles.customRow}>
                      <Text style={ncStyles.customName}>{s.name}</Text>
                      <View style={ncStyles.customInputs}>
                        <View style={ncStyles.customField}>
                          <Input
                            label="Questions"
                            placeholder="25"
                            keyboardType="number-pad"
                            value={s.count}
                            onChangeText={(t) =>
                              onCustomSections((prev) => prev.map((r, idx) => (idx === i ? { ...r, count: t } : r)))
                            }
                          />
                        </View>
                        <View style={ncStyles.customField}>
                          <Input
                            label="Marks"
                            placeholder="1"
                            keyboardType="numeric"
                            value={s.marks_correct}
                            onChangeText={(t) =>
                              onCustomSections((prev) =>
                                prev.map((r, idx) => (idx === i ? { ...r, marks_correct: t } : r))
                              )
                            }
                          />
                        </View>
                        <View style={ncStyles.customField}>
                          <Input
                            label="Negative"
                            placeholder="0"
                            keyboardType="numeric"
                            value={s.negative_marks}
                            onChangeText={(t) =>
                              onCustomSections((prev) =>
                                prev.map((r, idx) => (idx === i ? { ...r, negative_marks: t } : r))
                              )
                            }
                          />
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={[ncStyles.pin, { transform: [{ rotate: PIN_TILT[2] }] }]}>
                <Ionicons name="pin" size={13} color="#C0392B" style={ncStyles.pinIcon} />
                <Text style={ncStyles.pinLabel}>{setsSectionNo}. Paper Sets</Text>
                <Stepper
                  label="Number of paper sets"
                  value={setCount}
                  onChange={onSetCount}
                  min={1}
                  max={26}
                  suffix={setCount === 1 ? 'set' : 'sets'}
                />
                <View style={ncStyles.setChips}>
                  {paperSetLabels(setCount).map((label) => (
                    <View key={label} style={ncStyles.setChip}>
                      <Text style={ncStyles.setChipText}>{label}</Text>
                    </View>
                  ))}
                </View>
                <Toggle
                  label="Allow question reuse across sets"
                  value={allowReuse}
                  onChange={onAllowReuse}
                  hint={
                    allowReuse
                      ? 'A question may appear in more than one set.'
                      : 'Off — every set must use different questions.'
                  }
                />
              </View>
            </ScrollView>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Continue"
              accessibilityState={{ disabled: !canContinue }}
              disabled={!canContinue}
              onPress={onContinue}
              style={[ncStyles.continueBtn, { opacity: canContinue ? 1 : 0.4 }]}
            >
              <Text style={ncStyles.continueText}>Continue</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onClose} style={ncStyles.cancelBtn}>
              <Text style={ncStyles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/* --------------------------- examination archive --------------------------- */

/**
 * "THE EXAMINATION ARCHIVE" — the vintage picker that replaces the plain
 * dropdown for choosing an exam format. A category index down the left,
 * searchable archival record cards on the right. Selecting a record calls
 * the same `onChange` the plain Select used to call — no format-loading
 * logic lives here.
 */
function ExaminationArchive({
  visible,
  options,
  value,
  onChange,
  onClose,
  emptyText,
}: {
  visible: boolean;
  options: SelectOption[];
  value: string | null;
  onChange: (value: string) => void;
  onClose: () => void;
  emptyText?: string;
}) {
  const p = useArchivePalette();
  const reduced = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const t = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const o of options) set.add(o.group || 'General');
    return Array.from(set);
  }, [options]);

  useEffect(() => {
    if (!visible) return;
    const current = options.find((o) => o.value === value);
    setCategory(current?.group || categories[0] || null);
    setQuery('');
    // Re-seed only when the archive opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (visible) setMounted(true);
    if (reduced) {
      t.setValue(visible ? 1 : 0);
      if (!visible) setMounted(false);
      return;
    }
    Animated.timing(t, {
      toValue: visible ? 1 : 0,
      duration: visible ? 620 : 420,
      easing: visible ? Easing.out(Easing.back(1.1)) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      if (!visible) setMounted(false);
    });
  }, [visible, t, reduced]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => `${o.label} ${o.hint ?? ''} ${o.group ?? ''}`.toLowerCase().includes(q))
    : options.filter((o) => (o.group || 'General') === category);

  // Large, premium archive sheet — not a generic modal.
  const frameWidth = Math.min(width * 0.78, 1120);
  const frameHeight = Math.min(height * 0.84, 860);
  const indexWidth = Math.max(200, Math.min(260, frameWidth * 0.23));
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] });
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });

  return (
    <Modal transparent visible={mounted} animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, arStyles.scrim, { opacity: t }]}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close examination archive" onPress={onClose} />
      </Animated.View>

      <View style={arStyles.center} pointerEvents="box-none">
        <Animated.View
          style={[
            arStyles.frame,
            {
              width: frameWidth,
              height: frameHeight,
              backgroundColor: p.cover,
              borderColor: p.coverEdge,
              opacity: t,
              transform: [{ translateY }, { scale }],
            },
          ]}
        >
          <View style={[arStyles.gilt, { borderColor: p.coverHighlight }]} pointerEvents="none" />
          <View style={[arStyles.parchment, { backgroundColor: p.page }]}>
            <PageGrain />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={[arStyles.close, { borderColor: p.gold, backgroundColor: p.pageShade }]}
            >
              <Text style={[arStyles.closeGlyph, { color: p.gold }]}>×</Text>
            </Pressable>

            <Text style={[arStyles.title, { color: p.ink }]}>THE EXAMINATION ARCHIVE</Text>
            <View style={arStyles.titleOrnament}>
              <View style={[arStyles.ornLine, { backgroundColor: p.gold }]} />
              <Ionicons name="diamond-outline" size={9} color={p.gold} style={{ marginHorizontal: 8 }} />
              <View style={[arStyles.ornLine, { backgroundColor: p.gold }]} />
            </View>
            <Text style={[arStyles.subtitle, { color: p.inkDim }]}>
              Select an exam from the archive to continue
            </Text>

            <View style={[arStyles.search, { borderColor: p.gold, backgroundColor: p.pageShade }]}>
              <Ionicons name="search" size={16} color={p.inkDim} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search the archive…"
                placeholderTextColor={p.inkFaint}
                autoCapitalize="none"
                style={[arStyles.searchInput, { color: p.ink }]}
              />
            </View>

            <View style={arStyles.body}>
              <View style={[arStyles.index, { width: indexWidth, borderColor: p.rule }]}>
                <Text style={[arStyles.indexTitle, { color: p.inkDim }]}>ARCHIVE INDEX</Text>
                <View style={arStyles.indexOrnament}>
                  <View style={[arStyles.ornLineSmall, { backgroundColor: p.gold }]} />
                  <Ionicons name="diamond-outline" size={7} color={p.gold} style={{ marginHorizontal: 6 }} />
                  <View style={[arStyles.ornLineSmall, { backgroundColor: p.gold }]} />
                </View>
                <ScrollView showsVerticalScrollIndicator={false}>
                  {categories.map((cat) => {
                    const active = cat === category && !q;
                    return (
                      <Pressable
                        key={cat}
                        accessibilityRole="button"
                        accessibilityLabel={cat}
                        accessibilityState={{ selected: active }}
                        onPress={() => {
                          setCategory(cat);
                          setQuery('');
                        }}
                        style={[
                          arStyles.catRow,
                          active && {
                            backgroundColor: p.cover,
                            borderColor: p.gold,
                            shadowColor: '#000',
                            shadowOffset: { width: 0, height: 3 },
                            shadowOpacity: 0.3,
                            shadowRadius: 6,
                            elevation: 3,
                          },
                        ]}
                      >
                        <Ionicons name={categoryIcon(cat)} size={16} color={active ? p.gold : p.inkFaint} />
                        <Text
                          style={[
                            arStyles.catText,
                            { color: active ? p.onCover : p.inkDim },
                            active && arStyles.catTextActive,
                          ]}
                          numberOfLines={1}
                        >
                          {cat}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              <View style={arStyles.list}>
                <CenteredHeading>Available Examinations</CenteredHeading>
                <ScrollView style={arStyles.listScroll} showsVerticalScrollIndicator={false}>
                  {filtered.length === 0 ? (
                    <Text style={[arStyles.empty, { color: p.inkDim }]}>
                      {q ? 'No match.' : (emptyText ?? 'Nothing to choose from yet.')}
                    </Text>
                  ) : (
                    filtered.map((option) => (
                      <ArchiveRecord
                        key={option.value}
                        option={option}
                        active={option.value === value}
                        onPress={() => {
                          onChange(option.value);
                          onClose();
                        }}
                        palette={p}
                      />
                    ))
                  )}
                </ScrollView>
              </View>
            </View>

            <Text style={[arStyles.footer, { color: p.danger }]}>✦ Select an exam to continue ✦</Text>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function categoryIcon(cat: string): keyof typeof Ionicons.glyphMap {
  const k = cat.toLowerCase();
  if (k.includes('bank') || k.includes('financ')) return 'business-outline';
  if (k.includes('engineer')) return 'construct-outline';
  if (k.includes('medic') || k.includes('health')) return 'medkit-outline';
  if (k.includes('manage')) return 'briefcase-outline';
  if (k.includes('govern') || k.includes('civil') || k.includes('admin')) return 'shield-outline';
  if (k.includes('teach') || k.includes('educat')) return 'school-outline';
  if (k.includes('law')) return 'hammer-outline';
  return 'ribbon-outline';
}

function ArchiveRecord({
  option,
  active,
  onPress,
  palette: p,
}: {
  option: SelectOption;
  active: boolean;
  onPress: () => void;
  palette: ArchivePalette;
}) {
  const t = useRef(new Animated.Value(0)).current;
  const to = (v: number) =>
    Animated.spring(t, { toValue: v, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, -2] });

  // Purely presentational split of the existing "org · description" hint
  // into the two stacked lines the archive record shows — the data itself
  // (built in formatOptions) is untouched.
  const [orgLine, ...descParts] = (option.hint ?? '').split(' · ');
  const descLine = descParts.join(' · ');

  return (
    <Animated.View style={{ transform: [{ translateY }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={option.label}
        accessibilityState={{ selected: active, disabled: !!option.disabled }}
        disabled={option.disabled}
        onPress={onPress}
        onPressIn={() => to(1)}
        onPressOut={() => to(0)}
        {...({ onHoverIn: () => to(1), onHoverOut: () => to(0) } as object)}
        style={[
          arStyles.record,
          {
            borderColor: active ? p.gold : p.rule,
            borderWidth: active ? 2 : 1,
            backgroundColor: active ? p.goldSoft : p.pageShade,
            opacity: option.disabled ? 0.5 : 1,
            shadowOpacity: active ? 0.22 : 0.1,
          },
        ]}
      >
        <View style={arStyles.recordBody}>
          <View style={arStyles.recordHead}>
            <Text style={[arStyles.recordTitle, { color: p.ink }]} numberOfLines={1}>
              {option.label}
            </Text>
            {option.tag ? (
              <View style={[arStyles.tag, { borderColor: p.gold }]}>
                <Text style={[arStyles.tagText, { color: p.gold }]}>{option.tag}</Text>
              </View>
            ) : null}
          </View>
          {orgLine ? (
            <Text style={[arStyles.recordOrg, { color: p.inkDim }]} numberOfLines={1}>
              {orgLine}
            </Text>
          ) : null}
          {descLine ? (
            <Text style={[arStyles.recordHint, { color: p.inkFaint }]} numberOfLines={1}>
              {descLine}
            </Text>
          ) : null}
        </View>
        <View
          style={[
            arStyles.seal,
            { borderColor: active ? p.gold : p.rule, backgroundColor: active ? p.gold : 'transparent' },
          ]}
        >
          {active ? <Ionicons name="checkmark" size={13} color={p.cover} /> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const arStyles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(0,0,0,0.72)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  // Dark wooden/leather outer frame.
  frame: {
    borderWidth: 16,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.6,
    shadowRadius: 40,
    elevation: 30,
  },
  gilt: {
    position: 'absolute',
    top: 5,
    left: 5,
    right: 5,
    bottom: 5,
    borderWidth: 1,
    borderRadius: 6,
  },
  // Cream parchment page inside the frame.
  parchment: {
    flex: 1,
    borderRadius: 6,
    overflow: 'hidden',
    paddingTop: 26,
    paddingBottom: 18,
    paddingHorizontal: 30,
  },
  close: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  closeGlyph: { fontSize: 18, fontWeight: '700', lineHeight: 20, marginTop: -1 },
  title: {
    fontFamily: serif,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 2,
    textAlign: 'center',
  },
  titleOrnament: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  ornLine: { width: 46, height: 1 },
  ornLineSmall: { width: 22, height: 1 },
  subtitle: {
    fontFamily: serif,
    fontStyle: 'italic',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 18,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 13,
    marginBottom: 20,
  },
  searchInput: { flex: 1, fontFamily: serif, fontSize: 14.5, fontStyle: 'italic', paddingVertical: 2 },
  body: { flexDirection: 'row', gap: 24, flex: 1, minHeight: 0 },
  index: { borderRightWidth: 1, paddingRight: 16 },
  indexTitle: {
    fontFamily: serif,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  indexOrnament: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 6, marginBottom: 16 },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  catText: { fontFamily: serif, fontSize: 14, flexShrink: 1 },
  catTextActive: { fontWeight: '700' },
  list: { flex: 1, minHeight: 0 },
  listScroll: { flex: 1 },
  empty: { fontFamily: serif, fontSize: 13, fontStyle: 'italic', textAlign: 'center', marginTop: 24 },
  record: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 7,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
  },
  recordBody: { flex: 1 },
  recordHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  recordTitle: { flex: 1, fontFamily: serif, fontSize: 16, fontWeight: '700' },
  recordOrg: { fontFamily: serif, fontSize: 12.5, lineHeight: 17 },
  recordHint: { fontFamily: serif, fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  tag: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  tagText: { fontFamily: serif, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.8 },
  seal: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    fontFamily: serif,
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: 1.2,
    textAlign: 'center',
    marginTop: 16,
    opacity: 0.85,
  },
});

const ncStyles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(0,0,0,0.58)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  frame: {
    borderWidth: 6,
    borderRadius: 8,
    padding: 8,
    maxHeight: '86%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.55,
    shadowRadius: 30,
    elevation: 24,
  },
  surface: {
    borderRadius: 3,
    overflow: 'hidden',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.35)',
  },
  title: {
    fontFamily: serif,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 4,
    textTransform: 'uppercase',
    color: '#FFFFFF',
    textAlign: 'center',
    opacity: 0.95,
  },
  subtitle: {
    fontFamily: serif,
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    marginTop: 4,
  },
  underline: {
    alignSelf: 'center',
    width: 82,
    height: 1,
    backgroundColor: '#FFFFFF',
    opacity: 0.35,
    marginTop: 9,
    marginBottom: 12,
  },
  scroll: { maxHeight: 440 },
  pin: {
    backgroundColor: '#F3E9C9',
    borderRadius: 2,
    padding: 12,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 6,
  },
  pinIcon: { position: 'absolute', top: -8, left: '50%', marginLeft: -6.5 },
  pinLabel: {
    fontFamily: serif,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#2A2410',
    marginBottom: 8,
    textAlign: 'center',
  },
  pinHint: { fontFamily: serif, fontSize: 11, color: '#5A5030', marginBottom: 8, textAlign: 'center' },
  archiveTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#B8A85F',
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.35)',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  archiveTriggerValue: { fontFamily: serif, fontSize: 13, fontWeight: '700', color: '#2A2410' },
  archiveTriggerHint: { fontFamily: serif, fontSize: 10.5, color: '#5A5030', marginTop: 2 },
  error: { fontFamily: serif, fontSize: 11, color: '#8B2E2E', marginTop: 6 },
  hint: { fontFamily: serif, fontSize: 11, color: '#5A5030', marginTop: 6 },
  blueprint: { marginTop: 8 },
  blueprintMeta: { fontFamily: serif, fontSize: 11.5, color: '#4A421F' },
  blueprintTotals: { fontFamily: serif, fontSize: 11.5, fontWeight: '700', color: '#6B4E12', marginTop: 4 },
  blueprintFree: { fontFamily: serif, fontSize: 11.5, color: '#5A5030', marginTop: 4, lineHeight: 16 },
  blueprintNote: { fontFamily: serif, fontSize: 10.5, color: '#7A6E45', marginTop: 4 },
  customRow: { marginTop: 6 },
  customName: { fontFamily: serif, fontSize: 12, fontWeight: '700', color: '#2A2410', marginBottom: 4 },
  customInputs: { flexDirection: 'row', gap: 8 },
  customField: { flex: 1 },
  setChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, marginBottom: 4 },
  setChip: { borderWidth: 1, borderColor: '#B8A85F', borderRadius: 3, paddingHorizontal: 9, paddingVertical: 4 },
  setChipText: { fontFamily: serif, fontSize: 11, fontWeight: '700', color: '#4A421F' },
  continueBtn: {
    marginTop: 6,
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    borderRadius: 3,
    paddingVertical: 10,
    paddingHorizontal: 30,
  },
  continueText: {
    fontFamily: serif,
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: '#FFFFFF',
  },
  cancelBtn: { alignSelf: 'center', marginTop: 8, paddingVertical: 4, paddingHorizontal: 12 },
  cancelText: {
    fontFamily: serif,
    fontSize: 10.5,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.6)',
  },
});

/* --------------------------------- styles --------------------------------- */

const makeStyles = (p: ArchivePalette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: p.backdrop },
    body: { flex: 1, flexDirection: 'row' },
    scrollContent: { paddingVertical: 16 },
    stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },

    createCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingVertical: 30 },
    createHint: {
      fontFamily: serif,
      fontSize: 12.5,
      color: p.inkDim,
      textAlign: 'center',
      lineHeight: 18,
      maxWidth: 260,
    },

    summaryCard: {
      borderWidth: 1,
      borderColor: p.gold,
      backgroundColor: p.goldSoft,
      borderRadius: 3,
      paddingVertical: 8,
      paddingHorizontal: 10,
      marginBottom: 12,
    },
    summaryHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    summaryTitle: { flex: 1, fontFamily: serif, fontWeight: '700', fontSize: 12.5, color: p.ink },
    summaryEdit: { fontFamily: serif, fontSize: 10.5, fontWeight: '700', color: p.gold, textTransform: 'uppercase' },
    summaryMeta: { fontFamily: serif, fontSize: 10.5, color: p.inkDim, marginTop: 4 },

    fieldLabel: { fontFamily: serif, color: p.inkFaint, fontSize: 13, fontWeight: '600', marginBottom: 8 },
    slotsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    addSlot: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 8 },
    addSlotText: { fontFamily: serif, color: p.gold, fontSize: 13, fontWeight: '700' },
    slotRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    slotInputs: { flexDirection: 'row', gap: 8, flex: 1 },
    slotInput: { flex: 1 },
    removeSlot: { paddingBottom: 8 },
    noPapers: { fontFamily: serif, color: p.inkDim, fontSize: 13, fontStyle: 'italic', marginBottom: 8 },
    paperOption: {
      borderWidth: 1,
      borderColor: p.rule,
      borderRadius: 3,
      padding: 12,
      marginBottom: 8,
      backgroundColor: p.pageShade,
    },
    paperOptionActive: { borderColor: p.gold, backgroundColor: p.goldSoft },
    paperOptionText: { fontFamily: serif, color: p.inkDim, fontSize: 13, fontWeight: '600' },
    formActions: { marginTop: 14, gap: 8 },

    emptyText: { fontFamily: serif, fontSize: 12.5, color: p.inkDim, lineHeight: 18, textAlign: 'center' },

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
    provisional: { fontFamily: serif, color: p.warning, fontSize: 12, marginTop: 8, lineHeight: 17 },
    slotChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    slotChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: `${p.gold}1A`,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    slotChipText: { fontFamily: serif, color: p.inkDim, fontSize: 11, fontWeight: '600' },
    cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 9 },

    actionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      borderWidth: 1,
      borderRadius: 3,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    actionBtnText: { fontFamily: serif, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },

    setChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
    setChip: {
      borderWidth: 1,
      borderColor: p.rule,
      borderRadius: 3,
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: p.pageShade,
    },
    setChipText: { fontFamily: serif, color: p.ink, fontSize: 12, fontWeight: '700' },
    assignBlurb: { fontFamily: serif, color: p.inkDim, fontSize: 12, lineHeight: 18, marginBottom: 12 },
    assignRow: {
      borderTopWidth: 1,
      borderTopColor: p.rule,
      paddingTop: 12,
      marginBottom: 8,
    },
    assignName: { fontFamily: serif, color: p.ink, fontSize: 14, fontWeight: '700', marginBottom: 6 },
    assignChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    assignChip: {
      borderWidth: 1,
      borderColor: p.rule,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: p.pageShade,
    },
    assignChipOn: { borderColor: p.gold, backgroundColor: p.goldSoft },
    assignChipText: { fontFamily: serif, color: p.inkDim, fontSize: 12, fontWeight: '700' },
  });
