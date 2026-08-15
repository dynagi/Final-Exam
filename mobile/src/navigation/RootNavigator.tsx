import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  Theme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';
import BookIntro from '../components/BookIntro';
import LoadingScreen from '../components/LoadingScreen';
import { HeaderActions } from '../components/UI';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { gradients, ThemeColors } from '../lib/theme';
import { Role, ROLE_LABEL } from '../lib/types';

import BookScreen from '../screens/auth/BookScreen';
import CenterLoginScreen from '../screens/auth/CenterLoginScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import PendingApprovalScreen from '../screens/auth/PendingApprovalScreen';
import SignUpScreen from '../screens/auth/SignUpScreen';

import InvigilatorScanScreen from '../screens/invigilator/InvigilatorScanScreen';

import MyQuestionsScreen from '../screens/teacher/MyQuestionsScreen';
import TeacherDashboard from '../screens/teacher/TeacherDashboard';
import UploadQuestionScreen from '../screens/teacher/UploadQuestionScreen';

import ComposePaperScreen from '../screens/setter/ComposePaperScreen';
import MyPapersScreen from '../screens/setter/MyPapersScreen';
import QuestionPoolScreen from '../screens/setter/QuestionPoolScreen';
import SetterDashboard from '../screens/setter/SetterDashboard';

import AdminApprovalsScreen from '../screens/admin/AdminApprovalsScreen';
import AdminDashboard from '../screens/admin/AdminDashboard';
import AdminOverviewScreen from '../screens/admin/AdminOverviewScreen';
import AdminPapersScreen from '../screens/admin/AdminPapersScreen';
import AuditLogScreen from '../screens/admin/AuditLogScreen';
import CentersScreen from '../screens/admin/CentersScreen';
import CustodyScreen from '../screens/admin/CustodyScreen';
import DetectionsScreen from '../screens/admin/DetectionsScreen';
import ExamsScreen from '../screens/admin/ExamsScreen';
import PrintPreviewScreen from '../screens/admin/PrintPreviewScreen';

export type AuthStackParamList = {
  Book: undefined;
  Login: { initialRole?: Role } | undefined;
  SignUp: undefined;
  CenterLogin: undefined;
};

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const Tabs = createBottomTabNavigator();

function TabIcon({
  name,
  focused,
  color,
  size,
}: {
  name: keyof typeof Ionicons.glyphMap;
  focused: boolean;
  color: string;
  size: number;
}) {
  const s = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(s, { toValue: focused ? 1 : 0, useNativeDriver: true, speed: 20, bounciness: 9 }).start();
  }, [focused, s]);
  const scale = s.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const translateY = s.interpolate({ inputRange: [0, 1], outputRange: [0, -2] });
  const glowOpacity = s.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const glowScale = s.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const pill = size + 18;
  return (
    <Animated.View
      style={{ alignItems: 'center', justifyContent: 'center', transform: [{ scale }, { translateY }] }}
    >
      {/* Highlighted halo behind the active icon. */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: pill,
          height: pill,
          borderRadius: pill / 2,
          opacity: glowOpacity,
          transform: [{ scale: glowScale }],
        }}
      >
        <LinearGradient
          colors={gradients.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: pill / 2, opacity: 0.22 }]}
        />
      </Animated.View>
      <Ionicons name={name} color={color} size={size} />
    </Animated.View>
  );
}

function icon(name: keyof typeof Ionicons.glyphMap) {
  return ({ focused, color, size }: { focused: boolean; color: string; size: number }) => (
    <TabIcon name={name} focused={focused} color={color} size={size} />
  );
}

function useTabScreenOptions() {
  const { colors } = useTheme();
  return useMemo(
    () => ({
      headerStyle: { backgroundColor: colors.bg },
      headerTitleStyle: { color: colors.text, fontWeight: '800' as const, fontSize: 17 },
      headerTintColor: colors.text,
      headerShadowVisible: false,
      headerRight: () => <HeaderActions />,
      // Seamless cross-fade/shift when switching tabs.
      animation: 'shift' as const,
      // Frosted-glass tab bar: a translucent fill over a real blur layer.
      tabBarBackground: () => (
        <BlurView
          intensity={Platform.OS === 'android' ? 24 : 40}
          tint={colors.blurTint}
          style={StyleSheet.absoluteFill}
        />
      ),
      tabBarStyle: {
        backgroundColor: colors.glass,
        borderTopColor: colors.glassBorder,
        paddingTop: 4,
        elevation: 0,
      },
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.textDim,
      tabBarLabelStyle: { fontWeight: '600' as const },
    }),
    [colors]
  );
}

function TeacherTabs() {
  const screenOptions = useTabScreenOptions();
  return (
    <Tabs.Navigator screenOptions={screenOptions}>
      <Tabs.Screen
        name="TeacherDashboard"
        component={TeacherDashboard}
        options={{
          title: 'Dashboard',
          tabBarIcon: icon('speedometer-outline'),
          // Carries the archive header and its own index rail, so the app
          // chrome stands down here. Upload and My Questions keep theirs.
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="Upload"
        component={UploadQuestionScreen}
        options={{
          title: 'Upload Questions',
          tabBarLabel: 'Upload',
          tabBarIcon: icon('cloud-upload-outline'),
          // Carries the archive header and its own index rail.
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="MyQuestions"
        component={MyQuestionsScreen}
        options={{
          title: 'My Questions',
          tabBarIcon: icon('list-outline'),
          // Carries the archive header and its own index rail.
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      />
    </Tabs.Navigator>
  );
}

function SetterTabs() {
  const screenOptions = useTabScreenOptions();
  return (
    <Tabs.Navigator screenOptions={screenOptions}>
      <Tabs.Screen
        name="SetterDashboard"
        component={SetterDashboard}
        options={{
          title: 'Dashboard',
          tabBarIcon: icon('speedometer-outline'),
          // The archive book brings its own header bar (with the profile menu
          // holding theme + logout) and its own index navigation, so the app
          // chrome stands down here. Every other tab keeps the normal header
          // and tab bar, so no route becomes unreachable.
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="QuestionPool"
        component={QuestionPoolScreen}
        options={{
          title: 'Question Pool',
          tabBarLabel: 'Pool',
          tabBarIcon: icon('library-outline'),
          // Same treatment as the Dashboard: this screen carries the archive
          // header and the index rail itself, so the app chrome stands down.
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="Compose"
        component={ComposePaperScreen}
        options={{
          title: 'Compose Paper',
          tabBarLabel: 'Compose',
          tabBarIcon: icon('create-outline'),
          // Carries the archive header and index rail itself.
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="MyPapers"
        component={MyPapersScreen}
        options={{
          title: 'My Papers',
          tabBarIcon: icon('documents-outline'),
          // Now carries the archive header and index rail itself, same as
          // the other setter tabs above.
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      />
    </Tabs.Navigator>
  );
}

function AdminTabs() {
  const screenOptions = useTabScreenOptions();
  return (
    <Tabs.Navigator screenOptions={screenOptions}>
      <Tabs.Screen
        name="AdminDashboard"
        component={AdminDashboard}
        options={{
          title: 'Command Center',
          tabBarLabel: 'Dashboard',
          tabBarIcon: icon('speedometer-outline'),
          // The command centre carries the archive header and the full
          // eight-entry index rail, so the app chrome stands down here.
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="AdminOverview"
        component={AdminOverviewScreen}
        options={{
          title: 'Command Overview',
          tabBarLabel: 'Overview',
          tabBarIcon: icon('bar-chart-outline'),
          // Carries the archive header and the index rail itself.
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="Approvals"
        component={AdminApprovalsScreen}
        options={{
          title: 'Account Approvals',
          tabBarLabel: 'Approvals',
          tabBarIcon: icon('person-add-outline'),
          // Carries the archive header and the index rail itself.
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="Papers"
        component={AdminPapersScreen}
        options={{
          title: 'Papers',
          tabBarIcon: icon('documents-outline'),
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="PrintPreview"
        component={PrintPreviewScreen}
        options={{
          title: 'Print Preview',
          tabBarLabel: 'Print',
          tabBarIcon: icon('print-outline'),
          // Carries the archive header and the index rail itself.
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="Exams"
        component={ExamsScreen}
        options={{
          title: 'Exams',
          tabBarIcon: icon('calendar-outline'),
          // Carries the archive header and the index rail itself.
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="Centers"
        component={CentersScreen}
        options={{
          title: 'Exam Centers',
          tabBarLabel: 'Centers',
          tabBarIcon: icon('business-outline'),
          // Carries the archive header and the index rail itself.
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="Custody"
        component={CustodyScreen}
        options={{
          title: 'Chain of Custody',
          tabBarLabel: 'Custody',
          tabBarIcon: icon('location-outline'),
          // Carries the archive header and the index rail itself.
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="Detections"
        component={DetectionsScreen}
        options={{
          title: 'QR Detections',
          tabBarLabel: 'Detections',
          tabBarIcon: icon('scan-outline'),
          // Carries the archive header and the index rail itself.
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="Audit"
        component={AuditLogScreen}
        options={{
          title: 'Audit Log',
          tabBarLabel: 'Audit',
          tabBarIcon: icon('reader-outline'),
          // Carries the archive header and the index rail itself.
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      />
    </Tabs.Navigator>
  );
}

function InvigilatorTabs() {
  const screenOptions = useTabScreenOptions();
  return (
    <Tabs.Navigator screenOptions={screenOptions}>
      <Tabs.Screen
        name="Scan"
        component={InvigilatorScanScreen}
        options={{ title: 'Scan-in', tabBarIcon: icon('qr-code-outline') }}
      />
    </Tabs.Navigator>
  );
}

function navThemeFor(colors: ThemeColors, isDark: boolean): Theme {
  const base = isDark ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.bg,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      notification: colors.danger,
    },
  };
}

/**
 * Keep the splash on screen for at least `minMs` from app start.
 *
 * Restoring a session is a fast AsyncStorage read, so the boot animation used
 * to flash past before anyone could see it. The floor starts at mount, so it
 * costs nothing later: a sign-out that briefly flips `loading` after the
 * timer has elapsed shows no artificial delay.
 */
function useMinimumSplash(active: boolean, minMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setElapsed(true), minMs);
    return () => clearTimeout(id);
  }, [minMs]);
  return active || !elapsed;
}

/** How long the boot animation is guaranteed to stay up. */
const SPLASH_MIN_MS = 2600;

export default function RootNavigator() {
  const { session, profile, loading, justSignedIn, clearJustSignedIn } = useAuth();
  const { colors, isDark } = useTheme();
  const navTheme = useMemo(() => navThemeFor(colors, isDark), [colors, isDark]);
  const showSplash = useMinimumSplash(loading, SPLASH_MIN_MS);

  if (showSplash) {
    return <LoadingScreen />;
  }

  return (
    <NavigationContainer theme={navTheme}>
      {!session || !profile ? (
        <AuthStack.Navigator
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
            animation: 'fade',
          }}
        >
          <AuthStack.Screen name="Book" component={BookScreen} />
          <AuthStack.Screen name="Login" component={LoginScreen} />
          <AuthStack.Screen name="SignUp" component={SignUpScreen} />
          <AuthStack.Screen name="CenterLogin" component={CenterLoginScreen} />
        </AuthStack.Navigator>
      ) : (profile.role === 'teacher' || profile.role === 'paper_setter') &&
        profile.status &&
        profile.status !== 'approved' ? (
        // Teacher/paper-setter sign-ups sit here until an Admin approves
        // them — the server refuses every request for a non-approved
        // profile, so there is nothing else this session can do. Admin and
        // invigilator accounts are never gated here (they are always
        // 'approved' by design — see patch-9-account-approval.sql), and the
        // `profile.status &&` guard means an older profiles row that
        // predates the migration (status column not selected yet) never
        // locks anyone out either.
        <PendingApprovalScreen />
      ) : profile.role === 'teacher' ? (
        justSignedIn ? (
          <BookIntro
            name={profile.full_name}
            role={ROLE_LABEL.teacher}
            onDone={clearJustSignedIn}
          />
        ) : (
          <TeacherTabs />
        )
      ) : profile.role === 'paper_setter' ? (
        <SetterTabs />
      ) : profile.role === 'invigilator' ? (
        <InvigilatorTabs />
      ) : (
        <AdminTabs />
      )}
    </NavigationContainer>
  );
}
