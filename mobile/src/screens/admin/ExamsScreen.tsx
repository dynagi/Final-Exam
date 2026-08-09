import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Screen,
  Select,
  SelectOption,
  Stepper,
  Toggle,
} from '../../components/UI';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
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
import { radius, spacing, ThemeColors } from '../../lib/theme';
import { Exam, ExamSlot, paperSetLabels, Paper, Profile, TeacherSubject } from '../../lib/types';

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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [exams, setExams] = useState<ExamWithPaper[]>([]);
  const [slots, setSlots] = useState<ExamSlot[]>([]);
  const [eligiblePapers, setEligiblePapers] = useState<Paper[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const [creating, setCreating] = useState(false);
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
  /**
   * Per-section counts the Admin must supply when the chosen format's
   * reference publishes none — without them the exam could not enforce
   * anything, so it is not optional.
   */
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
    setSetCount(4);
    setAllowReuse(false);
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

  return (
    <Screen>
      <Button
        title="Create Exam"
        icon="add-circle-outline"
        onPress={() => setCreating(true)}
        style={{ marginBottom: spacing.md }}
      />

      <FlatList
        data={exams}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.text} />
        }
        ListEmptyComponent={
          <EmptyState
            icon="calendar-outline"
            title="No exams scheduled"
            subtitle="Create an exam, pick its examination format and year, and the paper structure is loaded automatically."
          />
        }
        renderItem={({ item }) => {
          const blueprint = item.format_blueprint;
          return (
            <Card>
              <View style={styles.header}>
                <Text style={styles.title}>{item.name}</Text>
                <Badge status={item.status} />
              </View>
              <Text style={styles.meta}>📅 {item.exam_date} · ⏱ {item.duration_min} min</Text>
              <Text style={styles.meta}>
                🧾 {blueprint ? blueprint.display_name : 'No exam format attached'}
                {blueprint?.enforced
                  ? ` · ${blueprint.totals.questions ?? '—'} questions · ${blueprint.totals.marks ?? '—'} marks`
                  : ''}
              </Text>
              <Text style={styles.meta}>📄 {item.paper?.title ?? 'No paper attached yet'}</Text>
              <Text style={styles.meta}>
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
                      <Ionicons name="time-outline" size={12} color={colors.accent} />
                      <Text style={styles.slotChipText}>{s.label}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              <Button
                title="Manage paper sets"
                variant="ghost"
                icon="albums-outline"
                onPress={() => {
                  setSetsTarget(item);
                  setSetsDraft(item.paper_set_count);
                  setReuseDraft(item.allow_question_reuse);
                }}
                style={{ marginTop: spacing.md }}
              />
              {blueprint ? (
                <Button
                  title="Assign subjects to teachers"
                  variant="ghost"
                  icon="people-outline"
                  onPress={() => void openAssign(item)}
                  style={{ marginTop: spacing.sm }}
                />
              ) : null}
            </Card>
          );
        }}
      />

      {/* ------------------------------ create ------------------------------ */}
      <Modal transparent visible={creating} animationType="fade" onRequestClose={() => setCreating(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>Create Exam</Text>

              <Select
                label="Exam format"
                placeholder={catalogue.length ? 'Choose an exam and year…' : 'Loading catalogue…'}
                value={formatKey}
                options={formatOptions}
                onChange={(key) => void pickFormat(key)}
                searchable
                emptyText={catalogueError ?? 'Loading the exam format catalogue…'}
              />
              {catalogueError ? <Text style={styles.error}>{catalogueError}</Text> : null}
              {loadingFormat ? <Text style={styles.hint}>Loading structure…</Text> : null}

              {format ? (
                <View style={styles.blueprint}>
                  <Text style={styles.blueprintTitle}>{format.display_name}</Text>
                  <Text style={styles.blueprintMeta}>
                    {format.body} · {format.mode}
                    {format.duration_minutes ? ` · ${format.duration_minutes} min` : ''}
                  </Text>
                  {format.enforced ? (
                    <>
                      <Text style={styles.blueprintTotals}>
                        {format.sections.length} sections ·{' '}
                        {format.totals.questions ??
                          `${format.totals.questions_min}–${format.totals.questions_max}`}{' '}
                        questions · {format.totals.marks ?? '—'} marks
                      </Text>
                      {format.sections.map((section) => (
                        <View key={section.name} style={styles.blueprintSection}>
                          <Text style={styles.blueprintSectionName}>{section.name}</Text>
                          {section.requirements.map((r) => (
                            <Text key={r.display_label} style={styles.blueprintReq}>
                              • {r.display_label} · {markingSummary(r)} · unattempted{' '}
                              {r.unattempted_marks}
                            </Text>
                          ))}
                        </View>
                      ))}
                    </>
                  ) : (
                    <Text style={styles.blueprintFree}>
                      The reference does not publish question counts for this exam — set them below
                      so papers can be limited to exactly that many questions.
                    </Text>
                  )}
                  {format.provisional ? (
                    <Text style={styles.provisional}>
                      ⓘ The {format.year} pattern is carried forward from {format.year - 1} and is not
                      yet confirmed by an official notification.
                    </Text>
                  ) : null}
                  {format.notes.map((note, i) => (
                    <Text key={i} style={styles.blueprintNote}>
                      ⓘ {note}
                    </Text>
                  ))}
                </View>
              ) : null}

              {/* Open formats: the Admin states the counts, and from then on
                  they are enforced exactly like a published blueprint. */}
              {format && !format.enforced ? (
                <View style={styles.customBlock}>
                  <Text style={styles.customTitle}>Questions per section (required)</Text>
                  <Text style={styles.setsHint}>
                    Every paper for this exam must hold exactly these counts.
                  </Text>
                  {customSections.map((s, i) => (
                    <View key={s.name} style={styles.customRow}>
                      <Text style={styles.customName}>{s.name}</Text>
                      <View style={styles.customInputs}>
                        <View style={styles.customField}>
                          <Input
                            label="Questions"
                            placeholder="25"
                            keyboardType="number-pad"
                            value={s.count}
                            onChangeText={(t) =>
                              setCustomSections((prev) =>
                                prev.map((r, idx) => (idx === i ? { ...r, count: t } : r))
                              )
                            }
                          />
                        </View>
                        <View style={styles.customField}>
                          <Input
                            label="Marks"
                            placeholder="1"
                            keyboardType="numeric"
                            value={s.marks_correct}
                            onChangeText={(t) =>
                              setCustomSections((prev) =>
                                prev.map((r, idx) => (idx === i ? { ...r, marks_correct: t } : r))
                              )
                            }
                          />
                        </View>
                        <View style={styles.customField}>
                          <Input
                            label="Negative"
                            placeholder="0"
                            keyboardType="numeric"
                            value={s.negative_marks}
                            onChangeText={(t) =>
                              setCustomSections((prev) =>
                                prev.map((r, idx) => (idx === i ? { ...r, negative_marks: t } : r))
                              )
                            }
                          />
                        </View>
                      </View>
                    </View>
                  ))}
                  <Text style={styles.customTotal}>
                    Total:{' '}
                    {customSections.reduce((n, s) => n + (parseInt(s.count, 10) || 0), 0)} questions
                    ·{' '}
                    {customSections.reduce(
                      (n, s) => n + (parseInt(s.count, 10) || 0) * (Number(s.marks_correct) || 0),
                      0
                    )}{' '}
                    marks
                  </Text>
                </View>
              ) : null}

              {/* Paper sets sit right under the format: how many independent
                  papers this exam needs is a headline decision, not a detail. */}
              <View style={styles.setsBlock}>
                <Text style={styles.setsBlockTitle}>Paper sets</Text>
                <Text style={styles.setsHint}>
                  Each set is a complete, independent paper with its own questions. The paper setter
                  builds them one at a time.
                </Text>
                <Stepper
                  label="Number of paper sets"
                  value={setCount}
                  onChange={setSetCount}
                  min={1}
                  max={26}
                  suffix={setCount === 1 ? 'set' : 'sets'}
                />
                <View style={styles.setChips}>
                  {paperSetLabels(setCount).map((label) => (
                    <View key={label} style={styles.setChip}>
                      <Text style={styles.setChipText}>{label}</Text>
                    </View>
                  ))}
                </View>
                {format?.enforced && format.totals.questions ? (
                  <Text style={styles.setsMath}>
                    {setCount} × {format.totals.questions} questions ={' '}
                    {setCount * format.totals.questions} questions needed in the bank
                    {allowReuse ? ' (fewer, if sets share questions)' : ''}.
                  </Text>
                ) : null}
                <Toggle
                  label="Allow question reuse across sets"
                  value={allowReuse}
                  onChange={setAllowReuse}
                  hint={
                    allowReuse
                      ? 'A question may appear in more than one set.'
                      : 'Off — every set must use different questions.'
                  }
                />
                <Text style={styles.setsHint}>
                  You can raise or lower this later from “Manage paper sets”, as long as the sets you
                  drop have not been sealed.
                </Text>
              </View>

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
                    <Ionicons name="add" size={16} color={colors.primary} />
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
                      <Ionicons name="trash-outline" size={18} color={colors.danger} />
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
                      <Text style={[styles.paperOptionText, active && { color: colors.primary }]}>{paper.title}</Text>
                    </Pressable>
                  );
                })
              )}

              <Button title="Create Exam" onPress={() => void create()} loading={busy} style={{ marginTop: spacing.md }} />
              <Button title="Cancel" variant="ghost" onPress={() => setCreating(false)} style={{ marginTop: spacing.sm }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ---------------------------- paper sets ----------------------------- */}
      <Modal
        transparent
        visible={!!setsTarget}
        animationType="fade"
        onRequestClose={() => setSetsTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>Paper sets · {setsTarget?.name}</Text>
              <Text style={styles.assignBlurb}>
                Every set is an independent paper: the setter picks its own questions and each set
                must satisfy the exam format on its own. Sets can be added or removed at any time
                until their paper is sealed.
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
                  . Any unsealed selection in those sets is discarded; sealed sets cannot be
                  removed.
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
              <Button
                title="Save paper sets"
                loading={savingSets}
                onPress={() => void saveSets()}
                style={{ marginTop: spacing.md }}
              />
              <Button
                title="Cancel"
                variant="ghost"
                onPress={() => setSetsTarget(null)}
                style={{ marginTop: spacing.sm }}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* -------------------------- subject assignment ----------------------- */}
      <Modal
        transparent
        visible={!!assignTarget}
        animationType="fade"
        onRequestClose={() => setAssignTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>Subjects · {assignTarget?.name}</Text>
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
                            <Text style={[styles.assignChipText, on && { color: colors.primary }]}>
                              {subject}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ))
              )}
              <Button
                title="Done"
                onPress={() => setAssignTarget(null)}
                style={{ marginTop: spacing.md }}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    title: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
    meta: { color: colors.textDim, fontSize: 13, marginTop: 2 },
    slotChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
    slotChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    slotChipText: { color: colors.textDim, fontSize: 11, fontWeight: '600' },
    fieldLabel: { color: colors.textDim, fontSize: 13, fontWeight: '600', marginBottom: spacing.sm },
    hint: { color: colors.textDim, fontSize: 12, marginBottom: spacing.sm },
    error: { color: colors.danger, fontSize: 12, marginBottom: spacing.sm },
    provisional: { color: colors.warning, fontSize: 12, marginTop: spacing.sm, lineHeight: 17 },
    blueprint: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.sm,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    blueprintTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
    blueprintMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
    blueprintTotals: { color: colors.accent, fontSize: 12, fontWeight: '700', marginTop: 6 },
    blueprintSection: { marginTop: spacing.sm },
    blueprintSectionName: { color: colors.text, fontSize: 13, fontWeight: '700' },
    blueprintReq: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
    blueprintFree: { color: colors.textDim, fontSize: 12, lineHeight: 18, marginTop: 6 },
    blueprintNote: { color: colors.textFaint, fontSize: 11, lineHeight: 16, marginTop: 6 },
    slotsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    addSlot: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: spacing.sm },
    addSlotText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
    slotRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    slotInputs: { flexDirection: 'row', gap: spacing.sm, flex: 1 },
    slotInput: { flex: 1 },
    removeSlot: { paddingBottom: spacing.sm },
    noPapers: { color: colors.textDim, fontSize: 13, fontStyle: 'italic', marginBottom: spacing.sm },
    paperOption: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sm,
      padding: spacing.md,
      marginBottom: spacing.sm,
      backgroundColor: colors.surfaceAlt,
    },
    paperOptionActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
    paperOptionText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
    customBlock: {
      borderWidth: 1,
      borderColor: colors.warning,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    customTitle: { color: colors.text, fontSize: 14, fontWeight: '800', marginBottom: 4 },
    customRow: { marginTop: spacing.sm },
    customName: { color: colors.text, fontSize: 13, fontWeight: '700', marginBottom: 4 },
    customInputs: { flexDirection: 'row', gap: spacing.sm },
    customField: { flex: 1 },
    customTotal: { color: colors.accent, fontSize: 12, fontWeight: '800', marginTop: 4 },
    setsBlock: {
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    setsBlockTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '800',
      marginBottom: 4,
    },
    setsMath: {
      color: colors.accent,
      fontSize: 12,
      fontWeight: '700',
      marginBottom: spacing.md,
    },
    setChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
    setChip: {
      borderWidth: 1,
      borderColor: colors.borderLight,
      borderRadius: radius.sm,
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: colors.surfaceAlt,
    },
    setChipText: { color: colors.text, fontSize: 12, fontWeight: '700' },
    setsHint: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginBottom: spacing.md },
    assignBlurb: { color: colors.textDim, fontSize: 12, lineHeight: 18, marginBottom: spacing.md },
    assignRow: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: spacing.md,
      marginBottom: spacing.sm,
    },
    assignName: { color: colors.text, fontSize: 14, fontWeight: '700', marginBottom: 6 },
    assignChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    assignChip: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: colors.surfaceAlt,
    },
    assignChipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
    assignChipText: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
    modalBackdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'center', padding: spacing.xl },
    modalCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.xl,
      maxHeight: '85%',
    },
    modalTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: spacing.lg },
  });
