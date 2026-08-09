/**
 * ScrollAlert — a royal-decree popup.
 *
 * Used where a rule has to be stated firmly and centrally: the paper setter
 * trying to put more questions into a section than the exam format allows.
 * A refused tap should feel like a proclamation, not a toast, so the notice
 * unfurls in the middle of the screen like a scroll being unrolled between
 * two gilded rods, sealed with wax.
 *
 * The whole animation runs off one non-native Animated.Value: the parchment's
 * height is interpolated (a layout property, so the native driver is out) and
 * every other property is derived from the same value to stay in step. The
 * unfurling body is keyed on its text, so a new notice remounts and measures
 * itself instead of inheriting the previous one's height.
 */
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { radius, serif, spacing } from '../lib/theme';

const PARCHMENT = '#F3E8CC';
const PARCHMENT_EDGE = '#DCC79A';
const INK = '#3B2E1F';
const INK_DIM = '#6B5842';
const GOLD = '#A9812F';
const GOLD_LIGHT = '#D8B85C';
const WAX = '#8B2E2E';
const SCROLL_WIDTH = 340;

export interface ScrollAlertContent {
  title: string;
  message: string;
  /** Optional emphasised line, e.g. "Physics  25 / 25". */
  detail?: string;
}

export default function ScrollAlert({
  content,
  onClose,
  dismissLabel = 'Understood',
}: {
  /** Null hides the scroll; setting it opens and unfurls a fresh notice. */
  content: ScrollAlertContent | null;
  onClose: () => void;
  dismissLabel?: string;
}) {
  const { colors } = useTheme();

  return (
    <Modal transparent visible={!!content} animationType="fade" onRequestClose={onClose}>
      <BlurView intensity={30} tint={colors.blurTint} style={StyleSheet.absoluteFill} />
      <Pressable style={styles.backdrop} onPress={onClose}>
        {content ? (
          <Unfurl
            key={`${content.title}|${content.message}|${content.detail ?? ''}`}
            content={content}
            onClose={onClose}
            dismissLabel={dismissLabel}
          />
        ) : null}
      </Pressable>
    </Modal>
  );
}

/** The scroll itself: rods, unrolling parchment, wax seal. */
function Unfurl({
  content,
  onClose,
  dismissLabel,
}: {
  content: ScrollAlertContent;
  onClose: () => void;
  dismissLabel: string;
}) {
  // 0 = rolled up, 1 = fully unfurled.
  const unfurl = useRef(new Animated.Value(0)).current;
  // The parchment's natural height, reported by the content inside the clip.
  const [bodyHeight, setBodyHeight] = useState(0);

  useEffect(() => {
    if (!bodyHeight) return;
    unfurl.setValue(0);
    const anim = Animated.timing(unfurl, {
      toValue: 1,
      duration: 640,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [bodyHeight, unfurl]);

  const height = unfurl.interpolate({ inputRange: [0, 1], outputRange: [0, bodyHeight] });
  const opacity = unfurl.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 1] });
  const scaleX = unfurl.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.84, 1.02, 1] });
  const sealScale = unfurl.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0, 0, 1] });
  const sealRotate = unfurl.interpolate({ inputRange: [0, 1], outputRange: ['-45deg', '-8deg'] });

  return (
    // Swallow taps on the scroll itself so only the backdrop dismisses.
    <Pressable onPress={() => {}}>
      <Animated.View style={[styles.scroll, { transform: [{ scaleX }] }]}>
        <Rod />

        <Animated.View
          style={[styles.parchmentClip, bodyHeight ? { height, opacity } : styles.premeasure]}
        >
          {/* Laid out at its natural height inside the clip; the clip's
              animated height is what reveals it. */}
          <View
            style={styles.parchment}
            onLayout={(e) => {
              const h = Math.ceil(e.nativeEvent.layout.height);
              if (h && h !== bodyHeight) setBodyHeight(h);
            }}
          >
            <View style={styles.body}>
              <Text style={styles.flourish}>❦</Text>
              <Text style={styles.title}>{content.title}</Text>
              <View style={styles.rule} />
              <Text style={styles.message}>{content.message}</Text>
              {content.detail ? <Text style={styles.detail}>{content.detail}</Text> : null}
              <Pressable onPress={onClose} style={styles.button}>
                <LinearGradient
                  colors={[WAX, '#B8453F']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
                <Text style={styles.buttonText}>{dismissLabel}</Text>
              </Pressable>
            </View>
          </View>

          <LinearGradient
            colors={['rgba(59,46,31,0.22)', 'transparent']}
            style={styles.shadowTop}
            pointerEvents="none"
          />
          <LinearGradient
            colors={['transparent', 'rgba(59,46,31,0.22)']}
            style={styles.shadowBottom}
            pointerEvents="none"
          />
        </Animated.View>

        <Rod />

        <Animated.View
          style={[styles.seal, { transform: [{ scale: sealScale }, { rotate: sealRotate }] }]}
          pointerEvents="none"
        >
          <Ionicons name="ribbon" size={20} color={GOLD_LIGHT} />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

/** One gilded rod with rounded finials — what the scroll winds around. */
function Rod() {
  return (
    <View style={styles.rodRow}>
      <View style={styles.finial} />
      <LinearGradient
        colors={[GOLD, GOLD_LIGHT, GOLD]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.rod}
      />
      <View style={styles.finial} />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  scroll: { width: SCROLL_WIDTH, maxWidth: '100%', alignItems: 'stretch' },
  rodRow: { flexDirection: 'row', alignItems: 'center' },
  rod: {
    flex: 1,
    height: 14,
    borderRadius: 7,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 5,
  },
  finial: {
    width: 16,
    height: 20,
    borderRadius: 8,
    backgroundColor: GOLD_LIGHT,
    borderWidth: 1,
    borderColor: GOLD,
  },
  parchmentClip: { overflow: 'hidden', marginHorizontal: 8 },
  /** Before the first measurement: laid out, but invisible and zero-height. */
  premeasure: { height: 0, opacity: 0 },
  parchment: {
    backgroundColor: PARCHMENT,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: PARCHMENT_EDGE,
  },
  shadowTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 14 },
  shadowBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 14 },
  body: { padding: spacing.xl, alignItems: 'center' },
  flourish: { color: GOLD, fontSize: 18, marginBottom: 2 },
  title: {
    color: INK,
    fontFamily: serif,
    fontSize: 19,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  rule: { width: 90, height: 1, backgroundColor: GOLD, marginVertical: spacing.md, opacity: 0.7 },
  message: {
    color: INK_DIM,
    fontFamily: serif,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  detail: {
    color: INK,
    fontFamily: serif,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: spacing.md,
    letterSpacing: 0.4,
  },
  button: {
    marginTop: spacing.xl,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 34,
    overflow: 'hidden',
  },
  buttonText: {
    color: PARCHMENT,
    fontFamily: serif,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  seal: {
    position: 'absolute',
    bottom: -12,
    alignSelf: 'center',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: WAX,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#6E2222',
  },
});
