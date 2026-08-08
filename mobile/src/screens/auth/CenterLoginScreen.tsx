import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useState } from 'react';
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
import type { AuthStackParamList } from '../../navigation/RootNavigator';

export default function CenterLoginScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const { signInCenter } = useAuth();
  const { colors } = useTheme();

  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!code.trim() || !password) {
      setError('Enter your center code and password.');
      return;
    }
    setBusy(true);
    try {
      await signInCenter(code, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed.');
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
                  <BookBadge icon="qr-code" gradient={['#8B2E2E', '#B8453F']} glowColor="#8B2E2E" />
                  <Text style={pageStyles.title}>Exam Center Access</Text>
                  <Text style={pageStyles.subtitle}>Invigilator Login{'\n'}Scan-in Authentication is Required</Text>
                  <View style={pageStyles.flexSpace} />
                  <QuillAndScroll />
                </View>
              }
              right={
                <View>
                  <Text style={pageStyles.portalTitle}>System Access Portal</Text>
                  <Text style={pageStyles.portalHint}>
                    Use the center code and password issued by the Admin.
                  </Text>

                  <BookInput
                    icon="business-outline"
                    label="Center Code"
                    placeholder="e.g. DL-014"
                    autoCapitalize="characters"
                    value={code}
                    onChangeText={setCode}
                  />
                  <BookInput
                    icon="lock-closed-outline"
                    label="Center Password"
                    placeholder="••••••••"
                    secureTextEntry
                    value={password}
                    onChangeText={setPassword}
                  />

                  {error ? <Text style={pageStyles.error}>{error}</Text> : null}

                  <View style={pageStyles.sealWrap}>
                    <SealButton title="Sign In to Scan" icon="qr-code-outline" onPress={() => void submit()} loading={busy} />
                  </View>

                  <Pressable onPress={() => navigation.navigate('Login')} style={pageStyles.linkWrap}>
                    <Text style={pageStyles.link}>
                      Staff member? <Text style={pageStyles.linkStrong}>Use the main login</Text>
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
  portalHint: { fontFamily: serif, fontSize: 12, color: INK_DIM, marginBottom: 16, lineHeight: 17 },
  error: { fontFamily: serif, color: '#8B2E2E', fontSize: 12, marginBottom: 12 },
  sealWrap: { marginTop: 4, marginBottom: 18 },
  linkWrap: { alignItems: 'center' },
  link: { fontFamily: serif, fontSize: 12, color: INK_DIM },
  linkStrong: { fontWeight: '700', color: GOLD },
});
