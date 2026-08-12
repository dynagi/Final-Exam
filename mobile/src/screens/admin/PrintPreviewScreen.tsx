import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Animated, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SvgXml } from 'react-native-svg';
import {
  ArchiveBackground,
  ArchiveHeader,
  ArchiveIndexOverlay,
  ArchivePalette,
  ArchiveSidebar,
  OpenBook,
  PageScroll,
  PageTitle,
  Rule,
  fluid,
  useArchiveLayout,
  useArchivePalette,
  usePageTurn,
} from '../../components/ArchiveBook';
import { BookButton, CenteredHeading } from '../../components/ArchiveControls';
import { usePrintPreview } from '../../context/PrintPreviewContext';
import { showAlert } from '../../lib/alert';
import { buildAllCopiesHtml, buildPaperHtml, printHtml, sharePaperPdf } from '../../lib/print';
import { frameQrSvgs, qrSvg } from '../../lib/qr';
import { labelFor, serif } from '../../lib/theme';
import { PaperQuestionContent, PaperViewQuestion, PrintedCopy } from '../../lib/types';
import { useAdminIndex } from './useAdminIndex';

const SELF = 'PrintPreview';

/** One question, rendered the way the printed copy renders it. */
function QuestionRow({
  q,
  number,
  palette: p,
  pageWidth,
}: {
  q: PaperQuestionContent | PaperViewQuestion;
  number: number;
  palette: ArchivePalette;
  pageWidth: number;
}) {
  const styles = useMemo(() => makeStyles(p), [p]);
  const negative = 'negative_marks' in q ? q.negative_marks : 0;
  const hasOptions = (q.question_type === 'mcq' || q.question_type === 'msq') && q.options.length > 0;
  return (
    <View style={styles.q}>
      <Text style={[styles.qBody, { fontSize: fluid(pageWidth, 12, 14) }]}>
        <Text style={styles.qNum}>Q{number}. </Text>
        {q.body}
      </Text>
      <View style={styles.qTags}>
        <View style={[styles.qTypePill, { borderColor: p.rule }]}>
          <Text style={styles.qTypePillText}>{labelFor(q.question_type)}</Text>
        </View>
        <Text style={styles.qMarks}>
          [{q.marks} mark{q.marks === 1 ? '' : 's'}
          {negative > 0 ? `, −${negative}` : ''}]
        </Text>
      </View>
      {hasOptions ? (
        q.options.map((o, oi) => (
          <Text key={oi} style={styles.option}>
            {String.fromCharCode(65 + oi)}. {o}
          </Text>
        ))
      ) : (
        <View style={[styles.answerSpace, { borderBottomColor: p.rule }]} />
      )}
    </View>
  );
}

export default function PrintPreviewScreen() {
  const p = useArchivePalette();
  const styles = useMemo(() => makeStyles(p), [p]);
  const { stacked, outerPad, sidebarMode, pageWidth } = useArchiveLayout();
  const insets = useSafeAreaInsets();
  const { lastPrint } = usePrintPreview();

  const [indexOpen, setIndexOpen] = useState(false);
  const [selected, setSelected] = useState<PrintedCopy | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A short, soft turn on the preview leaf only — not the whole book —
  // whenever the selected copy changes.
  const copyTurn = usePageTurn({ duration: 650, angle: 62 });

  // Default to copy #1 whenever a new print result arrives.
  useEffect(() => {
    setSelected(lastPrint?.copyList?.[0] ?? null);
  }, [lastPrint]);

  // Regenerate the on-screen QR when the selected copy changes.
  useEffect(() => {
    let active = true;
    if (!selected) {
      setQr(null);
      return;
    }
    void qrSvg(selected.qr_payload, 150).then((svg) => {
      if (active) setQr(svg);
    });
    return () => {
      active = false;
    };
  }, [selected]);

  const { items, onSelect } = useAdminIndex({
    active: SELF,
    onBeforeSelect: () => setIndexOpen(false),
  });

  const selectCopy = (copy: PrintedCopy, direction: 1 | -1) => {
    if (copy.id === selected?.id) return;
    copyTurn.turn(direction, () => setSelected(copy));
  };

  const shell = (content: React.ReactNode) => (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ArchiveBackground />
      <ArchiveHeader
        title="SECUREAI EXAM ARCHIVE"
        shortTitle="ARCHIVE"
        subtitle="Admin · Print Preview"
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
          >
            {content}
          </ScrollView>
        ) : (
          <View style={[styles.stage, { paddingHorizontal: outerPad }]}>{content}</View>
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

  if (!lastPrint || !selected) {
    return shell(
      <View style={styles.empty}>
        <Ionicons name="print-outline" size={28} color={p.inkFaint} />
        <Text style={styles.emptyTitle}>No printed paper to preview</Text>
        <Text style={styles.emptyText}>
          Run a Print Ceremony from the Papers page. The decrypted paper, its QR codes and a
          print preview open here automatically.
        </Text>
      </View>
    );
  }

  const paper = lastPrint.paper;

  // All copies, each with its own header QR and its own grid of frame QRs —
  // built once for the "one file" actions.
  const buildAllHtml = async () => {
    const copies = await Promise.all(
      lastPrint.copyList.map(async (c) => ({
        copy: c,
        qrSvg: await qrSvg(c.qr_payload, 160),
        frameSvgs: c.frames?.length ? await frameQrSvgs(c.frames) : null,
      }))
    );
    return buildAllCopiesHtml(lastPrint, copies);
  };

  const doPrintCopy = async () => {
    setBusy(true);
    try {
      const svg = await qrSvg(selected.qr_payload, 160);
      const frames = selected.frames?.length ? await frameQrSvgs(selected.frames) : null;
      await printHtml(buildPaperHtml(lastPrint, selected, svg, frames));
    } catch (e) {
      showAlert('Print failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const doPrintAll = async () => {
    setBusy(true);
    try {
      await printHtml(await buildAllHtml());
    } catch (e) {
      showAlert('Print failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const doShareAll = async () => {
    setBusy(true);
    try {
      await sharePaperPdf(await buildAllHtml());
    } catch (e) {
      showAlert('Export failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  /* -------------------------------- pages -------------------------------- */

  const leftPage = (
    <PageScroll>
      <PageTitle center size={[19, 27]}>
        Print Ceremony
      </PageTitle>
      <Rule ornament gap={12} />

      <CenteredHeading>Select Copy</CenteredHeading>
      <View style={styles.copyRow}>
        {lastPrint.copyList.map((c, i) => {
          const active = c.id === selected.id;
          const selIndex = lastPrint.copyList.findIndex((x) => x.id === selected.id);
          return (
            <Pressable
              key={c.id}
              onPress={() => selectCopy(c, i > selIndex ? 1 : -1)}
              style={[
                styles.copyPill,
                { borderColor: active ? p.gold : p.rule },
                active && { backgroundColor: p.goldSoft, borderWidth: 2 },
              ]}
            >
              <Text style={[styles.copyPillText, { color: active ? p.ink : p.inkDim }]}>
                #{c.copy_number}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Rule gap={16} />

      <CenteredHeading>Actions</CenteredHeading>
      <View style={styles.actions}>
        <BookButton
          title={`Print all ${lastPrint.copies} copies — one file`}
          icon="print"
          variant="gold"
          loading={busy}
          onPress={() => void doPrintAll()}
        />
        <View style={styles.actionGap} />
        <BookButton
          title={`Print this copy only (#${selected.copy_number})`}
          icon="document-outline"
          loading={busy}
          onPress={() => void doPrintCopy()}
        />
        <View style={styles.actionGap} />
        <BookButton
          title={Platform.OS === 'web' ? 'Save all as PDF' : 'Export all as PDF'}
          icon="share-outline"
          loading={busy}
          onPress={() => void doShareAll()}
        />
      </View>
    </PageScroll>
  );

  const rightPage = (
    <PageScroll>
      <PageTitle center size={[19, 27]}>
        Print Preview
      </PageTitle>
      <Rule ornament gap={12} />

      <Animated.View style={copyTurn.style}>
        <View style={[styles.sheetHeader, { borderBottomColor: p.rule }]}>
          <View style={styles.flex}>
            <Text style={styles.examName}>{paper.exam_name || 'Examination'}</Text>
            <Text style={[styles.paperTitle, { fontSize: fluid(pageWidth, 15, 19) }]}>
              {paper.title}
            </Text>
            <Text style={styles.paperSub}>
              {paper.format_display_name ? `${paper.format_display_name} · ` : ''}
              Subject: {paper.subject} ·{' '}
              {paper.sections?.reduce((n, s) => n + s.question_count, 0) ?? paper.questions.length}{' '}
              questions · Total marks {paper.total_marks}
              {paper.duration_minutes ? ` · ${paper.duration_minutes} min` : ''}
            </Text>
            <Text style={styles.copyLine}>
              Copy #{selected.copy_number} of {lastPrint.copies} · {lastPrint.location}
            </Text>
          </View>
          <View style={styles.qrWrap}>
            {qr ? <SvgXml xml={qr} width={88} height={88} /> : null}
            <Text style={styles.qrCap}>Signed QR</Text>
            {selected.trace_code ? (
              <Text style={styles.traceCap}>TRACE {selected.trace_code}</Text>
            ) : null}
          </View>
        </View>

        <View style={[styles.instructions, { backgroundColor: `${p.pageShade}CC`, borderColor: p.rule }]}>
          <Ionicons name="information-circle-outline" size={14} color={p.inkDim} />
          <View style={styles.flex}>
            {(paper.instructions?.length
              ? paper.instructions
              : [
                  'Uniquely watermarked & QR-signed. Chain of custody tracked — any leak is traceable to this copy.',
                ]
            ).map((line, i) => (
              <Text key={i} style={styles.instructionsText}>
                {line}
              </Text>
            ))}
          </View>
        </View>

        {/* Papers sealed against an exam format print in their section layout —
            the same document the setter confirmed in the preview. */}
        {paper.sections?.length
          ? paper.sections.map((section) => (
              <View key={section.name}>
                <View style={[styles.sectionHead, { borderColor: p.rule }]}>
                  <Text style={styles.sectionName}>{section.name}</Text>
                  <Text style={styles.sectionMeta}>
                    {section.question_count} Q · {section.marks} marks
                  </Text>
                </View>
                {section.questions.map((q) => (
                  <QuestionRow key={q.id} q={q} number={q.number} palette={p} pageWidth={pageWidth} />
                ))}
              </View>
            ))
          : paper.questions.map((q, i) => (
              <QuestionRow key={i} q={q} number={i + 1} palette={p} pageWidth={pageWidth} />
            ))}

        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.turnShade, copyTurn.shadeStyle]}
        />
      </Animated.View>
    </PageScroll>
  );

  return shell(
    <OpenBook
      left={leftPage}
      right={rightPage}
      leftFolio="Print ceremony"
      rightFolio={`Copy #${selected.copy_number} of ${lastPrint.copies}`}
    />
  );
}

/* --------------------------------- styles --------------------------------- */

const makeStyles = (p: ArchivePalette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: p.backdrop },
    body: { flex: 1, flexDirection: 'row' },
    stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
    scrollContent: { paddingVertical: 16 },

    /* empty state */
    empty: { alignItems: 'center', gap: 9, paddingHorizontal: 30 },
    emptyTitle: { fontFamily: serif, fontSize: 16, fontWeight: '700', color: p.ink },
    emptyText: {
      fontFamily: serif,
      fontSize: 12.5,
      color: p.inkDim,
      lineHeight: 18,
      textAlign: 'center',
      maxWidth: 380,
    },

    /* left page */
    copyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, justifyContent: 'center', marginTop: 8 },
    copyPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
    copyPillText: { fontFamily: serif, fontSize: 12.5, fontWeight: '700' },
    actions: { marginTop: 8 },
    actionGap: { height: 9 },

    /* right page */
    sheetHeader: { flexDirection: 'row', gap: 12, borderBottomWidth: 2, paddingBottom: 12, marginBottom: 12 },
    examName: {
      fontFamily: serif,
      fontSize: 10,
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      color: p.inkFaint,
    },
    paperTitle: { fontFamily: serif, fontWeight: '700', color: p.ink, marginTop: 2 },
    paperSub: { fontFamily: serif, fontSize: 11, color: p.inkDim, marginTop: 5, lineHeight: 16 },
    copyLine: { fontFamily: serif, fontSize: 10.5, color: p.inkFaint, marginTop: 4 },
    qrWrap: { alignItems: 'center', backgroundColor: '#fff', padding: 6, borderRadius: 6 },
    qrCap: { fontFamily: serif, fontSize: 8.5, color: '#555', marginTop: 2 },
    traceCap: { fontFamily: serif, fontSize: 8.5, fontWeight: '700', letterSpacing: 0.5, color: p.gold, marginTop: 2 },

    instructions: {
      flexDirection: 'row',
      gap: 7,
      alignItems: 'flex-start',
      borderWidth: 1,
      borderRadius: 4,
      padding: 9,
      marginBottom: 12,
    },
    instructionsText: { fontFamily: serif, fontSize: 11, lineHeight: 16, color: p.inkDim, flex: 1 },

    sectionHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: 8,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      paddingVertical: 4,
      marginTop: 12,
    },
    sectionName: { fontFamily: serif, fontSize: 13, fontWeight: '700', color: p.ink, flex: 1 },
    sectionMeta: { fontFamily: serif, fontSize: 10.5, fontWeight: '700', color: p.inkDim },

    q: { marginTop: 11 },
    qBody: { fontFamily: serif, color: p.ink, lineHeight: 19 },
    qNum: { fontWeight: '700' },
    qTags: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
    qTypePill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 },
    qTypePillText: {
      fontFamily: serif,
      fontSize: 9,
      fontWeight: '700',
      letterSpacing: 0.5,
      color: p.inkDim,
    },
    qMarks: { fontFamily: serif, fontSize: 10.5, color: p.inkFaint },
    option: { fontFamily: serif, fontSize: 12, color: p.ink, lineHeight: 20, marginLeft: 12, marginTop: 2 },
    answerSpace: { height: 44, borderBottomWidth: 1, borderStyle: 'dashed', marginTop: 8 },

    turnShade: { backgroundColor: '#000' },
  });
