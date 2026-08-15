import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
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
} from '../../components/ArchiveBook';
import { KeyBlackboard, Seal } from '../../components/ArchiveControls';
import { usePrintPreview } from '../../context/PrintPreviewContext';
import { showAlert } from '../../lib/alert';
import { cosignPaper, printCopies } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { serif } from '../../lib/theme';
import { Paper } from '../../lib/types';
import { useAdminIndex } from './useAdminIndex';

const SELF = 'Papers';

export default function AdminPapersScreen() {
  const p = useArchivePalette();
  const { stacked, outerPad, sidebarMode, pageWidth } = useArchiveLayout();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(p), [p]);
  const navigation = useNavigation<{ navigate: (screen: string) => void }>();
  const { setLastPrint } = usePrintPreview();

  const [papers, setPapers] = useState<Paper[]>([]);
  const [copyCounts, setCopyCounts] = useState<Record<string, number>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [indexOpen, setIndexOpen] = useState(false);

  const [cosignTarget, setCosignTarget] = useState<Paper | null>(null);
  const [printTarget, setPrintTarget] = useState<Paper | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    const [{ data: paperRows, error: pErr }, { data: copyRows }] = await Promise.all([
      supabase
        .from('papers')
        .select('*, setter:profiles(full_name), exam:exams!papers_exam_id_fkey(name)')
        .order('created_at', { ascending: false }),
      supabase.from('paper_copies').select('paper_id'),
    ]);
    if (pErr) {
      console.error('papers query failed:', pErr);
      showAlert('Could not load papers', pErr.message);
    }
    setPapers((paperRows as Paper[] | null) ?? []);

    const counts: Record<string, number> = {};
    for (const row of (copyRows as { paper_id: string }[] | null) ?? []) {
      counts[row.paper_id] = (counts[row.paper_id] ?? 0) + 1;
    }
    setCopyCounts(counts);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // Live: see papers arrive for co-signature the moment a setter seals them.
  useEffect(() => {
    const channel = supabase
      .channel('papers-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'papers' }, () => void load())
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

  const handleCosign = async (values: Record<string, string>) => {
    const passphrase = values.passphrase ?? '';
    if (passphrase.length < 8) {
      showAlert('Weak passphrase', 'Use at least 8 characters. You will need it at the print ceremony.');
      return;
    }
    if (!cosignTarget) return;
    setWorking(true);
    try {
      await cosignPaper(cosignTarget.id, passphrase);
      setCosignTarget(null);
      showAlert(
        'Co-signed 🛡️',
        "Dual control is now active: this paper cannot be decrypted without BOTH your passphrase and the setter's. The setter sees the status change live."
      );
      void load();
    } catch (e) {
      showAlert('Co-sign failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setWorking(false);
    }
  };

  const handlePrint = async (values: Record<string, string>) => {
    if (!printTarget) return;
    const setterPass = values.setterPassphrase ?? '';
    const adminPass = values.adminPassphrase ?? '';
    const copies = parseInt(values.copies ?? '', 10);
    const press = (values.press ?? '').trim();

    if (!setterPass || !adminPass) {
      showAlert('Two-person rule', 'Both the Setter and Admin passphrases are required.');
      return;
    }
    if (!copies || copies < 1) {
      showAlert('Invalid copy count', 'Enter how many copies to print (1 or more).');
      return;
    }
    if (!press) {
      showAlert('Missing press name', 'Enter the name of the printing press.');
      return;
    }

    setWorking(true);
    try {
      const result = await printCopies(printTarget.id, setterPass, adminPass, copies, press);
      setPrintTarget(null);
      setLastPrint(result);
      void load();
      showAlert(
        'Print ceremony complete 🖨️',
        `${result.copies} copies minted. Each carries a signed QR + invisible fingerprint. Opening the print preview…`,
        [{ text: 'View & Print', onPress: () => navigation.navigate('PrintPreview') }]
      );
    } catch (e) {
      showAlert('Ceremony failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setWorking(false);
    }
  };

  const { items, onSelect } = useAdminIndex({
    active: SELF,
    onBeforeSelect: () => setIndexOpen(false),
  });

  const pending = papers.filter((p2) => p2.status !== 'printed' && p2.status !== 'distributed' && p2.status !== 'completed');
  const printed = papers.filter((p2) => p2.status === 'printed' || p2.status === 'distributed' || p2.status === 'completed');

  const statusLabel = (status: Paper['status']) => {
    if (status === 'draft') return 'Draft';
    if (status === 'sealed') return 'Awaiting Co-sign';
    if (status === 'sealed_dual') return 'Awaiting Printing';
    return status.replace(/_/g, ' ');
  };

  /* -------------------------------- pages -------------------------------- */

  const leftPage = (
    <LeafScroll stacked={stacked}>
      <PageTitle center size={[19, 27]}>
        Papers in Progress
      </PageTitle>
      <Rule ornament gap={12} />

      {pending.length === 0 ? (
        <Text style={styles.emptyText}>
          No papers awaiting action. Papers sealed by setters arrive here for co-signature in
          real time.
        </Text>
      ) : (
        pending.map((item) => (
          <View key={item.id} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={[styles.cardTitle, { fontSize: fluid(pageWidth, 12.5, 14) }]} numberOfLines={1}>
                {item.title}
              </Text>
              <Seal label={statusLabel(item.status).toUpperCase()} tone={item.status === 'sealed' ? p.warning : p.info} />
            </View>
            <Text style={styles.cardMeta}>
              {item.exam?.name ? `${item.exam.name} · ` : ''}
              {item.subject} · {item.question_count} questions · by{' '}
              {item.setter?.full_name ?? 'Unknown'} · {timeAgo(item.created_at)}
            </Text>
            {copyCounts[item.id] ? (
              <Text style={styles.copies}>{copyCounts[item.id]} copies in custody</Text>
            ) : null}

            {item.status === 'sealed' && (
              <ActionButton
                label="Co-sign (Key Share 2/2)"
                icon="shield-checkmark-outline"
                palette={p}
                onPress={() => setCosignTarget(item)}
              />
            )}
            {item.status === 'sealed_dual' && (
              <ActionButton
                label="Print Ceremony"
                icon="print-outline"
                palette={p}
                tone={p.success}
                onPress={() => setPrintTarget(item)}
              />
            )}
            {item.status === 'draft' && (
              <Text style={styles.hint}>Setter has not sealed this draft yet.</Text>
            )}
          </View>
        ))
      )}
    </LeafScroll>
  );

  const rightPage = (
    <LeafScroll stacked={stacked}>
      <PageTitle center size={[19, 27]}>
        Printed Papers
      </PageTitle>
      <Rule ornament gap={12} />

      {printed.length === 0 ? (
        <Text style={styles.emptyText}>
          No papers have completed the printing ceremony yet.
        </Text>
      ) : (
        printed.map((item) => (
          <View key={item.id} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={[styles.cardTitle, { fontSize: fluid(pageWidth, 12.5, 14) }]} numberOfLines={1}>
                {item.title}
              </Text>
              <Seal label={statusLabel(item.status).toUpperCase()} tone={p.success} />
            </View>
            <Text style={styles.cardMeta}>
              {item.exam?.name ? `${item.exam.name} · ` : ''}
              {item.subject} · {item.question_count} questions · by{' '}
              {item.setter?.full_name ?? 'Unknown'} · {timeAgo(item.created_at)}
            </Text>
            {copyCounts[item.id] ? (
              <Text style={styles.copies}>{copyCounts[item.id]} copies in custody</Text>
            ) : null}
          </View>
        ))
      )}
    </LeafScroll>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ArchiveBackground />
      <ArchiveHeader
        title="SECUREAI EXAM ARCHIVE"
        shortTitle="ARCHIVE"
        subtitle="Admin · Papers"
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
            <OpenBook left={leftPage} right={rightPage} leftFolio="In progress" rightFolio="Printed" />
          </ScrollView>
        ) : (
          <View style={[styles.stage, { paddingHorizontal: outerPad }]}>
            <OpenBook left={leftPage} right={rightPage} leftFolio="In progress" rightFolio="Printed" />
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

      <KeyBlackboard
        visible={!!cosignTarget}
        title="Co-Sign Ceremony"
        subtitle={`Co-signing "${cosignTarget?.title ?? ''}". Your key wraps the second half of the encryption. After this, decryption requires both you and the setter.`}
        fields={[{ key: 'passphrase', label: 'Admin paraphrase key (min 8 chars)', placeholder: 'Secret passphrase' }]}
        submitLabel="Co-Sign Paper"
        busy={working}
        onSubmit={(values) => void handleCosign(values)}
        onClose={() => setCosignTarget(null)}
      />

      <KeyBlackboard
        visible={!!printTarget}
        title="Printing Ceremony"
        subtitle={`Decrypting "${printTarget?.title ?? ''}" requires BOTH keys, entered together. Each printed copy receives a signed QR code and an invisible AI fingerprint.`}
        fields={[
          { key: 'setterPassphrase', label: "Paper Setter's paraphrase key" },
          { key: 'adminPassphrase', label: "Admin's paraphrase key" },
          {
            key: 'copies',
            label: 'Number of copies to print',
            placeholder: '10',
            secure: false,
            keyboardType: 'number-pad',
          },
          {
            key: 'press',
            label: 'Printing press name',
            placeholder: 'Central Government Press',
            secure: false,
          },
        ]}
        submitLabel="Decrypt & Print Copies"
        busy={working}
        onSubmit={(values) => void handlePrint(values)}
        onClose={() => setPrintTarget(null)}
      />
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
  tone,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  palette: ArchivePalette;
  tone?: string;
}) {
  const styles = useMemo(() => makeStyles(p), [p]);
  const accent = tone ?? p.gold;
  return (
    <View style={[styles.actionBtn, { borderColor: accent }]}>
      <Ionicons name={icon} size={13} color={accent} />
      <Text style={[styles.actionBtnText, { color: accent }]} onPress={onPress}>
        {label}
      </Text>
    </View>
  );
}

/* --------------------------------- styles --------------------------------- */

const makeStyles = (p: ArchivePalette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: p.backdrop },
    body: { flex: 1, flexDirection: 'row' },
    scrollContent: { paddingVertical: 16 },
    stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },

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
    copies: { fontFamily: serif, fontSize: 10.5, color: p.gold, marginTop: 3, fontWeight: '700' },
    hint: { fontFamily: serif, fontSize: 11, color: p.inkFaint, fontStyle: 'italic', marginTop: 8 },

    actionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      borderWidth: 1,
      borderRadius: 3,
      paddingHorizontal: 10,
      paddingVertical: 6,
      marginTop: 9,
    },
    actionBtnText: { fontFamily: serif, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  });
