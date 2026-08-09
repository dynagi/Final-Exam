import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { gradients, labelFor, radius, serif, spacing, ThemeColors, toneFor } from '../lib/theme';
import { Exam, Role, ROLE_LABEL } from '../lib/types';
import { PAGE_SIZES, pageWindow } from '../lib/usePagination';
import { PressableIcon, Reveal, Tappable, useCountUp, useFloat, usePressableScale, usePulse } from './anim';
import { Aurora } from './Aurora';
import GradientText from './GradientText';
import { HudFrame } from './HudFrame';

/** Shared hook: memoized themed styles for any component in this file. */
function useStyles() {
  const { colors } = useTheme();
  return useMemo(() => ({ colors, styles: makeStyles(colors) }), [colors]);
}

/* ------------------------------- layout ---------------------------------- */

export function Screen({
  children,
  scroll = false,
  refreshing,
  onRefresh,
  aurora = true,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Animated mesh backdrop behind the content. On by default. */
  aurora?: boolean;
}) {
  const { colors, styles } = useStyles();
  // Drives scroll-linked parallax on the Aurora blobs (native driver).
  const scrollY = useRef(new Animated.Value(0)).current;

  const backdrop = aurora ? <Aurora scrollY={scroll ? scrollY : undefined} /> : null;

  if (scroll) {
    return (
      <View style={styles.screen}>
        {backdrop}
        <Animated.ScrollView
          style={styles.scrollTransparent}
          contentContainerStyle={styles.screenContent}
          showsVerticalScrollIndicator={false}
          decelerationRate="normal"
          scrollEventThrottle={16}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: true }
          )}
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
            ) : undefined
          }
        >
          {children}
        </Animated.ScrollView>
      </View>
    );
  }
  return (
    <View style={styles.screen}>
      {backdrop}
      <View style={[styles.flex, styles.screenContent]}>{children}</View>
    </View>
  );
}

export function Card({
  children,
  style,
  glass = false,
  delay = 0,
  reveal = true,
  hud = false,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  glass?: boolean;
  delay?: number;
  reveal?: boolean;
  /** Sci-fi corner brackets, for the flagship/console-style cards. */
  hud?: boolean;
}) {
  const { styles } = useStyles();
  const hover = useRef(new Animated.Value(0)).current;
  const to = (v: number) =>
    Animated.spring(hover, { toValue: v, useNativeDriver: true, speed: 30, bounciness: 5 }).start();
  const translateY = hover.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });

  const card = (
    <Animated.View
      {...({ onPointerEnter: () => to(1), onPointerLeave: () => to(0) } as object)}
      style={[styles.card, glass && styles.cardGlass, { transform: [{ translateY }] }, style]}
    >
      {children}
      {hud ? <HudFrame inset={-1} /> : null}
    </Animated.View>
  );

  return reveal ? <Reveal delay={delay}>{card}</Reveal> : card;
}

export function SectionTitle({ title, right }: { title: string; right?: React.ReactNode }) {
  const { styles } = useStyles();
  return (
    <View style={styles.sectionTitleRow}>
      <View style={styles.sectionTitleLeft}>
        <LinearGradient
          colors={gradients.brand}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.sectionBar}
        />
        <GradientText colors={gradients.brand} style={styles.sectionTitle}>
          {title}
        </GradientText>
      </View>
      {right}
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
}) {
  const { colors, styles } = useStyles();
  const float = useFloat(8);
  return (
    <Reveal scale>
      <View style={styles.empty}>
        <Animated.View style={[styles.emptyIconWrap, float]}>
          <Ionicons name={icon} size={34} color={colors.primary} />
        </Animated.View>
        <Text style={styles.emptyTitle}>{title}</Text>
        {subtitle ? <Text style={styles.emptySubtitle}>{subtitle}</Text> : null}
      </View>
    </Reveal>
  );
}

/* ------------------------------- controls -------------------------------- */

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'danger' | 'success' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, styles } = useStyles();
  const { handlers, style: scaleStyle } = usePressableScale();
  const gradient =
    variant === 'primary'
      ? gradients.primary
      : variant === 'danger'
        ? gradients.danger
        : variant === 'success'
          ? gradients.success
          : null;
  const fg = variant === 'ghost' ? colors.textDim : colors.onAccent;

  return (
    <Animated.View style={[scaleStyle, variant !== 'ghost' && styles.buttonGlow, style]}>
      <Pressable
        onPress={onPress}
        disabled={disabled || loading}
        {...handlers}
        style={({ pressed }) => [
          styles.button,
          variant === 'ghost' && styles.buttonGhost,
          { opacity: disabled || loading ? 0.5 : pressed ? 0.95 : 1 },
        ]}
      >
        {gradient ? (
          <LinearGradient
            colors={gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        {gradient && !disabled && !loading ? <ButtonShimmer /> : null}
        {loading ? (
          <ActivityIndicator color={fg} />
        ) : (
          <View style={styles.buttonInner}>
            {icon ? <Ionicons name={icon} size={17} color={fg} /> : null}
            <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

/** Diagonal light band that continuously sweeps across a filled button — the "console" shimmer. */
function ButtonShimmer() {
  const [width, setWidth] = React.useState(220);
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 2600, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.delay(900),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [t]);

  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.6, width * 1.2] });

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width || width)}
    >
      <Animated.View style={{ position: 'absolute', top: 0, bottom: 0, width: width * 0.28, transform: [{ translateX }, { skewX: '-18deg' }] }}>
        <LinearGradient
          colors={['transparent', 'rgba(255,255,255,0.35)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </View>
  );
}

interface InputProps extends TextInputProps {
  label?: string;
}

export function Input({ label, style, onFocus, onBlur, ...rest }: InputProps) {
  const { colors, styles } = useStyles();
  const [focused, setFocused] = React.useState(false);
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.textFaint}
        style={[styles.input, focused && styles.inputFocused, style]}
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

export function Chips({
  options,
  value,
  onChange,
}: {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const { styles } = useStyles();
  return (
    <View style={styles.chipsRow}>
      {options.map((option) => {
        const active = option === value;
        return (
          <Tappable
            key={option}
            onPress={() => onChange(option)}
            style={[styles.chip, active && styles.chipActive]}
          >
            {active ? (
              <LinearGradient
                colors={gradients.primary}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            ) : null}
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{option}</Text>
          </Tappable>
        );
      })}
    </View>
  );
}

/**
 * Horizontal exam selector — exams are the categories every question and
 * paper lives under. `allowAll` adds an "All Exams" pill for filtering.
 */
export function ExamPicker({
  exams,
  value,
  onChange,
  allowAll = false,
}: {
  exams: Exam[];
  value: string | null;
  onChange: (examId: string | null) => void;
  allowAll?: boolean;
}) {
  const { colors, styles } = useStyles();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.examRow}
    >
      {allowAll ? (
        <Tappable
          onPress={() => onChange(null)}
          style={[styles.examPill, value === null && styles.examPillActive]}
        >
          {value === null ? (
            <LinearGradient
              colors={gradients.primary}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <Ionicons name="albums-outline" size={15} color={value === null ? colors.onAccent : colors.textDim} />
          <Text style={[styles.examName, value === null && styles.examTextActive]}>All Exams</Text>
        </Tappable>
      ) : null}
      {exams.map((exam) => {
        const active = exam.id === value;
        return (
          <Tappable
            key={exam.id}
            onPress={() => onChange(exam.id)}
            style={[styles.examPill, active && styles.examPillActive]}
          >
            {active ? (
              <LinearGradient
                colors={gradients.primary}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            ) : null}
            <Ionicons name="calendar-outline" size={15} color={active ? colors.onAccent : colors.accent} />
            <View>
              <Text style={[styles.examName, active && styles.examTextActive]} numberOfLines={1}>
                {exam.name}
              </Text>
              <Text style={[styles.examDate, active && styles.examTextActive]}>{exam.exam_date}</Text>
            </View>
          </Tappable>
        );
      })}
    </ScrollView>
  );
}

/**
 * Numeric stepper with − / + buttons (and a typable middle field). Used for
 * counts like center seat capacity. Clamps to [min, max]; buttons carry the
 * same press/hover micro-interaction as the rest of the app.
 */
export function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max = 100000,
  step = 1,
  suffix,
}: {
  label?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const { colors, styles } = useStyles();
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const set = (n: number) => onChange(clamp(Number.isFinite(n) ? Math.trunc(n) : min));
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      <View style={styles.stepperRow}>
        <Tappable
          onPress={() => set(value - step)}
          disabled={value <= min}
          style={[styles.stepperBtn, value <= min && styles.stepperBtnOff]}
        >
          <Ionicons name="remove" size={22} color={colors.text} />
        </Tappable>
        <View style={styles.stepperValueWrap}>
          <TextInput
            value={String(value)}
            onChangeText={(t) => set(parseInt(t.replace(/[^0-9]/g, ''), 10))}
            keyboardType="number-pad"
            style={styles.stepperValue}
            selectTextOnFocus
          />
          {suffix ? <Text style={styles.stepperSuffix}>{suffix}</Text> : null}
        </View>
        <Tappable
          onPress={() => set(value + step)}
          disabled={value >= max}
          style={[styles.stepperBtn, value >= max && styles.stepperBtnOff]}
        >
          <Ionicons name="add" size={22} color={colors.text} />
        </Tappable>
      </View>
    </View>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  /** Second line under the label — body, mode, marks summary… */
  hint?: string;
  /** Groups options under a sticky-ish heading in the picker sheet. */
  group?: string;
  /** Small pill on the right, e.g. "PROVISIONAL". */
  tag?: string;
  disabled?: boolean;
}

/**
 * Dropdown backed by a searchable sheet. Used wherever the list is too long
 * for chips — the exam-format catalogue is ~140 entries, and the subject list
 * comes straight from the selected format.
 */
export function Select({
  label,
  placeholder = 'Select…',
  value,
  options,
  onChange,
  disabled,
  searchable,
  emptyText = 'Nothing to choose from yet.',
}: {
  label?: string;
  placeholder?: string;
  value: string | null;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Defaults on once the list gets long. */
  searchable?: boolean;
  emptyText?: string;
}) {
  const { colors, styles } = useStyles();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const selected = options.find((o) => o.value === value) ?? null;
  const withSearch = searchable ?? options.length > 8;

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      `${o.label} ${o.hint ?? ''} ${o.group ?? ''}`.toLowerCase().includes(q)
    );
  }, [options, query]);

  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      <Tappable
        onPress={() => {
          if (disabled) return;
          setQuery('');
          setOpen(true);
        }}
        disabled={disabled}
        style={[styles.selectField, disabled && styles.selectFieldOff]}
      >
        <View style={styles.flex}>
          <Text style={selected ? styles.selectValue : styles.selectPlaceholder} numberOfLines={1}>
            {selected?.label ?? placeholder}
          </Text>
          {selected?.hint ? (
            <Text style={styles.selectHint} numberOfLines={1}>
              {selected.hint}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-down" size={18} color={colors.textDim} />
      </Tappable>

      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <BlurView intensity={28} tint={colors.blurTint} style={StyleSheet.absoluteFill} />
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, styles.selectSheet]}>
            <LinearGradient
              colors={gradients.brand}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.modalTopBar}
            />
            <View style={styles.selectSheetHead}>
              <Text style={styles.modalTitle}>{label ?? 'Select'}</Text>
              <PressableIcon name="close" size={22} color={colors.textDim} onPress={() => setOpen(false)} />
            </View>
            {withSearch ? (
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search…"
                placeholderTextColor={colors.textFaint}
                autoCapitalize="none"
                style={[styles.input, { marginBottom: spacing.md }]}
              />
            ) : null}
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {filtered.length === 0 ? (
                <Text style={styles.selectEmpty}>{query ? 'No match.' : emptyText}</Text>
              ) : (
                filtered.map((option, index) => {
                  const active = option.value === value;
                  const newGroup = option.group && option.group !== filtered[index - 1]?.group;
                  return (
                    <View key={option.value}>
                      {newGroup ? <Text style={styles.selectGroup}>{option.group}</Text> : null}
                      <Tappable
                        onPress={() => {
                          if (option.disabled) return;
                          onChange(option.value);
                          setOpen(false);
                        }}
                        disabled={option.disabled}
                        style={[
                          styles.selectRow,
                          active && styles.selectRowActive,
                          option.disabled && styles.selectRowOff,
                        ]}
                      >
                        <View style={styles.flex}>
                          <Text style={[styles.selectRowLabel, active && { color: colors.primary }]}>
                            {option.label}
                          </Text>
                          {option.hint ? <Text style={styles.selectRowHint}>{option.hint}</Text> : null}
                        </View>
                        {option.tag ? (
                          <View style={styles.selectTag}>
                            <Text style={styles.selectTagText}>{option.tag}</Text>
                          </View>
                        ) : null}
                        {active ? (
                          <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                        ) : null}
                      </Tappable>
                    </View>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/**
 * `Physics 20/20 ✓` / `Chemistry 18/20 ⚠` — the per-section completion meter
 * the paper setter works against, with the per-type quota underneath.
 */
export function SectionProgress({
  name,
  current,
  target,
  complete,
  over,
  detail,
  warning,
}: {
  name: string;
  current: number;
  /** "20" or "22–26" for the formats published as a range. */
  target: string;
  complete: boolean;
  over?: boolean;
  detail?: { label: string; current: number; target: string; ok: boolean }[];
  warning?: string | null;
}) {
  const { colors, styles } = useStyles();
  const tone = complete ? colors.success : over ? colors.danger : colors.warning;
  const max = Math.max(1, Number(target.split('–').pop()) || current || 1);
  const ratio = Math.max(0, Math.min(1, current / max));

  return (
    <View style={styles.progressRow}>
      <View style={styles.progressHead}>
        <Text style={styles.progressName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.progressCount, { color: tone }]}>
          {current}/{target} {complete ? '✓' : '⚠'}
        </Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${ratio * 100}%`, backgroundColor: tone }]} />
      </View>
      {detail?.length ? (
        <View style={styles.progressDetail}>
          {detail.map((d) => (
            <View key={d.label} style={styles.progressChip}>
              <Text style={[styles.progressChipText, { color: d.ok ? colors.textDim : tone }]}>
                {d.label} {d.current}/{d.target}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {warning ? <Text style={[styles.progressWarning, { color: tone }]}>⚠ {warning}</Text> : null}
    </View>
  );
}

/**
 * Page control for the question lists: a range readout, page-size chips and
 * a compact page strip. Renders nothing when a single page holds everything,
 * so short banks stay uncluttered.
 */
export function Pagination({
  page,
  pageCount,
  from,
  to,
  total,
  pageSize,
  onPage,
  onPageSize,
  noun = 'question',
}: {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize?: (n: number) => void;
  noun?: string;
}) {
  const { colors, styles } = useStyles();
  const showSizes = !!onPageSize && total > PAGE_SIZES[0];
  if (pageCount <= 1 && !showSizes) return null;

  return (
    <View style={styles.pagination}>
      <View style={styles.paginationTop}>
        <Text style={styles.paginationRange}>
          {total === 0
            ? `No ${noun}s`
            : `Showing ${from}–${to} of ${total} ${noun}${total === 1 ? '' : 's'}`}
        </Text>
        {showSizes ? (
          <View style={styles.paginationSizes}>
            {PAGE_SIZES.map((size) => {
              const active = size === pageSize;
              return (
                <Tappable
                  key={size}
                  onPress={() => onPageSize?.(size)}
                  style={[styles.paginationSize, active && styles.paginationSizeActive]}
                >
                  <Text style={[styles.paginationSizeText, active && { color: colors.primary }]}>
                    {size === 0 ? 'All' : size}
                  </Text>
                </Tappable>
              );
            })}
          </View>
        ) : null}
      </View>

      {pageCount > 1 ? (
        <View style={styles.paginationPages}>
          <Tappable
            onPress={() => onPage(page - 1)}
            disabled={page <= 1}
            style={[styles.pageBtn, page <= 1 && styles.pageBtnOff]}
          >
            <Ionicons name="chevron-back" size={16} color={colors.text} />
          </Tappable>

          {pageWindow(page, pageCount).map((p, i) =>
            p === null ? (
              <Text key={`gap-${i}`} style={styles.pageGap}>
                …
              </Text>
            ) : (
              <Tappable
                key={p}
                onPress={() => onPage(p)}
                style={[styles.pageBtn, p === page && styles.pageBtnActive]}
              >
                <Text style={[styles.pageBtnText, p === page && { color: colors.onAccent }]}>
                  {p}
                </Text>
              </Tappable>
            )
          )}

          <Tappable
            onPress={() => onPage(page + 1)}
            disabled={page >= pageCount}
            style={[styles.pageBtn, page >= pageCount && styles.pageBtnOff]}
          >
            <Ionicons name="chevron-forward" size={16} color={colors.text} />
          </Tappable>
        </View>
      ) : null}
    </View>
  );
}

/** On/off switch with an explanatory line — used for policy flags. */
export function Toggle({
  label,
  value,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  const { colors, styles } = useStyles();
  return (
    <Tappable
      onPress={() => !disabled && onChange(!value)}
      disabled={disabled}
      style={[styles.toggleRow, disabled && styles.selectFieldOff]}
    >
      <View style={styles.flex}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {hint ? <Text style={styles.toggleHint}>{hint}</Text> : null}
      </View>
      <View style={[styles.toggleTrack, value && { backgroundColor: colors.primary }]}>
        <View style={[styles.toggleKnob, value && styles.toggleKnobOn]} />
      </View>
    </Tappable>
  );
}

const ALARMING = ['missing', 'leaked', 'critical'];

/** Stamp-in mount animation: badges land like a rubber stamp being pressed onto paper. */
function useStampIn() {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.spring(t, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 9 });
    anim.start();
    return () => anim.stop();
  }, [t]);
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [1.7, 1] });
  const rotate = t.interpolate({ inputRange: [0, 1], outputRange: ['-6deg', '-1.5deg'] });
  const opacity = t.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] });
  return { transform: [{ scale }, { rotate }], opacity };
}

export function Badge({ status }: { status: string }) {
  const { colors, styles } = useStyles();
  const tone = toneFor(colors, status);
  const pulse = usePulse(1, 1.6, 800);
  const stamp = useStampIn();
  const alarming = ALARMING.includes(status);
  return (
    <Animated.View style={[styles.badge, { backgroundColor: `${tone}1A`, borderColor: `${tone}66` }, stamp]}>
      <Animated.View style={[styles.badgeDot, { backgroundColor: tone }, alarming && pulse]} />
      <Text style={[styles.badgeText, { color: tone }]}>{labelFor(status).toUpperCase()}</Text>
    </Animated.View>
  );
}

export function Stat({
  label,
  value,
  tone,
  delay = 0,
}: {
  label: string;
  value: number | string;
  tone?: string;
  delay?: number;
}) {
  const { colors, styles } = useStyles();
  const numeric = typeof value === 'number';
  const counted = useCountUp(numeric ? (value as number) : 0);
  const accent = tone ?? colors.primary;
  return (
    <Reveal delay={delay} scale style={styles.statFlex}>
      <View style={styles.stat}>
        <LinearGradient
          colors={[accent, `${accent}00`]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.statAccent}
        />
        <Text style={[styles.statValue, { color: tone ?? colors.text }]}>
          {numeric ? counted : value}
        </Text>
        <Text style={styles.statLabel}>{label}</Text>
      </View>
    </Reveal>
  );
}

export function RolePicker({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  const { colors, styles } = useStyles();
  const roles: { role: Role; icon: keyof typeof Ionicons.glyphMap }[] = [
    { role: 'teacher', icon: 'school-outline' },
    { role: 'paper_setter', icon: 'create-outline' },
    { role: 'admin', icon: 'shield-checkmark-outline' },
  ];
  return (
    <View style={styles.roleRow}>
      {roles.map(({ role, icon }) => {
        const active = role === value;
        return (
          <Tappable
            key={role}
            onPress={() => onChange(role)}
            style={[styles.roleTab, active && styles.roleTabActive]}
            wrapperStyle={styles.flex}
            pressScale={0.96}
            hoverScale={1.03}
          >
            <Ionicons name={icon} size={22} color={active ? colors.primary : colors.textDim} />
            <Text style={[styles.roleTabText, active && { color: colors.primary }]}>
              {ROLE_LABEL[role]}
            </Text>
          </Tappable>
        );
      })}
    </View>
  );
}

/** Sun/moon pill that flips the app between light and dark (spins on toggle). */
export function ThemeToggle() {
  const { colors, isDark, toggle } = useTheme();
  const spin = useRef(new Animated.Value(isDark ? 1 : 0)).current;
  const press = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.spring(spin, { toValue: isDark ? 1 : 0, useNativeDriver: true, speed: 12, bounciness: 8 }).start();
  }, [isDark, spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const to = (v: number) => Animated.spring(press, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  return (
    <Pressable
      onPress={toggle}
      hitSlop={10}
      onPressIn={() => to(0.8)}
      onPressOut={() => to(1)}
      {...({ onHoverIn: () => to(1.15), onHoverOut: () => to(1) } as object)}
      style={{ paddingHorizontal: spacing.md }}
    >
      <Animated.View style={{ transform: [{ scale: press }, { rotate }] }}>
        <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={20} color={colors.textDim} />
      </Animated.View>
    </Pressable>
  );
}

export function SignOutButton() {
  const { colors } = useTheme();
  const { signOut } = useAuth();
  return (
    <PressableIcon
      name="log-out-outline"
      size={22}
      color={colors.textDim}
      onPress={() => void signOut()}
      style={{ paddingHorizontal: spacing.md }}
    />
  );
}

/** Header cluster: theme toggle + sign out, used as `headerRight`. */
export function HeaderActions() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <ThemeToggle />
      <SignOutButton />
    </View>
  );
}

/* --------------------------- ceremony modal ------------------------------ */

export interface ModalField {
  key: string;
  label: string;
  placeholder?: string;
  secure?: boolean;
  numeric?: boolean;
  defaultValue?: string;
}

/**
 * Generic modal for the cryptographic ceremonies (seal, co-sign, print) and
 * other small forms. Field values are returned as a key -> string record.
 */
export function CeremonyModal({
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
  fields: ModalField[];
  submitLabel: string;
  busy?: boolean;
  onSubmit: (values: Record<string, string>) => void;
  onClose: () => void;
}) {
  const { colors, styles } = useStyles();
  const [values, setValues] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (visible) {
      const initial: Record<string, string> = {};
      for (const field of fields) initial[field.key] = field.defaultValue ?? '';
      setValues(initial);
    }
    // Re-initialize only when the modal opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <BlurView intensity={28} tint={colors.blurTint} style={StyleSheet.absoluteFill} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalBackdrop}
      >
        <Reveal scale>
          <View style={styles.modalCard}>
            <LinearGradient
              colors={gradients.brand}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.modalTopBar}
            />
            <Text style={styles.modalTitle}>{title}</Text>
            {subtitle ? <Text style={styles.modalSubtitle}>{subtitle}</Text> : null}
            {fields.map((field) => (
              <Input
                key={field.key}
                label={field.label}
                placeholder={field.placeholder}
                secureTextEntry={field.secure}
                keyboardType={field.numeric ? 'number-pad' : 'default'}
                autoCapitalize="none"
                value={values[field.key] ?? ''}
                onChangeText={(text) => setValues((prev) => ({ ...prev, [field.key]: text }))}
              />
            ))}
            <Button title={submitLabel} loading={busy} onPress={() => onSubmit(values)} />
            <Button title="Cancel" variant="ghost" onPress={onClose} style={{ marginTop: spacing.sm }} />
          </View>
        </Reveal>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* --------------------------------- styles -------------------------------- */

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1 },
    scrollTransparent: { flex: 1, backgroundColor: 'transparent' },
    screen: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    screenContent: {
      padding: spacing.lg,
      paddingBottom: spacing.xl * 2,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      marginBottom: spacing.md,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: colors.blurTint === 'dark' ? 0.35 : 0.1,
      shadowRadius: 18,
      elevation: 4,
    },
    cardGlass: {
      backgroundColor: colors.glass,
      borderColor: colors.glassBorder,
    },
    sectionTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    sectionTitleLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    sectionBar: { width: 4, height: 16, borderRadius: 2 },
    sectionTitle: { fontFamily: serif, fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
    empty: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
    emptyIconWrap: {
      width: 76,
      height: 76,
      borderRadius: 38,
      borderWidth: 1,
      borderColor: colors.glassBorder,
      backgroundColor: colors.primarySoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.xs,
    },
    emptyTitle: { color: colors.text, fontWeight: '700', fontSize: 15 },
    emptySubtitle: { color: colors.textDim, fontSize: 13, textAlign: 'center', lineHeight: 19 },
    button: {
      borderRadius: radius.md,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    buttonGlow: {
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.45,
      shadowRadius: 16,
      elevation: 6,
      borderRadius: radius.md,
    },
    buttonInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    buttonGhost: { borderWidth: 1, borderColor: colors.borderLight, backgroundColor: 'transparent' },
    buttonText: { fontWeight: '800', fontSize: 15, letterSpacing: 0.3 },
    inputLabel: { color: colors.textDim, fontSize: 13, fontWeight: '600', marginBottom: 6 },
    input: {
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      color: colors.text,
      paddingHorizontal: spacing.md,
      paddingVertical: 12,
      fontSize: 15,
    },
    inputFocused: {
      borderColor: colors.accent,
      backgroundColor: colors.primarySoft,
      shadowColor: colors.accent,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.5,
      shadowRadius: 10,
      elevation: 4,
    },
    stepperRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    stepperBtn: {
      width: 48,
      height: 48,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.borderLight,
      backgroundColor: colors.glass,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepperBtnOff: { opacity: 0.4 },
    stepperValueWrap: {
      flex: 1,
      height: 48,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    stepperValue: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '800',
      textAlign: 'center',
      minWidth: 40,
      paddingVertical: 0,
    },
    stepperSuffix: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
    selectField: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: 12,
    },
    selectFieldOff: { opacity: 0.5 },
    selectValue: { color: colors.text, fontSize: 15, fontWeight: '600' },
    selectPlaceholder: { color: colors.textFaint, fontSize: 15 },
    selectHint: { color: colors.textDim, fontSize: 11, marginTop: 2 },
    selectSheet: { maxHeight: '82%' },
    selectSheetHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    selectGroup: {
      color: colors.accent,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    selectRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    selectRowActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
    selectRowOff: { opacity: 0.4 },
    selectRowLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
    selectRowHint: { color: colors.textDim, fontSize: 11, marginTop: 2, lineHeight: 15 },
    selectTag: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    selectTagText: { color: colors.warning, fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },
    selectEmpty: { color: colors.textDim, fontSize: 13, fontStyle: 'italic', padding: spacing.md },
    pagination: { marginVertical: spacing.sm, gap: spacing.sm },
    paginationTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    paginationRange: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
    paginationSizes: { flexDirection: 'row', gap: 4 },
    paginationSize: {
      minWidth: 34,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sm,
      paddingHorizontal: 8,
      paddingVertical: 4,
      backgroundColor: colors.surfaceAlt,
    },
    paginationSizeActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
    paginationSizeText: { color: colors.textDim, fontSize: 11, fontWeight: '800' },
    paginationPages: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
    pageBtn: {
      minWidth: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sm,
      paddingHorizontal: 6,
      backgroundColor: colors.surfaceAlt,
    },
    pageBtnActive: { borderColor: 'transparent', backgroundColor: colors.primary },
    pageBtnOff: { opacity: 0.4 },
    pageBtnText: { color: colors.text, fontSize: 12, fontWeight: '800' },
    pageGap: { color: colors.textFaint, fontSize: 12, paddingHorizontal: 2 },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      marginBottom: spacing.md,
    },
    toggleLabel: { color: colors.text, fontSize: 14, fontWeight: '700' },
    toggleHint: { color: colors.textDim, fontSize: 11, marginTop: 2, lineHeight: 16 },
    toggleTrack: {
      width: 46,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.borderLight,
      padding: 3,
      justifyContent: 'center',
    },
    toggleKnob: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.surface,
    },
    toggleKnobOn: { alignSelf: 'flex-end' },
    progressRow: { marginBottom: spacing.md },
    progressHead: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
    progressName: { color: colors.text, fontSize: 14, fontWeight: '700', flex: 1 },
    progressCount: { fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
    progressTrack: {
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.surfaceAlt,
      overflow: 'hidden',
      marginTop: 6,
    },
    progressFill: { height: '100%', borderRadius: 3 },
    progressDetail: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 6 },
    progressChip: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    progressChipText: { fontSize: 10, fontWeight: '700' },
    progressWarning: { fontSize: 12, marginTop: 6, lineHeight: 17 },
    chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 8,
      backgroundColor: colors.surfaceAlt,
      overflow: 'hidden',
    },
    chipActive: { borderColor: 'transparent' },
    chipText: { color: colors.textDim, fontWeight: '700', fontSize: 13 },
    chipTextActive: { color: colors.onAccent },
    examRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 2 },
    examPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.surfaceAlt,
      overflow: 'hidden',
      maxWidth: 240,
    },
    examPillActive: { borderColor: 'transparent' },
    examName: { color: colors.text, fontWeight: '700', fontSize: 13 },
    examDate: { color: colors.textDim, fontSize: 11, marginTop: 1 },
    examTextActive: { color: colors.onAccent },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderWidth: 1.5,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
      alignSelf: 'flex-start',
    },
    badgeDot: { width: 6, height: 6, borderRadius: 3 },
    badgeText: { fontFamily: serif, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
    statFlex: { flexGrow: 1, flexBasis: 140, minWidth: 140 },
    stat: {
      flex: 1,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
      padding: spacing.md,
      paddingTop: spacing.md + 4,
      alignItems: 'center',
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: colors.blurTint === 'dark' ? 0.3 : 0.08,
      shadowRadius: 14,
      elevation: 3,
    },
    statAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
    statValue: { fontSize: 24, fontWeight: '900' },
    statLabel: { color: colors.textDim, fontSize: 11, marginTop: 2, textAlign: 'center', fontWeight: '600' },
    roleRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
    roleTab: {
      flex: 1,
      alignItems: 'center',
      gap: 5,
      paddingVertical: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    roleTabActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
    roleTabText: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
    modalBackdrop: {
      flex: 1,
      backgroundColor: colors.backdrop,
      justifyContent: 'center',
      padding: spacing.xl,
    },
    modalCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.glassBorder,
      padding: spacing.xl,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 20 },
      shadowOpacity: 0.4,
      shadowRadius: 30,
      elevation: 12,
    },
    modalTopBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
    modalTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 4 },
    modalSubtitle: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginBottom: spacing.lg },
  });
