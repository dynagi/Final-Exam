/**
 * Paper Preview — the last human checkpoint before encryption.
 *
 * Renders the server-built PaperView using the standard Indian question-paper
 * skeleton: centred exam header, a duration / marks / paper-set strip, the
 * candidate block, the instruction box, subject sections split into typed
 * sub-sections ("Section A — MCQ"), and a footer carrying the paper code and
 * set. It is the same layout the printed copies use, so what the setter
 * confirms here is literally what gets printed.
 *
 * "Confirm & Encrypt Paper" is the setter's explicit acknowledgement; nothing
 * is sealed until they press it.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { CompositionReport } from '../lib/examFormats';
import { radius, serif, spacing, ThemeColors } from '../lib/theme';
import { PaperView, PaperViewQuestion } from '../lib/types';
import { Button } from './UI';

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

function QuestionBlock({
  question,
  styles,
}: {
  question: PaperViewQuestion;
  styles: ReturnType<typeof makeStyles>;
}) {
  const hasOptions =
    (question.question_type === 'mcq' || question.question_type === 'msq') &&
    question.options.length > 0;

  return (
    <View style={styles.question}>
      <View style={styles.qRow}>
        <Text style={styles.qNo}>{question.number}.</Text>
        <Text style={styles.qText}>{question.body}</Text>
        <Text style={styles.qMarks}>
          [{question.marks}
          {question.negative_marks > 0 ? ` / −${question.negative_marks}` : ''}]
        </Text>
      </View>

      {hasOptions ? (
        <View style={styles.options}>
          {question.options.map((option, i) => (
            <View key={i} style={styles.option}>
              <Text style={styles.optionKey}>({OPTION_LABELS[i] ?? i + 1})</Text>
              <Text style={styles.optionText}>{option}</Text>
            </View>
          ))}
        </View>
      ) : question.question_type === 'numerical' ? (
        <View style={styles.answerBox}>
          <Text style={styles.answerHint}>Answer:</Text>
          <View style={styles.answerRule} />
        </View>
      ) : (
        <View style={styles.subjective}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.ruledLine} />
          ))}
        </View>
      )}
    </View>
  );
}

export default function PaperPreview({
  visible,
  view,
  report,
  loading,
  busy,
  onBack,
  onConfirm,
}: {
  visible: boolean;
  view: PaperView | null;
  report: CompositionReport | null;
  loading?: boolean;
  busy?: boolean;
  onBack: () => void;
  /** Undefined hides the confirm action (read-only preview, e.g. for Admin). */
  onConfirm?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const canConfirm = !!onConfirm && !!view && (report?.ok ?? false);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onBack}>
      <View style={styles.screen}>
        <View style={styles.topBar}>
          <Text style={styles.topBarTitle} numberOfLines={1}>
            Paper Preview{view?.set_label ? ` · ${view.set_label}` : ''}
          </Text>
          <Text style={styles.topBarHint}>Exactly as students will receive it</Text>
        </View>

        {loading || !view ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Building the final paper…</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.sheetWrap} showsVerticalScrollIndicator={false}>
            <View style={styles.sheet}>
              {/* ---------------------------- header --------------------------- */}
              <View style={styles.header}>
                <Text style={styles.examName}>
                  {(view.exam_name ?? view.title).toUpperCase()}
                </Text>
                <Text style={styles.paperLabel}>{view.paper_label ?? view.subject}</Text>
              </View>

              <View style={styles.examMeta}>
                <Text style={styles.metaItem}>
                  <Text style={styles.metaKey}>Duration: </Text>
                  {view.duration_minutes ? `${view.duration_minutes} minutes` : '—'}
                </Text>
                <Text style={styles.metaItem}>
                  <Text style={styles.metaKey}>Total Marks: </Text>
                  {view.total_marks}
                </Text>
                <Text style={styles.metaItem}>
                  <Text style={styles.metaKey}>Paper Set: </Text>
                  {view.set_label ?? '—'}
                </Text>
              </View>

              {/* --------------------------- candidate ------------------------- */}
              <View style={styles.candidate}>
                <View style={styles.candidateRow}>
                  <View style={styles.candidateCell}>
                    <Text style={styles.candidateText}>
                      <Text style={styles.metaKey}>Candidate Name: </Text>______________________
                    </Text>
                  </View>
                  <View style={[styles.candidateCell, styles.candidateCellLast]}>
                    <Text style={styles.candidateText}>
                      <Text style={styles.metaKey}>Roll No: </Text>______________
                    </Text>
                  </View>
                </View>
                <View style={[styles.candidateRow, styles.candidateRowLast]}>
                  <View style={styles.candidateCell}>
                    <Text style={styles.candidateText}>
                      <Text style={styles.metaKey}>Registration No: </Text>_____________________
                    </Text>
                  </View>
                  <View style={[styles.candidateCell, styles.candidateCellLast]}>
                    <Text style={styles.candidateText}>
                      <Text style={styles.metaKey}>Centre: </Text>______________
                    </Text>
                  </View>
                </View>
              </View>

              {/* -------------------------- instructions ----------------------- */}
              <View style={styles.instructions}>
                <Text style={styles.instructionsTitle}>INSTRUCTIONS</Text>
                {view.instructions.map((line, i) => (
                  <Text key={i} style={styles.instructionLine}>
                    {i + 1}. {line}
                  </Text>
                ))}
              </View>

              {/* ---------------------------- sections ------------------------- */}
              {view.sections.map((section) => (
                <View key={section.name} style={styles.section}>
                  <Text style={styles.sectionTitle}>{section.name.toUpperCase()}</Text>
                  {section.groups.map((group) => (
                    <View key={group.label} style={styles.subsection}>
                      <View style={styles.subTitle}>
                        <Text style={styles.subTitleText}>
                          {group.label}
                          {group.required != null ? ` — Required: ${group.required} questions` : ''}
                        </Text>
                      </View>
                      <Text style={styles.summary}>
                        {group.questions.length} question
                        {group.questions.length === 1 ? '' : 's'}
                        {group.marks_correct != null
                          ? ` · +${group.marks_correct} for a correct answer${
                              group.negative_marks > 0
                                ? `, −${group.negative_marks} for an incorrect answer`
                                : ', no negative marking'
                            }, ${group.unattempted_marks} if unattempted`
                          : ''}
                      </Text>
                      {group.questions.map((question) => (
                        <QuestionBlock key={question.id} question={question} styles={styles} />
                      ))}
                    </View>
                  ))}
                </View>
              ))}

              {/* ----------------------------- footer -------------------------- */}
              <View style={styles.footer}>
                <Text style={styles.footerText}>
                  {view.format_code?.toUpperCase() ?? view.subject}
                  {view.format_year ? `_${view.format_year}` : ''}
                </Text>
                <Text style={styles.footerText}>Set: {view.set_label ?? '—'}</Text>
                <Text style={styles.footerText}>
                  {view.total_questions} questions · {view.total_marks} marks
                </Text>
              </View>
            </View>

            {report && !report.ok ? (
              <View style={styles.blockers}>
                <Text style={styles.blockersTitle}>Cannot finalize paper</Text>
                {report.errors.slice(0, 6).map((error, i) => (
                  <Text key={i} style={styles.blockerLine}>
                    • {error}
                  </Text>
                ))}
              </View>
            ) : null}
            {report?.warnings.length ? (
              <View style={styles.notice}>
                {report.warnings.map((warning, i) => (
                  <Text key={i} style={styles.noticeLine}>
                    ⓘ {warning}
                  </Text>
                ))}
              </View>
            ) : null}
          </ScrollView>
        )}

        <View style={styles.actions}>
          <Button title="← Back to Edit" variant="ghost" onPress={onBack} disabled={busy} />
          {onConfirm ? (
            <Button
              title="Confirm & Encrypt Paper"
              icon="lock-closed-outline"
              onPress={onConfirm}
              disabled={!canConfirm}
              loading={busy}
              style={{ marginTop: spacing.sm }}
            />
          ) : null}
          {onConfirm && !canConfirm && !loading ? (
            <Text style={styles.actionHint}>
              <Ionicons name="alert-circle-outline" size={12} /> Complete every section before this
              set can be encrypted.
            </Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    topBar: {
      paddingTop: spacing.xl * 2,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.bgElevated,
    },
    topBarTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
    topBarHint: { color: colors.textDim, fontSize: 12, marginTop: 2 },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
    loadingText: { color: colors.textDim, fontSize: 13 },
    sheetWrap: { padding: spacing.lg, paddingBottom: spacing.xl },
    // The preview deliberately reads like paper, not like the app chrome.
    sheet: {
      backgroundColor: colors.bgElevated,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: spacing.lg,
    },
    header: {
      alignItems: 'center',
      borderBottomWidth: 2,
      borderBottomColor: colors.text,
      paddingBottom: 9,
    },
    examName: {
      color: colors.text,
      fontFamily: serif,
      fontSize: 19,
      fontWeight: '700',
      letterSpacing: 0.5,
      textAlign: 'center',
    },
    paperLabel: { color: colors.text, fontSize: 13, fontWeight: '700', marginTop: 2 },
    examMeta: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      gap: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.text,
      paddingVertical: 7,
      marginBottom: spacing.md,
    },
    metaItem: { color: colors.text, fontSize: 12 },
    metaKey: { fontWeight: '700' },
    candidate: {
      borderWidth: 1,
      borderColor: colors.text,
      marginBottom: spacing.md,
    },
    candidateRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.text },
    candidateRowLast: { borderBottomWidth: 0 },
    candidateCell: {
      flex: 1,
      padding: 6,
      borderRightWidth: 1,
      borderRightColor: colors.text,
    },
    candidateCellLast: { borderRightWidth: 0 },
    candidateText: { color: colors.textDim, fontSize: 11 },
    instructions: {
      borderWidth: 1,
      borderColor: colors.text,
      padding: 10,
      marginBottom: spacing.lg,
    },
    instructionsTitle: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 0.8,
      textAlign: 'center',
      marginBottom: 5,
    },
    instructionLine: { color: colors.textDim, fontSize: 11.5, lineHeight: 18 },
    section: { marginTop: spacing.lg },
    sectionTitle: {
      color: colors.text,
      fontFamily: serif,
      fontSize: 15,
      fontWeight: '700',
      textAlign: 'center',
      letterSpacing: 0.6,
      borderTopWidth: 2,
      borderBottomWidth: 2,
      borderColor: colors.text,
      paddingVertical: 7,
    },
    subsection: { marginTop: spacing.md },
    subTitle: {
      borderWidth: 1,
      borderColor: colors.borderLight,
      backgroundColor: colors.surfaceAlt,
      padding: 6,
    },
    subTitleText: { color: colors.text, fontSize: 12.5, fontWeight: '700' },
    summary: { color: colors.textFaint, fontSize: 11, marginTop: 5, marginBottom: 9 },
    question: { marginBottom: 13 },
    qRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
    qNo: { color: colors.text, fontSize: 13.5, fontWeight: '700', minWidth: 28 },
    qText: { color: colors.text, fontSize: 13.5, lineHeight: 20, flex: 1 },
    qMarks: { color: colors.textDim, fontSize: 11, fontWeight: '700' },
    options: { marginTop: 6, marginLeft: 34, gap: 5 },
    option: { flexDirection: 'row', gap: 6 },
    optionKey: { color: colors.text, fontSize: 12.5, fontWeight: '700' },
    optionText: { color: colors.textDim, fontSize: 12.5, flex: 1, lineHeight: 18 },
    answerBox: { marginTop: 10, marginLeft: 34, flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
    answerHint: { color: colors.textFaint, fontSize: 11 },
    answerRule: {
      flex: 1,
      maxWidth: '65%',
      height: 22,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderLight,
    },
    subjective: { marginTop: 10, marginLeft: 34 },
    ruledLine: { height: 24, borderBottomWidth: 1, borderBottomColor: colors.border },
    footer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.text,
      marginTop: spacing.xl,
      paddingTop: 6,
    },
    footerText: { color: colors.textFaint, fontSize: 10 },
    blockers: {
      marginTop: spacing.md,
      borderWidth: 1,
      borderColor: colors.danger,
      backgroundColor: colors.surface,
      borderRadius: radius.sm,
      padding: spacing.md,
    },
    blockersTitle: { color: colors.danger, fontSize: 13, fontWeight: '800', marginBottom: 6 },
    blockerLine: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
    notice: {
      marginTop: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sm,
      padding: spacing.md,
    },
    noticeLine: { color: colors.warning, fontSize: 12, lineHeight: 18 },
    actions: {
      padding: spacing.lg,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.bgElevated,
    },
    actionHint: {
      color: colors.textDim,
      fontSize: 11,
      textAlign: 'center',
      marginTop: spacing.sm,
    },
  });
