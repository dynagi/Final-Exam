/**
 * Command Overview — a single, detailed operational snapshot across every
 * subsystem (exams, paper pipeline, custody, centers, question bank,
 * security detections, team and audit activity), aggregated client-side
 * from lightweight column-only reads so it stays cheap at any bank size.
 *
 * Rendered as four spreads of the same examination archive every other
 * Admin screen lives in — donuts and magnitude bars on parchment, not
 * dashboard cards — turned with a real single-leaf flip (FlipBook: the
 * right leaf swings over the spine and lands as the new left leaf) rather
 * than the whole spread rotating as one rigid plane.
 *
 * Chart colors are not eyeballed: the gold ordinal ramp (pipeline/funnel
 * stages), the four-hue team-role set, and the reserved status colors were
 * each run through the dataviz skill's validator for both the light
 * parchment and dark "book under a lamp" surfaces before being wired in
 * here — see the comments on each constant below for what passed.
 */
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArchiveBackground,
  ArchiveHeader,
  ArchiveIndexOverlay,
  ArchivePalette,
  ArchiveSidebar,
  FlipBook,
  FlipBookHandle,
  PageScroll,
  PageTitle,
  Rule,
  useArchiveLayout,
  useArchivePalette,
} from '../../components/ArchiveBook';
import { BookArrow, PageIndicator } from '../../components/ArchiveUpload';
import { ChartSegment, DonutChart, MagnitudeBars } from '../../components/ArchiveCharts';
import { useTheme } from '../../context/ThemeContext';
import { supabase } from '../../lib/supabase';
import { labelFor, serif } from '../../lib/theme';
import { Role, ROLE_LABEL } from '../../lib/types';
import { useAdminIndex } from './useAdminIndex';

const SELF = 'AdminOverview';

const PAPER_STATUS_ORDER = ['draft', 'sealed', 'sealed_dual', 'printed', 'distributed', 'completed'];
const ROLE_ORDER: Role[] = ['teacher', 'paper_setter', 'admin', 'invigilator'];
const TOP_SUBJECTS_SHOWN = 6;
const TOP_ACTIONS_SHOWN = 6;
const TOP_FORMATS_SHOWN = 6;
const TOP_CUSTODY_SHOWN = 6;
const AUDIT_SAMPLE_SIZE = 500;

/**
 * Ordinal ramp for pipeline/funnel stages (one hue, monotone lightness —
 * swapping the order would change the meaning, so this is ordinal, not
 * categorical). 6 steps light→dark, validated with
 * `validate_palette.js --ordinal`: lightness monotone, every adjacent step
 * ΔL >= 0.06, light end clears 2:1 against its page surface, single hue
 * (10-11° spread). Used for papers (6 stages) and, as evenly-spaced
 * subsets of the same validated ramp, copies and questions.
 */
const GOLD_RAMP: Record<'light' | 'dark', string[]> = {
  light: ['#C9A030', '#AD8828', '#937122', '#795B1B', '#604615', '#48330F'],
  dark: ['#F0D488', '#E0BE68', '#D0A848', '#C09230', '#A87A20', '#8C6414'],
};

/**
 * Categorical set for team roles (identity, not order — swapping which role
 * gets which hue would not change the meaning). 4 hues, fixed assignment
 * order matching ROLE_ORDER, validated `--pairs all` (any two roles can sit
 * adjacent in the donut depending on the data) against both page surfaces:
 * light passes clean but for one WARN-band adjacent pair (6.5 ΔE, legal
 * with the legend's direct labels as the required secondary encoding);
 * dark clears the full 8.0 target on every pair.
 */
const TEAM_COLORS: Record<'light' | 'dark', Record<Role, string>> = {
  light: { teacher: '#237A54', paper_setter: '#9A5527', admin: '#2E5C9E', invigilator: '#82316C' },
  dark: { teacher: '#2F9E7A', paper_setter: '#C2703F', admin: '#4A7AB8', invigilator: '#A8477E' },
};

function tally(values: (string | null | undefined)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    const key = v ?? 'unknown';
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function topEntries(counts: Record<string, number>, n: number): [string, number][] {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

interface Overview {
  exams: { total: number };
  papers: { total: number; byStatus: Record<string, number>; totalQuestions: number };
  copies: { total: number; byStatus: Record<string, number> };
  questions: { total: number; byStatus: Record<string, number>; bySubject: Record<string, number> };
  centers: { total: number; reconciled: number; pending: number };
  detections: { total: number; byLevel: Record<string, number> };
  alerts: { total: number; unacknowledged: number; bySeverity: Record<string, number> };
  team: { total: number; byRole: Record<string, number> };
  audit: { total: number; today: number; sampleSize: number; byAction: Record<string, number> };
  custody: { total: number; byType: Record<string, number> };
  formats: { byName: Record<string, number> };
}

const EMPTY_OVERVIEW: Overview = {
  exams: { total: 0 },
  papers: { total: 0, byStatus: {}, totalQuestions: 0 },
  copies: { total: 0, byStatus: {} },
  questions: { total: 0, byStatus: {}, bySubject: {} },
  centers: { total: 0, reconciled: 0, pending: 0 },
  detections: { total: 0, byLevel: {} },
  alerts: { total: 0, unacknowledged: 0, bySeverity: {} },
  team: { total: 0, byRole: {} },
  audit: { total: 0, today: 0, sampleSize: 0, byAction: {} },
  custody: { total: 0, byType: {} },
  formats: { byName: {} },
};

export default function AdminOverviewScreen() {
  const p = useArchivePalette();
  const { isDark } = useTheme();
  const { outerPad, sidebarMode } = useArchiveLayout();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(p), [p]);
  const [indexOpen, setIndexOpen] = useState(false);

  const gold = GOLD_RAMP[isDark ? 'dark' : 'light'];
  const teamColors = TEAM_COLORS[isDark ? 'dark' : 'light'];

  const [overview, setOverview] = useState<Overview>(EMPTY_OVERVIEW);
  const [spread, setSpread] = useState(0);
  const book = useRef<FlipBookHandle>(null);

  const load = useCallback(async () => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayIso = startOfToday.toISOString();

    const [
      examsRes,
      papersRes,
      copiesRes,
      questionsRes,
      centersRes,
      custodyRes,
      detectionsRes,
      auditSampleRes,
      auditTotalRes,
      auditTodayRes,
      alertsRes,
      profilesRes,
    ] = await Promise.all([
      supabase.from('exams').select('format_code, format_blueprint'),
      supabase.from('papers').select('status, question_count'),
      supabase.from('paper_copies').select('status'),
      supabase.from('questions').select('subject, status'),
      supabase.from('exam_centers').select('reconciled_at'),
      supabase.from('custody_events').select('event_type'),
      supabase.from('qr_detections').select('alert_level'),
      supabase.from('audit_log').select('action').order('id', { ascending: false }).limit(AUDIT_SAMPLE_SIZE),
      supabase.from('audit_log').select('id', { count: 'exact', head: true }),
      supabase.from('audit_log').select('id', { count: 'exact', head: true }).gte('created_at', todayIso),
      supabase.from('alerts').select('severity, acknowledged'),
      supabase.from('profiles').select('role'),
    ]);

    const exams =
      (examsRes.data as { format_code: string | null; format_blueprint: { display_name?: string } | null }[] | null) ??
      [];
    const papers = (papersRes.data as { status: string; question_count: number }[] | null) ?? [];
    const copyStatuses = ((copiesRes.data as { status: string }[] | null) ?? []).map((r) => r.status);
    const questions = (questionsRes.data as { subject: string; status: string }[] | null) ?? [];
    const centers = (centersRes.data as { reconciled_at: string | null }[] | null) ?? [];
    const custodyTypes = ((custodyRes.data as { event_type: string }[] | null) ?? []).map((r) => r.event_type);
    const detectionLevels = ((detectionsRes.data as { alert_level: string }[] | null) ?? []).map(
      (r) => r.alert_level
    );
    const auditSample = (auditSampleRes.data as { action: string }[] | null) ?? [];
    const alerts = (alertsRes.data as { severity: string; acknowledged: boolean }[] | null) ?? [];
    const roles = ((profilesRes.data as { role: string }[] | null) ?? []).map((r) => r.role);

    setOverview({
      exams: { total: exams.length },
      papers: {
        total: papers.length,
        byStatus: tally(papers.map((pp) => pp.status)),
        totalQuestions: papers.reduce((sum, pp) => sum + (pp.question_count ?? 0), 0),
      },
      copies: { total: copyStatuses.length, byStatus: tally(copyStatuses) },
      questions: {
        total: questions.length,
        byStatus: tally(questions.map((q) => q.status)),
        bySubject: tally(questions.map((q) => q.subject)),
      },
      centers: {
        total: centers.length,
        reconciled: centers.filter((c) => c.reconciled_at).length,
        pending: centers.filter((c) => !c.reconciled_at).length,
      },
      detections: { total: detectionLevels.length, byLevel: tally(detectionLevels) },
      alerts: {
        total: alerts.length,
        unacknowledged: alerts.filter((a) => !a.acknowledged).length,
        bySeverity: tally(alerts.map((a) => a.severity)),
      },
      team: { total: roles.length, byRole: tally(roles) },
      audit: {
        total: auditTotalRes.count ?? 0,
        today: auditTodayRes.count ?? 0,
        sampleSize: auditSample.length,
        byAction: tally(auditSample.map((a) => a.action)),
      },
      custody: { total: custodyTypes.length, byType: tally(custodyTypes) },
      formats: {
        byName: tally(exams.map((e) => e.format_blueprint?.display_name ?? e.format_code ?? 'No format')),
      },
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    const channel = supabase
      .channel('overview-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'papers' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'paper_copies' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'questions' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exam_centers' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qr_detections' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'custody_events' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exams' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const { items, onSelect } = useAdminIndex({
    active: SELF,
    onBeforeSelect: () => setIndexOpen(false),
  });

  const missingOrLeaked =
    (overview.copies.byStatus.missing ?? 0) + (overview.copies.byStatus.leaked ?? 0);
  const topSubjects = topEntries(overview.questions.bySubject, TOP_SUBJECTS_SHOWN);
  const topActions = topEntries(overview.audit.byAction, TOP_ACTIONS_SHOWN);
  const topFormats = topEntries(overview.formats.byName, TOP_FORMATS_SHOWN);
  const topCustody = topEntries(overview.custody.byType, TOP_CUSTODY_SHOWN);

  const paperSegments: ChartSegment[] = PAPER_STATUS_ORDER.map((status, i) => ({
    key: status,
    label: labelFor(status),
    value: overview.papers.byStatus[status] ?? 0,
    color: gold[i],
  }));

  const copySegments: ChartSegment[] = [
    { key: 'printed', label: labelFor('printed'), value: overview.copies.byStatus.printed ?? 0, color: gold[0] },
    {
      key: 'in_transit',
      label: labelFor('in_transit'),
      value: overview.copies.byStatus.in_transit ?? 0,
      color: gold[2],
    },
    {
      key: 'at_center',
      label: labelFor('at_center'),
      value: overview.copies.byStatus.at_center ?? 0,
      color: gold[3],
    },
    {
      key: 'delivered',
      label: labelFor('delivered'),
      value: overview.copies.byStatus.delivered ?? 0,
      color: gold[5],
    },
    { key: 'missing_leaked', label: 'Missing / Leaked', value: missingOrLeaked, color: p.danger },
  ];

  const questionSegments: ChartSegment[] = [
    { key: 'submitted', label: labelFor('submitted'), value: overview.questions.byStatus.submitted ?? 0, color: gold[0] },
    { key: 'approved', label: labelFor('approved'), value: overview.questions.byStatus.approved ?? 0, color: gold[3] },
    { key: 'used', label: labelFor('used'), value: overview.questions.byStatus.used ?? 0, color: gold[5] },
  ];

  const teamSegments: ChartSegment[] = ROLE_ORDER.map((role) => ({
    key: role,
    label: `${ROLE_LABEL[role]}s`,
    value: overview.team.byRole[role] ?? 0,
    color: teamColors[role],
  }));

  const detectionSegments: ChartSegment[] = [
    { key: 'critical', label: 'Critical', value: overview.detections.byLevel.critical ?? 0, color: p.danger },
    { key: 'warning', label: 'Warning', value: overview.detections.byLevel.warning ?? 0, color: p.warning },
    { key: 'info', label: 'Info', value: overview.detections.byLevel.info ?? 0, color: p.info },
  ];

  const centerSegments: ChartSegment[] = [
    { key: 'reconciled', label: 'Reconciled', value: overview.centers.reconciled, color: p.success },
    { key: 'pending', label: 'Pending', value: overview.centers.pending, color: p.warning },
  ];

  const alertSegments: ChartSegment[] = [
    { key: 'critical', label: 'Critical', value: overview.alerts.bySeverity.critical ?? 0, color: p.danger },
    { key: 'warning', label: 'Warning', value: overview.alerts.bySeverity.warning ?? 0, color: p.warning },
    { key: 'info', label: 'Info', value: overview.alerts.bySeverity.info ?? 0, color: p.info },
  ];

  const subjectBars = topSubjects.map(([subject, count]) => ({ key: subject, label: subject, value: count }));
  const actionBars = topActions.map(([action, count]) => ({ key: action, label: action, value: count }));
  const formatBars = topFormats.map(([name, count]) => ({ key: name, label: name, value: count }));
  const custodyBars = topCustody.map(([type, count]) => ({
    key: type,
    label: labelFor(type) !== type ? labelFor(type) : type.replace(/_/g, ' '),
    value: count,
  }));

  /* ------------------------------- spreads -------------------------------- */

  const spreads = [
    {
      title: 'Overview',
      left: (
        <PageScroll>
          <PageTitle center size={[19, 27]}>
            Command Overview
          </PageTitle>
          <Rule ornament gap={12} />
          <View style={styles.ledger}>
            <LedgerRow icon="calendar-outline" label="Exams scheduled" value={overview.exams.total} tone={p.gold} palette={p} />
            <LedgerRow icon="documents-outline" label="Papers in flight" value={overview.papers.total} tone={p.info} palette={p} />
            <LedgerRow icon="cube-outline" label="Copies tracked" value={overview.copies.total} tone={p.gold} palette={p} />
            <LedgerRow
              icon="warning-outline"
              label="Missing / leaked"
              value={missingOrLeaked}
              tone={missingOrLeaked > 0 ? p.danger : p.success}
              palette={p}
            />
            <LedgerRow
              icon="notifications-outline"
              label="Open alerts"
              value={overview.alerts.unacknowledged}
              tone={overview.alerts.unacknowledged > 0 ? p.danger : p.success}
              palette={p}
            />
          </View>
          <Text style={styles.footnote}>Updates in real time as papers, copies and alerts change.</Text>
        </PageScroll>
      ),
      right: (
        <PageScroll>
          <PageTitle center size={[19, 27]}>
            Paper Pipeline
          </PageTitle>
          <Rule ornament gap={12} />
          <DonutChart segments={paperSegments} palette={p} centerLabel="papers" />
          <Text style={styles.footnote}>
            {overview.papers.totalQuestions} question slot{overview.papers.totalQuestions === 1 ? '' : 's'} committed
            across every paper.
          </Text>
        </PageScroll>
      ),
    },
    {
      title: 'Custody & Bank',
      left: (
        <PageScroll>
          <PageTitle center size={[19, 27]}>
            Custody & Print
          </PageTitle>
          <Rule ornament gap={12} />
          <DonutChart segments={copySegments} palette={p} centerLabel="copies" />
          {custodyBars.length > 0 ? (
            <>
              <Text style={styles.subheading}>Custody events by type</Text>
              <MagnitudeBars items={custodyBars} palette={p} />
            </>
          ) : (
            <Text style={styles.footnote}>No custody checkpoint scans logged yet.</Text>
          )}
        </PageScroll>
      ),
      right: (
        <PageScroll>
          <PageTitle center size={[19, 27]}>
            Question Bank
          </PageTitle>
          <Rule ornament gap={12} />
          <DonutChart segments={questionSegments} palette={p} centerLabel="questions" />
          {subjectBars.length > 0 ? (
            <>
              <Text style={styles.subheading}>Top subjects</Text>
              <MagnitudeBars items={subjectBars} palette={p} />
            </>
          ) : null}
        </PageScroll>
      ),
    },
    {
      title: 'People & Security',
      left: (
        <PageScroll>
          <PageTitle center size={[19, 27]}>
            Team
          </PageTitle>
          <Rule ornament gap={12} />
          <DonutChart segments={teamSegments} palette={p} centerLabel="accounts" />
          <Text style={styles.subheading}>Exam centers</Text>
          <DonutChart segments={centerSegments} palette={p} size={96} thickness={15} centerLabel="centers" />
        </PageScroll>
      ),
      right: (
        <PageScroll>
          <PageTitle center size={[19, 27]}>
            Detections
          </PageTitle>
          <Rule ornament gap={12} />
          <DonutChart segments={detectionSegments} palette={p} centerLabel="sightings" />
          {actionBars.length > 0 ? (
            <>
              <Text style={styles.subheading}>Top audit actions (last {overview.audit.sampleSize})</Text>
              <MagnitudeBars items={actionBars} palette={p} />
            </>
          ) : null}
        </PageScroll>
      ),
    },
    {
      title: 'Formats & Alerts',
      left: (
        <PageScroll>
          <PageTitle center size={[19, 27]}>
            Exam Formats In Use
          </PageTitle>
          <Rule ornament gap={12} />
          {formatBars.length > 0 ? (
            <MagnitudeBars items={formatBars} palette={p} />
          ) : (
            <Text style={styles.footnote}>No exams scheduled yet.</Text>
          )}
          <Text style={styles.footnote}>Which examination formats this archive's exams are actually set against.</Text>
        </PageScroll>
      ),
      right: (
        <PageScroll>
          <PageTitle center size={[19, 27]}>
            Alerts
          </PageTitle>
          <Rule ornament gap={12} />
          <DonutChart segments={alertSegments} palette={p} centerLabel="alerts" />
          <View style={styles.ledger}>
            <LedgerRow icon="reader-outline" label="Audit entries today" value={overview.audit.today} tone={p.info} palette={p} />
            <LedgerRow icon="library-outline" label="Audit entries total" value={overview.audit.total} tone={p.gold} palette={p} />
            <LedgerRow icon="location-outline" label="Custody scans logged" value={overview.custody.total} tone={p.gold} palette={p} />
          </View>
        </PageScroll>
      ),
    },
  ];

  const spreadCount = spreads.length;
  const current = Math.min(spread, spreadCount - 1);

  const renderSide = useCallback(
    (spreadIndex: number, side: 'left' | 'right') => spreads[spreadIndex]?.[side] ?? null,
    // spreads is rebuilt every render from `overview` — it is always current,
    // this just avoids re-declaring the callback identity on every keystroke
    // elsewhere on the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overview, gold, teamColors, p]
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ArchiveBackground />
      <ArchiveHeader
        title="SECUREAI EXAM ARCHIVE"
        shortTitle="ARCHIVE"
        subtitle="Admin · Overview"
        onMenu={sidebarMode === 'overlay' ? () => setIndexOpen(true) : undefined}
      />

      <View style={styles.body}>
        {sidebarMode === 'overlay' ? null : (
          <ArchiveSidebar items={items} activeRoute={SELF} onSelect={onSelect} />
        )}

        <View style={[styles.stage, { paddingHorizontal: outerPad }]}>
          <View style={styles.bookArea}>
            <Text style={styles.spreadTitle}>{spreads[current].title}</Text>
            <View style={styles.bookRow}>
              <View style={styles.arrowSlot}>
                <BookArrow
                  direction="prev"
                  label="Previous spread"
                  disabled={current <= 0}
                  onPress={() => book.current?.prev()}
                />
              </View>

              <View style={styles.bookWrap}>
                <FlipBook
                  ref={book}
                  spread={current}
                  spreadCount={spreadCount}
                  onSpread={setSpread}
                  renderSide={renderSide}
                  leftFolio={`${current * 2 + 1}`}
                  rightFolio={`${current * 2 + 2}`}
                />
              </View>

              <View style={styles.arrowSlot}>
                <BookArrow
                  direction="next"
                  label="Next spread"
                  disabled={current >= spreadCount - 1}
                  onPress={() => book.current?.next()}
                />
              </View>
            </View>

            <View style={styles.pageIndicator}>
              <PageIndicator page={current + 1} pageCount={spreadCount} onGo={(n) => book.current?.goTo(n - 1)} />
            </View>
          </View>
        </View>
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

function LedgerRow({
  icon,
  label,
  value,
  tone,
  palette: p,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: number;
  tone: string;
  palette: ArchivePalette;
}) {
  const styles = useMemo(() => makeStyles(p), [p]);
  return (
    <View style={styles.ledgerRow}>
      <Ionicons name={icon} size={14} color={tone} style={styles.ledgerIcon} />
      <Text style={styles.ledgerLabel}>{label}</Text>
      <Text style={[styles.ledgerValue, { color: tone }]}>{value}</Text>
    </View>
  );
}

const makeStyles = (p: ArchivePalette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: p.backdrop },
    body: { flex: 1, flexDirection: 'row' },
    stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
    bookArea: { width: '100%', alignItems: 'center' },
    spreadTitle: {
      fontFamily: serif,
      fontSize: 12.5,
      fontWeight: '700',
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: p.onCover,
      marginBottom: 10,
    },
    bookRow: { flexDirection: 'row', alignItems: 'center', width: '100%', maxWidth: 1180 },
    arrowSlot: { width: 44, alignItems: 'center' },
    bookWrap: { flex: 1, alignItems: 'center' },

    ledger: {
      marginTop: 6,
      borderWidth: 1,
      borderColor: p.rule,
      borderRadius: 4,
      backgroundColor: p.pageShade,
    },
    ledgerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      paddingHorizontal: 12,
      paddingVertical: 11,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.rule,
    },
    ledgerIcon: { width: 16 },
    ledgerLabel: { flex: 1, fontFamily: serif, fontSize: 12.5, fontWeight: '600', color: p.ink },
    ledgerValue: { fontFamily: serif, fontSize: 15, fontWeight: '800' },

    subheading: {
      fontFamily: serif,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: p.inkFaint,
      marginTop: 16,
      marginBottom: 10,
    },
    footnote: { fontFamily: serif, fontSize: 11, color: p.inkFaint, fontStyle: 'italic', marginTop: 12, lineHeight: 16 },

    pageIndicator: { alignItems: 'center', marginTop: 12 },
  });
