/**
 * Book-styled building blocks for the Teacher section's post-login screens
 * (Dashboard, Secure Question Bank) — layered on top of the fixed
 * parchment/ink/gold palette + serif type already established for the auth
 * flow in `BookUI.tsx`, so a signed-in teacher's screens read as a
 * continuation of the same storybook rather than a palette swap.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { GOLD, INK, INK_DIM, PAPER } from './BookUI';
import { Tappable } from './anim';
import { serif } from '../lib/theme';

/* --------------------------------- cards ---------------------------------- */

export function BookCard({
  icon,
  title,
  children,
  actionLabel,
  actionIcon,
  onAction,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  children: React.ReactNode;
  actionLabel?: string;
  actionIcon?: keyof typeof Ionicons.glyphMap;
  onAction?: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardIcon}>
          <Ionicons name={icon} size={15} color={GOLD} />
        </View>
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      <View style={styles.cardBody}>{children}</View>
      {actionLabel && onAction ? (
        <Tappable onPress={onAction} style={styles.cardAction} pressScale={0.96} hoverScale={1.02}>
          {actionIcon ? <Ionicons name={actionIcon} size={13} color={INK} /> : null}
          <Text style={styles.cardActionText}>{actionLabel.toUpperCase()}</Text>
        </Tappable>
      ) : null}
    </View>
  );
}

export function BookMiniStat({ value, label }: { value: number | string; label: string }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniStatValue}>{value}</Text>
      <Text style={styles.miniStatLabel}>{label}</Text>
    </View>
  );
}

export function BookProgressBar({ ratio, label }: { ratio: number; label: string }) {
  const pct = Math.max(0, Math.min(1, ratio));
  return (
    <View style={styles.progressWrap}>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct * 100}%` }]} />
      </View>
      <Text style={styles.progressLabel}>
        {label} · {Math.round(pct * 100)}%
      </Text>
    </View>
  );
}

export function BookLogLine({ text, time }: { text: string; time: string }) {
  return (
    <View style={styles.logLine}>
      <View style={styles.logDot} />
      <Text style={styles.logText} numberOfLines={1}>
        {text}
      </Text>
      <Text style={styles.logTime}>{time}</Text>
    </View>
  );
}

/* ------------------------------- page flip --------------------------------- */

const FLIP_LEG_MS = 190;

/**
 * Drives a book-style page turn: rotate the current page edge-on
 * (invisible at ~90°), swap the underlying content while hidden, then
 * rotate the new content back into view. `flipTo` takes the state mutation
 * (e.g. `() => pager.setPage(page + 1)`) to run at the swap point.
 */
export function usePageFlip() {
  const rotate = useRef(new Animated.Value(0)).current;
  const [flipping, setFlipping] = useState(false);

  const flipTo = (advance: () => void) => {
    if (flipping) return;
    setFlipping(true);
    Animated.timing(rotate, {
      toValue: 1,
      duration: FLIP_LEG_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      advance();
      rotate.setValue(-1);
      Animated.timing(rotate, {
        toValue: 0,
        duration: FLIP_LEG_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => setFlipping(false));
    });
  };

  const rotateY = rotate.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ['85deg', '0deg', '-85deg'],
  });
  const scaleX = rotate.interpolate({
    inputRange: [-1, -0.5, 0, 0.5, 1],
    outputRange: [0.45, 0.78, 1, 0.78, 0.45],
  });
  const opacity = rotate.interpolate({
    inputRange: [-1, -0.6, 0, 0.6, 1],
    outputRange: [0.35, 0.9, 1, 0.9, 0.35],
  });

  return {
    flipTo,
    flipping,
    style: { opacity, transform: [{ perspective: 1200 }, { rotateY }, { scaleX }] },
  };
}

export function PageFlipArrows({
  page,
  pageCount,
  onPrev,
  onNext,
  disabled,
}: {
  page: number;
  pageCount: number;
  onPrev: () => void;
  onNext: () => void;
  disabled?: boolean;
}) {
  if (pageCount <= 1) return null;
  return (
    <View style={styles.arrowsRow}>
      <Tappable
        onPress={onPrev}
        disabled={disabled || page <= 1}
        style={[styles.arrowBtn, (disabled || page <= 1) && styles.arrowBtnOff]}
      >
        <Ionicons name="chevron-back" size={16} color={INK} />
      </Tappable>
      <Text style={styles.arrowPageText}>
        Page {page} of {pageCount}
      </Text>
      <Tappable
        onPress={onNext}
        disabled={disabled || page >= pageCount}
        style={[styles.arrowBtn, (disabled || page >= pageCount) && styles.arrowBtnOff]}
      >
        <Ionicons name="chevron-forward" size={16} color={INK} />
      </Tappable>
    </View>
  );
}

/* --------------------------------- styles --------------------------------- */

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(59,46,31,0.16)',
    borderRadius: 14,
    padding: 16,
    flex: 1,
    minWidth: 220,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  cardIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: `${GOLD}22`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontFamily: serif, fontWeight: '700', fontSize: 14, color: INK },
  cardBody: { gap: 8 },
  cardAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
    borderWidth: 1,
    borderColor: `${GOLD}66`,
    borderRadius: 999,
    paddingVertical: 8,
    backgroundColor: `${GOLD}14`,
  },
  cardActionText: { fontFamily: serif, fontSize: 11, fontWeight: '700', color: INK, letterSpacing: 0.8 },
  miniStat: { alignItems: 'flex-start' },
  miniStatValue: { fontFamily: serif, fontWeight: '800', fontSize: 22, color: INK },
  miniStatLabel: { fontFamily: serif, fontSize: 11, color: INK_DIM, marginTop: 1 },
  progressWrap: { marginTop: 2 },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(59,46,31,0.12)',
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: GOLD },
  progressLabel: { fontFamily: serif, fontSize: 11, color: INK_DIM, marginTop: 4 },
  logLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: GOLD },
  logText: { fontFamily: serif, fontSize: 12, color: INK, flex: 1 },
  logTime: { fontFamily: serif, fontSize: 10, color: INK_DIM },
  arrowsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginTop: 14,
  },
  arrowBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(59,46,31,0.25)',
    backgroundColor: PAPER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowBtnOff: { opacity: 0.35 },
  arrowPageText: { fontFamily: serif, fontSize: 11, color: INK_DIM, fontWeight: '700' },
});
