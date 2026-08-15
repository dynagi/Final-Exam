import type { Session } from '@supabase/supabase-js';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { signUpUser } from '../lib/api';
import { centerEmail } from '../lib/config';
import { supabase } from '../lib/supabase';
import { Profile, Role, ROLE_LABEL } from '../lib/types';

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (role: Role, email: string, password: string) => Promise<void>;
  /** Center/invigilator login: code + password (mapped to a hidden email). */
  signInCenter: (code: string, password: string) => Promise<void>;
  /**
   * Creates the account (pre-confirmed, no email) and signs straight in.
   * `domains` — exactly 2 subjects — is required for role 'paper_setter'.
   */
  signUp: (role: Role, fullName: string, email: string, password: string, domains?: string[]) => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * True for one render cycle right after a fresh `signIn`/`signUp` — never
   * on a cold-start session restore. Screens that play a one-shot "welcome"
   * cinematic (see the Teacher book intro) gate on this and call
   * `clearJustSignedIn` once it has played.
   */
  justSignedIn: boolean;
  clearJustSignedIn: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [justSignedIn, setJustSignedIn] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (!newSession) {
        setProfile(null);
        setLoading(false);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      // maybeSingle rather than single: a signed-in account with no profile
      // row is a state worth reporting, not a 406 the caller has to decode.
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.warn(`Could not load the profile for ${userId}: ${error.message}`);
      } else if (!data) {
        console.warn(
          `Signed in as ${userId} but no profiles row exists. If the database was rebuilt, ` +
            'run the profile backfill at the bottom of supabase/reset-database.sql.'
        );
      }
      setProfile((data as Profile | null) ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const signIn = useCallback(async (role: Role, email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw new Error(error.message);

    // The selected role tab must match the account's real role.
    const { data: prof } = await supabase
      .from('profiles')
      .select('*')
      // maybeSingle: an account whose profile row is missing is a real state
      // to handle, not an HTTP 406 to throw.
      .eq('id', data.user.id)
      .maybeSingle();
    if (!prof) {
      await supabase.auth.signOut();
      throw new Error('No profile found for this account.');
    }
    const realRole = (prof as Profile).role;
    if (realRole !== role) {
      await supabase.auth.signOut();
      throw new Error(
        `This account is registered as ${ROLE_LABEL[realRole]}. Switch to that tab and sign in again.`
      );
    }
    setJustSignedIn(true);
  }, []);

  const signInCenter = useCallback(async (code: string, password: string) => {
    const email = centerEmail(code);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error('Invalid center code or password.');

    const { data: prof } = await supabase
      .from('profiles')
      .select('*')
      // maybeSingle: an account whose profile row is missing is a real state
      // to handle, not an HTTP 406 to throw.
      .eq('id', data.user.id)
      .maybeSingle();
    if (!prof || (prof as Profile).role !== 'invigilator') {
      await supabase.auth.signOut();
      throw new Error('This is not a center login.');
    }
  }, []);

  const signUp = useCallback(
    async (role: Role, fullName: string, email: string, password: string, domains?: string[]) => {
      // The server creates the account pre-confirmed via the admin API,
      // so no confirmation email is sent (immune to the mailer rate limit).
      await signUpUser(role, fullName.trim(), email.trim(), password, domains);
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw new Error(error.message);
      // Session is live; RootNavigator switches to the role's app.
      setJustSignedIn(true);
    },
    []
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setJustSignedIn(false);
  }, []);

  const clearJustSignedIn = useCallback(() => setJustSignedIn(false), []);

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        loading,
        signIn,
        signInCenter,
        signUp,
        signOut,
        justSignedIn,
        clearJustSignedIn,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
