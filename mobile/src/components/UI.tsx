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
