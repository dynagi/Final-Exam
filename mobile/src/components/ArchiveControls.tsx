/**
 * ArchiveControls — the interactive furniture that lives on a book page:
 * centred headings, vintage pills and plaques, the printed archive note, the
 * book-page paginator, and the two "physical object" pickers.
 *
 * The pickers are deliberately not dropdowns. Choosing an examination unfolds
 * an old pamphlet out of the page; choosing a teacher raises a classroom
 * blackboard. Both are Modals so they float above the book, and both honour
 * reduced motion by snapping to their final state.
 *
 * Everything here reads its colours from ArchiveBook's palette, so the Pool
 * page and the Dashboard stay one visual system.
 */
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { serif } from '../lib/theme';
import { pageWindow } from '../lib/usePagination';
import {
  ArchivePalette,
  PageGrain,
  fluid,
  useArchiveLayout,
  useArchivePalette,
  useReducedMotion,
} from './ArchiveBook';

/* -------------------------------- basics ---------------------------------- */

/**
 * A small wax-stamp style status seal. Shared across the archive screens.
 * `scale` lets a page that is shrinking its type to fit take the seal with it.
 */
export function Seal({ label, tone, scale = 1 }: { label: string; tone: string; scale?: number }) {
  if (scale === 1) {
    return (
      <View style={[styles.seal, { borderColor: tone, backgroundColor: `${tone}14` }]}>
        <View style={[styles.sealDot, { backgroundColor: tone }]} />
        <Text style={[styles.sealText, { color: tone }]}>{label}</Text>
      </View>
    );
  }
  const s = (n: number) => Math.round(n * scale * 10) / 10;
  return (
    <View
      style={[
        styles.seal,
        {
          borderColor: tone,
          backgroundColor: `${tone}14`,
          paddingHorizontal: s(9),
          paddingVertical: s(3),
          gap: s(5),
        },
      ]}
    >
      <View
        style={[styles.sealDot, { backgroundColor: tone, width: s(5), height: s(5), borderRadius: s(3) }]}
      />
      <Text style={[styles.sealText, { color: tone, fontSize: s(9.5) }]}>{label}</Text>
    </View>
  );
}

/** Centred section heading, set between two short rules like a printed index. */
export function CenteredHeading({ children }: { children: React.ReactNode }) {
  const p = useArchivePalette();
  const { pageWidth } = useArchiveLayout();
  return (
    <View style={styles.headingRow}>
      <View style={[styles.headingRule, { backgroundColor: p.rule }]} />
      <Text
        style={[styles.heading, { color: p.ink, fontSize: fluid(pageWidth, 11.5, 14) }]}
        numberOfLines={1}
      >
        {children}
      </Text>
      <View style={[styles.headingRule, { backgroundColor: p.rule }]} />
    </View>
  );
}

/**
 * The centred brass plaque that opens a picker. Shows the current selection,
 * so the page still reads as a filter summary when nothing is open.
 */
export function PlaqueButton({
  value,
  onPress,
  icon,
  accessibilityLabel,
}: {
  value: string;
  onPress: () => void;
  icon: keyof typeof Ionicons.glyphMap;
  accessibilityLabel: string;
}) {
  const p = useArchivePalette();
  const { pageWidth } = useArchiveLayout();
  const t = useRef(new Animated.Value(0)).current;
  const [focused, setFocused] = useState(false);
  const to = (v: number) =>
    Animated.spring(t, { toValue: v, useNativeDriver: true, speed: 32, bounciness: 6 }).start();
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, -2] });

  return (
    <Animated.View style={[styles.plaqueWrap, { transform: [{ translateY }] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        onPressIn={() => to(1)}
        onPressOut={() => to(0)}
        {...({
          onHoverIn: () => to(1),
          onHoverOut: () => to(0),
          onFocus: () => setFocused(true),
          onBlur: () => setFocused(false),
        } as object)}
        style={[
          styles.plaque,
          {
            backgroundColor: p.pageShade,
            borderColor: focused ? p.gold : `${p.gold}88`,
            borderWidth: focused ? 2 : 1,
          },
        ]}
      >
        <Ionicons name={icon} size={14} color={p.gold} />
        <Text
          style={[styles.plaqueText, { color: p.ink, fontSize: fluid(pageWidth, 12, 14) }]}
          numberOfLines={1}
        >
          {value}
        </Text>
        <Ionicons name="chevron-down" size={13} color={p.inkDim} />
      </Pressable>
    </Animated.View>
  );
}

/** Wrapped, centred row of vintage pills — subjects, types, statuses. */
export function PillRow({
  options,
  value,
  onChange,
}: {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const p = useArchivePalette();
  return (
    <View style={styles.pillRow}>
      {options.map((option) => (
        <Pill key={option} label={option} active={option === value} onPress={() => onChange(option)} palette={p} />
      ))}
    </View>
  );
}

function Pill({
  label,
  active,
  onPress,
  palette: p,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  palette: ArchivePalette;
}) {
  const t = useRef(new Animated.Value(0)).current;
  const [focused, setFocused] = useState(false);
  const to = (v: number) =>
    Animated.spring(t, { toValue: v, useNativeDriver: true, speed: 34, bounciness: 7 }).start();
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, -2] });

  return (
    <Animated.View style={{ transform: [{ translateY }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: active }}
        onPress={onPress}
        onPressIn={() => to(1)}
        onPressOut={() => to(0)}
        {...({
          onHoverIn: () => to(1),
          onHoverOut: () => to(0),
          onFocus: () => setFocused(true),
          onBlur: () => setFocused(false),
        } as object)}
        style={[
          styles.pill,
          {
            backgroundColor: active ? p.goldSoft : 'transparent',
            borderColor: active ? p.gold : focused ? p.gold : p.rule,
          },
        ]}
      >
        <Text
          style={[styles.pillText, { color: active ? p.ink : p.inkDim }, active && styles.pillTextActive]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/** A small printed note in the page margin — the archive's running tally. */
export function ArchiveNote({ children }: { children: React.ReactNode }) {
  const p = useArchivePalette();
  return (
    <View style={[styles.note, { borderColor: p.rule, backgroundColor: `${p.pageShade}99` }]}>
      {children}
    </View>
  );
}

export function NoteLine({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  const p = useArchivePalette();
  return (
    <View style={styles.noteLine}>
      <Text style={[styles.noteValue, { color: tone ?? p.ink }]}>{value}</Text>
      <Text style={[styles.noteLabel, { color: p.inkDim }]}>{label}</Text>
    </View>
  );
}

/* ------------------------------ paginator --------------------------------- */

/**
 * The book's own paginator, pinned to the top-left of the right leaf.
 * `onTurn` receives the direction so the caller can drive the page-turn
 * animation and swap the rows at the right moment.
 */
export function BookPagination({
  page,
  pageCount,
  from,
  to,
  total,
  pageSize,
  onTurn,
  onPageSize,
  sizes,
}: {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
  pageSize: number;
  onTurn: (nextPage: number, direction: 1 | -1) => void;
  onPageSize: (n: number) => void;
  sizes: readonly number[];
}) {
  const p = useArchivePalette();
  const goto = (next: number) => {
    if (next === page || next < 1 || next > pageCount) return;
    onTurn(next, next > page ? 1 : -1);
  };

  return (
    <View style={styles.pager}>
      <View style={styles.pagerRow}>
        <PagerBtn icon="chevron-back" label="Previous page" disabled={page <= 1} onPress={() => goto(page - 1)} palette={p} />
        {pageCount > 1
          ? pageWindow(page, pageCount).map((n, i) =>
              n === null ? (
                <Text key={`gap-${i}`} style={[styles.pagerGap, { color: p.inkFaint }]}>
                  …
                </Text>
              ) : (
                <PagerNum key={n} n={n} active={n === page} onPress={() => goto(n)} palette={p} />
              )
            )
          : null}
        <PagerBtn
          icon="chevron-forward"
          label="Next page"
          disabled={page >= pageCount}
          onPress={() => goto(page + 1)}
          palette={p}
        />
      </View>
      <View style={styles.pagerFoot}>
        <Text style={[styles.pagerRange, { color: p.inkFaint }]}>
          {total === 0 ? 'No questions' : `Showing ${from}–${to} of ${total}`}
        </Text>
        <View style={styles.pagerSizes}>
          {sizes.map((s) => (
            <Pressable
              key={s}
              accessibilityRole="button"
              accessibilityLabel={`${s === 0 ? 'All' : s} per page`}
              accessibilityState={{ selected: s === pageSize }}
              onPress={() => onPageSize(s)}
              hitSlop={6}
            >
              <Text
                style={[
                  styles.pagerSize,
                  { color: s === pageSize ? p.gold : p.inkFaint },
                  s === pageSize && styles.pagerSizeActive,
                ]}
              >
                {s === 0 ? 'All' : s}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

function PagerBtn({
  icon,
  label,
  disabled,
  onPress,
  palette: p,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  disabled: boolean;
  onPress: () => void;
  palette: ArchivePalette;
}) {
  const t = useRef(new Animated.Value(0)).current;
  const to = (v: number) =>
    Animated.spring(t, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 8 }).start();
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] });
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        hitSlop={6}
        onPressIn={() => !disabled && to(1)}
        onPressOut={() => to(0)}
        {...({ onHoverIn: () => !disabled && to(1), onHoverOut: () => to(0) } as object)}
        style={[
          styles.pagerBtn,
          { borderColor: p.rule, backgroundColor: p.pageShade, opacity: disabled ? 0.32 : 1 },
        ]}
      >
        <Ionicons name={icon} size={15} color={p.ink} />
      </Pressable>
    </Animated.View>
  );
}

function PagerNum({
  n,
  active,
  onPress,
  palette: p,
}: {
  n: number;
  active: boolean;
  onPress: () => void;
  palette: ArchivePalette;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Page ${n}`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      hitSlop={4}
      style={[
        styles.pagerNum,
        active && { borderBottomColor: p.gold, borderBottomWidth: 2 },
      ]}
    >
      <Text style={[styles.pagerNumText, { color: active ? p.gold : p.inkDim }, active && styles.pagerNumActive]}>
        {n}
      </Text>
    </Pressable>
  );
}

/* ----------------------------- exam pamphlet ------------------------------ */

export interface PamphletOption {
  id: string | null;
  label: string;
  hint?: string;
}

/**
 * The examination archive, folded into the page. Opening it unfolds the sheet
 * upward from its bottom edge; choosing an entry folds it away again.
 */
export function ExamPamphlet({
  visible,
  options,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  options: PamphletOption[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
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
      // Unfolding a sheet of paper takes longer than letting it drop shut.
      duration: visible ? 700 : 380,
      easing: visible ? Easing.out(Easing.back(1.2)) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      if (!visible) setMounted(false);
    });
  }, [visible, t, reduced]);

  const sheetWidth = Math.min(width - 40, 620);
  // Roughly 200px per column, so the archive spreads out as it gets wider.
  const columns = Math.max(1, Math.min(3, Math.floor(sheetWidth / 200)));

  // The unfold: a creased sheet opening out and settling flat.
  const scaleY = t.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0.04, 0.58, 1] });
  const scaleX = t.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0.62, 0.86, 1] });
  const rotate = t.interpolate({ inputRange: [0, 0.65, 1], outputRange: ['-3deg', '1.4deg', '0deg'] });
  const opacity = t.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 1, 1] });

  return (
    <Modal transparent visible={mounted} animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, styles.popupScrim, { opacity: t }]}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close examination archive" onPress={onClose} />
      </Animated.View>

      <View style={styles.popupCenter} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.pamphlet,
            {
              width: sheetWidth,
              backgroundColor: p.pamphlet,
              borderColor: p.pamphletEdge,
              opacity,
              transform: [{ scaleY }, { scaleX }, { rotate }],
              // Unfolds out of the page rather than growing from its middle.
              transformOrigin: 'center bottom',
            },
          ]}
        >
          <LinearGradient
            colors={[p.pamphletShade, p.pamphlet, p.pamphletShade]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <PageGrain />
          {/* Darker, coffee-stained edges all round. */}
          <LinearGradient
            colors={[`${p.pamphletEdge}55`, 'transparent', `${p.pamphletEdge}55`]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <LinearGradient
            colors={[`${p.pamphletEdge}44`, 'transparent', `${p.pamphletEdge}44`]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          {/* Fold creases, so the sheet reads as something that was folded. */}
          <View style={[styles.creaseV, { backgroundColor: p.pamphletEdge }]} pointerEvents="none" />
          <View style={[styles.creaseH, { backgroundColor: p.pamphletEdge }]} pointerEvents="none" />

          <View style={styles.pamphletHead}>
            <Ionicons name="ribbon-outline" size={14} color={p.pamphletEdge} />
            <Text style={[styles.pamphletTitle, { color: p.pamphletInk }]}>Exam Archive</Text>
            <Ionicons name="ribbon-outline" size={14} color={p.pamphletEdge} />
          </View>
          <View style={[styles.pamphletRule, { backgroundColor: `${p.pamphletEdge}66` }]} />

          <ScrollView style={styles.pamphletScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.pamphletGrid}>
              {options.map((option) => {
                const active = option.id === selected;
                return (
                  <View key={option.id ?? 'all'} style={{ width: `${100 / columns}%` }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={option.label}
                      accessibilityState={{ selected: active }}
                      onPress={() => onSelect(option.id)}
                      style={({ pressed }) => [
                        styles.pamphletItem,
                        { borderColor: active ? p.pamphletEdge : 'transparent' },
                        (active || pressed) && { backgroundColor: `${p.pamphletEdge}22` },
                      ]}
                    >
                      <Text
                        style={[
                          styles.pamphletItemText,
                          { color: active ? p.pamphletInk : p.pamphletInkDim },
                          active && styles.pamphletItemActive,
                        ]}
                        numberOfLines={2}
                      >
                        {option.label}
                      </Text>
                      {option.hint ? (
                        <Text
                          style={[styles.pamphletHint, { color: p.pamphletInkDim }]}
                          numberOfLines={1}
                        >
                          {option.hint}
                        </Text>
                      ) : null}
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </ScrollView>

          <View style={[styles.pamphletRule, { backgroundColor: `${p.pamphletEdge}66` }]} />
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.pamphletClose}>
            <Text style={[styles.pamphletCloseText, { color: p.pamphletInkDim }]}>Fold away</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

/* --------------------------- teacher blackboard --------------------------- */

/** Static chalk dust, so the board never re-randomises between renders. */
const CHALK = [
  [8, 18, 22], [22, 62, 14], [37, 9, 30], [49, 78, 18], [61, 33, 24],
  [74, 55, 16], [86, 14, 26], [93, 70, 12], [15, 88, 20], [30, 41, 28],
  [55, 92, 15], [68, 25, 22], [80, 84, 18], [44, 50, 13], [5, 47, 25],
] as const;

/**
 * The teacher list, written up on a classroom board. Rises into place, settles
 * with a slight rotation, then the names chalk themselves on.
 */
export function TeacherBlackboard({
  visible,
  teachers,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  teachers: string[];
  selected: string;
  onSelect: (name: string) => void;
  onClose: () => void;
}) {
  const p = useArchivePalette();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const board = useRef(new Animated.Value(0)).current;
  const chalk = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) setMounted(true);
    if (reduced) {
      board.setValue(visible ? 1 : 0);
      chalk.setValue(visible ? 1 : 0);
      if (!visible) setMounted(false);
      return;
    }
    if (visible) {
      chalk.setValue(0);
      Animated.sequence([
        Animated.timing(board, {
          toValue: 1,
          duration: 520,
          easing: Easing.out(Easing.back(1.4)),
          useNativeDriver: true,
        }),
        // The names are written after the board has settled.
        Animated.timing(chalk, {
          toValue: 1,
          duration: 320,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.timing(board, {
        toValue: 0,
        duration: 260,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => setMounted(false));
    }
  }, [visible, board, chalk, reduced]);

  const boardWidth = Math.min(width - 40, 560);
  const translateY = board.interpolate({ inputRange: [0, 1], outputRange: [56, 0] });
  const rotate = board.interpolate({ inputRange: [0, 0.7, 1], outputRange: ['-2.6deg', '0.9deg', '0deg'] });
  const scale = board.interpolate({ inputRange: [0, 1], outputRange: [0.93, 1] });
  const chalkY = chalk.interpolate({ inputRange: [0, 1], outputRange: [6, 0] });

  const columns = teachers.length > 8 ? 2 : 1;

  return (
    <Modal transparent visible={mounted} animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, styles.popupScrim, { opacity: board }]}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close teacher board" onPress={onClose} />
      </Animated.View>

      <View style={styles.popupCenter} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.boardFrame,
            {
              width: boardWidth,
              // The frame is timber in both themes; only its darkness shifts.
              backgroundColor: p.cover,
              borderColor: p.coverEdge,
              opacity: board,
              transform: [{ translateY }, { rotate }, { scale }],
            },
          ]}
        >
          <View style={styles.boardSurface}>
            <LinearGradient
              colors={['#24352A', '#16211A', '#1D2C22']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            {/* Chalk dust left over from the last lesson. */}
            {CHALK.map(([x, y, w], i) => (
              <View
                key={i}
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: `${x}%`,
                  top: `${y}%`,
                  width: w,
                  height: 6,
                  borderRadius: 4,
                  backgroundColor: '#FFFFFF',
                  // Just a smear left by the duster — any stronger and the
                  // marks read as objects sitting on the board.
                  opacity: 0.016,
                }}
              />
            ))}

            <Text style={styles.boardTitle}>Teachers</Text>
            <View style={styles.boardUnderline} />

            <Animated.View style={{ opacity: chalk, transform: [{ translateY: chalkY }] }}>
              <ScrollView style={styles.boardScroll} showsVerticalScrollIndicator={false}>
                <View style={styles.boardGrid}>
                  {teachers.map((name) => {
                    const active = name === selected;
                    return (
                      <View key={name} style={{ width: `${100 / columns}%` }}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={name}
                          accessibilityState={{ selected: active }}
                          onPress={() => onSelect(name)}
                          style={({ pressed }) => [
                            styles.boardItem,
                            (active || pressed) && styles.boardItemActive,
                          ]}
                        >
                          {active ? <Text style={styles.boardTick}>✓</Text> : null}
                          <Text
                            style={[styles.boardName, active && styles.boardNameActive]}
                            numberOfLines={1}
                          >
                            {name}
                          </Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
            </Animated.View>
          </View>

          {/* Chalk rail along the bottom of the frame. */}
          <View style={[styles.boardRail, { backgroundColor: p.coverEdge }]}>
            <View style={styles.boardChalkStick} />
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8}>
              <Text style={styles.boardClose}>Wipe board</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/* ------------------------------ key blackboard ----------------------------- */

export interface KeyField {
  key: string;
  label: string;
  placeholder?: string;
  /** Masks input as a passphrase. Defaults to true — most board fields are keys. */
  secure?: boolean;
  keyboardType?: 'default' | 'number-pad';
}

/**
 * A dark chalkboard modal for entering cryptographic passphrase keys
 * (co-sign / print ceremony). Visually the same board as TeacherBlackboard —
 * timber frame, chalk dust, chalk rail — but chalk-lined inputs instead of a
 * name list, and the confirm action is disabled until every key is filled.
 */
export function KeyBlackboard({
  visible,
  title,
  subtitle,
  fields,
  submitLabel,
  busy,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  fields: KeyField[];
  submitLabel: string;
  busy?: boolean;
  onSubmit: (values: Record<string, string>) => void;
  onClose: () => void;
}) {
  const p = useArchivePalette();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const board = useRef(new Animated.Value(0)).current;
  const chalk = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (visible) {
      const initial: Record<string, string> = {};
      for (const field of fields) initial[field.key] = '';
      setValues(initial);
    }
    // Re-initialize only when the board opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (visible) setMounted(true);
    if (reduced) {
      board.setValue(visible ? 1 : 0);
      chalk.setValue(visible ? 1 : 0);
      if (!visible) setMounted(false);
      return;
    }
    if (visible) {
      chalk.setValue(0);
      Animated.sequence([
        Animated.timing(board, {
          toValue: 1,
          duration: 520,
          easing: Easing.out(Easing.back(1.4)),
          useNativeDriver: true,
        }),
        Animated.timing(chalk, {
          toValue: 1,
          duration: 320,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.timing(board, {
        toValue: 0,
        duration: 260,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => setMounted(false));
    }
  }, [visible, board, chalk, reduced]);

  const boardWidth = Math.min(width - 40, 480);
  const translateY = board.interpolate({ inputRange: [0, 1], outputRange: [56, 0] });
  const rotate = board.interpolate({ inputRange: [0, 0.7, 1], outputRange: ['-2.6deg', '0.9deg', '0deg'] });
  const scale = board.interpolate({ inputRange: [0, 1], outputRange: [0.93, 1] });
  const chalkY = chalk.interpolate({ inputRange: [0, 1], outputRange: [6, 0] });

  // The ceremony cannot proceed until every key on the board is written.
  const ready = fields.every((f) => (values[f.key] ?? '').trim().length > 0);

  return (
    <Modal transparent visible={mounted} animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, styles.popupScrim, { opacity: board }]}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close" onPress={onClose} />
      </Animated.View>

      <View style={styles.popupCenter} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.boardFrame,
            {
              width: boardWidth,
              backgroundColor: p.cover,
              borderColor: p.coverEdge,
              opacity: board,
              transform: [{ translateY }, { rotate }, { scale }],
            },
          ]}
        >
          <View style={styles.boardSurface}>
            <LinearGradient
              colors={['#24352A', '#16211A', '#1D2C22']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            {CHALK.map(([x, y, w], i) => (
              <View
                key={i}
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: `${x}%`,
                  top: `${y}%`,
                  width: w,
                  height: 6,
                  borderRadius: 4,
                  backgroundColor: '#FFFFFF',
                  opacity: 0.016,
                }}
              />
            ))}

            <Text style={styles.boardTitle}>{title}</Text>
            <View style={styles.boardUnderline} />
            {subtitle ? <Text style={styles.boardSubtitle}>{subtitle}</Text> : null}

            <Animated.View style={{ opacity: chalk, transform: [{ translateY: chalkY }], width: '100%' }}>
              {fields.map((field) => (
                <View key={field.key} style={styles.boardFieldWrap}>
                  <Text style={styles.boardFieldLabel}>{field.label}</Text>
                  <TextInput
                    value={values[field.key] ?? ''}
                    onChangeText={(text) => setValues((prev) => ({ ...prev, [field.key]: text }))}
                    placeholder={field.placeholder}
                    placeholderTextColor="rgba(255,255,255,0.28)"
                    secureTextEntry={field.secure ?? true}
                    keyboardType={field.keyboardType ?? 'default'}
                    autoCapitalize="none"
                    style={styles.boardInput}
                  />
                </View>
              ))}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={submitLabel}
                accessibilityState={{ disabled: !ready || !!busy }}
                disabled={!ready || busy}
                onPress={() => onSubmit(values)}
                style={({ pressed }) => [
                  styles.boardSubmit,
                  { opacity: !ready || busy ? 0.4 : pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={styles.boardSubmitText}>{busy ? 'Working…' : submitLabel}</Text>
              </Pressable>
            </Animated.View>
          </View>

          <View style={[styles.boardRail, { backgroundColor: p.coverEdge }]}>
            <View style={styles.boardChalkStick} />
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8}>
              <Text style={styles.boardClose}>Wipe board</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/* --------------------------- pencil paper modal ---------------------------- */

/**
 * The "magic pencil" opening: a single pencil appears centre-stage, rolls
 * upward, and a sheet of parchment unfolds out from underneath it — the
 * exact reverse plays on close. One reusable shell for every popup that
 * simply needs to present an existing form on a sheet of paper (Manage
 * Paper Sets, Assign Subjects to Teachers, …) with this shared animation
 * language instead of a generic modal fade.
 */
export function AnimatedPencilPaperModal({
  visible,
  title,
  subtitle,
  onClose,
  children,
  width = 460,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  const p = useArchivePalette();
  const { isDark } = useTheme();
  const reduced = useReducedMotion();
  const { width: winWidth } = useWindowDimensions();
  const t = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);
  const [interactive, setInteractive] = useState(false);

  useEffect(() => {
    if (visible) setMounted(true);
    if (reduced) {
      t.setValue(visible ? 1 : 0);
      setInteractive(visible);
      if (!visible) setMounted(false);
      return;
    }
    setInteractive(false);
    Animated.timing(t, {
      toValue: visible ? 1 : 0,
      // Slow and deliberate — the pencil is doing the opening, not a dialog snapping in.
      duration: visible ? 1250 : 1150,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: true,
    }).start(() => {
      if (!visible) setMounted(false);
      else setInteractive(true);
    });
  }, [visible, t, reduced]);

  const sheetWidth = Math.min(winWidth - 64, width);
  // The pencil is the parchment's hidden chamber, so it spans a good share of
  // the sheet's own width — never a fixed size that could look stretched.
  const pencilWidth = Math.max(200, Math.min(340, sheetWidth * 0.62));

  // The pencil stays horizontal throughout — it never leaves, it just settles
  // into place while the slot in its barrel opens and the parchment slides
  // out from directly behind it. Reversing t on close pulls the paper back
  // inside and the slot shuts.
  const pencilTranslateY = t.interpolate({ inputRange: [0, 0.12, 0.4, 1], outputRange: [10, 10, 0, 0] });
  const pencilWobble = t.interpolate({ inputRange: [0, 0.12, 0.3, 0.5, 1], outputRange: ['0deg', '0deg', '-2.5deg', '0deg', '0deg'] });
  const slotOpacity = t.interpolate({ inputRange: [0, 0.1, 0.25, 1], outputRange: [0.25, 0.25, 1, 1] });

  // The parchment emerges from directly behind the pencil's barrel: anchored
  // at its own top edge (tucked slightly under the pencil), it grows
  // downward rather than fading in.
  const paperOpacity = t.interpolate({ inputRange: [0, 0.18, 0.42, 1], outputRange: [0, 0.35, 1, 1] });
  const paperScaleY = t.interpolate({ inputRange: [0, 0.18, 0.58, 1], outputRange: [0.02, 0.08, 0.7, 1] });

  return (
    <Modal transparent visible={mounted} animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: t }]}>
        <BlurView intensity={isDark ? 20 : 14} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.pencilScrim]} />
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close" onPress={onClose} />
      </Animated.View>

      <View style={styles.pencilCenter} pointerEvents="box-none">
        <View style={{ width: sheetWidth, alignItems: 'center' }} pointerEvents="box-none">
          <Animated.View
            pointerEvents="none"
            style={[styles.pencilWrap, { transform: [{ translateY: pencilTranslateY }, { rotate: pencilWobble }] }]}
          >
            <VintagePencil width={pencilWidth} slotOpacity={slotOpacity} palette={p} />
          </Animated.View>

          <Animated.View
            style={[
              styles.pencilPaper,
              {
                width: sheetWidth,
                // Tucked up behind the pencil's barrel so it reads as sliding
                // out from inside it, not dropping from below it.
                marginTop: -Math.round(pencilWidth * 0.13 * 0.55),
                zIndex: 1,
                backgroundColor: p.pamphlet,
                borderColor: p.pamphletEdge,
                opacity: paperOpacity,
                transform: [{ scaleY: paperScaleY }],
                transformOrigin: 'center top',
              },
            ]}
            pointerEvents={interactive ? 'auto' : 'none'}
          >
            <LinearGradient
              colors={[p.pamphletShade, p.pamphlet, p.pamphletShade]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <PageGrain />
            <Text style={[styles.pencilTitle, { color: p.pamphletInk }]}>{title}</Text>
            {subtitle ? <Text style={[styles.pencilSubtitle, { color: p.pamphletInkDim }]}>{subtitle}</Text> : null}
            <View style={[styles.pencilRule, { backgroundColor: `${p.pamphletEdge}66` }]} />
            <ScrollView
              style={styles.pencilScroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * The pencil itself: a horizontal wooden barrel with brass ferrule bands, a
 * central chamber (with a seam that reads as the slot the parchment slides
 * out of), and a real tapered graphite tip — not a generic glyph.
 */
function VintagePencil({
  width,
  slotOpacity,
  palette: p,
}: {
  width: number;
  slotOpacity: Animated.AnimatedInterpolation<string | number>;
  palette: ArchivePalette;
}) {
  const h = Math.round(width * 0.13);
  return (
    <View style={[pencilStyles.row, { width, height: h }]}>
      <View style={[pencilStyles.eraser, { flex: 1.1, height: h, borderRadius: h / 2 }]} />
      <View style={[pencilStyles.ferrule, { flex: 0.7, height: h * 0.86 }]} />
      <View style={[pencilStyles.wood, { flex: 2.4, height: h }]} />
      <View style={[pencilStyles.band, { flex: 0.35, height: h, backgroundColor: p.gold }]} />
      <View style={[pencilStyles.barrel, { flex: 3.6, height: h * 1.1 }]}>
        <Animated.View style={[pencilStyles.slot, { opacity: slotOpacity }]} />
      </View>
      <View style={[pencilStyles.band, { flex: 0.35, height: h, backgroundColor: p.gold }]} />
      <View style={[pencilStyles.wood, { flex: 2.2, height: h }]} />
      <View
        style={{
          width: 0,
          height: 0,
          borderTopWidth: h / 2,
          borderBottomWidth: h / 2,
          borderLeftWidth: h * 0.9,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderLeftColor: '#D8C39A',
        }}
      />
      <View
        style={{
          width: 0,
          height: 0,
          borderTopWidth: h * 0.16,
          borderBottomWidth: h * 0.16,
          borderLeftWidth: h * 0.34,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderLeftColor: '#2B2620',
        }}
      />
    </View>
  );
}

const pencilStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  eraser: { backgroundColor: '#D98A8A', borderWidth: 1, borderColor: '#B85F5F' },
  ferrule: { backgroundColor: '#9A9994', borderWidth: 1, borderColor: '#6E6D69' },
  wood: { backgroundColor: '#A6432E' },
  band: {},
  barrel: { backgroundColor: '#8C3826', alignItems: 'center', justifyContent: 'center', borderRadius: 2 },
  slot: { width: '70%', height: 2, borderRadius: 1, backgroundColor: '#2B1A12' },
});

/* -------------------------------- text field ------------------------------ */

/** A ruled writing line on the page, rather than a boxed web input. */
export function BookField({
  label,
  style,
  onFocus,
  onBlur,
  ...rest
}: { label?: string } & TextInputProps) {
  const p = useArchivePalette();
  const [focused, setFocused] = useState(false);
  return (
    <View>
      {label ? <Text style={[styles.fieldLabel, { color: p.inkFaint }]}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={`${p.inkFaint}CC`}
        style={[
          styles.field,
          {
            color: p.ink,
            backgroundColor: focused ? `${p.goldSoft}` : 'transparent',
            borderBottomColor: focused ? p.gold : p.rule,
            borderBottomWidth: focused ? 2 : 1,
          },
          style,
        ]}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...rest}
      />
    </View>
  );
}

/* --------------------------------- buttons -------------------------------- */

/** Vintage action: `ghost` is an inked outline, `gold` a brass plate. */
export function BookButton({
  title,
  icon,
  onPress,
  variant = 'ghost',
  disabled,
  loading,
  compact,
}: {
  title: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  variant?: 'ghost' | 'gold' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
}) {
  const p = useArchivePalette();
  const t = useRef(new Animated.Value(0)).current;
  const [focused, setFocused] = useState(false);
  const off = disabled || loading;
  const to = (v: number) =>
    Animated.spring(t, { toValue: v, useNativeDriver: true, speed: 32, bounciness: 7 }).start();
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, -2] });

  const gold = variant === 'gold';
  const danger = variant === 'danger';
  // Gold keeps its established look (gold icon, ink text) — only the new
  // danger variant tints both icon and text the same way, so a Reject-style
  // action reads unmistakably as destructive.
  const accent = danger ? p.danger : gold ? p.gold : null;
  const textColor = danger ? p.danger : gold ? p.ink : p.inkDim;
  return (
    <Animated.View style={{ transform: [{ translateY }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: !!off, busy: !!loading }}
        disabled={off}
        onPress={onPress}
        onPressIn={() => !off && to(1)}
        onPressOut={() => to(0)}
        {...({
          onHoverIn: () => !off && to(1),
          onHoverOut: () => to(0),
          onFocus: () => setFocused(true),
          onBlur: () => setFocused(false),
        } as object)}
        style={[
          styles.bookBtn,
          compact && styles.bookBtnCompact,
          {
            backgroundColor: accent ? `${accent}26` : p.pageShade,
            borderColor: focused ? (accent ?? p.gold) : (accent ?? p.rule),
            borderWidth: focused || accent ? 2 : 1,
            opacity: off ? 0.42 : 1,
          },
        ]}
      >
        {icon ? (
          <Ionicons name={loading ? 'hourglass-outline' : icon} size={14} color={accent ?? p.inkDim} />
        ) : null}
        <Text style={[styles.bookBtnText, { color: textColor }]} numberOfLines={1}>
          {title}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/* ------------------------------- exam scale ------------------------------- */

/** Major/minor rule marks along one edge of the scale. */
function RulerEdge({ flip }: { flip?: boolean }) {
  const ticks = Array.from({ length: 76 }, (_, i) => i);
  return (
    <View style={[styles.ruler, flip && styles.rulerFlip]}>
      <View style={styles.rulerTicks}>
        {ticks.map((i) => {
          const major = i % 5 === 0;
          return (
            <View
              key={i}
              style={[
                styles.tick,
                { height: major ? 11 : i % 5 === 2 ? 7 : 5, opacity: major ? 0.85 : 0.5 },
              ]}
            />
          );
        })}
      </View>
      {!flip ? (
        <>
          <View style={styles.rulerNumbers}>
            {Array.from({ length: 16 }, (_, i) => (
              <Text key={i} style={styles.rulerNumber}>
                {i}
              </Text>
            ))}
          </View>
          <Text style={styles.rulerUnit}>cm</Text>
        </>
      ) : null}
    </View>
  );
}

/**
 * A physical measuring scale laid over the archive, one per examination, with
 * the exam's own name printed where the brand would be. Stepping through them
 * slides the current scale out and the next one in; tapping selects.
 */
export function ExamScale({
  visible,
  exams,
  selectedId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  exams: { id: string; name: string; exam_date?: string | null }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const p = useArchivePalette();
  const { isDark } = useTheme();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const enter = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);
  const [index, setIndex] = useState(0);

  // Open on the exam currently in use, so the scale reads as the live state.
  useEffect(() => {
    if (!visible) return;
    const at = exams.findIndex((e) => e.id === selectedId);
    setIndex(at >= 0 ? at : 0);
  }, [visible, selectedId, exams]);

  useEffect(() => {
    if (visible) setMounted(true);
    if (reduced) {
      enter.setValue(visible ? 1 : 0);
      if (!visible) setMounted(false);
      return;
    }
    Animated.timing(enter, {
      toValue: visible ? 1 : 0,
      duration: visible ? 620 : 300,
      easing: visible ? Easing.out(Easing.back(1.15)) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      if (!visible) setMounted(false);
    });
  }, [visible, enter, reduced]);

  const step = (delta: 1 | -1) => {
    const next = index + delta;
    if (next < 0 || next >= exams.length) return;
    if (reduced) {
      setIndex(next);
      return;
    }
    // Slide the current scale off, swap, slide the new one in.
    Animated.timing(slide, {
      toValue: -delta,
      duration: 140,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setIndex(next);
      slide.setValue(delta);
      Animated.timing(slide, {
        toValue: 0,
        duration: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  };

  const current = exams[index];
  const scaleWidth = Math.min(width - 48, 720);
  const translateX = Animated.add(
    enter.interpolate({ inputRange: [0, 1], outputRange: [-90, 0] }),
    slide.interpolate({ inputRange: [-1, 1], outputRange: [-70, 70] })
  );
  const rotate = enter.interpolate({ inputRange: [0, 1], outputRange: ['-4deg', '0deg'] });

  return (
    <Modal transparent visible={mounted} animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {/* The whole interface behind the scale is blurred, book included. */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: enter }]}>
        <BlurView intensity={isDark ? 34 : 26} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.scaleScrim]} />
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close exam scale" onPress={onClose} />
      </Animated.View>

      <View style={styles.popupCenter} pointerEvents="box-none">
        <Animated.View style={{ opacity: enter, transform: [{ translateX }, { rotate }] }}>
          <Text style={[styles.scaleCaption, { color: p.onCover }]}>
            Measure out an examination
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Use ${current?.name ?? 'this exam'}`}
            onPress={() => current && onSelect(current.id)}
            style={[
              styles.scale,
              {
                width: scaleWidth,
                // Moulded plastic reads white in both themes; only the tint of
                // the light falling on it changes.
                backgroundColor: isDark ? '#D9D3C4' : '#F7F4EC',
                borderColor: isDark ? '#8C8676' : '#C9C2AE',
              },
            ]}
          >
            <LinearGradient
              colors={['rgba(255,255,255,0.9)', 'rgba(255,255,255,0.2)', 'rgba(0,0,0,0.07)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <RulerEdge />
            <View style={styles.scaleBody}>
              <Text style={styles.scaleName} numberOfLines={1} adjustsFontSizeToFit>
                {(current?.name ?? 'No examination').toUpperCase()}
              </Text>
              <Text style={styles.scaleSide} numberOfLines={1}>
                {current?.exam_date ?? ''}
              </Text>
            </View>
            <RulerEdge flip />
          </Pressable>

          <View style={styles.scaleNav}>
            <BookButton
              title="Previous"
              icon="chevron-back"
              onPress={() => step(-1)}
              disabled={index === 0}
              compact
            />
            <Text style={[styles.scaleCount, { color: p.onCover }]}>
              Exam {exams.length === 0 ? 0 : index + 1} of {exams.length}
            </Text>
            <BookButton
              title="Next"
              icon="chevron-forward"
              onPress={() => step(1)}
              disabled={index >= exams.length - 1}
              compact
            />
          </View>

          <View style={styles.scaleUse}>
            <BookButton
              title={current ? `Use ${current.name}` : 'Close'}
              icon="checkmark-circle-outline"
              variant="gold"
              onPress={() => (current ? onSelect(current.id) : onClose())}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/* --------------------------- requirements bookmark ------------------------ */

/**
 * A page marker sticking out of the top of the book. Clicking it draws a
 * parchment insert down over the spread; clicking again tucks it back in.
 *
 * The sheet is absolutely positioned so opening it never resizes the book —
 * it slides out from behind the tab rather than pushing the pages apart.
 */
export function RequirementsBookmark({
  open,
  onToggle,
  label,
  status,
  tone,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  /** Short at-a-glance state printed on the tab, e.g. "75 / 75 ✓". */
  status?: string;
  tone?: string;
  children: React.ReactNode;
}) {
  const p = useArchivePalette();
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(open ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) {
      t.setValue(open ? 1 : 0);
      return;
    }
    Animated.timing(t, {
      toValue: open ? 1 : 0,
      duration: open ? 560 : 340,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [open, t, reduced]);

  // The tab nudges down as the insert is drawn out from under it.
  const tabY = t.interpolate({ inputRange: [0, 1], outputRange: [0, 4] });
  const sheetY = t.interpolate({ inputRange: [0, 1], outputRange: [-26, 0] });
  const sheetScale = t.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });

  return (
    <>
      <Animated.View style={[styles.tabWrap, { transform: [{ translateY: tabY }] }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}. ${open ? 'Close' : 'Open'} the requirements insert`}
          accessibilityState={{ expanded: open }}
          onPress={onToggle}
          style={[
            styles.tab,
            { backgroundColor: p.pamphlet, borderColor: p.pamphletEdge },
          ]}
        >
          <Ionicons name={open ? 'bookmark' : 'bookmark-outline'} size={13} color={tone ?? p.pamphletInk} />
          <Text style={[styles.tabText, { color: p.pamphletInk }]} numberOfLines={1}>
            {label}
          </Text>
          {status ? (
            <Text style={[styles.tabStatus, { color: tone ?? p.pamphletInkDim }]} numberOfLines={1}>
              {status}
            </Text>
          ) : null}
        </Pressable>
        {/* The notch that ties the tab into the book's edge. */}
        <View style={[styles.tabNotch, { backgroundColor: p.pamphletEdge }]} />
      </Animated.View>

      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        style={[
          styles.insert,
          {
            backgroundColor: p.pamphlet,
            borderColor: p.pamphletEdge,
            opacity: t,
            transform: [{ translateY: sheetY }, { scaleY: sheetScale }],
            transformOrigin: 'center top',
          },
        ]}
      >
        <LinearGradient
          colors={[p.pamphletShade, p.pamphlet]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <PageGrain />
        {children}
      </Animated.View>
    </>
  );
}

/* ------------------------------ approve action ---------------------------- */

/** Vintage approve action — muted green, serif, understated. */
export function ApproveButton({
  onPress,
  busy,
  style,
}: {
  onPress: () => void;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const p = useArchivePalette();
  const t = useRef(new Animated.Value(0)).current;
  const [focused, setFocused] = useState(false);
  const to = (v: number) =>
    Animated.spring(t, { toValue: v, useNativeDriver: true, speed: 34, bounciness: 7 }).start();
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Approve for papers"
        accessibilityState={{ busy: !!busy, disabled: !!busy }}
        disabled={busy}
        onPress={onPress}
        onPressIn={() => to(1)}
        onPressOut={() => to(0)}
        {...({
          onHoverIn: () => to(1),
          onHoverOut: () => to(0),
          onFocus: () => setFocused(true),
          onBlur: () => setFocused(false),
        } as object)}
        style={[
          styles.approve,
          {
            borderColor: p.success,
            backgroundColor: `${p.success}16`,
            borderWidth: focused ? 2 : 1,
            opacity: busy ? 0.55 : 1,
          },
        ]}
      >
        <Ionicons name="checkmark-circle-outline" size={15} color={p.success} />
        <Text style={[styles.approveText, { color: p.success }]}>
          {busy ? 'Approving…' : 'Approve'}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/* --------------------------------- styles --------------------------------- */

const styles = StyleSheet.create({
  /* seal */
  seal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  sealDot: { width: 5, height: 5, borderRadius: 3 },
  sealText: { fontFamily: serif, fontSize: 9.5, fontWeight: '700', letterSpacing: 1 },

  /* heading */
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headingRule: { flex: 1, height: 1 },
  heading: {
    fontFamily: serif,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    textAlign: 'center',
  },

  /* plaque */
  plaqueWrap: { alignSelf: 'center', maxWidth: '100%' },
  plaque: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 3,
    paddingVertical: 9,
    paddingHorizontal: 16,
    minWidth: 168,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 6,
    elevation: 2,
  },
  plaqueText: { fontFamily: serif, fontWeight: '700', letterSpacing: 0.6, flexShrink: 1 },

  /* pills */
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, justifyContent: 'center' },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  pillText: { fontFamily: serif, fontSize: 12.5 },
  pillTextActive: { fontWeight: '700' },

  /* note */
  note: { borderWidth: 1, borderRadius: 3, paddingVertical: 10, paddingHorizontal: 12, gap: 5 },
  noteLine: { flexDirection: 'row', alignItems: 'baseline', gap: 6, justifyContent: 'center' },
  noteValue: { fontFamily: serif, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  noteLabel: { fontFamily: serif, fontSize: 11.5 },

  /* paginator */
  pager: { gap: 6 },
  pagerRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  pagerBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pagerNum: { paddingHorizontal: 5, paddingBottom: 2, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  pagerNumText: { fontFamily: serif, fontSize: 13, fontVariant: ['tabular-nums'] },
  pagerNumActive: { fontWeight: '700' },
  pagerGap: { fontFamily: serif, fontSize: 13, paddingHorizontal: 1 },
  pagerFoot: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  pagerRange: { fontFamily: serif, fontSize: 10.5, letterSpacing: 0.3 },
  pagerSizes: { flexDirection: 'row', gap: 8 },
  pagerSize: { fontFamily: serif, fontSize: 10.5 },
  pagerSizeActive: { fontWeight: '700' },

  /* popups */
  popupScrim: { backgroundColor: 'rgba(0,0,0,0.58)' },
  popupCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },

  /* pamphlet */
  pamphlet: {
    maxHeight: '82%',
    borderWidth: 1,
    borderRadius: 2,
    paddingTop: 14,
    paddingBottom: 8,
    paddingHorizontal: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.5,
    shadowRadius: 28,
    elevation: 22,
  },
  creaseV: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, opacity: 0.28 },
  creaseH: { position: 'absolute', left: 0, right: 0, top: '46%', height: 1, opacity: 0.2 },
  pamphletHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  pamphletTitle: {
    fontFamily: serif,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  pamphletRule: { height: 1, marginVertical: 10 },
  pamphletScroll: { flexGrow: 0 },
  pamphletGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  pamphletItem: {
    borderWidth: 1,
    borderRadius: 3,
    paddingVertical: 8,
    paddingHorizontal: 10,
    margin: 2,
  },
  pamphletItemText: { fontFamily: serif, fontSize: 13.5, lineHeight: 18 },
  pamphletItemActive: { fontWeight: '700' },
  pamphletHint: { fontFamily: serif, fontSize: 10, marginTop: 1 },
  pamphletClose: { alignSelf: 'center', paddingVertical: 4, paddingHorizontal: 12 },
  pamphletCloseText: {
    fontFamily: serif,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },

  /* blackboard */
  boardFrame: {
    borderWidth: 1,
    borderRadius: 6,
    padding: 10,
    maxHeight: '82%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.55,
    shadowRadius: 30,
    elevation: 24,
  },
  boardSurface: {
    borderRadius: 3,
    overflow: 'hidden',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.5)',
  },
  boardTitle: {
    fontFamily: serif,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 4,
    textTransform: 'uppercase',
    color: '#FFFFFF',
    textAlign: 'center',
    opacity: 0.94,
  },
  boardUnderline: {
    alignSelf: 'center',
    width: 82,
    height: 1,
    backgroundColor: '#FFFFFF',
    opacity: 0.4,
    marginTop: 7,
    marginBottom: 12,
  },
  boardScroll: { flexGrow: 0 },
  boardGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  boardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 7,
    paddingHorizontal: 9,
    margin: 2,
    borderRadius: 3,
  },
  boardItemActive: { backgroundColor: 'rgba(255,255,255,0.12)' },
  boardTick: { color: '#FFFFFF', fontSize: 12 },
  // White in both themes: chalk is chalk.
  boardName: { fontFamily: serif, fontSize: 14, color: '#FFFFFF', opacity: 0.9, flexShrink: 1 },
  boardNameActive: { fontWeight: '700', opacity: 1 },
  boardRail: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 3,
  },
  boardChalkStick: {
    width: 26,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#F2ECE0',
    opacity: 0.85,
  },
  boardClose: {
    fontFamily: serif,
    fontSize: 10.5,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: '#F2ECE0',
    opacity: 0.8,
  },
  boardSubtitle: {
    fontFamily: serif,
    fontSize: 11.5,
    lineHeight: 16,
    color: 'rgba(255,255,255,0.68)',
    textAlign: 'center',
    marginBottom: 14,
  },
  boardFieldWrap: { marginBottom: 12 },
  boardFieldLabel: {
    fontFamily: serif,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.65)',
    marginBottom: 5,
  },
  boardInput: {
    fontFamily: serif,
    fontSize: 14,
    color: '#FFFFFF',
    borderBottomWidth: 1.5,
    borderBottomColor: 'rgba(255,255,255,0.4)',
    paddingVertical: 7,
    paddingHorizontal: 2,
  },
  boardSubmit: {
    marginTop: 6,
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    borderRadius: 3,
    paddingVertical: 9,
    paddingHorizontal: 22,
  },
  boardSubmitText: {
    fontFamily: serif,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: '#FFFFFF',
  },

  /* text field */
  fieldLabel: {
    fontFamily: serif,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  field: {
    fontFamily: serif,
    fontSize: 14,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 2,
  },

  /* buttons */
  bookBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 3,
    paddingVertical: 9,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 2,
  },
  bookBtnCompact: { paddingVertical: 6, paddingHorizontal: 10 },
  bookBtnText: { fontFamily: serif, fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },

  /* exam scale */
  scaleScrim: { backgroundColor: 'rgba(0,0,0,0.42)' },
  scaleCaption: {
    fontFamily: serif,
    fontSize: 11,
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: 14,
    opacity: 0.85,
  },
  scale: {
    borderWidth: 1,
    borderRadius: 9,
    paddingVertical: 8,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.55,
    shadowRadius: 26,
    elevation: 24,
  },
  ruler: { paddingHorizontal: 10 },
  rulerFlip: { transform: [{ scaleY: -1 }] },
  rulerTicks: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  tick: { width: 1, backgroundColor: '#2A2A26' },
  rulerNumbers: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 1 },
  rulerNumber: { fontFamily: serif, fontSize: 7.5, color: '#2A2A26', opacity: 0.8 },
  rulerUnit: {
    fontFamily: serif,
    fontSize: 7,
    color: '#2A2A26',
    opacity: 0.7,
    position: 'absolute',
    left: 12,
    top: 21,
  },
  scaleBody: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  scaleName: {
    fontFamily: serif,
    fontSize: 21,
    fontWeight: '700',
    letterSpacing: 2.6,
    color: '#1E1E1A',
    flexShrink: 1,
    textAlign: 'center',
  },
  scaleSide: {
    fontFamily: serif,
    fontSize: 8.5,
    letterSpacing: 1.2,
    color: '#4A4A44',
    position: 'absolute',
    right: 16,
  },
  scaleNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    marginTop: 18,
  },
  scaleCount: {
    fontFamily: serif,
    fontSize: 11.5,
    letterSpacing: 1.2,
    minWidth: 104,
    textAlign: 'center',
  },
  scaleUse: { alignItems: 'center', marginTop: 12 },

  /* requirements bookmark */
  tabWrap: { alignItems: 'center', zIndex: 30 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    paddingVertical: 6,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.32,
    shadowRadius: 7,
    elevation: 8,
  },
  tabText: {
    fontFamily: serif,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  tabStatus: { fontFamily: serif, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  tabNotch: { height: 2, width: 54, opacity: 0.55 },
  insert: {
    position: 'absolute',
    top: 26,
    left: '8%',
    right: '8%',
    borderWidth: 1,
    borderRadius: 3,
    paddingVertical: 14,
    paddingHorizontal: 18,
    overflow: 'hidden',
    zIndex: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 20,
  },

  /* approve */
  approve: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 3,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  approveText: { fontFamily: serif, fontSize: 12.5, fontWeight: '700', letterSpacing: 1.2 },

  /* pencil paper modal */
  pencilScrim: { backgroundColor: 'rgba(0,0,0,0.4)' },
  pencilCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  pencilWrap: {
    marginBottom: 2,
    zIndex: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  pencilPaper: {
    maxWidth: '100%',
    maxHeight: '82%',
    borderWidth: 1,
    borderRadius: 3,
    paddingTop: 18,
    paddingBottom: 10,
    paddingHorizontal: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.5,
    shadowRadius: 28,
    elevation: 22,
  },
  pencilTitle: {
    fontFamily: serif,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1,
    textAlign: 'center',
  },
  pencilSubtitle: {
    fontFamily: serif,
    fontSize: 11.5,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 6,
  },
  pencilRule: { height: 1, marginTop: 12, marginBottom: 12 },
  pencilScroll: { flexGrow: 0 },
});
