import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useRef, useState } from 'react';
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
import { EmptyState } from '../../components/UI';
import { shortHash, timeAgo } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { serif } from '../../lib/theme';
import { AuditEntry } from '../../lib/types';
import { useAdminIndex } from './useAdminIndex';

const SELF = 'Audit';
/** Rows per leaf — a spread (left + right) holds twice this many. */
const PER_LEAF = 6;
const PER_SPREAD = PER_LEAF * 2;

export default function AuditLogScreen() {
  const p = useArchivePalette();
  const { outerPad, sidebarMode } = useArchiveLayout();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(p), [p]);
  const [indexOpen, setIndexOpen] = useState(false);

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [spread, setSpread] = useState(0);
  const book = useRef<FlipBookHandle>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('audit_log')
      .select('*')
      .order('id', { ascending: false })
      .limit(60);
    setEntries((data as AuditEntry[] | null) ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const { items, onSelect } = useAdminIndex({
    active: SELF,
    onBeforeSelect: () => setIndexOpen(false),
  });

  // The newest entries (already ordered newest-first by the query) open the book.
  const spreadCount = Math.max(1, Math.ceil(entries.length / PER_SPREAD));
  const current = Math.min(spread, spreadCount - 1);
  const start = current * PER_SPREAD;
  const leftEntries = entries.slice(start, start + PER_LEAF);
  const rightEntries = entries.slice(start + PER_LEAF, start + PER_SPREAD);

  const renderSide = useCallback(
    (spreadIndex: number, side: 'left' | 'right') => {
      const base = spreadIndex * PER_SPREAD + (side === 'right' ? PER_LEAF : 0);
      const rows = entries.slice(base, base + PER_LEAF);
      if (side === 'left') {
        return (
          <PageScroll>
            <PageTitle center size={[19, 27]}>
              Audit Log
            </PageTitle>
            <View style={styles.banner}>
              <Ionicons name="link" size={14} color={p.gold} />
              <Text style={styles.bannerText}>
                Hash-chained & append-only: every entry&apos;s hash covers the previous one.
                Tampering with any record breaks every hash after it.
              </Text>
            </View>
            <Rule ornament gap={12} />
            {rows.length === 0 ? (
              <EmptyState
                icon="reader-outline"
                title="No audit entries yet"
                subtitle="Every seal, co-sign, print and custody scan is recorded here permanently."
              />
            ) : (
              rows.map((entry) => <AuditEntryRow key={entry.id} entry={entry} palette={p} />)
            )}
          </PageScroll>
        );
      }
      return (
        <PageScroll>
          <PageTitle center size={[19, 27]}>
            Continued
          </PageTitle>
          <Rule ornament gap={12} />
          {rows.length === 0 ? (
            <Text style={styles.emptyNote}>No further entries on this spread.</Text>
          ) : (
            rows.map((entry) => <AuditEntryRow key={entry.id} entry={entry} palette={p} />)
          )}
        </PageScroll>
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, p, styles]
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ArchiveBackground />
      <ArchiveHeader
        title="SECUREAI EXAM ARCHIVE"
        shortTitle="ARCHIVE"
        subtitle="Admin · Audit"
        onMenu={sidebarMode === 'overlay' ? () => setIndexOpen(true) : undefined}
      />

      <View style={styles.body}>
        {sidebarMode === 'overlay' ? null : (
          <ArchiveSidebar items={items} activeRoute={SELF} onSelect={onSelect} />
        )}

        <View style={[styles.stage, { paddingHorizontal: outerPad }]}>
          <View style={styles.bookArea}>
            <View style={styles.bookRow}>
              <View style={styles.arrowSlot}>
                <BookArrow
                  direction="prev"
                  label="Previous audit spread"
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
                  leftFolio={`Entries ${entries.length ? start + 1 : 0}–${start + leftEntries.length}`}
                  rightFolio={
                    rightEntries.length
                      ? `Entries ${start + PER_LEAF + 1}–${start + PER_LEAF + rightEntries.length}`
                      : 'End of spread'
                  }
                />
              </View>

              <View style={styles.arrowSlot}>
                <BookArrow
                  direction="next"
                  label="Next audit spread"
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

function AuditEntryRow({ entry, palette: p }: { entry: AuditEntry; palette: ArchivePalette }) {
  const styles = useMemo(() => makeStyles(p), [p]);
  const title =
    entry.details && typeof entry.details.title === 'string' ? String(entry.details.title) : null;
  return (
    <View style={styles.entry}>
      <View style={styles.entryHead}>
        <Text style={styles.action} numberOfLines={1}>
          {entry.action}
        </Text>
        <Text style={styles.time}>{timeAgo(entry.created_at)}</Text>
      </View>
      <Text style={styles.detail}>
        {entry.actor_name ?? 'system'} · {entry.entity}
        {title ? ` · "${title}"` : ''}
      </Text>
      <View style={styles.hashRow}>
        <Text style={styles.hash}>{shortHash(entry.prev_hash)}</Text>
        <Ionicons name="arrow-forward" size={11} color={p.gold} />
        <Text style={styles.hash}>{shortHash(entry.hash)}</Text>
      </View>
      <View style={styles.entryRule} />
    </View>
  );
}

const makeStyles = (p: ArchivePalette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.backdrop },
    body: { flex: 1, flexDirection: 'row' },
    stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
    bookArea: { width: '100%', alignItems: 'center' },
    bookRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, width: '100%', maxWidth: 1180 },
    arrowSlot: { paddingTop: 14 },
    bookWrap: { flex: 1, alignItems: 'center' },

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
    bannerText: { flex: 1, fontFamily: serif, fontSize: 11, lineHeight: 16, color: p.inkDim },

    entry: { marginBottom: 12 },
    entryHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    action: { flex: 1, fontFamily: serif, fontSize: 13, fontWeight: '700', letterSpacing: 0.3, color: p.ink },
    time: { fontFamily: serif, fontSize: 10.5, color: p.inkFaint },
    detail: { fontFamily: serif, fontSize: 11.5, color: p.inkDim, marginTop: 3 },
    hashRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 7 },
    hash: { fontFamily: 'monospace', fontSize: 9.5, color: p.inkFaint },
    entryRule: { height: 1, backgroundColor: p.rule, marginTop: 12 },
    emptyNote: {
      fontFamily: serif,
      fontSize: 12,
      color: p.inkFaint,
      fontStyle: 'italic',
      textAlign: 'center',
      marginTop: 20,
    },

    pageIndicator: { alignItems: 'center', marginTop: 12 },
  });
