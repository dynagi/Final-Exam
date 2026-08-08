import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import Svg, { Ellipse, Line, Path } from 'react-native-svg';
import { serif } from '../lib/theme';
import { usePressableScale } from './anim';

/**
 * Shared "storybook" visual language for every auth screen (Book, Login,
 * SignUp, CenterLogin) — a fixed parchment/ink/gold palette independent of
 * the app's light/dark theme, so the book always looks like paper.
 */
export const PAPER = '#F3E8CC';
export const PAPER_SHADE = '#E9DAB4';
export const INK = '#3B2E1F';
export const INK_DIM = '#6B5842';
export const GOLD = '#A9812F';
export const COVER = '#1B140D';
export const COVER_GOLD = '#D8B85C';

/* --------------------------------- layout -------------------------------- */

/** Responsive book sizing — side-by-side pages on wide screens, stacked on phones. */
export function useBookLayout() {
  const { width: winWidth } = Dimensions.get('window');
  const stacked = winWidth < 700;
  const bookWidth = Math.min(stacked ? winWidth - 32 : winWidth - 48, 860);
  const pageWidth = stacked ? bookWidth : bookWidth / 2;
  return { stacked, bookWidth, pageWidth };
}

export function BookBanner() {
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>SECURE AI EXAM SYSTEM — VOL. 1</Text>
    </View>
  );
}

export function Page({
  children,
  style,
  width,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  width: number;
}) {
  return (
    <View style={[styles.page, { width }, style]}>
      <LinearGradient colors={[PAPER, PAPER_SHADE]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={styles.pageInner}>{children}</View>
    </View>
  );
}

/** The two-page spread shell — pass full page content as `left`/`right`. */
export function BookSpread({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  const { stacked, bookWidth, pageWidth } = useBookLayout();
  return (
    <View style={{ width: bookWidth }}>
      <View style={[styles.book, stacked && styles.bookStacked]}>
        <Page width={pageWidth} style={!stacked && styles.leftCorners}>
          {left}
        </Page>
        {!stacked && <View style={styles.spine} />}
        <Page width={pageWidth} style={stacked ? { marginTop: 16 } : styles.rightCorners}>
          {right}
        </Page>
      </View>
    </View>
  );
}

/* ------------------------------- ornaments -------------------------------- */

/** Simple stylized quill-over-scroll ornament, drawn from primitive SVG shapes. */
export function QuillAndScroll() {
  return (
    <Svg width={120} height={70} viewBox="0 0 120 70">
      <Ellipse cx={20} cy={50} rx={8} ry={10} fill="none" stroke={INK_DIM} strokeWidth={2} />
      <Path d="M 20 40 H 92" stroke={INK_DIM} strokeWidth={2} fill="none" />
      <Path d="M 20 60 H 92" stroke={INK_DIM} strokeWidth={2} fill="none" />
      <Ellipse cx={92} cy={50} rx={8} ry={10} fill="none" stroke={INK_DIM} strokeWidth={2} />
      <Line x1={30} y1={14} x2={78} y2={54} stroke={INK} strokeWidth={2.5} />
      <Path d="M 30 14 C 20 10, 14 2, 16 2 C 18 2, 30 4, 34 18 Z" fill={GOLD} opacity={0.85} />
      <Ellipse cx={79} cy={56} rx={2} ry={2} fill={INK} />
    </Svg>
  );
}

export function BookBadge({
  icon,
  gradient = ['#2A4B7C', '#4A7AB8'],
  glowColor = '#2A4B7C',
}: {
  icon: keyof typeof Ionicons.glyphMap;
  gradient?: readonly [string, string];
  glowColor?: string;
}) {
  return (
    <View style={[styles.badge, { shadowColor: glowColor }]}>
      <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Ionicons name={icon} size={30} color="#fff" />
    </View>
  );
}

/** Small pill under a form heading — the role a Login form is locked to (role is chosen back on the Book menu). */
export function RoleTag({ label }: { label: string }) {
  return (
    <View style={styles.roleTag}>
      <Text style={styles.roleTagText}>SIGNING IN AS {label.toUpperCase()}</Text>
    </View>
  );
}

/* ------------------------------- controls --------------------------------- */

export function BookInput({
  icon,
  label,
  style,
  onFocus,
  onBlur,
  ...rest
}: { icon?: keyof typeof Ionicons.glyphMap; label?: string } & TextInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.inputGroup}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      <View style={[styles.inputWrap, focused && styles.inputWrapFocused]}>
        {icon ? <Ionicons name={icon} size={16} color={INK_DIM} style={styles.inputIcon} /> : null}
        <TextInput
          placeholderTextColor={`${INK_DIM}99`}
          style={[styles.input, style]}
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
    </View>
  );
}

export function BookCheckbox({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <Pressable onPress={onToggle} style={styles.checkboxRow}>
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        {checked ? <Ionicons name="checkmark" size={12} color={PAPER} /> : null}
      </View>
      <Text style={styles.checkboxLabel}>{label}</Text>
    </Pressable>
  );
}

/** Ornate oval brass-plaque button — the book's primary call to action. */
export function SealButton({
  title,
  onPress,
  loading,
  disabled,
  icon,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const { handlers, style: scaleStyle } = usePressableScale();
  return (
    <Animated.View style={[scaleStyle, styles.sealGlow]}>
      <Pressable
        onPress={onPress}
        disabled={disabled || loading}
        {...handlers}
        style={({ pressed }) => [styles.seal, { opacity: disabled || loading ? 0.55 : pressed ? 0.92 : 1 }]}
      >
        <LinearGradient
          colors={['#E4C878', '#A9812F', '#8A6D23']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {loading ? (
          <ActivityIndicator color={INK} />
        ) : (
          <View style={styles.sealInner}>
            {icon ? <Ionicons name={icon} size={16} color={INK} /> : null}
            <Text style={styles.sealText}>{title}</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

/* --------------------------------- styles --------------------------------- */

const styles = StyleSheet.create({
  banner: {
    backgroundColor: COVER,
    borderWidth: 1,
    borderColor: COVER_GOLD,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
    marginBottom: 16,
  },
  bannerText: { color: COVER_GOLD, fontFamily: serif, fontWeight: '700', fontSize: 13, letterSpacing: 1.4 },
  page: {
    minHeight: 460,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#0000001A',
  },
  pageInner: { flex: 1, padding: 20 },
  book: {
    flexDirection: 'row',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.35,
    shadowRadius: 28,
    elevation: 12,
  },
  bookStacked: { flexDirection: 'column' },
  leftCorners: { borderTopRightRadius: 0, borderBottomRightRadius: 0 },
  rightCorners: { borderTopLeftRadius: 0, borderBottomLeftRadius: 0 },
  spine: { width: 10, backgroundColor: '#00000022' },
  badge: {
    width: 68,
    height: 68,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 14,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 16,
    elevation: 8,
  },
  roleTag: {
    alignSelf: 'flex-start',
    backgroundColor: `${GOLD}22`,
    borderWidth: 1,
    borderColor: `${GOLD}66`,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 16,
  },
  roleTagText: { fontFamily: serif, fontSize: 10, fontWeight: '700', color: GOLD, letterSpacing: 1 },
  inputGroup: { marginBottom: 14 },
  inputLabel: { fontFamily: serif, fontSize: 12, fontWeight: '700', color: INK_DIM, marginBottom: 6, letterSpacing: 0.5 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.4)',
    borderWidth: 1,
    borderColor: 'rgba(59,46,31,0.25)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  inputWrapFocused: { borderColor: GOLD, backgroundColor: 'rgba(255,255,255,0.7)' },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, fontFamily: serif, fontSize: 14, color: INK, padding: 0 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: {
    width: 17,
    height: 17,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: INK_DIM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: GOLD, borderColor: GOLD },
  checkboxLabel: { fontFamily: serif, fontSize: 12, color: INK_DIM },
  sealGlow: {
    shadowColor: '#8A6D23',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  seal: {
    borderRadius: 999,
    borderWidth: 2,
    borderColor: INK,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sealInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sealText: { fontFamily: serif, fontWeight: '800', fontSize: 14, letterSpacing: 1.5, color: INK },
});
