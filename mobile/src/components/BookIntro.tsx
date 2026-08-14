/**
 * One-shot cinematic played the moment a teacher signs in: a book far away
 * in the dark zooms toward the viewer, the signed-in name + role fade in,
 * then the cover swings open (same rotateY/perspective trick as the cover
 * open in BookScreen.tsx) to hand off into the app.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { COVER, COVER_GOLD, GOLD } from './BookUI';
import { serif } from '../lib/theme';

const ZOOM_DURATION = 900;
const HOLD_AFTER_ZOOM = 650;
const OPEN_DURATION = 700;

export default function BookIntro({
  name,
  role,
  onDone,
}: {
  name: string;
  role: string;
  onDone: () => void;
}) {
  const zoom = useRef(new Animated.Value(0)).current;
  const cover = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const sequence = Animated.sequence([
      Animated.spring(zoom, {
        toValue: 1,
        useNativeDriver: true,
        speed: 3,
        bounciness: 9,
      }),
      Animated.delay(HOLD_AFTER_ZOOM),
      Animated.timing(cover, {
        toValue: 1,
        duration: OPEN_DURATION,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    sequence.start(({ finished }) => {
      if (finished) onDone();
    });
    return () => sequence.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const badgeScale = zoom.interpolate({ inputRange: [0, 1], outputRange: [0.28, 1] });
  const badgeOpacity = zoom.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 1] });
  const textOpacity = zoom.interpolate({ inputRange: [0, 0.55, 0.85, 1], outputRange: [0, 0, 1, 1] });
  const textTranslate = zoom.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });

  const coverRotate = cover.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-118deg'] });
  const coverOpacity = cover.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] });
  const stageOpacity = cover.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  return (
    <View style={styles.stage}>
      <Animated.View style={[styles.center, { opacity: stageOpacity }]}>
        <Animated.View
          style={[
            styles.bookWrap,
            { opacity: coverOpacity, transform: [{ perspective: 1400 }, { rotateY: coverRotate }] },
          ]}
        >
          <Animated.View
            style={[styles.book, { opacity: badgeOpacity, transform: [{ scale: badgeScale }] }]}
          >
            <View style={styles.badge}>
              <Ionicons name="shield-checkmark" size={34} color={COVER_GOLD} />
            </View>
            <Text style={styles.bookTitle}>SECURE AI{'\n'}EXAM SYSTEM</Text>
          </Animated.View>
        </Animated.View>

        <Animated.View
          style={[styles.textWrap, { opacity: textOpacity, transform: [{ translateY: textTranslate }] }]}
        >
          <Text style={styles.welcome}>Welcome back,</Text>
          <Text style={styles.name}>{name}</Text>
          <View style={styles.rolePill}>
            <Text style={styles.roleText}>{role.toUpperCase()}</Text>
          </View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0A0704',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  bookWrap: { alignItems: 'center' },
  book: { alignItems: 'center' },
  badge: {
    width: 110,
    height: 110,
    borderRadius: 26,
    backgroundColor: COVER,
    borderWidth: 2,
    borderColor: COVER_GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: COVER_GOLD,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 10,
  },
  bookTitle: {
    fontFamily: serif,
    fontWeight: '700',
    fontSize: 15,
    color: COVER_GOLD,
    textAlign: 'center',
    letterSpacing: 1.4,
    lineHeight: 20,
  },
  textWrap: { alignItems: 'center', marginTop: 28 },
  welcome: { fontFamily: serif, fontSize: 14, color: '#C9B98C', letterSpacing: 0.6 },
  name: {
    fontFamily: serif,
    fontWeight: '700',
    fontSize: 24,
    color: '#F3E8CC',
    marginTop: 4,
    textAlign: 'center',
  },
  rolePill: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: `${GOLD}88`,
    backgroundColor: `${GOLD}22`,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  roleText: { fontFamily: serif, fontSize: 11, fontWeight: '700', color: GOLD, letterSpacing: 1.4 },
});
