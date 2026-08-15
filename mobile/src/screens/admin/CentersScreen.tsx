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
  PageGrain,
  useArchiveLayout,
  useArchivePalette,
  useReducedMotion,
} from '../../components/ArchiveBook';
import { BookArrow } from '../../components/ArchiveUpload';
import { BookButton, BookPagination, Seal } from '../../components/ArchiveControls';
import { EmptyState, Input, Stepper } from '../../components/UI';
import { showAlert } from '../../lib/alert';
import { allocateCopies, provisionCenter, scanCopy } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { serif } from '../../lib/theme';
import { Exam, ExamCenter, ExamSlot } from '../../lib/types';
import { Pagination, usePagination } from '../../lib/usePagination';
import { useScheduledExams } from '../../lib/useExams';
import { useAdminIndex } from './useAdminIndex';

const SELF = 'Centers';

type CopyLite = {
  id: string;
  copy_number: number;
  center_id: string | null;
  scanned_at: string | null;
  qr_payload: string;
  paper_id: string;
  set_label: string | null;
};

type PaperLite = { id: string; set_label: string | null };

export default function CentersScreen() {
  const { exams } = useScheduledExams();
  const p = useArchivePalette();
  const { outerPad, sidebarMode, bookWidth } = useArchiveLayout();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const styles = useMemo(() => makeStyles(p), [p]);
  const [indexOpen, setIndexOpen] = useState(false);
  const examPadColumns = bookWidth >= 900 ? 3 : bookWidth >= 600 ? 2 : 1;

  const [examId, setExamId] = useState<string | null>(null);
  const [centers, setCenters] = useState<ExamCenter[]>([]);
  const [slots, setSlots] = useState<ExamSlot[]>([]);
  const [papers, setPapers] = useState<PaperLite[]>([]);
  const [copies, setCopies] = useState<CopyLite[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const [examPadQuery, setExamPadQuery] = useState('');
  const [centerQuery, setCenterQuery] = useState('');
  const flash = useRef(new Animated.Value(0)).current;

  // Create-center scroll
  const [creating, setCreating] = useState(false);
  const [cName, setCName] = useState('');
  const [cCode, setCCode] = useState('');
  const [cPassword, setCPassword] = useState('');
  const [cSlotId, setCSlotId] = useState<string | null>(null);
  const [cCapacity, setCCapacity] = useState(30);
  const [busy, setBusy] = useState(false);

  // Allocate + scan popups
  const [allocTarget, setAllocTarget] = useState<ExamCenter | null>(null);
  const [allocCount, setAllocCount] = useState('10');
  const [allocSet, setAllocSet] = useState<string | null>(null);
  const [scanTarget, setScanTarget] = useState<ExamCenter | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    if (!examId) {
      setCenters([]);
      setCopies([]);
      setSlots([]);
      setPapers([]);
      return;
    }
    const [{ data: centerRows }, { data: slotRows }, { data: paperRows }] = await Promise.all([
      supabase.from('exam_centers').select('*').eq('exam_id', examId).order('starts_at', { ascending: true }),
      supabase.from('exam_slots').select('*').eq('exam_id', examId).order('slot_no', { ascending: true }),
      supabase.from('papers').select('id, set_label').eq('exam_id', examId),
    ]);
    setCenters((centerRows as ExamCenter[] | null) ?? []);
    setSlots((slotRows as ExamSlot[] | null) ?? []);

    const paperRowsList = (paperRows as PaperLite[] | null) ?? [];
    setPapers(paperRowsList);
    const paperIds = paperRowsList.map((row) => row.id);
    if (paperIds.length === 0) {
      setCopies([]);
      return;
    }
    const setLabelByPaper = new Map(paperRowsList.map((row) => [row.id, row.set_label]));
    const { data: copyRows } = await supabase
      .from('paper_copies')
      .select('id, copy_number, center_id, scanned_at, qr_payload, paper_id')
      .in('paper_id', paperIds)
      .order('copy_number', { ascending: true });
    const copiesWithSet = ((copyRows as Omit<CopyLite, 'set_label'>[] | null) ?? []).map((c) => ({
      ...c,
      set_label: setLabelByPaper.get(c.paper_id) ?? null,
    }));
    setCopies(copiesWithSet);
  }, [examId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    const channel = supabase
      .channel('centers-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exam_centers' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'paper_copies' }, () => void load())
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

  const unallocated = copies.filter((c) => !c.center_id).length;
  const forCenter = (id: string) => copies.filter((c) => c.center_id === id);

  const availableSets = useMemo(() => {
    const labels = new Set<string>();
    for (const paper of papers) if (paper.set_label) labels.add(paper.set_label);
    return Array.from(labels).sort();
  }, [papers]);

  const unallocatedForSet = (label: string | null) =>
    copies.filter((c) => !c.center_id && (!label || c.set_label === label)).length;

  const openCreate = () => {
    setCName('');
    setCCode('');
    setCPassword('');
    setCSlotId(slots[0]?.id ?? null);
    setCCapacity(30);
    setCreating(true);
  };

  const createCenter = async () => {
    if (!examId) return;
    if (cName.trim().length < 2) return showAlert('Missing name', 'Enter a center name.');
    if (cCode.trim().length < 1) return showAlert('Missing code', 'Enter a short center code.');
    if (cPassword.length < 6) return showAlert('Weak password', 'Center password must be 6+ characters.');
    if (slots.length > 0 && !cSlotId) return showAlert('Pick a slot', 'Choose which slot this center runs.');

    setBusy(true);
    try {
      const res = await provisionCenter({
        examId,
        slotId: cSlotId,
        name: cName.trim(),
        code: cCode.trim(),
        password: cPassword,
        capacity: cCapacity,
      });
      setCreating(false);
      showAlert(
        'Center created ✅',
        `Login code: ${res.login.code}\n\nShare the code and the password you just set with the center. The invigilator signs in via "Exam center login" and scans QRs.`
      );
      void load();
    } catch (e) {
      showAlert('Could not create center', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const doAllocate = async () => {
    if (!allocTarget) return;
    const count = parseInt(allocCount, 10);
    if (!count || count < 1) return showAlert('Invalid count', 'Enter how many copies to allocate.');
    if (availableSets.length > 0 && !allocSet) return showAlert('Pick a set', 'Choose which paper set to allocate.');
    setWorking(true);
    try {
      const res = await allocateCopies(allocTarget.id, count, allocSet ?? undefined);
      setAllocTarget(null);
      showAlert(
        'Allocated',
        `${res.allocated} cop${res.allocated === 1 ? 'y' : 'ies'}${res.set_label ? ` (${res.set_label})` : ''} allocated to ${allocTarget.name}.`
      );
      void load();
    } catch (e) {
      showAlert('Allocation failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setWorking(false);
    }
  };

  const doScan = async (copy: CopyLite) => {
    setWorking(true);
    try {
      const res = await scanCopy(copy.qr_payload);
      showAlert(
        'Scanned ✓',
        `Copy #${res.copy_number}${res.set_label ? ` ${res.set_label}` : ''} scanned in. Removed from pending.`
      );
      void load();
    } catch (e) {
      showAlert('Scan failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setWorking(false);
    }
  };

  const { items, onSelect } = useAdminIndex({
    active: SELF,
    onBeforeSelect: () => setIndexOpen(false),
  });

  const selectExam = (id: string) => {
    if (reduced) {
      setExamId(id);
      setCenterQuery('');
      return;
    }
    Animated.sequence([
      Animated.timing(flash, { toValue: 1, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(flash, { toValue: 0, duration: 170, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start();
    setTimeout(() => {
      setExamId(id);
      setCenterQuery('');
    }, 90);
  };

  const filteredCenters = useMemo(() => {
    const q = centerQuery.trim().toLowerCase();
    if (!q) return centers;
    return centers.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  }, [centers, centerQuery]);

  const centerPages = usePagination(filteredCenters, 3);
  const scanList = scanTarget ? forCenter(scanTarget.id) : [];

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ArchiveBackground />
      <ArchiveHeader
        title="SECUREAI EXAM ARCHIVE"
        shortTitle="ARCHIVE"
        subtitle="Admin · Centers"
        onMenu={sidebarMode === 'overlay' ? () => setIndexOpen(true) : undefined}
      />

      <View style={styles.body}>
        {sidebarMode === 'overlay' ? null : (
          <ArchiveSidebar items={items} activeRoute={SELF} onSelect={onSelect} />
        )}

        <View style={[styles.stage, { paddingHorizontal: outerPad }]}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: 20 + insets.bottom }]}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={p.gold} />
            }
          >
            {exams.length === 0 ? (
              <EmptyState
                icon="business-outline"
                title="No exams scheduled"
                subtitle="Schedule an exam with slots first (Exams tab), then add centers under it."
              />
            ) : !examId ? (
              <ExamPadGrid
                exams={exams}
                onSelect={selectExam}
                palette={p}
                columns={examPadColumns}
                query={examPadQuery}
                onQuery={setExamPadQuery}
              />
            ) : (
              <CenterBook
                examName={exams.find((e) => e.id === examId)?.name ?? ''}
                onBack={() => setExamId(null)}
                totalCenters={filteredCenters.length}
                pagination={centerPages}
                forCenter={forCenter}
                query={centerQuery}
                onQuery={setCenterQuery}
                onAddCenter={openCreate}
                onAllocate={(c) => {
                  setAllocTarget(c);
                  setAllocCount('10');
                  setAllocSet(availableSets[0] ?? null);
                }}
                onScan={(c) => setScanTarget(c)}
                palette={p}
              />
            )}
          </ScrollView>
        </View>
      </View>

      <ArchiveIndexOverlay
        visible={indexOpen}
        items={items}
        activeRoute={SELF}
        onSelect={onSelect}
        onClose={() => setIndexOpen(false)}
      />

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flash, { opacity: flash }]} />

      <AddCenterScroll
        visible={creating}
        onClose={() => setCreating(false)}
        name={cName}
        onName={setCName}
        code={cCode}
        onCode={setCCode}
        password={cPassword}
        onPassword={setCPassword}
        capacity={cCapacity}
        onCapacity={setCCapacity}
        slots={slots}
        slotId={cSlotId}
        onSlotId={setCSlotId}
        busy={busy}
        onSubmit={() => void createCenter()}
      />

      <AllocateBoard
        visible={!!allocTarget}
        centerName={allocTarget?.name ?? ''}
        unallocated={unallocatedForSet(allocSet)}
        count={allocCount}
        onCount={setAllocCount}
        sets={availableSets}
        selectedSet={allocSet}
        onSelectSet={setAllocSet}
        busy={working}
        onSubmit={() => void doAllocate()}
        onClose={() => setAllocTarget(null)}
      />

      <OmrSheet
        visible={!!scanTarget}
        centerName={scanTarget?.name ?? ''}
        copies={scanList}
        busy={working}
        onScan={(copy) => void doScan(copy)}
        onClose={() => setScanTarget(null)}
      />
    </View>
  );
}

/* ------------------------------- exam pads -------------------------------- */

/** The large parchment-in-a-wooden-frame book the exam archive lives inside. */
function ArchivePanel({ children }: { children: React.ReactNode }) {
  const p = useArchivePalette();
  const styles = useMemo(() => makeApStyles(p), [p]);
  return (
    <View style={styles.frame}>
      <View style={styles.gilt} pointerEvents="none" />
      <View style={styles.page}>
        <PageGrain />
        <View style={styles.content}>{children}</View>
      </View>
    </View>
  );
}

const makeApStyles = (p: ArchivePalette) =>
  StyleSheet.create({
    frame: {
      borderWidth: 12,
      borderRadius: 12,
      backgroundColor: p.cover,
      borderColor: p.coverEdge,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 16 },
      shadowOpacity: 0.4,
      shadowRadius: 28,
      elevation: 18,
    },
    gilt: { position: 'absolute', top: 4, left: 4, right: 4, bottom: 4, borderWidth: 1, borderColor: p.coverHighlight, borderRadius: 6 },
    page: { backgroundColor: p.page, borderRadius: 4, overflow: 'hidden' },
    content: { padding: 22 },
  });

/** A stable, decorative reference number for a pad — derived from real data. */
function padId(exam: Exam, all: Exam[]): string {
  const idx = Math.max(0, all.findIndex((e) => e.id === exam.id));
  const year = exam.exam_date?.slice(0, 4) || '----';
  return `SAEP-${year}-${String(idx + 1).padStart(4, '0')}`;
}

function ExamPadGrid({
  exams,
  onSelect,
  palette: p,
  columns,
  query,
  onQuery,
}: {
  exams: Exam[];
  onSelect: (id: string) => void;
  palette: ArchivePalette;
  columns: number;
  query: string;
  onQuery: (v: string) => void;
}) {
  const styles = useMemo(() => makePadStyles(p), [p]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return exams;
    return exams.filter((e) => e.name.toLowerCase().includes(q));
  }, [exams, query]);

  return (
    <ArchivePanel>
      <View style={styles.head}>
        <Text style={styles.heading}>Select an Examination</Text>
        <Text style={styles.subheading}>Choose an exam to manage its centers</Text>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={14} color={p.inkFaint} />
        <TextInput
          value={query}
          onChangeText={onQuery}
          placeholder="Search exams by name…"
          placeholderTextColor={p.inkFaint}
          autoCapitalize="none"
          style={styles.searchInput}
        />
      </View>

      {filtered.length === 0 ? (
        <Text style={styles.empty}>No exams match this search.</Text>
      ) : (
        <View style={styles.grid}>
          {filtered.map((exam) => (
            <ExamPad
              key={exam.id}
              exam={exam}
              padId={padId(exam, exams)}
              onPress={() => onSelect(exam.id)}
              palette={p}
              columns={columns}
            />
          ))}
        </View>
      )}
    </ArchivePanel>
  );
}

const PAD_INSTRUCTIONS = [
  'Read all instructions carefully before starting the examination.',
  'Do not share or exchange your pad.',
  'Write your answers only in the space provided.',
  'Do not write your name or any identification mark.',
  'Use only Blue / Black ball point pen.',
];

function ExamPad({
  exam,
  padId: id,
  onPress,
  palette: p,
  columns,
}: {
  exam: Exam;
  padId: string;
  onPress: () => void;
  palette: ArchivePalette;
  columns: number;
}) {
  const styles = useMemo(() => makePadStyles(p), [p]);
  const t = useRef(new Animated.Value(0)).current;
  const to = (v: number) =>
    Animated.spring(t, { toValue: v, useNativeDriver: true, speed: 28, bounciness: 6 }).start();
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, -4] });
  const blueprint = exam.format_blueprint;
  const statusLabel = blueprint?.provisional ? 'PROVISIONAL' : exam.status.toUpperCase();
  const statusTone = blueprint?.provisional ? p.warning : p.success;

  return (
    <Animated.View style={[styles.padWrap, { width: `${100 / columns}%`, transform: [{ translateY }] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={exam.name}
        onPress={onPress}
        onPressIn={() => to(1)}
        onPressOut={() => to(0)}
        {...({ onHoverIn: () => to(1), onHoverOut: () => to(0) } as object)}
        style={styles.pad}
      >
        <View style={styles.clip} />
        <View style={styles.padHead}>
          <View>
            <Text style={styles.padEyebrow}>EXAM PAD</Text>
            <Text style={styles.padImprint}>SECUREAI EXAM ARCHIVE</Text>
          </View>
          <View style={styles.padIdTag}>
            <Text style={styles.padIdLabel}>PAD ID</Text>
            <Text style={styles.padIdValue} numberOfLines={1}>{id}</Text>
          </View>
        </View>

        <View style={styles.statusRow}>
          <Seal label={statusLabel} tone={statusTone} />
        </View>

        <Text style={styles.padNameEyebrow}>EXAM NAME</Text>
        <Text style={styles.padName} numberOfLines={3}>
          {exam.name}
        </Text>
        <View style={styles.padRule} />

        <View style={styles.metaList}>
          <MetaRow icon="calendar-outline" label="EXAM DATE" value={exam.exam_date} palette={p} />
          <MetaRow icon="time-outline" label="DURATION" value={`${exam.duration_min} Minutes`} palette={p} />
          <MetaRow icon="create-outline" label="MODE" value={blueprint?.mode ?? '—'} palette={p} />
          <MetaRow
            icon="ribbon-outline"
            label="TOTAL MARKS"
            value={blueprint?.totals?.marks != null ? String(blueprint.totals.marks) : '—'}
            palette={p}
          />
          <MetaRow
            icon="albums-outline"
            label="PAPER SET"
            value={exam.paper_set_count === 1 ? 'Set A' : `${exam.paper_set_count} sets`}
            palette={p}
          />
        </View>

        <View style={styles.instructions}>
          <Text style={styles.instructionsTitle}>— IMPORTANT INSTRUCTIONS —</Text>
          {PAD_INSTRUCTIONS.map((line, i) => (
            <Text key={i} style={styles.instructionLine}>
              {i + 1}. {line}
            </Text>
          ))}
          <Ionicons name="brush" size={16} color={p.pamphletEdge} style={styles.quill} />
        </View>

        <View style={styles.waxSeal}>
          <Ionicons name="disc" size={26} color="#7A1E1E" />
        </View>
      </Pressable>
    </Animated.View>
  );
}

function MetaRow({
  icon,
  label,
  value,
  palette: p,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  palette: ArchivePalette;
}) {
  const styles = useMemo(() => makePadStyles(p), [p]);
  return (
    <View style={styles.metaRow}>
      <Ionicons name={icon} size={13} color={p.gold} style={styles.metaIcon} />
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

/* ------------------------------- center book ------------------------------- */

function CenterBook({
  examName,
  onBack,
  totalCenters,
  pagination,
  forCenter,
  query,
  onQuery,
  onAddCenter,
  onAllocate,
  onScan,
  palette: p,
}: {
  examName: string;
  onBack: () => void;
  totalCenters: number;
  pagination: Pagination<ExamCenter>;
  forCenter: (id: string) => CopyLite[];
  query: string;
  onQuery: (v: string) => void;
  onAddCenter: () => void;
  onAllocate: (c: ExamCenter) => void;
  onScan: (c: ExamCenter) => void;
  palette: ArchivePalette;
}) {
  const styles = useMemo(() => makeCbStyles(p), [p]);
  const reduced = useReducedMotion();
  const slide = useRef(new Animated.Value(0)).current;

  const go = (nextPage: number) => {
    if (nextPage < 1 || nextPage > pagination.pageCount || nextPage === pagination.page) return;
    const direction = nextPage > pagination.page ? 1 : -1;
    if (reduced) {
      pagination.setPage(nextPage);
      return;
    }
    Animated.timing(slide, {
      toValue: direction,
      duration: 260,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      pagination.setPage(nextPage);
      slide.setValue(-direction);
      Animated.timing(slide, {
        toValue: 0,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  };

  const translateX = slide.interpolate({ inputRange: [-1, 1], outputRange: [-60, 60] });
  const opacity = slide.interpolate({ inputRange: [-1, -0.01, 0, 0.01, 1], outputRange: [0.12, 0.12, 1, 0.12, 0.12] });

  // The summary strip follows whichever visible center was last tapped —
  // falls back to the first of the page when nothing in view is selected.
  const [activeId, setActiveId] = useState<string | null>(null);
  const primary = pagination.pageItems.find((c) => c.id === activeId) ?? pagination.pageItems[0] ?? null;
  const primaryList = primary ? forCenter(primary.id) : [];
  const primaryScanned = primaryList.filter((c) => c.scanned_at).length;

  return (
    <View>
      <View style={styles.toolRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to exam archive" onPress={onBack} style={styles.backBtn}>
          <Ionicons name="arrow-undo" size={15} color={p.gold} />
        </Pressable>
        <View style={styles.addCenterWrap}>
          <BookButton title="Add Center" icon="add-circle-outline" variant="gold" onPress={onAddCenter} />
        </View>
        <View style={styles.search}>
          <Ionicons name="search" size={14} color={p.inkFaint} />
          <TextInput
            value={query}
            onChangeText={onQuery}
            placeholder="Search centers…"
            placeholderTextColor={p.inkFaint}
            autoCapitalize="none"
            style={styles.searchInput}
          />
        </View>
      </View>

      <View style={styles.titleRow}>
        <View style={styles.titleOrnLine} />
        <Text style={styles.examName} numberOfLines={1}>
          {examName}
        </Text>
        <View style={styles.titleOrnLine} />
      </View>

      {primary ? (
        <View style={styles.summary}>
          <View style={styles.summaryIcon}>
            <Ionicons name="business" size={16} color={p.pamphletEdge} />
          </View>
          <View style={styles.summaryName}>
            <Text style={styles.summaryNameText} numberOfLines={1}>
              {primary.name.toUpperCase()}
            </Text>
            <Text style={styles.summaryCode}>Code {primary.code}</Text>
          </View>
          <View style={styles.summaryStats}>
            <SummaryStat label="Starts" value={fmtDateTime(primary.starts_at)} palette={p} />
            <SummaryStat label="Seats" value={String(primary.capacity)} palette={p} />
            <SummaryStat label="Allocated" value={String(primaryList.length)} palette={p} />
            <SummaryStat label="Scanned" value={`${primaryScanned} / ${primaryList.length}`} palette={p} />
          </View>
        </View>
      ) : null}

      {totalCenters === 0 ? (
        <EmptyState
          icon="business-outline"
          title="No centers yet"
          subtitle="Add a center (this creates its invigilator login), allocate copies, then scan in. Unscanned copies raise an alert ~20 min before the slot."
        />
      ) : (
        <>
          <View style={styles.browser}>
            <BookArrow
              direction="prev"
              label="Previous centers"
              disabled={pagination.page <= 1}
              onPress={() => go(pagination.page - 1)}
            />
            <Animated.View style={[styles.coverRow, { transform: [{ translateX }], opacity }]}>
              {pagination.pageItems.map((center, i) => (
                <CenterCover
                  key={center.id}
                  center={center}
                  ordinal={pagination.from + i}
                  total={totalCenters}
                  list={forCenter(center.id)}
                  active={primary?.id === center.id}
                  onSelect={() => setActiveId(center.id)}
                  onAllocate={() => onAllocate(center)}
                  onScan={() => onScan(center)}
                  palette={p}
                />
              ))}
            </Animated.View>
            <BookArrow
              direction="next"
              label="Next centers"
              disabled={pagination.page >= pagination.pageCount}
              onPress={() => go(pagination.page + 1)}
            />
          </View>

          <View style={styles.paginationRow}>
            <BookPagination
              page={pagination.page}
              pageCount={pagination.pageCount}
              from={pagination.from}
              to={pagination.to}
              total={pagination.total}
              pageSize={pagination.pageSize}
              onTurn={(next) => go(next)}
              onPageSize={() => undefined}
              sizes={[]}
            />
          </View>
        </>
      )}
    </View>
  );
}

function SummaryStat({ label, value, palette: p }: { label: string; value: string; palette: ArchivePalette }) {
  const styles = useMemo(() => makeCbStyles(p), [p]);
  return (
    <View style={styles.summaryStat}>
      <Text style={styles.summaryStatLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.summaryStatValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function CoverMetaRow({
  icon,
  label,
  value,
  palette: p,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  palette: ArchivePalette;
}) {
  const styles = useMemo(() => makeCcStyles(p), [p]);
  return (
    <View style={styles.metaRow}>
      <Ionicons name={icon} size={12} color={p.gold} style={styles.metaIcon} />
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function CenterCover({
  center,
  ordinal,
  total,
  list,
  active,
  onSelect,
  onAllocate,
  onScan,
  palette: p,
}: {
  center: ExamCenter;
  ordinal: number;
  total: number;
  list: CopyLite[];
  active: boolean;
  onSelect: () => void;
  onAllocate: () => void;
  onScan: () => void;
  palette: ArchivePalette;
}) {
  const styles = useMemo(() => makeCcStyles(p), [p]);
  const scanned = list.filter((c) => c.scanned_at).length;
  const pending = list.length - scanned;

  return (
    <View style={styles.coverWrap}>
      <View style={[styles.cover, active && { borderColor: p.gold }]}>
        <View style={styles.gilt} pointerEvents="none" />
        <View style={styles.record}>
          <PageGrain />
          <View style={styles.tag}>
            <Text style={styles.tagText}>
              CENTER {ordinal} OF {total}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Show ${center.name} in the summary`}
            accessibilityState={{ selected: active }}
            onPress={onSelect}
          >
            <View style={styles.sealRow}>
              <Ionicons name="business" size={22} color={p.pamphletEdge} />
            </View>
            <Text style={styles.name} numberOfLines={2}>
              {center.name}
            </Text>
            <Text style={styles.code}>Code {center.code}</Text>
          </Pressable>
          <View style={styles.rule} />

          <View style={styles.metaList}>
            <CoverMetaRow icon="time-outline" label="START TIME" value={fmtDateTime(center.starts_at)} palette={p} />
            <CoverMetaRow icon="people-outline" label="SEATS / CAPACITY" value={String(center.capacity)} palette={p} />
            <CoverMetaRow icon="cube-outline" label="ALLOCATED COPIES" value={String(list.length)} palette={p} />
            <CoverMetaRow icon="qr-code-outline" label="SCANNED COPIES" value={`${scanned} / ${list.length}`} palette={p} />
            {center.reconciled_at ? (
              <CoverMetaRow icon="checkmark-done-outline" label="STATUS" value="Checked" palette={p} />
            ) : null}
          </View>

          <View style={styles.actions}>
            <BookButton title="Allocate copies" icon="cube-outline" onPress={onAllocate} />
            <BookButton
              title={`Scan-in (${pending})`}
              icon="qr-code-outline"
              variant="gold"
              onPress={onScan}
              disabled={pending === 0}
            />
          </View>

          <View style={styles.waxSeal}>
            <Ionicons name="disc" size={28} color="#7A1E1E" />
          </View>
        </View>
      </View>
    </View>
  );
}

/* ---------------------------- add center scroll ---------------------------- */

function AddCenterScroll({
  visible,
  onClose,
  name,
  onName,
  code,
  onCode,
  password,
  onPassword,
  capacity,
  onCapacity,
  slots,
  slotId,
  onSlotId,
  busy,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  name: string;
  onName: (v: string) => void;
  code: string;
  onCode: (v: string) => void;
  password: string;
  onPassword: (v: string) => void;
  capacity: number;
  onCapacity: (v: number) => void;
  slots: ExamSlot[];
  slotId: string | null;
  onSlotId: (v: string) => void;
  busy: boolean;
  onSubmit: () => void;
}) {
  const p = useArchivePalette();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const t = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) setMounted(true);
    if (reduced) {
      t.setValue(visible ? 1 : 0);
      if (!visible) setMounted(false);
      return;
    }
    Animated.timing(t, {
      toValue: visible ? 1 : 0,
      duration: visible ? 780 : 460,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      if (!visible) setMounted(false);
    });
  }, [visible, t, reduced]);

  const sheetWidth = Math.min(width - 64, 520);
  // Unrolls downward from a roller at the top, rather than sideways from two rods.
  const scaleY = t.interpolate({ inputRange: [0, 1], outputRange: [0.02, 1] });
  const ink = t.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 0, 1] });

  return (
    <Modal transparent visible={mounted} animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, scrollStyles.scrim, { opacity: t }]}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close" onPress={onClose} />
      </Animated.View>

      <View style={scrollStyles.center} pointerEvents="box-none">
        <Animated.View style={[scrollStyles.column, { width: sheetWidth, opacity: t }]}>
          <View style={[scrollStyles.rodWrapV, { width: sheetWidth + 16 }]}>
            <LinearGradient
              colors={[p.coverEdge, p.cover, p.coverEdge]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={scrollStyles.rodV}
            />
            <View style={[scrollStyles.rodCapLeft, { backgroundColor: p.gold }]} />
            <View style={[scrollStyles.rodCapRight, { backgroundColor: p.gold }]} />
          </View>

          <Animated.View
            style={[
              scrollStyles.parchmentV,
              {
                width: sheetWidth,
                backgroundColor: p.pamphlet,
                borderColor: p.pamphletEdge,
                transform: [{ scaleY }],
                transformOrigin: 'center top',
              },
            ]}
          >
            <LinearGradient
              colors={[p.pamphletShade, p.pamphlet, p.pamphletShade]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <PageGrain />

            <Animated.View style={{ opacity: ink }}>
              <ScrollView style={scrollStyles.scroll} showsVerticalScrollIndicator={false}>
                <View style={scrollStyles.crest}>
                  <Ionicons name="ribbon" size={16} color={p.pamphletEdge} />
                </View>
                <Text style={[scrollStyles.title, { color: p.pamphletInk }]}>Add Exam Center</Text>
                <Text style={[scrollStyles.blurb, { color: p.pamphletInkDim }]}>
                  Creates the center and its invigilator login (code + password). The invigilator uses
                  these on the "Exam center login" screen to scan papers in.
                </Text>
                <View style={[scrollStyles.rule, { backgroundColor: `${p.pamphletEdge}77` }]} />

                <Input
                  label="Center name"
                  placeholder="e.g. Govt. Sr. Sec. School, Sector 12"
                  value={name}
                  onChangeText={onName}
                />
                <Input
                  label="Center code (login id)"
                  placeholder="e.g. DL-014"
                  value={code}
                  onChangeText={onCode}
                  autoCapitalize="characters"
                />
                <Input
                  label="Center password"
                  placeholder="min 6 chars"
                  value={password}
                  onChangeText={onPassword}
                  secureTextEntry
                />

                <Stepper
                  label="Seats / capacity"
                  value={capacity}
                  onChange={onCapacity}
                  min={0}
                  max={5000}
                  step={5}
                  suffix="seats"
                />
                <Text style={[scrollStyles.hint, { color: p.pamphletInkDim }]}>
                  How many candidates this center seats. Guides how many copies to allocate.
                </Text>

                <Text style={[scrollStyles.fieldLabel, { color: p.pamphletInk }]}>Slot</Text>
                {slots.length === 0 ? (
                  <Text style={[scrollStyles.hint, { color: p.warning }]}>
                    No slots on this exam — add slots when scheduling it.
                  </Text>
                ) : (
                  slots.map((slot) => {
                    const active = slotId === slot.id;
                    return (
                      <Pressable
                        key={slot.id}
                        onPress={() => onSlotId(slot.id)}
                        style={[
                          scrollStyles.slotOption,
                          { borderColor: active ? p.gold : p.pamphletEdge, backgroundColor: active ? `${p.gold}22` : 'transparent' },
                        ]}
                      >
                        <Ionicons
                          name={active ? 'radio-button-on' : 'radio-button-off'}
                          size={16}
                          color={active ? p.gold : p.pamphletInkDim}
                        />
                        <Text style={[scrollStyles.slotText, { color: active ? p.pamphletInk : p.pamphletInkDim }]}>
                          {slot.label}
                        </Text>
                      </Pressable>
                    );
                  })
                )}

                <View style={{ height: 14 }} />
                <BookButton title="Create Center" variant="gold" onPress={onSubmit} loading={busy} />
                <View style={{ height: 8 }} />
                <BookButton title="Cancel" onPress={onClose} />
              </ScrollView>
            </Animated.View>
          </Animated.View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/* ------------------------------ allocate board ----------------------------- */

function AllocateBoard({
  visible,
  centerName,
  unallocated,
  count,
  onCount,
  sets,
  selectedSet,
  onSelectSet,
  busy,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  centerName: string;
  unallocated: number;
  count: string;
  onCount: (v: string) => void;
  sets: string[];
  selectedSet: string | null;
  onSelectSet: (v: string | null) => void;
  busy: boolean;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const p = useArchivePalette();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const board = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) setMounted(true);
    if (reduced) {
      board.setValue(visible ? 1 : 0);
      if (!visible) setMounted(false);
      return;
    }
    Animated.timing(board, {
      toValue: visible ? 1 : 0,
      duration: visible ? 600 : 420,
      easing: visible ? Easing.out(Easing.back(1.2)) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      if (!visible) setMounted(false);
    });
  }, [visible, board, reduced]);

  const boardWidth = Math.min(width - 40, 420);
  const translateY = board.interpolate({ inputRange: [0, 1], outputRange: [40, 0] });
  const scale = board.interpolate({ inputRange: [0, 1], outputRange: [0.93, 1] });

  return (
    <Modal transparent visible={mounted} animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, boardStyles.scrim, { opacity: board }]}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close" onPress={onClose} />
      </Animated.View>

      <View style={boardStyles.center} pointerEvents="box-none">
        <Animated.View
          style={[
            boardStyles.frame,
            {
              width: boardWidth,
              backgroundColor: p.cover,
              borderColor: p.coverEdge,
              opacity: board,
              transform: [{ translateY }, { scale }],
            },
          ]}
        >
          <View style={boardStyles.surface}>
            <LinearGradient
              colors={['#3A4830', '#232D1E', '#2E3A27']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <Text style={boardStyles.title}>ALLOCATE COPIES</Text>
            <View style={boardStyles.underline} />
            <Text style={boardStyles.subtitle} numberOfLines={1}>
              {centerName}
            </Text>

            {sets.length > 0 ? (
              <View style={boardStyles.setPicker}>
                <Text style={boardStyles.setPickerLabel}>Which set?</Text>
                <View style={boardStyles.setChips}>
                  {sets.map((label) => {
                    const active = selectedSet === label;
                    return (
                      <Pressable
                        key={label}
                        accessibilityRole="button"
                        accessibilityLabel={`Set ${label}`}
                        accessibilityState={{ selected: active }}
                        onPress={() => onSelectSet(label)}
                        style={[boardStyles.setChip, active && boardStyles.setChipActive]}
                      >
                        <Text style={[boardStyles.setChipText, active && boardStyles.setChipTextActive]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            <View style={boardStyles.pin}>
              <Ionicons name="pin" size={13} color="#C0392B" style={boardStyles.pinIcon} />
              <Text style={boardStyles.pinLabel}>Number of copies</Text>
              <Text style={boardStyles.pinHint}>
                {unallocated} unallocated cop{unallocated === 1 ? 'y' : 'ies'} available to draw from.
              </Text>
              <TextInput
                value={count}
                onChangeText={onCount}
                keyboardType="number-pad"
                placeholder="10"
                placeholderTextColor="rgba(255,255,255,0.3)"
                style={boardStyles.input}
              />
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Allocate"
              disabled={busy}
              onPress={onSubmit}
              style={[boardStyles.submit, { opacity: busy ? 0.5 : 1 }]}
            >
              <Text style={boardStyles.submitText}>{busy ? 'Allocating…' : 'Allocate'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onClose} style={boardStyles.cancel}>
              <Text style={boardStyles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/* --------------------------------- omr sheet -------------------------------- */

function OmrSheet({
  visible,
  centerName,
  copies,
  busy,
  onScan,
  onClose,
}: {
  visible: boolean;
  centerName: string;
  copies: CopyLite[];
  busy: boolean;
  onScan: (copy: CopyLite) => void;
  onClose: () => void;
}) {
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) setMounted(true);
    if (reduced) {
      t.setValue(visible ? 1 : 0);
      if (!visible) setMounted(false);
      return;
    }
    Animated.timing(t, {
      toValue: visible ? 1 : 0,
      duration: visible ? 420 : 300,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      if (!visible) setMounted(false);
    });
  }, [visible, t, reduced]);

  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] });

  return (
    <Modal transparent visible={mounted} animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, omrStyles.scrim, { opacity: t }]}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close" onPress={onClose} />
      </Animated.View>

      <View style={omrStyles.center} pointerEvents="box-none">
        <Animated.View style={[omrStyles.sheet, { opacity: t, transform: [{ scale }] }]}>
          <View style={omrStyles.head}>
            <Text style={omrStyles.title}>OMR ANSWER SHEET</Text>
            <Text style={omrStyles.subtitle} numberOfLines={1}>
              Scan-in · {centerName}
            </Text>
          </View>
          <View style={omrStyles.rule} />
          <Text style={omrStyles.instructions}>Darken the bubble to confirm the copy has been scanned in.</Text>

          <ScrollView style={omrStyles.scroll} showsVerticalScrollIndicator={false}>
            {copies.length === 0 ? (
              <Text style={omrStyles.empty}>No copies allocated to this center yet.</Text>
            ) : (
              copies.map((copy) => {
                const scanned = !!copy.scanned_at;
                return (
                  <Pressable
                    key={copy.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Copy ${copy.copy_number}${copy.set_label ? ` ${copy.set_label}` : ''}. ${scanned ? 'Scanned' : 'Not scanned'}`}
                    accessibilityState={{ disabled: scanned || busy }}
                    disabled={scanned || busy}
                    onPress={() => onScan(copy)}
                    style={omrStyles.row}
                  >
                    <Text style={omrStyles.copyLabel}>
                      Copy {copy.copy_number}
                      {copy.set_label ? ` ${copy.set_label}` : ''}
                    </Text>
                    <View style={omrStyles.dots} />
                    <View style={omrStyles.bubbleGroup}>
                      <View style={omrStyles.bubbleUnit}>
                        <View style={[omrStyles.bubble, scanned && omrStyles.bubbleOn]}>
                          {scanned ? <View style={omrStyles.bubbleFill} /> : null}
                        </View>
                        <Text style={omrStyles.bubbleLetter}>Y</Text>
                      </View>
                      <View style={omrStyles.bubbleUnit}>
                        <View style={[omrStyles.bubble, !scanned && omrStyles.bubbleOn]}>
                          {!scanned ? <View style={omrStyles.bubbleFill} /> : null}
                        </View>
                        <Text style={omrStyles.bubbleLetter}>N</Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={onClose} style={omrStyles.done}>
            <Text style={omrStyles.doneText}>Done</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

/* --------------------------------- styles --------------------------------- */

const makeStyles = (p: ArchivePalette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: p.backdrop },
    body: { flex: 1, flexDirection: 'row' },
    stage: { flex: 1 },
    scrollContent: { paddingVertical: 16 },
    flash: { backgroundColor: '#FFFFFF', zIndex: 999 },
  });

const makePadStyles = (p: ArchivePalette) =>
  StyleSheet.create({
    head: { alignItems: 'center', marginBottom: 16 },
    heading: { fontFamily: serif, fontSize: 24, fontWeight: '800', color: p.ink },
    subheading: { fontFamily: serif, fontSize: 12.5, color: p.inkDim, marginTop: 3 },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: p.rule,
      backgroundColor: p.pageShade,
      borderRadius: 4,
      paddingHorizontal: 12,
      paddingVertical: 9,
      marginBottom: 18,
    },
    searchInput: { flex: 1, fontFamily: serif, fontSize: 13, color: p.ink },
    empty: { fontFamily: serif, fontSize: 13, color: p.inkDim, fontStyle: 'italic', textAlign: 'center', marginTop: 24 },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    padWrap: { padding: 8 },
    pad: {
      backgroundColor: p.pamphlet,
      borderColor: p.pamphletEdge,
      borderWidth: 2,
      borderRadius: 6,
      padding: 18,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.28,
      shadowRadius: 14,
      elevation: 8,
    },
    clip: {
      position: 'absolute',
      top: -10,
      left: '50%',
      marginLeft: -22,
      width: 44,
      height: 18,
      borderRadius: 3,
      backgroundColor: p.cover,
      borderWidth: 1,
      borderColor: p.coverEdge,
    },
    padHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginTop: 6 },
    padEyebrow: { fontFamily: serif, fontSize: 15, fontWeight: '800', letterSpacing: 2, color: p.pamphletInk },
    padImprint: { fontFamily: serif, fontSize: 8.5, letterSpacing: 1, color: p.pamphletInkDim, marginTop: 2 },
    padIdTag: {
      borderWidth: 1,
      borderColor: p.danger,
      borderRadius: 3,
      paddingHorizontal: 7,
      paddingVertical: 3,
      maxWidth: 150,
    },
    padIdLabel: { fontFamily: serif, fontSize: 7, fontWeight: '700', letterSpacing: 1, color: p.pamphletInkDim, textAlign: 'center' },
    padIdValue: { fontFamily: serif, fontSize: 9, fontWeight: '700', color: p.danger, textAlign: 'center' },
    statusRow: { alignItems: 'center', marginTop: 10 },
    padNameEyebrow: {
      fontFamily: serif,
      fontSize: 9,
      fontWeight: '700',
      letterSpacing: 1.4,
      color: p.pamphletInkDim,
      textAlign: 'center',
      marginTop: 12,
    },
    padName: {
      fontFamily: serif,
      fontSize: 20,
      fontWeight: '800',
      color: p.pamphletInk,
      textAlign: 'center',
      marginTop: 4,
      lineHeight: 26,
    },
    padRule: { height: 1, backgroundColor: `${p.pamphletEdge}55`, marginTop: 14, marginBottom: 12 },
    metaList: { gap: 7 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    metaIcon: { width: 15 },
    metaLabel: { fontFamily: serif, fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: p.pamphletInkDim, width: 78 },
    metaValue: { flex: 1, fontFamily: serif, fontSize: 11.5, fontWeight: '600', color: p.pamphletInk },
    instructions: {
      marginTop: 16,
      borderWidth: 1,
      borderColor: `${p.pamphletEdge}55`,
      borderRadius: 4,
      padding: 12,
      backgroundColor: `${p.pamphletEdge}0D`,
      position: 'relative',
    },
    instructionsTitle: {
      fontFamily: serif,
      fontSize: 9,
      fontWeight: '700',
      letterSpacing: 1,
      color: p.pamphletInkDim,
      textAlign: 'center',
      marginBottom: 6,
    },
    instructionLine: { fontFamily: serif, fontSize: 9.5, color: p.pamphletInkDim, lineHeight: 14 },
    quill: { position: 'absolute', bottom: 8, right: 10, opacity: 0.6 },
    waxSeal: { alignItems: 'center', marginTop: 14 },
  });

const makeCbStyles = (p: ArchivePalette) =>
  StyleSheet.create({
    toolRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' },
    backBtn: {
      width: 34,
      height: 34,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: p.rule,
      backgroundColor: p.pageShade,
      alignItems: 'center',
      justifyContent: 'center',
    },
    search: {
      flex: 1,
      minWidth: 160,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: p.rule,
      backgroundColor: p.pageShade,
      borderRadius: 4,
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    searchInput: { flex: 1, fontFamily: serif, fontSize: 13, color: p.ink },
    // The gold BookButton assumes a light page behind it (its ink is dark
    // brown); on the dark backdrop it needs its own opaque light backing.
    addCenterWrap: { minWidth: 200, backgroundColor: p.pageShade, borderRadius: 4, padding: 2 },

    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
    titleOrnLine: { flex: 1, height: 1, backgroundColor: p.coverHighlight },
    // Sits directly on the dark archive backdrop (not the light page), so it
    // needs the "on cover" ink, not the page ink — otherwise it's dark-on-dark
    // in the light theme.
    examName: { fontFamily: serif, fontSize: 22, fontWeight: '800', color: p.onCover, textAlign: 'center' },

    summary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      borderWidth: 1,
      borderColor: p.rule,
      backgroundColor: p.pageShade,
      borderRadius: 6,
      paddingHorizontal: 16,
      paddingVertical: 14,
      marginBottom: 20,
      flexWrap: 'wrap',
    },
    summaryIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1.5,
      borderColor: p.gold,
      alignItems: 'center',
      justifyContent: 'center',
    },
    summaryName: { minWidth: 140 },
    summaryNameText: { fontFamily: serif, fontSize: 17, fontWeight: '800', color: p.ink },
    summaryCode: { fontFamily: serif, fontSize: 11.5, color: p.inkDim, marginTop: 2 },
    summaryStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, flex: 1, justifyContent: 'flex-end' },
    summaryStat: { alignItems: 'flex-start' },
    summaryStatLabel: {
      fontFamily: serif,
      fontSize: 9,
      fontWeight: '700',
      letterSpacing: 1,
      color: p.inkFaint,
    },
    summaryStatValue: { fontFamily: serif, fontSize: 14, fontWeight: '700', color: p.ink, marginTop: 2 },

    browser: { flex: 1, flexDirection: 'row', alignItems: 'stretch', gap: 16 },
    coverRow: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 22, justifyContent: 'center', alignItems: 'stretch' },
    paginationRow: { marginTop: 20, alignItems: 'center' },
  });

const makeCcStyles = (p: ArchivePalette) =>
  StyleSheet.create({
    coverWrap: { flex: 1, minWidth: 300, maxWidth: 420 },
    cover: {
      flex: 1,
      borderWidth: 10,
      borderRadius: 10,
      backgroundColor: p.cover,
      borderColor: p.coverEdge,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.38,
      shadowRadius: 22,
      elevation: 14,
    },
    gilt: { position: 'absolute', top: 5, left: 5, right: 5, bottom: 5, borderWidth: 1, borderColor: p.coverHighlight, borderRadius: 6 },
    record: {
      flex: 1,
      backgroundColor: p.pamphlet,
      borderRadius: 4,
      overflow: 'hidden',
      paddingTop: 30,
      paddingBottom: 24,
      paddingHorizontal: 26,
      justifyContent: 'space-between',
    },
    tag: {
      position: 'absolute',
      top: 0,
      left: '50%',
      marginLeft: -85,
      width: 170,
      backgroundColor: p.cover,
      borderWidth: 1,
      borderColor: p.gold,
      borderRadius: 4,
      paddingVertical: 6,
      alignItems: 'center',
    },
    tagText: { fontFamily: serif, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: p.gold },
    sealRow: { alignItems: 'center', marginTop: 20, marginBottom: 8 },
    name: { fontFamily: serif, fontSize: 23, fontWeight: '800', color: p.pamphletInk, textAlign: 'center' },
    code: { fontFamily: serif, fontSize: 13, color: p.pamphletInkDim, textAlign: 'center', marginTop: 4 },
    rule: { height: 1, backgroundColor: `${p.pamphletEdge}55`, marginTop: 16, marginBottom: 16 },
    metaList: { gap: 12 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    metaIcon: { width: 17 },
    metaLabel: { flex: 1, fontFamily: serif, fontSize: 11.5, fontWeight: '700', letterSpacing: 0.4, color: p.pamphletInkDim },
    metaValue: { fontFamily: serif, fontSize: 14, fontWeight: '700', color: p.pamphletInk },
    actions: { gap: 10, marginTop: 22 },
    waxSeal: { alignItems: 'center', marginTop: 16 },
  });

const scrollStyles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(0,0,0,0.58)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  column: { alignItems: 'center' },
  rodWrapV: { height: 13, justifyContent: 'center', zIndex: 2 },
  rodV: {
    height: 13,
    borderRadius: 7,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 10,
  },
  rodCapLeft: { position: 'absolute', left: -5, width: 7, height: 19, borderRadius: 4 },
  rodCapRight: { position: 'absolute', right: -5, width: 7, height: 19, borderRadius: 4 },
  parchmentV: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    paddingVertical: 20,
    paddingHorizontal: 24,
    minHeight: 240,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.42,
    shadowRadius: 20,
    elevation: 14,
  },
  scroll: { maxHeight: 480 },
  crest: { alignItems: 'center', marginBottom: 6 },
  title: {
    fontFamily: serif,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  blurb: { fontFamily: serif, fontSize: 11.5, lineHeight: 16, textAlign: 'center', marginTop: 8 },
  rule: { height: 1, marginTop: 12, marginBottom: 14 },
  hint: { fontFamily: serif, fontSize: 11, lineHeight: 15, marginTop: -6, marginBottom: 10 },
  fieldLabel: { fontFamily: serif, fontSize: 12.5, fontWeight: '700', marginBottom: 8 },
  slotOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 3,
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  slotText: { fontFamily: serif, fontSize: 13, fontWeight: '600' },
});

const boardStyles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(0,0,0,0.58)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  frame: {
    borderWidth: 6,
    borderRadius: 6,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.55,
    shadowRadius: 30,
    elevation: 24,
  },
  surface: {
    borderRadius: 3,
    overflow: 'hidden',
    paddingVertical: 18,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.5)',
  },
  title: {
    fontFamily: serif,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: '#FFFFFF',
    textAlign: 'center',
    opacity: 0.94,
  },
  underline: { alignSelf: 'center', width: 70, height: 1, backgroundColor: '#FFFFFF', opacity: 0.4, marginTop: 7, marginBottom: 6 },
  subtitle: { fontFamily: serif, fontSize: 12, color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginBottom: 14 },
  setPicker: { marginBottom: 14 },
  setPickerLabel: {
    fontFamily: serif,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.75)',
    textAlign: 'center',
    marginBottom: 8,
  },
  setChips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  setChip: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  setChipActive: { backgroundColor: '#F3E9C9', borderColor: '#F3E9C9' },
  setChipText: { fontFamily: serif, fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
  setChipTextActive: { color: '#2A2410' },
  pin: {
    backgroundColor: '#F3E9C9',
    borderRadius: 2,
    padding: 14,
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
    marginBottom: 6,
    textAlign: 'center',
  },
  pinHint: { fontFamily: serif, fontSize: 11, color: '#5A5030', marginBottom: 10, textAlign: 'center' },
  input: {
    fontFamily: serif,
    fontSize: 16,
    fontWeight: '700',
    color: '#2A2410',
    borderBottomWidth: 1.5,
    borderBottomColor: '#8B7B57',
    paddingVertical: 6,
    textAlign: 'center',
  },
  submit: {
    marginTop: 16,
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    borderRadius: 3,
    paddingVertical: 9,
    paddingHorizontal: 26,
  },
  submitText: {
    fontFamily: serif,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: '#FFFFFF',
  },
  cancel: { alignSelf: 'center', marginTop: 8, paddingVertical: 4, paddingHorizontal: 12 },
  cancelText: { fontFamily: serif, fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)' },
});

const OMR_PAPER = '#F3EFE0';
const OMR_INK = '#2B2013';
const OMR_LINE = '#8B7B57';

const omrStyles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(0,0,0,0.58)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  sheet: {
    width: 420,
    maxWidth: '100%',
    backgroundColor: OMR_PAPER,
    borderWidth: 2,
    borderColor: OMR_LINE,
    borderRadius: 4,
    padding: 20,
    maxHeight: '82%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.5,
    shadowRadius: 26,
    elevation: 22,
  },
  head: { alignItems: 'center' },
  title: { fontFamily: serif, fontSize: 16, fontWeight: '800', letterSpacing: 2.6, color: OMR_INK },
  subtitle: { fontFamily: serif, fontSize: 12, color: OMR_INK, opacity: 0.7, marginTop: 4 },
  rule: { height: 1, backgroundColor: OMR_LINE, opacity: 0.5, marginTop: 12, marginBottom: 8 },
  instructions: { fontFamily: serif, fontSize: 10.5, fontStyle: 'italic', color: OMR_INK, opacity: 0.65, textAlign: 'center', marginBottom: 10 },
  scroll: { maxHeight: 380 },
  empty: { fontFamily: serif, fontSize: 12.5, fontStyle: 'italic', color: OMR_INK, opacity: 0.6, textAlign: 'center', marginTop: 16 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: `${OMR_LINE}55` },
  copyLabel: { fontFamily: serif, fontSize: 13, fontWeight: '700', color: OMR_INK, width: 76 },
  dots: { flex: 1, height: 1, borderBottomWidth: 1, borderStyle: 'dashed', borderBottomColor: OMR_LINE, marginHorizontal: 8 },
  bubbleGroup: { flexDirection: 'row', gap: 16 },
  bubbleUnit: { alignItems: 'center', gap: 3 },
  bubble: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: OMR_LINE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleOn: { borderColor: OMR_INK },
  bubbleFill: { width: 11, height: 11, borderRadius: 6, backgroundColor: OMR_INK },
  bubbleLetter: { fontFamily: serif, fontSize: 9.5, fontWeight: '700', color: OMR_INK, opacity: 0.7 },
  done: {
    alignSelf: 'center',
    marginTop: 14,
    borderWidth: 1,
    borderColor: OMR_LINE,
    borderRadius: 3,
    paddingVertical: 8,
    paddingHorizontal: 22,
  },
  doneText: { fontFamily: serif, fontSize: 11.5, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: OMR_INK },
});
