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
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';
import LoadingScreen from '../components/LoadingScreen';
import { HeaderActions } from '../components/UI';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { gradients, ThemeColors } from '../lib/theme';
import { Role } from '../lib/types';

import BookScreen from '../screens/auth/BookScreen';
import CenterLoginScreen from '../screens/auth/CenterLoginScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import SignUpScreen from '../screens/auth/SignUpScreen';

import InvigilatorScanScreen from '../screens/invigilator/InvigilatorScanScreen';

import MyQuestionsScreen from '../screens/teacher/MyQuestionsScreen';
import TeacherDashboard from '../screens/teacher/TeacherDashboard';
import UploadQuestionScreen from '../screens/teacher/UploadQuestionScreen';

import ComposePaperScreen from '../screens/setter/ComposePaperScreen';
import MyPapersScreen from '../screens/setter/MyPapersScreen';
import QuestionPoolScreen from '../screens/setter/QuestionPoolScreen';
import SetterDashboard from '../screens/setter/SetterDashboard';

import AdminDashboard from '../screens/admin/AdminDashboard';
import AdminPapersScreen from '../screens/admin/AdminPapersScreen';
import AuditLogScreen from '../screens/admin/AuditLogScreen';
import CentersScreen from '../screens/admin/CentersScreen';
import CustodyScreen from '../screens/admin/CustodyScreen';
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
        options={{ title: 'Dashboard', tabBarIcon: icon('speedometer-outline') }}
      />
      <Tabs.Screen
        name="Upload"
        component={UploadQuestionScreen}
        options={{ title: 'Upload Questions', tabBarLabel: 'Upload', tabBarIcon: icon('cloud-upload-outline') }}
      />
      <Tabs.Screen
        name="MyQuestions"
        component={MyQuestionsScreen}
        options={{ title: 'My Questions', tabBarIcon: icon('list-outline') }}
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
        options={{ title: 'Dashboard', tabBarIcon: icon('speedometer-outline') }}
      />
      <Tabs.Screen
        name="QuestionPool"
        component={QuestionPoolScreen}
        options={{ title: 'Question Pool', tabBarLabel: 'Pool', tabBarIcon: icon('library-outline') }}
      />
      <Tabs.Screen
        name="Compose"
        component={ComposePaperScreen}
        options={{ title: 'Compose Paper', tabBarLabel: 'Compose', tabBarIcon: icon('create-outline') }}
      />
      <Tabs.Screen
        name="MyPapers"
        component={MyPapersScreen}
        options={{ title: 'My Papers', tabBarIcon: icon('documents-outline') }}
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
        options={{ title: 'Command Center', tabBarLabel: 'Dashboard', tabBarIcon: icon('speedometer-outline') }}
      />
      <Tabs.Screen
        name="Papers"
        component={AdminPapersScreen}
        options={{ title: 'Papers', tabBarIcon: icon('documents-outline') }}
      />
      <Tabs.Screen
        name="PrintPreview"
        component={PrintPreviewScreen}
        options={{ title: 'Print Preview', tabBarLabel: 'Print', tabBarIcon: icon('print-outline') }}
      />
      <Tabs.Screen
        name="Exams"
        component={ExamsScreen}
        options={{ title: 'Exams', tabBarIcon: icon('calendar-outline') }}
      />
      <Tabs.Screen
        name="Centers"
        component={CentersScreen}
        options={{ title: 'Exam Centers', tabBarLabel: 'Centers', tabBarIcon: icon('business-outline') }}
      />
      <Tabs.Screen
        name="Custody"
        component={CustodyScreen}
        options={{ title: 'Chain of Custody', tabBarLabel: 'Custody', tabBarIcon: icon('location-outline') }}
      />
      <Tabs.Screen
        name="Audit"
        component={AuditLogScreen}
        options={{ title: 'Audit Log', tabBarLabel: 'Audit', tabBarIcon: icon('reader-outline') }}
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

export default function RootNavigator() {
  const { session, profile, loading } = useAuth();
  const { colors, isDark } = useTheme();
  const navTheme = useMemo(() => navThemeFor(colors, isDark), [colors, isDark]);

  if (loading) {
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
      ) : profile.role === 'teacher' ? (
        <TeacherTabs />
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
