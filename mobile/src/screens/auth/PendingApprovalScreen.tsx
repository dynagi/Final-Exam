/**
 * Shown instead of the role's app when a teacher/paper-setter account has
 * signed in but has not yet been approved by an Admin (or was declined).
 * Nothing in the crypto service will answer this session's requests until
 * an Admin approves it — see requireRole()'s status gate in
 * server/src/index.js — so there is nothing useful for the account to do
 * but wait or sign out.
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  BookBadge,
  BookBanner,
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
import { ROLE_LABEL } from '../../lib/types';

export default function PendingApprovalScreen() {
  const { profile, signOut } = useAuth();
  const { colors } = useTheme();
  const rejected = profile?.status === 'rejected';

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <SafeAreaView style={styles.flex}>
        <View style={styles.topBar}>
          <View />
          <ThemeToggle />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <BookBanner />

          <BookSpread
            left={
              <View style={pageStyles.center}>
                <BookBadge
                  icon={rejected ? 'close-circle-outline' : 'hourglass-outline'}
                  gradient={rejected ? ['#7C2A2A', '#B85A4A'] : ['#7C5E2A', '#B8934A']}
                  glowColor={rejected ? '#7C2A2A' : '#7C5E2A'}
                />
                <Text style={pageStyles.title}>{rejected ? 'Not Approved' : 'Awaiting Approval'}</Text>
                <Text style={pageStyles.subtitle}>
                  {rejected
                    ? 'Your registration request was declined.'
                    : 'Your registration is under review'}
                </Text>
                <View style={pageStyles.flexSpace} />
                <QuillAndScroll />
              </View>
            }
            right={
              <View>
                <Text style={pageStyles.portalTitle}>
                  {profile ? `Welcome, ${profile.full_name}` : 'Welcome'}
                </Text>
                <Text style={pageStyles.portalHint}>
                  {profile ? `Registered as ${ROLE_LABEL[profile.role]}.` : ''}
                </Text>

                <View style={pageStyles.banner}>
                  <Ionicons
                    name={rejected ? 'alert-circle-outline' : 'information-circle-outline'}
                    size={16}
                    color={rejected ? '#8B2E2E' : INK_DIM}
                  />
                  <Text style={pageStyles.bannerText}>
                    {rejected
                      ? 'An admin reviewed this account and did not approve it. If you believe this is a mistake, contact your administrator to request a new invite.'
                      : 'An admin needs to approve this account before you can sign in and use the app. This usually does not take long — check back shortly, or contact your administrator directly.'}
                  </Text>
                </View>

                <View style={pageStyles.sealWrap}>
                  <SealButton title="Sign Out" icon="log-out-outline" onPress={() => void signOut()} />
                </View>
              </View>
            }
          />
        </ScrollView>
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
  banner: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: 'rgba(59,46,31,0.06)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 18,
  },
  bannerText: { fontFamily: serif, fontSize: 12, color: INK_DIM, flex: 1, lineHeight: 17 },
  sealWrap: { marginTop: 4, marginBottom: 18, alignItems: 'center' },
  link: { fontFamily: serif, fontSize: 12, color: GOLD },
});
