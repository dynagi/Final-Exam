import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';
import { gradients, serif, spacing } from '../lib/theme';
import { Aurora } from './Aurora';
import GradientText from './GradientText';

const BOOT_LINES = [
  'SEALING YOUR SESSION',
  'VERIFYING CREDENTIALS',
  'PREPARING QUESTION BANK',
  'ALIGNING ANSWER SHEETS',
];

const EXAM_ICONS: (keyof typeof Ionicons.glyphMap)[] = [
  'checkmark-circle-outline',
  'document-text-outline',
  'time-outline',
  'ribbon-outline',
  'book-outline',
  'clipboard-outline',
];

/** Full-screen boot animation: a rotating pen over a blurred ink-blot backdrop, with drifting exam iconography. */
export default function LoadingScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(), []);
  const [lineIndex, setLineIndex] = useState(0);
  const lineOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    const cycle = () => {
      Animated.timing(lineOpacity, { toValue: 1, duration: 260, useNativeDriver: true }).start(() => {
        if (cancelled) return;
        setTimeout(() => {
          if (cancelled) return;
          Animated.timing(lineOpacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
            if (cancelled) return;
            setLineIndex((i) => (i + 1) % BOOT_LINES.length);
            cycle();
          });
        }, 950);
      });
    };
    cycle();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <Aurora intensity={0.9} />
      <BlurView
        intensity={Platform.OS === 'web' ? 26 : 46}
        tint={colors.blurTint}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <FloatingIcons />

      <View style={styles.center}>
        <RotatingPen />
        <GradientText colors={gradients.brand} style={styles.title}>
          SecureAIExam
        </GradientText>
        <View style={styles.lineRow}>
          <Text style={[styles.caret, { color: colors.accent }]}>✒</Text>
          <Animated.Text style={[styles.bootLine, { color: colors.textDim, opacity: lineOpacity }]}>
            {BOOT_LINES[lineIndex]}
          </Animated.Text>
        </View>
        <PencilUnderline />
      </View>
    </View>
  );
}

/** A pen spins at the center, orbited by a slow dashed ring — a compass/seal-like loading mark. */
function RotatingPen() {
  const { colors } = useTheme();
  const spin = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const a = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1900, easing: Easing.linear, useNativeDriver: true }));
    const b = Animated.loop(Animated.timing(ring, { toValue: 1, duration: 5400, easing: Easing.linear, useNativeDriver: true }));
    const c = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    a.start();
    b.start();
    c.start();
    return () => {
      a.stop();
      b.stop();
      c.stop();
    };
  }, [spin, ring, bob]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const ringRotate = ring.interpolate({ inputRange: [0, 1], outputRange: ['360deg', '0deg'] });
  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });
  // Ring and nib scaled together so the pen keeps its clearance inside the orbit.
  const size = 168;
  const penSize = 70;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg }}>
      <Animated.View style={{ position: 'absolute', transform: [{ rotate: ringRotate }] }}>
        <Svg width={size} height={size}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={size / 2 - 5}
            stroke={colors.accent}
            strokeWidth={1.5}
            strokeDasharray="3 7"
            fill="none"
            opacity={0.55}
          />
        </Svg>
      </Animated.View>
      <Animated.View
        style={{
          transform: [{ translateY }, { rotate }],
          shadowColor: colors.accent,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.6,
          shadowRadius: 18,
        }}
      >
        <Ionicons name="pencil" size={penSize} color={colors.accent} />
      </Animated.View>
    </View>
  );
}

/** A thin gold rule that draws itself in, like a pen underlining a heading — used as the progress cue. */
function PencilUnderline() {
  const { colors } = useTheme();
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: false }),
        Animated.delay(300),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [t]);
  const width = t.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <View style={{ width: 190, height: 3, borderRadius: 2, overflow: 'hidden', backgroundColor: colors.border, marginTop: spacing.xl }}>
      <Animated.View style={{ height: 3, width, backgroundColor: colors.accent }} />
    </View>
  );
}

/** Exam iconography — checkmarks, documents, ribbons — drifting slowly in the foreground. */
function FloatingIcons() {
  const { colors } = useTheme();
  const { width, height } = Dimensions.get('window');
  const items = useMemo(
    () =>
      Array.from({ length: 10 }, (_, i) => ({
        icon: EXAM_ICONS[i % EXAM_ICONS.length],
        x: Math.random() * width,
        y: Math.random() * height,
        size: 16 + Math.random() * 12,
        dur: 3000 + Math.random() * 2600,
        delay: Math.random() * 2200,
        drift: 14 + Math.random() * 18,
      })),
    [width, height]
  );
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {items.map((it, i) => (
        <FloatingIcon key={i} {...it} color={colors.accent} />
      ))}
    </View>
  );
}

function FloatingIcon({
  icon,
  x,
  y,
  size,
  dur,
  delay,
  drift,
  color,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  x: number;
  y: number;
  size: number;
  dur: number;
  delay: number;
  drift: number;
  color: string;
}) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: dur, delay, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [t, dur, delay]);

  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, -drift] });
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [0.14, 0.42] });

  return (
    <Animated.View style={{ position: 'absolute', left: x, top: y, opacity, transform: [{ translateY }] }}>
      <Ionicons name={icon} size={size} color={color} />
    </Animated.View>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    center: { alignItems: 'center' },
    title: { fontFamily: serif, fontSize: 26, fontWeight: '700', letterSpacing: 0.4 },
    lineRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, height: 16 },
    caret: { fontSize: 13 },
    bootLine: { fontFamily: serif, fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  });
