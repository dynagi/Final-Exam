import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  BookBadge,
  BookBanner,
  BookInput,
  BookSpread,
  GOLD,
  INK,
  INK_DIM,
  QuillAndScroll,
  SealButton,
} from '../../components/BookUI';
import { ThemeToggle } from '../../components/UI';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { serif } from '../../lib/theme';
import { Role, ROLE_LABEL } from '../../lib/types';
import type { AuthStackParamList } from '../../navigation/RootNavigator';

// Admin is not self-serve: there is no signup path to a new admin account,
// so it is not offered here (server/src/index.js rejects it outright too).
const ROLES: Role[] = ['teacher', 'paper_setter'];

export default function SignUpScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const { signUp } = useAuth();
  const { colors } = useTheme();

  const [role, setRole] = useState<Role>('teacher');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSignUp = async () => {
    setError(null);
    if (!fullName.trim()) return setError('Enter your full name.');
    if (!email.trim()) return setError('Enter your email.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');

    setBusy(true);
    try {
      await signUp(role, fullName, email, password);
      // Session is live; RootNavigator switches to the role's app.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign up failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <SafeAreaView style={styles.flex}>
        <View style={styles.topBar}>
          <View />
          <ThemeToggle />
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <BookBanner />

            <BookSpread
              left={
                <View style={pageStyles.center}>
                  <BookBadge icon="person-add" gradient={['#2F6B3F', '#5FA876']} glowColor="#2F6B3F" />
                  <Text style={pageStyles.title}>Join Secure Exam</Text>
                  <Text style={pageStyles.subtitle}>Create Your Account{'\n'}An admin must approve it before you can sign in</Text>
                  <View style={pageStyles.flexSpace} />
                  <QuillAndScroll />
                </View>
              }
              right={
                <View>
                  <Text style={pageStyles.portalTitle}>New Account Registration</Text>
                  <Text style={pageStyles.portalHint}>Choose the role this account will hold.</Text>

                  <View style={pageStyles.roleRow}>
                    {ROLES.map((r) => {
                      const active = r === role;
                      return (
                        <Pressable key={r} onPress={() => setRole(r)} style={[pageStyles.roleTab, active && pageStyles.roleTabActive]}>
                          <Text style={[pageStyles.roleTabText, active && pageStyles.roleTabTextActive]}>{ROLE_LABEL[r]}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <View style={pageStyles.demoBanner}>
                    <Ionicons name="information-circle-outline" size={14} color={INK_DIM} />
                    <Text style={pageStyles.demoText}>
                      Teacher and paper-setter accounts need an admin&apos;s approval before they can sign in.
                      Admin accounts are provisioned directly and cannot be created here.
                    </Text>
                  </View>

                  <BookInput icon="person-circle-outline" label="Full Name" placeholder="Dr. A. Sharma" value={fullName} onChangeText={setFullName} />
                  <BookInput
                    icon="person-outline"
                    label="Email"
                    placeholder="you@example.com"
                    autoCapitalize="none"
                    keyboardType="email-address"
                    value={email}
                    onChangeText={setEmail}
                  />
                  <BookInput
                    icon="lock-closed-outline"
                    label="Password (min 8 chars)"
                    placeholder="••••••••"
                    secureTextEntry
                    value={password}
                    onChangeText={setPassword}
                  />

                  {error ? <Text style={pageStyles.error}>{error}</Text> : null}

                  <View style={pageStyles.sealWrap}>
                    <SealButton title="Create Account" icon="person-add-outline" onPress={() => void handleSignUp()} loading={busy} />
                  </View>

                  <Pressable onPress={() => navigation.navigate('Login')} style={pageStyles.linkWrap}>
                    <Text style={pageStyles.link}>
                      Already registered? <Text style={pageStyles.linkStrong}>Sign in</Text>
                    </Text>
                  </Pressable>
                </View>
              }
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  topBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 12, paddingTop: 8 },
  content: { alignItems: 'center', padding: 16, paddingBottom: 40 },
});

const pageStyles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center' },
  flexSpace: { flex: 1 },
  title: { fontFamily: serif, fontWeight: '700', fontSize: 20, color: INK, textAlign: 'center' },
  subtitle: { fontFamily: serif, fontSize: 13, color: INK_DIM, textAlign: 'center', marginTop: 8, lineHeight: 19 },
  portalTitle: { fontFamily: serif, fontWeight: '700', fontSize: 19, color: INK, marginBottom: 4 },
  portalHint: { fontFamily: serif, fontSize: 12, color: INK_DIM, marginBottom: 12 },
  roleRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  roleTab: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(59,46,31,0.25)',
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  roleTabActive: { borderColor: GOLD, backgroundColor: `${GOLD}26` },
  roleTabText: { fontFamily: serif, fontSize: 11, fontWeight: '700', color: INK_DIM },
  roleTabTextActive: { color: INK },
  demoBanner: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'flex-start',
    backgroundColor: 'rgba(59,46,31,0.06)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
  },
  demoText: { fontFamily: serif, fontSize: 11, color: INK_DIM, flex: 1, lineHeight: 15 },
  error: { fontFamily: serif, color: '#8B2E2E', fontSize: 12, marginBottom: 12 },
  sealWrap: { marginTop: 4, marginBottom: 18 },
  linkWrap: { alignItems: 'center' },
  link: { fontFamily: serif, fontSize: 12, color: INK_DIM },
  linkStrong: { fontWeight: '700', color: GOLD },
});
