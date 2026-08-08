import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';
import { gradients } from '../lib/theme';

/** Gradient badge orbited by two counter-rotating HUD rings — the app's "2050" mark. */
export function AuthOrb({
  icon,
  size = 132,
  badgeSize = 62,
  iconSize = 28,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  size?: number;
  badgeSize?: number;
  iconSize?: number;
}) {
  const { colors } = useTheme();
  const spinA = useRef(new Animated.Value(0)).current;
  const spinB = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const float = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const a = Animated.loop(Animated.timing(spinA, { toValue: 1, duration: 3400, easing: Easing.linear, useNativeDriver: true }));
    const b = Animated.loop(Animated.timing(spinB, { toValue: 1, duration: 5200, easing: Easing.linear, useNativeDriver: true }));
    const p = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    const f = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    a.start();
    b.start();
    p.start();
    f.start();
    return () => {
      a.stop();
      b.stop();
      p.stop();
      f.stop();
    };
  }, [spinA, spinB, pulse, float]);

  const rotateA = spinA.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const rotateB = spinB.interpolate({ inputRange: [0, 1], outputRange: ['360deg', '0deg'] });
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });
  const r1 = size * 0.47;
  const r2 = size * 0.38;
  const c1 = 2 * Math.PI * r1;
  const c2 = 2 * Math.PI * r2;

  return (
    <Animated.View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', transform: [{ translateY }] }}>
      <Animated.View style={{ position: 'absolute', transform: [{ rotate: rotateA }] }}>
        <Svg width={size} height={size}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r1}
            stroke={colors.accent}
            strokeWidth={2}
            strokeDasharray={`${c1 * 0.62} ${c1 * 0.38}`}
            fill="none"
            opacity={0.85}
          />
        </Svg>
      </Animated.View>
      <Animated.View style={{ position: 'absolute', transform: [{ rotate: rotateB }] }}>
        <Svg width={size} height={size}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r2}
            stroke={colors.violet}
            strokeWidth={2}
            strokeDasharray={`${c2 * 0.4} ${c2 * 0.6}`}
            fill="none"
            opacity={0.7}
          />
        </Svg>
      </Animated.View>
      <Animated.View
        style={{
          width: badgeSize,
          height: badgeSize,
          borderRadius: badgeSize * 0.3,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ scale }],
          shadowColor: colors.accent,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.7,
          shadowRadius: 20,
          elevation: 10,
          overflow: 'hidden',
        }}
      >
        <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <Ionicons name={icon} size={iconSize} color="#fff" />
      </Animated.View>
    </Animated.View>
  );
}

export default AuthOrb;
