import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { Button, Card, EmptyState, Screen, SectionTitle } from '../../components/UI';
import { usePrintPreview } from '../../context/PrintPreviewContext';
import { useTheme } from '../../context/ThemeContext';
import { showAlert } from '../../lib/alert';
import { buildAllCopiesHtml, buildPaperHtml, printHtml, sharePaperPdf } from '../../lib/print';
import { frameQrSvgs, qrSvg } from '../../lib/qr';
import { labelFor, spacing, ThemeColors } from '../../lib/theme';
import { PaperQuestionContent, PaperViewQuestion, PrintedCopy } from '../../lib/types';

/** One question, rendered the way the printed copy renders it. */
function QuestionRow({
  q,
  number,
  styles,
}: {
  q: PaperQuestionContent | PaperViewQuestion;
  number: number;
  styles: ReturnType<typeof makeStyles>;
}) {
  const negative = 'negative_marks' in q ? q.negative_marks : 0;
  const hasOptions = (q.question_type === 'mcq' || q.question_type === 'msq') && q.options.length > 0;
  return (
    <View style={styles.q}>
      <View style={styles.qHead}>
        <Text style={styles.qBody}>
          <Text style={styles.qNum}>Q{number}. </Text>
          {q.body}
        </Text>
      </View>
      <View style={styles.qTags}>
        <View style={styles.qTypePill}>
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
        <View style={styles.answerSpace} />
      )}
    </View>
  );
}

export default function PrintPreviewScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { lastPrint } = usePrintPreview();

  const [selected, setSelected] = useState<PrintedCopy | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  if (!lastPrint || !selected) {
    return (
      <Screen>
        <EmptyState
          icon="print-outline"
          title="No printed paper to preview"
          subtitle="Run a Print Ceremony from the Papers tab. The decrypted paper, its QR codes and a print preview open here automatically."
        />
      </Screen>
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

  return (
    <Screen scroll>
      <SectionTitle title="Select copy" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.copyRow}>
        {lastPrint.copyList.map((c) => {
          const active = c.id === selected.id;
          return (
            <Pressable
              key={c.id}
              onPress={() => setSelected(c)}
              style={[styles.copyPill, active && styles.copyPillActive]}
            >
              <Text style={[styles.copyPillText, active && styles.copyPillTextActive]}>
                #{c.copy_number}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.actions}>
        <Button
          title={`Print all ${lastPrint.copies} copies — one file`}
          icon="print"
          onPress={() => void doPrintAll()}
          loading={busy}
        />
        <Button
          title={`Print this copy only (#${selected.copy_number})`}
          variant="ghost"
          icon="document-outline"
          onPress={() => void doPrintCopy()}
          style={{ marginTop: spacing.sm }}
        />
        <Button
          title={Platform.OS === 'web' ? 'Save all as PDF' : 'Export all as PDF'}
          variant="ghost"
          icon="share-outline"
          onPress={() => void doShareAll()}
          style={{ marginTop: spacing.sm }}
        />
      </View>

      <SectionTitle title="Print preview" />
      {/* WYSIWYG-ish rendering of the printable paper. */}
      <Card style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.examName}>{paper.exam_name || 'Examination'}</Text>
            <Text style={styles.paperTitle}>{paper.title}</Text>
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
            {qr ? <SvgXml xml={qr} width={96} height={96} /> : null}
            <Text style={styles.qrCap}>Signed QR</Text>
            {selected.trace_code ? (
              <Text style={styles.traceCap}>TRACE {selected.trace_code}</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.instructions}>
          <Ionicons name="information-circle-outline" size={14} color={colors.textDim} />
          <View style={{ flex: 1 }}>
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
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionName}>{section.name}</Text>
                  <Text style={styles.sectionMeta}>
                    {section.question_count} Q · {section.marks} marks
                  </Text>
                </View>
                {section.questions.map((q) => (
                  <QuestionRow key={q.id} q={q} number={q.number} styles={styles} />
                ))}
              </View>
            ))
          : paper.questions.map((q, i) => (
              <QuestionRow key={i} q={q} number={i + 1} styles={styles} />
            ))}
      </Card>
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    copyRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      paddingVertical: 2,
    },
    copyPill: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 8,
      backgroundColor: colors.surfaceAlt,
    },
    copyPillActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    copyPillText: {
      color: colors.textDim,
      fontWeight: '700',
      fontSize: 13,
    },
    copyPillTextActive: {
      color: colors.primary,
    },
    actions: {
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    sheet: {
      backgroundColor: colors.bgElevated,
    },
    sheetHeader: {
      flexDirection: 'row',
      gap: spacing.md,
      borderBottomWidth: 2,
      borderBottomColor: colors.border,
      paddingBottom: spacing.md,
      marginBottom: spacing.md,
    },
    examName: {
      color: colors.textDim,
      fontSize: 11,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    paperTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '800',
      marginTop: 2,
    },
    paperSub: {
      color: colors.textDim,
      fontSize: 12,
      marginTop: 4,
    },
    copyLine: {
      color: colors.textFaint,
      fontSize: 11,
      marginTop: 4,
    },
    qrWrap: {
      alignItems: 'center',
      backgroundColor: '#fff',
      padding: 6,
      borderRadius: 8,
    },
    qrCap: {
      color: '#555',
      fontSize: 9,
      marginTop: 2,
    },
    traceCap: {
      color: colors.accent,
      fontSize: 9,
      fontWeight: '800',
      letterSpacing: 0.5,
      marginTop: 2,
    },
    sectionHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.borderLight,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderLight,
      paddingVertical: 4,
      marginTop: spacing.md,
    },
    sectionName: { color: colors.text, fontSize: 14, fontWeight: '800', flex: 1 },
    sectionMeta: { color: colors.textDim, fontSize: 11, fontWeight: '600' },
    instructions: {
      flexDirection: 'row',
      gap: 6,
      alignItems: 'flex-start',
      backgroundColor: colors.surfaceAlt,
      borderRadius: 8,
      padding: spacing.sm,
      marginBottom: spacing.md,
    },
    instructionsText: {
      color: colors.textDim,
      fontSize: 11,
      lineHeight: 16,
      flex: 1,
    },
    q: {
      marginBottom: spacing.md,
    },
    qHead: {
      flexDirection: 'row',
    },
    qBody: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
      flex: 1,
    },
    qNum: {
      fontWeight: '800',
    },
    qTags: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: 4,
    },
    qTypePill: {
      backgroundColor: colors.primary,
      borderRadius: 999,
      paddingHorizontal: 7,
      paddingVertical: 1,
    },
    qTypePillText: {
      color: colors.onAccent,
      fontSize: 9,
      fontWeight: '800',
      letterSpacing: 0.4,
    },
    qMarks: {
      color: colors.textDim,
      fontSize: 11,
    },
    option: {
      color: colors.text,
      fontSize: 13,
      lineHeight: 22,
      marginLeft: spacing.md,
      marginTop: 2,
    },
    answerSpace: {
      height: 54,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      borderStyle: 'dashed',
      marginTop: spacing.sm,
    },
  });
