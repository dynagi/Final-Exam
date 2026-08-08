import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PressableIcon } from '../../components/anim';
import {
  BookBadge,
  BookBanner,
  BookCheckbox,
  BookInput,
  BookSpread,
  GOLD,
  INK,
  INK_DIM,
  QuillAndScroll,
  RoleTag,
  SealButton,
} from '../../components/BookUI';
import { ThemeToggle } from '../../components/UI';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { IS_CONFIGURED } from '../../lib/config';
import { serif } from '../../lib/theme';
import { Role, ROLE_LABEL } from '../../lib/types';
import type { AuthStackParamList } from '../../navigation/RootNavigator';

type LoginRoute = { params?: AuthStackParamList['Login'] };

export default function LoginScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const route = useRoute<LoginRoute & { key: string; name: string }>();
  const { signIn } = useAuth();
  const { colors } = useTheme();

  const role: Role = route.params?.initialRole ?? 'teacher';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleLogin = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    try {
      await signIn(role, email, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <SafeAreaView style={styles.flex}>
        <View style={styles.topBar}>
          {navigation.canGoBack() ? (
            <PressableIcon name="arrow-back" size={22} color={colors.textDim} onPress={() => navigation.goBack()} />
          ) : (
            <View />
          )}
          <ThemeToggle />
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <BookBanner />

            <BookSpread
              left={
                <View style={pageStyles.center}>
                  <BookBadge icon="shield-checkmark" />
                  <Text style={pageStyles.title}>Welcome to Secure Exam</Text>
                  <Text style={pageStyles.subtitle}>Login{'\n'}Authentication is Required</Text>
                  <View style={pageStyles.flexSpace} />
                  <QuillAndScroll />
                </View>
              }
              right={
                <View>
                  <Text style={pageStyles.portalTitle}>System Access Portal</Text>
                  <RoleTag label={ROLE_LABEL[role]} />

                  {!IS_CONFIGURED && (
                    <View style={pageStyles.warnBanner}>
                      <Text style={pageStyles.warnText}>Not configured yet — set your Supabase keys in src/lib/config.ts</Text>
                    </View>
                  )}

                  <BookInput
                    icon="person-outline"
                    label="Username / Email"
                    placeholder="you@example.com"
                    autoCapitalize="none"
                    keyboardType="email-address"
                    value={email}
                    onChangeText={setEmail}
                  />
                  <BookInput
                    icon="lock-closed-outline"
                    label="Password"
                    placeholder="••••••••"
                    secureTextEntry
                    value={password}
                    onChangeText={setPassword}
                  />

                  <View style={pageStyles.optionsRow}>
                    <BookCheckbox checked={remember} onToggle={() => setRemember((r) => !r)} label="Remember Me" />
                    <Pressable
                      onPress={() =>
                        Alert.alert('Forgot password', 'Password resets aren’t available in this demo — contact your administrator.')
                      }
                    >
                      <Text style={pageStyles.forgotLink}>Forgot Password?</Text>
                    </Pressable>
                  </View>

                  {error ? <Text style={pageStyles.error}>{error}</Text> : null}

                  <View style={pageStyles.sealWrap}>
                    <SealButton title="Sign In" icon="log-in-outline" onPress={() => void handleLogin()} loading={busy} />
                  </View>

                  <Pressable onPress={() => navigation.navigate('Book')} style={pageStyles.linkWrap}>
                    <Text style={pageStyles.link}>
                      Need a different role? <Text style={pageStyles.linkStrong}>Return to Dashboard</Text>
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => navigation.navigate('SignUp')} style={pageStyles.linkWrap}>
                    <Text style={pageStyles.link}>
                      New here? <Text style={pageStyles.linkStrong}>Create an account</Text>
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => navigation.navigate('CenterLogin')} style={pageStyles.linkWrap}>
                    <Text style={pageStyles.link}>
                      Invigilator? <Text style={pageStyles.linkStrong}>Exam center login</Text>
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
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  content: { alignItems: 'center', padding: 16, paddingBottom: 40 },
});

const pageStyles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center' },
  flexSpace: { flex: 1 },
  title: { fontFamily: serif, fontWeight: '700', fontSize: 20, color: INK, textAlign: 'center' },
  subtitle: { fontFamily: serif, fontSize: 13, color: INK_DIM, textAlign: 'center', marginTop: 8, lineHeight: 19 },
  portalTitle: { fontFamily: serif, fontWeight: '700', fontSize: 19, color: INK, marginBottom: 4 },
  warnBanner: {
    backgroundColor: 'rgba(184,134,11,0.14)',
    borderColor: 'rgba(184,134,11,0.4)',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
  },
  warnText: { fontFamily: serif, color: '#8A6300', fontSize: 11, lineHeight: 15 },
  optionsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  forgotLink: { fontFamily: serif, fontSize: 12, fontWeight: '700', color: GOLD },
  error: { fontFamily: serif, color: '#8B2E2E', fontSize: 12, marginBottom: 12 },
  sealWrap: { marginTop: 4, marginBottom: 18 },
  linkWrap: { alignItems: 'center', marginBottom: 8 },
  link: { fontFamily: serif, fontSize: 12, color: INK_DIM },
  linkStrong: { fontWeight: '700', color: GOLD },
});
