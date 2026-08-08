import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  BookBadge,
  BookBanner,
  BookSpread,
  COVER,
  COVER_GOLD,
  GOLD,
  INK,
  INK_DIM,
  QuillAndScroll,
  useBookLayout,
} from '../../components/BookUI';
import { ThemeToggle } from '../../components/UI';
import { useTheme } from '../../context/ThemeContext';
import { serif } from '../../lib/theme';
import { Role } from '../../lib/types';
import type { AuthStackParamList } from '../../navigation/RootNavigator';

type MenuTarget =
  | { screen: 'Login'; role: Role; icon: keyof typeof Ionicons.glyphMap; label: string }
  | { screen: 'CenterLogin'; icon: keyof typeof Ionicons.glyphMap; label: string }
  | { screen: 'SignUp'; icon: keyof typeof Ionicons.glyphMap; label: string };

const MENU: MenuTarget[] = [
  { screen: 'Login', role: 'teacher', icon: 'school-outline', label: 'Teacher' },
  { screen: 'Login', role: 'paper_setter', icon: 'create-outline', label: 'Paper Setter' },
  { screen: 'Login', role: 'admin', icon: 'shield-checkmark-outline', label: 'Admin' },
  { screen: 'CenterLogin', icon: 'business-outline', label: 'Exam center login' },
  { screen: 'SignUp', icon: 'person-add-outline', label: 'Create Account' },
];

export default function BookScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const { colors } = useTheme();
  const { bookWidth } = useBookLayout();

  const cover = useRef(new Animated.Value(0)).current;
  const [coverGone, setCoverGone] = useState(false);
  const turn = useRef(new Animated.Value(0)).current;
  const [turning, setTurning] = useState(false);

  useEffect(() => {
    const anim = Animated.timing(cover, {
      toValue: 1,
      duration: 1100,
      delay: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start(() => setCoverGone(true));
    return () => anim.stop();
  }, [cover]);

  const goTo = (target: MenuTarget) => {
    if (turning) return;
    setTurning(true);
    Animated.timing(turn, {
      toValue: 1,
      duration: 460,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      if (target.screen === 'Login') navigation.navigate('Login', { initialRole: target.role });
      else navigation.navigate(target.screen);
      // Reset so the book is flat again if the user comes back.
      turn.setValue(0);
      setTurning(false);
    });
  };

  const coverRotate = cover.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-118deg'] });
  const coverOpacity = cover.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] });
  const turnRotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-95deg'] });
  const turnOpacity = turn.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const turnScale = turn.interpolate({ inputRange: [0, 1], outputRange: [1, 0.94] });

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <SafeAreaView style={styles.flex}>
        <View style={styles.topBar}>
          <View />
          <ThemeToggle />
        </View>

        <View style={styles.center}>
          <BookBanner />

          <View style={{ width: bookWidth }}>
            <Animated.View
              style={{
                opacity: turnOpacity,
                transform: [{ perspective: 1400 }, { rotateY: turnRotate }, { scale: turnScale }],
              }}
            >
              <BookSpread left={<LeftPage />} right={<RightPage onSelect={goTo} />} />
            </Animated.View>

            {!coverGone && (
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  {
                    opacity: coverOpacity,
                    transform: [
                      { perspective: 1400 },
                      { translateX: -bookWidth / 2 },
                      { rotateY: coverRotate },
                      { translateX: bookWidth / 2 },
                    ],
                  },
                ]}
              >
                <View style={styles.cover}>
                  <View style={styles.coverBadge}>
                    <Ionicons name="shield-checkmark" size={30} color={COVER_GOLD} />
                  </View>
                  <Text style={styles.coverTitle}>SECURE AI{'\n'}EXAM SYSTEM</Text>
                  <Text style={styles.coverVol}>VOL. 1</Text>
                </View>
              </Animated.View>
            )}
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

function LeftPage() {
  return (
    <View style={pageStyles.center}>
      <BookBadge icon="shield-checkmark" gradient={['#A9812F', '#D8B85C']} glowColor={GOLD} />
      <Text style={pageStyles.title}>Welcome to Secure Exam</Text>
      <Text style={pageStyles.subtitle}>Zero single point of failure.{'\n'}From question to exam hall.</Text>
      <View style={pageStyles.flexSpace} />
      <QuillAndScroll />
    </View>
  );
}

function RightPage({ onSelect }: { onSelect: (t: MenuTarget) => void }) {
  return (
    <View>
      <Text style={pageStyles.dashTitle}>Dashboard: Overview</Text>
      <View style={pageStyles.rule} />
      {MENU.map((item, i) => (
        <Pressable key={item.label} onPress={() => onSelect(item)} style={({ pressed }) => [pageStyles.menuRow, pressed && pageStyles.menuRowPressed]}>
          <Text style={pageStyles.menuIndex}>{i + 1}]</Text>
          <Ionicons name={item.icon} size={19} color={GOLD} style={pageStyles.menuIcon} />
          <Text style={pageStyles.menuLabel}>{item.label}</Text>
          <Ionicons name="chevron-forward" size={16} color={INK_DIM} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  cover: {
    flex: 1,
    backgroundColor: COVER,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: COVER_GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  coverBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: COVER_GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  coverTitle: { color: COVER_GOLD, fontFamily: serif, fontWeight: '700', fontSize: 20, textAlign: 'center', letterSpacing: 1.2, lineHeight: 26 },
  coverVol: { color: `${COVER_GOLD}CC`, fontFamily: serif, fontSize: 12, letterSpacing: 2 },
});

const pageStyles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center' },
  flexSpace: { flex: 1 },
  title: { fontFamily: serif, fontWeight: '700', fontSize: 20, color: INK, textAlign: 'center' },
  subtitle: { fontFamily: serif, fontSize: 13, color: INK_DIM, textAlign: 'center', marginTop: 8, lineHeight: 19 },
  dashTitle: { fontFamily: serif, fontWeight: '700', fontSize: 19, color: INK, marginTop: 8 },
  rule: { height: 1, backgroundColor: '#00000022', marginTop: 8, marginBottom: 12 },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#00000014',
  },
  menuRowPressed: { opacity: 0.55 },
  menuIndex: { fontFamily: serif, fontWeight: '700', color: GOLD, fontSize: 15, width: 22 },
  menuIcon: { marginRight: 2 },
  menuLabel: { fontFamily: serif, fontSize: 15, color: INK, flex: 1 },
});
