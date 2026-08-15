/**
 * Account Approvals — the one place an Admin approves or declines a
 * teacher/paper-setter sign-up. Until approved here, the account cannot use
 * the app at all: the crypto service's requireRole() refuses every request
 * for a non-approved profile (server/src/index.js), and Supabase RLS closes
 * the same gate for direct reads (get_my_role() returns null for a
 * pending/rejected profile — see supabase/patch-9-account-approval.sql).
 *
 * Styled as a leaf of the same examination archive every other Admin screen
 * lives in, rather than the plain dashboard chrome — so it reads as part of
 * the book, not a bolted-on settings page.
 */
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  useArchiveLayout,
  useArchivePalette,
} from '../../components/ArchiveBook';
import { BookButton } from '../../components/ArchiveControls';
import { EmptyState } from '../../components/UI';
import { showAlert } from '../../lib/alert';
import {
  addSetterDomains,
  approveAccount,
  fetchApprovedSetters,
  fetchPendingAccounts,
  rejectAccount,
} from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { serif } from '../../lib/theme';
import { Profile, ROLE_LABEL } from '../../lib/types';
import { useAdminIndex } from './useAdminIndex';

const SELF = 'Approvals';

/** Same fixed exam-category list offered at sign-up (SignUpScreen.tsx) — an admin can grant any of these. */
const ALL_DOMAINS = [
  'Banking / Finance',
  'Civil services',
  'Defence',
  'Design / Architecture',
  'Engineering / Science entrance',
  'Law entrance',
  'Management entrance',
  'Medical / Health science',
  'Professional / Technical',
  'Railways',
  'School boards',
  'SSC',
  'State entrance',
  'Teaching / Research',
  'University entrance',
];

export default function AdminApprovalsScreen() {
  const p = useArchivePalette();
  const { outerPad, sidebarMode } = useArchiveLayout();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(p), [p]);
  const [indexOpen, setIndexOpen] = useState(false);

  const [accounts, setAccounts] = useState<Profile[]>([]);
  const [setters, setSetters] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Grant-domains popup for an already-approved paper setter.
  const [domainTarget, setDomainTarget] = useState<Profile | null>(null);
  const [domainPicks, setDomainPicks] = useState<string[]>([]);
  const [grantingDomains, setGrantingDomains] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ accounts: rows }, { setters: setterRows }] = await Promise.all([
        fetchPendingAccounts(),
        fetchApprovedSetters(),
      ]);
      setAccounts(rows);
      setSetters(setterRows);
      setError(null);
    } catch (e) {
      // Most likely cause: patch-9-account-approval.sql has not been run yet
      // (profiles.status does not exist), which the server reports plainly.
      setError(e instanceof Error ? e.message : 'Could not load pending accounts');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    const channel = supabase
      .channel('approvals-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'setter_domains' }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const openDomainPicker = (setter: Profile) => {
    setDomainTarget(setter);
    setDomainPicks([]);
  };

  const grantDomains = async () => {
    if (!domainTarget || domainPicks.length === 0) return;
    setGrantingDomains(true);
    try {
      await addSetterDomains(domainTarget.id, domainPicks);
      setDomainTarget(null);
      setDomainPicks([]);
      void load();
    } catch (e) {
      showAlert('Could not grant domains', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setGrantingDomains(false);
    }
  };

  const approve = async (account: Profile) => {
    setBusyId(account.id);
    try {
      await approveAccount(account.id);
      setAccounts((prev) => prev.filter((a) => a.id !== account.id));
    } catch (e) {
      showAlert('Could not approve', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusyId(null);
    }
  };

  const reject = (account: Profile) => {
    showAlert(
      'Reject this account?',
      `${account.full_name} (${ROLE_LABEL[account.role]}) will be deleted outright and can sign up again later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusyId(account.id);
              try {
                await rejectAccount(account.id);
                setAccounts((prev) => prev.filter((a) => a.id !== account.id));
              } catch (e) {
                showAlert('Could not reject', e instanceof Error ? e.message : 'Unknown error');
              } finally {
                setBusyId(null);
              }
            })();
          },
        },
      ]
    );
  };

  const { items, onSelect } = useAdminIndex({
    active: SELF,
    onBeforeSelect: () => setIndexOpen(false),
  });

  const teacherCount = accounts.filter((a) => a.role === 'teacher').length;
  const setterCount = accounts.filter((a) => a.role === 'paper_setter').length;

  const leftPage = (
    <PageScroll>
      <PageTitle center size={[19, 27]}>
        Account Approvals
      </PageTitle>
      <View style={styles.banner}>
        <Ionicons name="shield-checkmark-outline" size={14} color={p.gold} />
        <Text style={styles.bannerText}>
          A new teacher or paper-setter account cannot sign in until approved here. Nothing
          created invite-only (admin, invigilator) ever needs approval.
        </Text>
      </View>
      <Rule ornament gap={12} />

      <View style={styles.ledger}>
        <LedgerRow
          icon="hourglass-outline"
          label="Awaiting approval"
          value={accounts.length}
          tone={accounts.length > 0 ? p.warning : p.success}
          palette={p}
        />
        <LedgerRow icon="school-outline" label="Teachers" value={teacherCount} tone={p.info} palette={p} />
        <LedgerRow
          icon="create-outline"
          label="Paper setters"
          value={setterCount}
          tone={p.gold}
          palette={p}
        />
      </View>

      <Rule ornament gap={16} />
      <Text style={styles.footnote}>
        Approving grants immediate access. Rejecting deletes the account outright — the person
        can register again later if it was declined by mistake.
      </Text>

      <Rule ornament gap={16} />
      <Text style={styles.sectionHeading}>Paper Setters — Exam Categories</Text>
      <Text style={styles.footnote}>
        Each setter picks 2 exam categories at sign-up and can only compose papers for exams in
        those categories — exams outside them never appear in their account. Grant more here if
        their workload grows.
      </Text>
      {setters.length === 0 ? (
        <Text style={styles.emptyNote}>No approved paper setters yet.</Text>
      ) : (
        setters.map((s) => (
          <View key={s.id} style={styles.setterRow}>
            <View style={styles.flex}>
              <Text style={styles.entryName} numberOfLines={1}>
                {s.full_name}
              </Text>
              <View style={styles.domainChips}>
                {(s.domains ?? []).length === 0 ? (
                  <Text style={styles.domainEmpty}>No domains</Text>
                ) : (
                  s.domains?.map((d) => (
                    <View key={d} style={styles.domainChip}>
                      <Text style={styles.domainChipText}>{d}</Text>
                    </View>
                  ))
                )}
              </View>
            </View>
            <BookButton title="+ Domain" icon="add-outline" onPress={() => openDomainPicker(s)} />
          </View>
        ))
      )}
    </PageScroll>
  );

  const rightPage = (
    <PageScroll>
      <PageTitle center size={[19, 27]}>
        Awaiting Approval
      </PageTitle>
      <Rule ornament gap={12} />

      {error ? (
        <View style={[styles.banner, styles.bannerDanger]}>
          <Ionicons name="warning-outline" size={14} color={p.danger} />
          <Text style={[styles.bannerText, { color: p.danger }]}>{error}</Text>
        </View>
      ) : loading ? (
        <Text style={styles.emptyNote}>Loading…</Text>
      ) : accounts.length === 0 ? (
        <EmptyState
          icon="checkmark-done-outline"
          title="Nothing waiting"
          subtitle="Every teacher and paper-setter sign-up has been approved or declined."
        />
      ) : (
        accounts.map((a) => (
          <View key={a.id} style={styles.entry}>
            <View style={styles.entryHead}>
              <Text style={styles.entryName} numberOfLines={1}>
                {a.full_name}
              </Text>
              <Text style={styles.entryRole}>{ROLE_LABEL[a.role]}</Text>
            </View>
            <Text style={styles.entryMeta}>Requested {new Date(a.created_at).toLocaleString()}</Text>
            {a.role === 'paper_setter' ? (
              <View style={styles.domainChips}>
                {(a.domains ?? []).length === 0 ? (
                  <Text style={styles.domainEmpty}>No domains chosen</Text>
                ) : (
                  a.domains?.map((d) => (
                    <View key={d} style={styles.domainChip}>
                      <Text style={styles.domainChipText}>{d}</Text>
                    </View>
                  ))
                )}
              </View>
            ) : null}
            <View style={styles.entryActions}>
              <BookButton
                title="Approve"
                icon="checkmark-outline"
                variant="gold"
                onPress={() => void approve(a)}
                loading={busyId === a.id}
              />
              <BookButton
                title="Reject"
                icon="close-outline"
                variant="danger"
                onPress={() => reject(a)}
                loading={busyId === a.id}
              />
            </View>
            <View style={styles.entryRule} />
          </View>
        ))
      )}
    </PageScroll>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ArchiveBackground />
      <ArchiveHeader
        title="SECUREAI EXAM ARCHIVE"
        shortTitle="ARCHIVE"
        subtitle="Admin · Approvals"
        onMenu={sidebarMode === 'overlay' ? () => setIndexOpen(true) : undefined}
      />

      <View style={styles.body}>
        {sidebarMode === 'overlay' ? null : (
          <ArchiveSidebar items={items} activeRoute={SELF} onSelect={onSelect} />
        )}

        <View style={[styles.stage, { paddingHorizontal: outerPad }]}>
          <OpenBook
            left={leftPage}
            right={rightPage}
            leftFolio="Approval policy"
            rightFolio={accounts.length ? `${accounts.length} waiting` : 'All clear'}
          />
        </View>
      </View>

      <ArchiveIndexOverlay
        visible={indexOpen}
        items={items}
        activeRoute={SELF}
        onSelect={onSelect}
        onClose={() => setIndexOpen(false)}
      />

      <Modal
        transparent
        visible={!!domainTarget}
        animationType="fade"
        onRequestClose={() => setDomainTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Grant domains — {domainTarget?.full_name}</Text>
            <Text style={styles.modalSubtitle}>
              Currently: {(domainTarget?.domains ?? []).join(', ') || 'none'}
            </Text>
            <View style={styles.domainChips}>
              {ALL_DOMAINS.filter((d) => !domainTarget?.domains?.includes(d)).map((d) => {
                const picked = domainPicks.includes(d);
                return (
                  <Pressable
                    key={d}
                    onPress={() =>
                      setDomainPicks((prev) =>
                        prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
                      )
                    }
                    style={[styles.domainChip, picked && styles.domainChipPicked]}
                  >
                    <Text style={[styles.domainChipText, picked && styles.domainChipTextPicked]}>{d}</Text>
                  </Pressable>
                );
              })}
            </View>
            {ALL_DOMAINS.every((d) => domainTarget?.domains?.includes(d)) ? (
              <Text style={styles.footnote}>Already holds every domain.</Text>
            ) : null}
            <View style={styles.entryActions}>
              <BookButton
                title="Grant"
                icon="checkmark-outline"
                variant="gold"
                onPress={() => void grantDomains()}
                loading={grantingDomains}
                disabled={domainPicks.length === 0}
              />
              <BookButton title="Cancel" icon="close-outline" onPress={() => setDomainTarget(null)} />
            </View>
          </View>
        </View>
      </Modal>
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

    banner: {
      flexDirection: 'row',
      gap: 8,
      alignItems: 'flex-start',
      backgroundColor: `${p.gold}14`,
      borderColor: `${p.gold}44`,
      borderWidth: 1,
      borderRadius: 4,
      padding: 10,
      marginTop: 4,
    },
    bannerDanger: { backgroundColor: `${p.danger}14`, borderColor: `${p.danger}44` },
    bannerText: { flex: 1, fontFamily: serif, fontSize: 11, lineHeight: 16, color: p.inkDim },

    ledger: {
      marginTop: 16,
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

    footnote: { fontFamily: serif, fontSize: 11, color: p.inkFaint, fontStyle: 'italic', lineHeight: 16 },

    entry: { marginBottom: 14 },
    entryHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    entryName: { flex: 1, fontFamily: serif, fontSize: 14, fontWeight: '700', color: p.ink },
    entryRole: {
      fontFamily: serif,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: p.gold,
    },
    entryMeta: { fontFamily: serif, fontSize: 11, color: p.inkFaint, marginTop: 2 },
    entryActions: { flexDirection: 'row', gap: 8, marginTop: 9 },
    entryRule: { height: 1, backgroundColor: p.rule, marginTop: 14 },

    emptyNote: {
      fontFamily: serif,
      fontSize: 12,
      color: p.inkFaint,
      fontStyle: 'italic',
      textAlign: 'center',
      marginTop: 20,
    },

    sectionHeading: { fontFamily: serif, fontSize: 14, fontWeight: '700', color: p.ink, marginBottom: 6 },

    domainChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
    domainChip: {
      borderWidth: 1,
      borderColor: p.gold,
      backgroundColor: `${p.gold}14`,
      borderRadius: 12,
      paddingVertical: 4,
      paddingHorizontal: 10,
    },
    domainChipPicked: { backgroundColor: `${p.gold}44` },
    domainChipText: { fontFamily: serif, fontSize: 10.5, fontWeight: '700', color: p.gold },
    domainChipTextPicked: { color: p.ink },
    domainEmpty: { fontFamily: serif, fontSize: 11, color: p.inkFaint, fontStyle: 'italic' },

    setterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      marginTop: 12,
    },

    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'center',
      padding: 24,
    },
    modalCard: {
      backgroundColor: p.page,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: p.rule,
      padding: 18,
    },
    modalTitle: { fontFamily: serif, fontSize: 15, fontWeight: '700', color: p.ink, marginBottom: 4 },
    modalSubtitle: { fontFamily: serif, fontSize: 11.5, color: p.inkDim, marginBottom: 10 },
  });
