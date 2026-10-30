import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

export interface GuideStep {
  /** Must match the id passed to registerTarget() for the element this step explains. */
  id: string;
  title: string;
  description: string;
}

interface PersistedGuideState {
  active: boolean;
  stepIndex: number;
}

const storageKey = (role: string, userId: string) => `secureaiexam.guide.${role}.${userId}`;

/**
 * Drives a first-time, per-role, per-account dashboard walkthrough: which step
 * is showing, the live measured node for each step's target, and resume/skip
 * state persisted locally (there is no server-side "onboarding seen" column,
 * so this follows the same AsyncStorage pattern ThemeContext already uses).
 *
 * A brand-new account with no saved state starts the guide automatically. A
 * saved `{ active: true, stepIndex }` resumes exactly there — closing the app
 * mid-guide never restarts it from Step 1. Skip or finishing writes
 * `{ active: false }`, which never auto-starts again.
 */
export function useDashboardGuide(role: string, userId: string | undefined, steps: GuideStep[]) {
  const [status, setStatus] = useState<'loading' | 'active' | 'done'>('loading');
  const [stepIndex, setStepIndex] = useState(0);
  // A version bump on every registerTarget() forces getTarget() callers to
  // re-render once a target's node actually mounts — the node itself lives in
  // a ref (not state) since it never needs to be diffed, only read fresh.
  const [, bumpTargets] = useState(0);
  const targets = useRef<Map<string, View | null>>(new Map());

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void AsyncStorage.getItem(storageKey(role, userId)).then((raw) => {
      if (cancelled) return;
      if (!raw) {
        setStatus('active');
        setStepIndex(0);
        return;
      }
      try {
        const saved = JSON.parse(raw) as PersistedGuideState;
        if (saved.active) {
          setStatus('active');
          setStepIndex(Math.max(0, saved.stepIndex));
        } else {
          setStatus('done');
        }
      } catch {
        setStatus('active');
        setStepIndex(0);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [role, userId]);

  const persist = useCallback(
    (next: PersistedGuideState) => {
      if (!userId) return;
      void AsyncStorage.setItem(storageKey(role, userId), JSON.stringify(next));
    },
    [role, userId]
  );

  const registerTarget = useCallback((id: string, node: View | null) => {
    if (targets.current.get(id) === node) return;
    targets.current.set(id, node);
    bumpTargets((v) => v + 1);
  }, []);

  // One cached ref-callback per target id, not a fresh closure every render.
  // A `ref={(node) => registerTarget(id, node)}` written inline at the call
  // site gets a new function identity on every render, which makes React
  // detach and reattach the ref (old(null), then new(node)) on every single
  // render — and since registerTarget's job is to trigger a re-render so
  // getTarget() picks up freshly-mounted nodes, that reattachment itself
  // becomes a render trigger, forever. Handing out the same function every
  // time (cached here, keyed by id) means React only calls it on real
  // mount/unmount.
  const refCallbacks = useRef<Map<string, (node: View | null) => void>>(new Map());
  const refFor = useCallback(
    (id: string) => {
      let fn = refCallbacks.current.get(id);
      if (!fn) {
        fn = (node: View | null) => registerTarget(id, node);
        refCallbacks.current.set(id, fn);
      }
      return fn;
    },
    [registerTarget]
  );

  const getTarget = useCallback((id: string) => targets.current.get(id) ?? null, []);

  const next = useCallback(() => {
    setStepIndex((prev) => {
      const nextIndex = prev + 1;
      if (nextIndex >= steps.length) {
        persist({ active: false, stepIndex: 0 });
        setStatus('done');
        return prev;
      }
      persist({ active: true, stepIndex: nextIndex });
      return nextIndex;
    });
  }, [steps.length, persist]);

  const skip = useCallback(() => {
    persist({ active: false, stepIndex: 0 });
    setStatus('done');
  }, [persist]);

  const visible = status === 'active' && steps.length > 0;
  const clampedIndex = Math.min(stepIndex, steps.length - 1);

  return {
    visible,
    stepIndex: clampedIndex,
    totalSteps: steps.length,
    step: visible ? (steps[clampedIndex] ?? null) : null,
    isLast: clampedIndex === steps.length - 1,
    refFor,
    getTarget,
    next,
    skip,
  };
}
