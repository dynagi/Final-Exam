/**
 * ArchiveBook — the "premium digital archive" shell.
 *
 * Composition: a full-width imprint header, a dark mahogany index rail down the
 * left, and an open bound book beside it holding the actual content. The index
 * sits *outside* the book so both leaves are free for real dashboard material.
 *
 * It is a presentation layer only. Nothing here talks to Supabase, the crypto
 * service or the exam-format catalogue; screens pass their existing data in as
 * children. The palette derives from the app's light/dark mode so the theme
 * toggle keeps working — light is daylit parchment, dark is a candlelit archive.
 *
 * The auth screens have their own, simpler book (components/BookUI.tsx) with a
 * fixed palette. This module is the themed, interactive counterpart used by the
 * dashboards; the two intentionally share the same ink/gold/parchment language.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { serif } from '../lib/theme';
import { ROLE_LABEL } from '../lib/types';
import { useCountUp } from './anim';

/* ------------------------------- palette --------------------------------- */

export interface ArchivePalette {
  /** The desk the book lies on. */
  backdrop: string;
  backdropDeep: string;
  lamp: string;
  /** Leather/wood binding, and the index rail cut from the same hide. */
  cover: string;
  coverEdge: string;
  coverHighlight: string;
  /** Legible text/icons printed on the binding — never equals `page`. */
  onCover: string;
  /** Parchment. */
  page: string;
  pageShade: string;
  pageDeep: string;
  /**
   * Coffee-stained stock for loose sheets that come *out* of the book (the
   * exam pamphlet). Deliberately darker than `page` so a sheet lying over the
   * spread reads as a separate object rather than a hole cut in the leaf.
   */
  pamphlet: string;
  pamphletShade: string;
  pamphletEdge: string;
  pamphletInk: string;
  pamphletInkDim: string;
  /** Ink. */
  ink: string;
  inkDim: string;
  inkFaint: string;
  rule: string;
  gold: string;
  goldSoft: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  grain: string;
}

const LIGHT: ArchivePalette = {
  backdrop: '#241A11',
  backdropDeep: '#120C07',
  lamp: 'rgba(216,184,92,0.13)',
  cover: '#4A3421',
  coverEdge: '#2A1D12',
  coverHighlight: 'rgba(216,184,92,0.30)',
  onCover: '#F6EBD1',
  page: '#F6EBD1',
  pageShade: '#E7D6AC',
  pageDeep: '#C9B287',
  pamphlet: '#E3CDA2',
  pamphletShade: '#CFB484',
  pamphletEdge: '#8A6B3C',
  pamphletInk: '#33240F',
  pamphletInkDim: '#6A5230',
  ink: '#3A2A1A',
  inkDim: '#6B5842',
  inkFaint: '#9A8869',
  rule: 'rgba(58,42,26,0.20)',
  gold: '#A9812F',
  goldSoft: 'rgba(169,129,47,0.14)',
  success: '#2F6B3F',
  warning: '#8F6412',
  danger: '#8B2E2E',
  info: '#2A4B7C',
  grain: 'rgba(74,52,33,0.055)',
};

/**
 * Night reading: the same book under a low lamp. The leaf itself goes dark and
 * the ink turns to warm parchment, rather than merely dimming the paper — that
 * kept dark mode almost indistinguishable from light and made the toggle feel
 * broken.
 */
const DARK: ArchivePalette = {
  backdrop: '#0A0705',
  backdropDeep: '#000000',
  lamp: 'rgba(216,184,92,0.10)',
  cover: '#1E140C',
  coverEdge: '#0A0705',
  coverHighlight: 'rgba(200,162,76,0.32)',
  onCover: '#E8D9B8',
  page: '#241A11',
  pageShade: '#1B130C',
  pageDeep: '#0F0A06',
  pamphlet: '#3A2A1B',
  pamphletShade: '#2C1F13',
  pamphletEdge: '#7A5A2E',
  pamphletInk: '#EEE0C2',
  pamphletInkDim: '#B7A27A',
  ink: '#EADBBA',
  inkDim: '#B29D74',
  inkFaint: '#7F6D4F',
  rule: 'rgba(234,219,186,0.18)',
  gold: '#C8A24C',
  goldSoft: 'rgba(200,162,76,0.13)',
  success: '#6FAE80',
  warning: '#D6A94A',
  danger: '#D07A7A',
  info: '#7FA8DE',
  grain: 'rgba(234,219,186,0.05)',
};

export function useArchivePalette(): ArchivePalette {
  const { isDark } = useTheme();
  return isDark ? DARK : LIGHT;
}

/* -------------------------------- layout ---------------------------------- */

export type SidebarMode = 'full' | 'slim' | 'overlay';

export interface ArchiveLayout {
  /** Pages sit one above the other instead of side by side. */
  stacked: boolean;
  compact: boolean;
  /** 'overlay' means the rail is off-canvas behind a menu button. */
  sidebarMode: SidebarMode;
  sidebarWidth: number;
  bookWidth: number;
  /** Usable width of one leaf — drives the fluid type scale on that leaf. */
  pageWidth: number;
  /**
   * Margin the host screen must use around the book. The book width already
   * subtracts it, so the two must not both be applied twice — that is what
   * pushes the page off the right edge on a phone.
   */
  outerPad: number;
  /** Fixed page height on the spread layout — keeps the book from resizing. */
  pageHeight: number | null;
}

/** Gap between the index rail and the book. */
const RAIL_GAP = 14;
/** Cover padding (both sides) + spine, subtracted to get one leaf's width. */
const COVER_CHROME = 18;
const SPINE_WIDTH = 26;

/**
 * The book stays dominant: the rail takes a fixed slice, the book takes the
 * rest. Below `860` the rail goes off-canvas rather than squeezing the book.
 */
export function useArchiveLayout(): ArchiveLayout {
  const { width, height } = useWindowDimensions();
  const compact = width < 480;
  const sidebarMode: SidebarMode = width >= 1180 ? 'full' : width >= 860 ? 'slim' : 'overlay';
  // 172, not 156: below that the bold active label ("Dashboard") ellipsises.
  const sidebarWidth = sidebarMode === 'full' ? 212 : sidebarMode === 'slim' ? 172 : 0;
  const outerPad = compact ? 10 : 20;

  const available = width - sidebarWidth - outerPad * 2 - (sidebarWidth ? RAIL_GAP : 0);
  const bookWidth = Math.min(available, 1180);
  const stacked = bookWidth < 720;
  const pageWidth = stacked
    ? bookWidth - COVER_CHROME
    : (bookWidth - COVER_CHROME - SPINE_WIDTH) / 2;
  const pageHeight = stacked ? null : Math.max(560, Math.min(height - 150, 820));

  return { stacked, compact, sidebarMode, sidebarWidth, bookWidth, pageWidth, outerPad, pageHeight };
}

/**
 * Fluid type, the RN equivalent of `clamp()`: interpolates between `min` and
 * `max` across a reference width band, so headings grow with the leaf they sit
 * on instead of jumping at a breakpoint.
 */
export function fluid(width: number, min: number, max: number, from = 300, to = 620): number {
  const t = Math.max(0, Math.min(1, (width - from) / (to - from)));
  return Math.round((min + (max - min) * t) * 10) / 10;
}

/* -------------------------------- fit-to-page ----------------------------- */

export interface FitScale {
  /** Multiply font sizes and spacing by this to make the content fit. */
  scale: number;
  /**
   * Reports the height available. Put it on the **ScrollView**, not on a plain
   * flex View — react-native-web's ResizeObserver does not deliver a layout
   * event for a View that is sized purely by its parent's flex, so a wrapper
   * never reports and the fit silently never runs.
   */
  onAvailable: (e: { nativeEvent: { layout: { height: number } } }) => void;
  /** Put on the content inside the scroller, to report its height. */
  onContent: (e: { nativeEvent: { layout: { height: number } } }) => void;
  /** True when even the smallest allowed size overflows — caller should scroll. */
  overflowing: boolean;
}

/**
 * Shrinks a block of content until it fits the height it is given, so a page
 * can show everything at once instead of scrolling.
 *
 * Measured, not guessed: the content is laid out once at full size, and the
 * scale is `available / natural`. Because shrinking type reduces height
 * super-linearly (shorter lines *and* fewer of them), that ratio always fits
 * with a little room to spare.
 *
 * It recomputes only when its inputs change — `signature` plus the measured
 * container height — never in response to its own output, so it cannot loop.
 */
/** Corrections allowed before giving up and letting the area scroll. */
const FIT_PASSES = 4;

export function useFitScale(signature: string, opts?: { min?: number }): FitScale {
  const min = opts?.min ?? 0.45;
  const [scale, setScaleState] = useState(1);
  const [overflowing, setOverflowing] = useState(false);

  // Measurements live in refs so a re-render never races them.
  const scaleRef = useRef(1);
  const availableRef = useRef(0);
  const contentRef = useRef(0);
  const fitted = useRef('');
  const passes = useRef(0);

  const apply = useCallback((v: number) => {
    scaleRef.current = v;
    setScaleState(v);
  }, []);

  /**
   * Run from BOTH callbacks. The content reports its height before the
   * scroller reports the budget, so computing in only one of them means the
   * numbers are never both present and the fit never runs.
   */
  const evaluate = useCallback(() => {
    const available = availableRef.current;
    const h = contentRef.current;
    if (!available || !h) return;
    // Aim a couple of pixels under the budget: landing exactly on it leaves a
    // correction too small to clear the epsilon below, and the area would be
    // flagged as overflowing over a 4px overshoot.
    const target = available - 3;

    const key = `${signature}|${Math.round(available)}`;
    if (fitted.current !== key) {
      fitted.current = key;
      passes.current = 0;
    }

    // Fit is judged against the real budget; `target` only steers the step.
    if (h <= available) {
      setOverflowing(false);
      return;
    }
    if (passes.current >= FIT_PASSES) {
      // Out of corrections — let it scroll rather than clip.
      setOverflowing(true);
      return;
    }
    passes.current += 1;

    // Height falls off faster than the type does: smaller text means shorter
    // lines *and* more characters per line. A linear ratio would over-shrink
    // badly, so step by its square root and re-measure.
    const next = Math.max(min, Math.min(1, scaleRef.current * Math.sqrt(target / h)));
    if (next < scaleRef.current - 0.002) {
      setOverflowing(false);
      apply(next);
    } else {
      // At the floor and still too tall.
      setOverflowing(true);
    }
  }, [signature, min, apply]);

  const restart = useCallback(() => {
    fitted.current = '';
    passes.current = 0;
    setOverflowing(false);
    if (scaleRef.current !== 1) apply(1);
    else evaluate();
  }, [apply, evaluate]);

  // New content: measure again from full size.
  useEffect(() => {
    restart();
    // Only when the content changes — re-running every render would undo the fit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return {
    scale,
    onAvailable: (e) => {
      const h = e.nativeEvent.layout.height;
      if (Math.abs(h - availableRef.current) < 1) {
        evaluate();
        return;
      }
      availableRef.current = h;
      restart();
    },
    onContent: (e) => {
      contentRef.current = e.nativeEvent.layout.height;
      evaluate();
    },
    overflowing,
  };
}

/* ---------------------------- reduced motion ------------------------------ */

/**
 * Honours the OS/browser "reduce motion" setting. When on, the page turn
 * collapses to an instant content swap.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    void Promise.resolve(AccessibilityInfo.isReduceMotionEnabled?.())
      .then((v) => {
        if (alive) setReduced(!!v);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) =>
      setReduced(!!v)
    );
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return reduced;
}

/* ------------------------------ page turn --------------------------------- */

export interface PageTurn {
  /** Spread onto the Animated.View that wraps the turning content. */
  style: Animated.WithAnimatedObject<ViewStyle>;
  /** Darkens the page as it swings — render as an absolute overlay. */
  shadeStyle: Animated.WithAnimatedObject<ViewStyle>;
  /** Runs `apply()` at the perpendicular point, mid-turn. */
  turn: (direction: 1 | -1, apply: () => void) => void;
  turning: boolean;
}

/**
 * A 3D page turn around the book's spine.
 *
 * The leaf rotates away to perpendicular, the caller's state change lands while
 * it is edge-on (so no content is ever seen mid-flip), then the new leaf falls
 * back into place from the other side. Rotation and opacity both run through
 * Animated — no width/height/top/left is ever animated.
 */
export function usePageTurn(opts?: { duration?: number; angle?: number }): PageTurn {
  const duration = opts?.duration ?? 720;
  const angle = opts?.angle ?? 88;
  const t = useRef(new Animated.Value(0)).current;
  const busy = useRef(false);
  const [turning, setTurning] = useState(false);
  const reduced = useReducedMotion();

  useEffect(
    () => () => {
      t.stopAnimation();
    },
    [t]
  );

  const turn = useCallback(
    (direction: 1 | -1, apply: () => void) => {
      if (reduced) {
        apply();
        return;
      }
      if (busy.current) return;
      busy.current = true;
      setTurning(true);
      const half = duration / 2;
      Animated.timing(t, {
        toValue: -direction,
        duration: half,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) {
          busy.current = false;
          setTurning(false);
          return;
        }
        apply();
        t.setValue(direction);
        Animated.timing(t, {
          toValue: 0,
          duration: half,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start(() => {
          busy.current = false;
          setTurning(false);
        });
      });
    },
    [duration, reduced, t]
  );

  const rotateY = t.interpolate({
    inputRange: [-1, 1],
    outputRange: [`-${angle}deg`, `${angle}deg`],
  });
  // Never fully hidden: the leaf dims as it goes edge-on rather than popping.
  const opacity = t.interpolate({
    inputRange: [-1, -0.55, 0, 0.55, 1],
    outputRange: [0.2, 0.82, 1, 0.82, 0.2],
  });
  const shadeOpacity = t.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: [0.34, 0, 0.34],
  });

  return {
    style: {
      opacity,
      transform: [{ perspective: 1400 }, { rotateY }],
      transformOrigin: 'left center',
    } as Animated.WithAnimatedObject<ViewStyle>,
    shadeStyle: { opacity: shadeOpacity } as Animated.WithAnimatedObject<ViewStyle>,
    turn,
    turning,
  };
}

/** Left/right arrow keys drive the visible navigator on web. */
export function useArrowKeys(onPrev: () => void, onNext: () => void, enabled = true) {
  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled) return;
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) return;
    const handler = (e: KeyboardEvent) => {
      const el = doc.activeElement as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      // Never steal the arrow keys from a field the user is typing in.
      if (tag === 'input' || tag === 'textarea' || el?.isContentEditable) return;
      if (e.key === 'ArrowLeft') onPrev();
      else if (e.key === 'ArrowRight') onNext();
    };
    doc.addEventListener('keydown', handler);
    return () => doc.removeEventListener('keydown', handler);
  }, [onPrev, onNext, enabled]);
}

/* ------------------------------ background -------------------------------- */

/** The dark, softly lit desk the book rests on. */
export function ArchiveBackground() {
  const p = useArchivePalette();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={[p.backdropDeep, p.backdrop, p.backdropDeep]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
      {/* Lamp glow above the book. */}
      <LinearGradient
        colors={[p.lamp, 'transparent']}
        style={[StyleSheet.absoluteFill, { height: '55%' }]}
      />
      {/* Vignette: darker at the very top and bottom. */}
      <LinearGradient
        colors={['rgba(0,0,0,0.45)', 'transparent', 'rgba(0,0,0,0.55)']}
        locations={[0, 0.4, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

/* -------------------------------- texture --------------------------------- */

/**
 * Aged-paper grain. Deterministic (no Math.random on render) and drawn from a
 * handful of static views, so it costs nothing to re-render and never flickers.
 */
const SPECKLES = [
  [7, 12, 2], [23, 47, 1], [41, 8, 2], [58, 63, 1], [72, 21, 2], [88, 55, 1],
  [14, 78, 2], [33, 91, 1], [51, 35, 1], [66, 84, 2], [81, 41, 1], [95, 73, 2],
  [4, 58, 1], [28, 26, 2], [45, 69, 1], [61, 15, 1], [77, 95, 2], [92, 31, 1],
  [18, 5, 1], [37, 52, 1], [55, 88, 2], [69, 44, 1], [84, 9, 1], [98, 61, 1],
] as const;

/**
 * Broad tonal washes. Kept very faint on purpose: hard-edged discs read as
 * blotches rather than aged paper, so these sit just above the noise floor.
 */
const STAINS = [
  [10, 16, 190], [72, 6, 150], [82, 66, 230], [24, 78, 170], [52, 38, 200],
] as const;

export function PageGrain({ opacity = 1 }: { opacity?: number }) {
  const p = useArchivePalette();
  return (
    <View style={[StyleSheet.absoluteFill, { opacity }]} pointerEvents="none">
      {STAINS.map(([x, y, size], i) => (
        <View
          key={`stain-${i}`}
          style={{
            position: 'absolute',
            left: `${x}%`,
            top: `${y}%`,
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: p.grain,
            opacity: 0.24,
          }}
        />
      ))}
      {SPECKLES.map(([x, y, size], i) => (
        <View
          key={`fleck-${i}`}
          style={{
            position: 'absolute',
            left: `${x}%`,
            top: `${y}%`,
            width: size,
            height: size,
            borderRadius: size,
            backgroundColor: p.inkFaint,
            opacity: 0.18,
          }}
        />
      ))}
    </View>
  );
}

/* --------------------------------- book ----------------------------------- */

function Spine({ height, stacked }: { height: number | null; stacked: boolean }) {
  const p = useArchivePalette();
  if (stacked) {
    // Horizontal gutter between the stacked pages.
    return (
      <View style={{ height: 16, backgroundColor: p.coverEdge, justifyContent: 'center' }}>
        <LinearGradient
          colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0.1)', 'rgba(0,0,0,0.5)']}
          style={StyleSheet.absoluteFill}
        />
        <View style={{ height: 1, backgroundColor: p.coverHighlight, opacity: 0.5 }} />
      </View>
    );
  }
  return (
    <View style={{ width: SPINE_WIDTH, height: height ?? undefined, backgroundColor: p.coverEdge }}>
      <LinearGradient
        colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.05)', 'rgba(0,0,0,0.55)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Centre stitch line and its highlight. */}
      <View style={styles.spineCenter}>
        <View style={{ flex: 1, backgroundColor: p.coverHighlight, opacity: 0.35 }} />
      </View>
    </View>
  );
}

function BookPage({
  children,
  side,
  height,
  stacked,
  folio,
}: {
  children: React.ReactNode;
  side: 'left' | 'right';
  height: number | null;
  stacked: boolean;
  /** Running foot printed at the bottom of the leaf. */
  folio?: string;
}) {
  const p = useArchivePalette();
  const inner = side === 'left' ? 'right' : 'left';
  return (
    <View
      style={[
        styles.page,
        { backgroundColor: p.page, height: height ?? undefined },
        // Stacked pages must size to their own content. Left as `flex: 1` in an
        // auto-height column they get an indeterminate height, and the folio
        // ends up painted over the last line of the page.
        stacked ? styles.pageStacked : styles.pageSpread,
        !stacked && (side === 'left' ? styles.pageLeft : styles.pageRight),
      ]}
    >
      {/* Parchment tone: warmer at the gutter, cooler at the outer edge. */}
      <LinearGradient
        colors={[p.page, p.pageShade]}
        start={{ x: side === 'left' ? 0 : 1, y: 0 }}
        end={{ x: side === 'left' ? 1 : 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <PageGrain />

      {/* Gutter shadow — the page curving down into the spine. */}
      <LinearGradient
        colors={['transparent', `${p.pageDeep}CC`]}
        start={{ x: side === 'left' ? 0 : 1, y: 0.5 }}
        end={{ x: side === 'left' ? 1 : 0, y: 0.5 }}
        style={[styles.gutter, { [inner]: 0 } as ViewStyle]}
        pointerEvents="none"
      />
      {/* Darker outer edge + the thickness of the leaves beneath. */}
      <View style={[styles.edgeStack, { [side === 'left' ? 'left' : 'right']: 0 }]} pointerEvents="none">
        <View style={{ flex: 1, backgroundColor: p.pageDeep, opacity: 0.55 }} />
        <View style={{ flex: 1, backgroundColor: p.pageShade, opacity: 0.5 }} />
        <View style={{ flex: 1, backgroundColor: p.pageDeep, opacity: 0.28 }} />
      </View>

      <View style={[styles.pageInner, !stacked && styles.flex]}>{children}</View>

      {folio ? (
        <View style={styles.folio} pointerEvents="none">
          <View style={[styles.folioRule, { backgroundColor: p.rule }]} />
          <Text style={[styles.folioText, { color: p.inkFaint }]} numberOfLines={1}>
            {folio}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** The bound, open book. Pass finished page content as `left` / `right`. */
export function OpenBook({
  left,
  right,
  leftFolio,
  rightFolio,
  height,
  width,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  leftFolio?: string;
  rightFolio?: string;
  /** Override the leaf height — for a book that shares the screen with other furniture. */
  height?: number;
  /** Override the book width, for the same reason. */
  width?: number;
}) {
  const p = useArchivePalette();
  const layout = useArchiveLayout();
  const { stacked } = layout;
  const bookWidth = width ?? layout.bookWidth;
  const pageHeight = height ?? layout.pageHeight;
  return (
    <View style={[styles.bookShadow, { width: bookWidth }]}>
      <View style={[styles.cover, { backgroundColor: p.cover, borderColor: p.coverEdge }]}>
        {/* Gilt line inside the binding. */}
        <View style={[styles.gilt, { borderColor: p.coverHighlight }]} pointerEvents="none" />
        <View style={[styles.pages, stacked && styles.pagesStacked]}>
          <BookPage side="left" height={pageHeight} stacked={stacked} folio={leftFolio}>
            {left}
          </BookPage>
          <Spine height={pageHeight} stacked={stacked} />
          <BookPage side="right" height={pageHeight} stacked={stacked} folio={rightFolio}>
            {right}
          </BookPage>
        </View>
      </View>
    </View>
  );
}

/* -------------------------------- flip book -------------------------------- */

export interface FlipBookHandle {
  next: () => void;
  prev: () => void;
  goTo: (spread: number) => void;
}

/**
 * A book you turn a leaf at a time.
 *
 * Going forward, the right leaf swings left about the spine and lands as the
 * new left leaf, revealing the next right leaf underneath — the leaf carries
 * the outgoing right page on its front and the incoming left page on its back.
 * Going back does the mirror image.
 *
 * The two faces are cross-faded at the perpendicular point and the back face is
 * flipped horizontally, so the effect needs no `preserve-3d` — which React
 * Native does not expose — while still reading as one solid turning leaf.
 */
export const FlipBook = React.forwardRef<
  FlipBookHandle,
  {
    /** 0-based index of the spread on show. */
    spread: number;
    spreadCount: number;
    onSpread: (spread: number) => void;
    renderSide: (spread: number, side: 'left' | 'right') => React.ReactNode;
    leftFolio?: string;
    rightFolio?: string;
    height?: number;
    width?: number;
    duration?: number;
  }
>(function FlipBook(
  { spread, spreadCount, onSpread, renderSide, leftFolio, rightFolio, height, width, duration = 780 },
  ref
) {
  const p = useArchivePalette();
  const layout = useArchiveLayout();
  const { stacked } = layout;
  const bookWidth = width ?? layout.bookWidth;
  const pageHeight = height ?? layout.pageHeight;
  const reduced = useReducedMotion();

  const t = useRef(new Animated.Value(0)).current;
  const [flip, setFlip] = useState<{ dir: 'next' | 'prev'; from: number } | null>(null);
  const busy = useRef(false);

  const start = useCallback(
    (dir: 'next' | 'prev') => {
      const to = dir === 'next' ? spread + 1 : spread - 1;
      if (busy.current || to < 0 || to >= spreadCount) return;
      if (reduced || stacked) {
        onSpread(to);
        return;
      }
      busy.current = true;
      // The spread underneath updates at once; the leaf on top still shows the
      // page being turned, so nothing is seen twice.
      setFlip({ dir, from: spread });
      onSpread(to);
      t.setValue(0);
      Animated.timing(t, {
        toValue: 1,
        duration,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        busy.current = false;
        setFlip(null);
      });
    },
    [spread, spreadCount, onSpread, reduced, stacked, t, duration]
  );

  React.useImperativeHandle(
    ref,
    () => ({
      next: () => start('next'),
      prev: () => start('prev'),
      goTo: (target: number) => {
        const clamped = Math.max(0, Math.min(spreadCount - 1, target));
        if (clamped === spread || busy.current) return;
        // A jump of more than one leaf turns in the right direction, once.
        start(clamped > spread ? 'next' : 'prev');
        // Land exactly where asked rather than one leaf along.
        if (Math.abs(clamped - spread) > 1) onSpread(clamped);
      },
    }),
    [start, spread, spreadCount, onSpread]
  );

  // Leaf geometry inside the cover's padding.
  const inner = bookWidth - COVER_CHROME;
  const leafWidth = (inner - SPINE_WIDTH) / 2;

  const rotate = t.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', flip?.dir === 'prev' ? '180deg' : '-180deg'],
  });
  const frontOpacity = t.interpolate({ inputRange: [0, 0.49, 0.5, 1], outputRange: [1, 1, 0, 0] });
  const backOpacity = t.interpolate({ inputRange: [0, 0.49, 0.5, 1], outputRange: [0, 0, 1, 1] });
  const shade = t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.4, 0] });

  return (
    <View style={[styles.bookShadow, { width: bookWidth }]}>
      <View style={[styles.cover, { backgroundColor: p.cover, borderColor: p.coverEdge }]}>
        <View style={[styles.gilt, { borderColor: p.coverHighlight }]} pointerEvents="none" />
        <View style={[styles.pages, stacked && styles.pagesStacked]}>
          <BookPage side="left" height={pageHeight} stacked={stacked} folio={leftFolio}>
            {renderSide(spread, 'left')}
          </BookPage>
          <Spine height={pageHeight} stacked={stacked} />
          <BookPage side="right" height={pageHeight} stacked={stacked} folio={rightFolio}>
            {renderSide(spread, 'right')}
          </BookPage>

          {flip && !stacked ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.leaf,
                {
                  width: leafWidth,
                  height: pageHeight ?? undefined,
                  left: flip.dir === 'next' ? leafWidth + SPINE_WIDTH : 0,
                  transformOrigin: flip.dir === 'next' ? 'left center' : 'right center',
                  transform: [{ perspective: 1600 }, { rotateY: rotate }],
                },
              ]}
            >
              {/* Front: the page you are turning away from. */}
              <Animated.View style={[StyleSheet.absoluteFill, { opacity: frontOpacity }]}>
                <BookPage
                  side={flip.dir === 'next' ? 'right' : 'left'}
                  height={pageHeight}
                  stacked={false}
                >
                  {renderSide(flip.from, flip.dir === 'next' ? 'right' : 'left')}
                </BookPage>
              </Animated.View>

              {/* Back: the page it becomes, un-mirrored so it reads correctly. */}
              <Animated.View
                style={[
                  StyleSheet.absoluteFill,
                  { opacity: backOpacity, transform: [{ scaleX: -1 }] },
                ]}
              >
                <BookPage
                  side={flip.dir === 'next' ? 'left' : 'right'}
                  height={pageHeight}
                  stacked={false}
                >
                  {renderSide(flip.dir === 'next' ? flip.from + 1 : flip.from - 1, flip.dir === 'next' ? 'left' : 'right')}
                </BookPage>
              </Animated.View>

              <Animated.View
                pointerEvents="none"
                style={[StyleSheet.absoluteFill, styles.leafShade, { opacity: shade }]}
              />
            </Animated.View>
          ) : null}
        </View>
      </View>
    </View>
  );
});

/**
 * Scrolls a page's content on the spread layout, and simply flows it when the
 * pages are stacked (so the outer scroll view owns the gesture on phones).
 */
export function PageScroll({ children }: { children: React.ReactNode }) {
  const { stacked } = useArchiveLayout();
  // No flex when stacked: the leaf sizes to this content, not the other way up.
  if (stacked) return <View>{children}</View>;
  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.pageScrollContent}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

/* ------------------------------- typography ------------------------------- */

/** The leaf's own title — sized against the leaf, not the window. */
export function PageTitle({
  children,
  eyebrow,
  center,
  size,
}: {
  children: React.ReactNode;
  eyebrow?: string;
  center?: boolean;
  /** Override the fluid range, e.g. a slightly smaller running head. */
  size?: [min: number, max: number];
}) {
  const p = useArchivePalette();
  const { pageWidth } = useArchiveLayout();
  const [min, max] = size ?? [26, 40];
  return (
    <View style={center && styles.centered}>
      {eyebrow ? (
        <SmallCaps style={center ? styles.centeredText : undefined}>{eyebrow}</SmallCaps>
      ) : null}
      <Text
        style={[
          styles.pageTitle,
          {
            color: p.ink,
            fontSize: fluid(pageWidth, min, max),
            lineHeight: fluid(pageWidth, min + 6, max + 8),
          },
          center && styles.centeredText,
        ]}
      >
        {children}
      </Text>
    </View>
  );
}

export function SectionHeading({ children }: { children: React.ReactNode }) {
  const p = useArchivePalette();
  const { pageWidth } = useArchiveLayout();
  return (
    <Text style={[styles.sectionHeading, { color: p.ink, fontSize: fluid(pageWidth, 16, 23) }]}>
      {children}
    </Text>
  );
}

export function SmallCaps({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  const p = useArchivePalette();
  return <Text style={[styles.smallCaps, { color: p.inkFaint }, style]}>{children}</Text>;
}

/** Hairline divider — a printed rule across the page. */
export function Rule({ ornament = false, gap = 12 }: { ornament?: boolean; gap?: number }) {
  const p = useArchivePalette();
  if (!ornament) {
    return <View style={[styles.rule, { backgroundColor: p.rule, marginVertical: gap }]} />;
  }
  return (
    <View style={[styles.ruleOrnate, { marginVertical: gap }]}>
      <View style={[styles.ruleFlex, { backgroundColor: p.rule }]} />
      <Ionicons name="diamond-outline" size={9} color={p.gold} />
      <View style={[styles.ruleFlex, { backgroundColor: p.rule }]} />
    </View>
  );
}

/* --------------------------------- header --------------------------------- */

interface Anchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The reader's name printed in the archive header. Theme and sign-out live
 * inside its dropdown — both reuse the app's existing implementations
 * (ThemeContext.toggle and AuthContext.signOut).
 */
function ProfileMenu() {
  const p = useArchivePalette();
  const { profile, signOut } = useAuth();
  const { isDark, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [hover, setHover] = useState(false);
  const ref = useRef<View>(null);
  const t = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  const { compact } = useArchiveLayout();

  useEffect(() => {
    if (reduced) {
      // Never leave the menu mounted-but-invisible: with motion reduced the
      // opacity has to land on its final value without an animation.
      t.setValue(open ? 1 : 0);
      return;
    }
    Animated.timing(t, {
      toValue: open ? 1 : 0,
      duration: open ? 190 : 130,
      easing: open ? Easing.out(Easing.quad) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [open, t, reduced]);

  const openMenu = () => {
    if (open) {
      setOpen(false);
      return;
    }
    // measureInWindow is async on native; open immediately so the tap always
    // responds, and drop the anchor in when it arrives (styles.menuCard has a
    // sensible fallback offset until then).
    ref.current?.measureInWindow((x, y, width, height) =>
      setAnchor({ x, y, width, height })
    );
    setOpen(true);
  };

  const name = profile?.full_name ?? 'Archivist';
  const role = profile ? ROLE_LABEL[profile.role] : 'Signed in';
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] });

  const item = (
    icon: keyof typeof Ionicons.glyphMap,
    label: string,
    hint: string,
    onPress: () => void,
    tone?: string
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuItem,
        { backgroundColor: pressed ? p.goldSoft : 'transparent' },
      ]}
    >
      <Ionicons name={icon} size={17} color={tone ?? p.inkDim} />
      <View style={styles.flex}>
        <Text style={[styles.menuLabel, { color: tone ?? p.ink }]}>{label}</Text>
        <Text style={[styles.menuHint, { color: p.inkFaint }]}>{hint}</Text>
      </View>
    </Pressable>
  );

  return (
    <>
      <View ref={ref} collapsable={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${name}. Account menu`}
          accessibilityState={{ expanded: open }}
          onPress={openMenu}
          {...({ onHoverIn: () => setHover(true), onHoverOut: () => setHover(false) } as object)}
          style={[
            styles.profileBtn,
            // A long name must not squeeze the archive imprint off a phone.
            { maxWidth: compact ? 148 : 220 },
            { borderColor: hover || open ? p.coverHighlight : 'transparent' },
            (hover || open) && { backgroundColor: 'rgba(255,255,255,0.06)' },
          ]}
        >
          <View style={[styles.avatar, { borderColor: p.coverHighlight }]}>
            <Ionicons name="person" size={13} color={p.coverHighlight} />
          </View>
          <Text style={[styles.profileName, { color: p.onCover }]} numberOfLines={1}>
            {name}
          </Text>
          <Ionicons name="chevron-down" size={13} color={p.coverHighlight} />
        </Pressable>
      </View>

      <Modal
        transparent
        visible={open}
        animationType="none"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityLabel="Close menu"
          onPress={() => setOpen(false)}
        />
        <Animated.View
          style={[
            styles.menuCard,
            {
              backgroundColor: p.page,
              // Gilt edge: keeps the card readable against the dark backdrop in
              // night mode, where page and cover are both dark.
              borderColor: p.gold,
              top: anchor ? anchor.y + anchor.height + 8 : 56,
              right: 16,
              opacity: t,
              transform: [{ translateY }],
            },
          ]}
        >
          <LinearGradient
            colors={[p.gold, 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.menuTopBar}
          />
          <View style={styles.menuHead}>
            <View style={[styles.avatarLarge, { borderColor: p.gold, backgroundColor: p.goldSoft }]}>
              <Ionicons name="person" size={16} color={p.gold} />
            </View>
            <View style={styles.flex}>
              <Text style={[styles.menuName, { color: p.ink }]} numberOfLines={1}>
                {name}
              </Text>
              <SmallCaps>{role}</SmallCaps>
            </View>
          </View>
          <Rule />
          {item(
            isDark ? 'sunny-outline' : 'moon-outline',
            'Theme',
            isDark ? 'Switch to daylight' : 'Switch to candlelight',
            () => toggle()
          )}
          {item('log-out-outline', 'Logout', 'End this session', () => {
            setOpen(false);
            void signOut();
          }, p.danger)}
        </Animated.View>
      </Modal>
    </>
  );
}

/** The archive's top bar: imprint on the left, the reader's name on the right. */
export function ArchiveHeader({
  title,
  shortTitle,
  subtitle,
  onMenu,
}: {
  title: string;
  /** Used instead of `title` on phone widths, where the full imprint truncates. */
  shortTitle?: string;
  subtitle?: string;
  /** Shown only when the index rail is off-canvas. */
  onMenu?: () => void;
}) {
  const p = useArchivePalette();
  const { compact } = useArchiveLayout();
  return (
    <View style={[styles.header, { backgroundColor: p.coverEdge, borderBottomColor: p.gold }]}>
      <View style={styles.headerLeft}>
        {onMenu ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open index"
            onPress={onMenu}
            hitSlop={8}
            style={[styles.headerMark, { borderColor: p.coverHighlight }]}
          >
            <Ionicons name="menu" size={17} color={p.coverHighlight} />
          </Pressable>
        ) : (
          <View style={[styles.headerMark, { borderColor: p.coverHighlight }]}>
            <Ionicons name="book" size={15} color={p.coverHighlight} />
          </View>
        )}
        <View style={styles.headerTitles}>
          <Text style={[styles.headerTitle, { color: p.onCover }]} numberOfLines={1}>
            {compact ? (shortTitle ?? title) : title}
          </Text>
          {subtitle && !compact ? (
            <Text style={[styles.headerSub, { color: p.coverHighlight }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      <ProfileMenu />
    </View>
  );
}

/* ------------------------------ index rail -------------------------------- */

export interface IndexItem {
  route: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Opens a panel instead of navigating; rendered the same way. */
  action?: () => void;
  disabled?: boolean;
}

/** One printed line of the index, cut into the leather rail. */
function RailEntry({
  ordinal,
  item,
  active,
  first,
  onPress,
}: {
  ordinal: number;
  item: IndexItem;
  active: boolean;
  /** The first entry carries an icon; the rest are numbered, as in an index. */
  first: boolean;
  onPress: () => void;
}) {
  const p = useArchivePalette();
  const t = useRef(new Animated.Value(0)).current;
  const [focused, setFocused] = useState(false);
  const to = (v: number) =>
    Animated.spring(t, { toValue: v, useNativeDriver: true, speed: 26, bounciness: 5 }).start();
  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [0, 4] });

  const tint = item.disabled ? `${p.onCover}55` : active ? p.gold : `${p.onCover}CC`;

  return (
    <Animated.View style={{ transform: [{ translateX }] }}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={item.label}
        accessibilityState={{ selected: active, disabled: !!item.disabled }}
        disabled={item.disabled}
        onPress={onPress}
        onPressIn={() => to(1)}
        onPressOut={() => to(0)}
        {...({
          onHoverIn: () => !item.disabled && to(1),
          onHoverOut: () => to(0),
          onFocus: () => setFocused(true),
          onBlur: () => setFocused(false),
        } as object)}
        style={[
          styles.railRow,
          active && { backgroundColor: 'rgba(0,0,0,0.34)' },
          focused && { borderColor: p.gold },
        ]}
      >
        {/* Gold bookmark bar marks the entry you are reading. */}
        <View
          style={[
            styles.railMark,
            { backgroundColor: active ? p.gold : 'transparent' },
          ]}
        />
        {first ? (
          <Ionicons name={item.icon} size={15} color={tint} style={styles.railGlyph} />
        ) : (
          <Text style={[styles.railNum, { color: tint }]}>{ordinal}.</Text>
        )}
        <Text
          style={[styles.railLabel, { color: tint }, active && styles.railLabelActive]}
          numberOfLines={1}
        >
          {item.label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function RailBody({
  items,
  activeRoute,
  onSelect,
}: {
  items: IndexItem[];
  activeRoute: string;
  onSelect: (item: IndexItem) => void;
}) {
  const p = useArchivePalette();
  return (
    <>
      <View style={styles.railHead}>
        <Text style={[styles.railHeadText, { color: p.coverHighlight }]}>Index</Text>
        <View style={[styles.railHeadRule, { backgroundColor: p.coverHighlight }]} />
      </View>
      {/* Scrolls when the index runs long — the Admin's has eight entries and
          must not spill off a short window. */}
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.railList}
        showsVerticalScrollIndicator={false}
      >
        {items.map((item, i) => (
          <RailEntry
            key={item.route}
            ordinal={i + 1}
            item={item}
            first={i === 0}
            active={item.route === activeRoute}
            onPress={() => onSelect(item)}
          />
        ))}
      </ScrollView>
    </>
  );
}

/** The mahogany index rail standing beside the book. */
export function ArchiveSidebar({
  items,
  activeRoute,
  onSelect,
}: {
  items: IndexItem[];
  activeRoute: string;
  onSelect: (item: IndexItem) => void;
}) {
  const p = useArchivePalette();
  const { sidebarWidth } = useArchiveLayout();
  return (
    <View
      style={[
        styles.rail,
        { width: sidebarWidth, backgroundColor: p.coverEdge, borderRightColor: `${p.gold}55` },
      ]}
    >
      <LinearGradient
        colors={['rgba(255,255,255,0.045)', 'transparent']}
        style={StyleSheet.absoluteFill}
      />
      <PageGrain opacity={0.5} />
      <RailBody items={items} activeRoute={activeRoute} onSelect={onSelect} />
    </View>
  );
}

/** The same rail, slid in over the content when it cannot stand beside it. */
export function ArchiveIndexOverlay({
  visible,
  items,
  activeRoute,
  onSelect,
  onClose,
}: {
  visible: boolean;
  items: IndexItem[];
  activeRoute: string;
  onSelect: (item: IndexItem) => void;
  onClose: () => void;
}) {
  const p = useArchivePalette();
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      t.setValue(visible ? 1 : 0);
      return;
    }
    Animated.timing(t, {
      toValue: visible ? 1 : 0,
      duration: visible ? 240 : 170,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, t, reduced]);

  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [-236, 0] });

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: t }]}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close index" onPress={onClose} />
      </Animated.View>
      <Animated.View
        style={[
          styles.railOverlay,
          { backgroundColor: p.coverEdge, borderRightColor: `${p.gold}66`, transform: [{ translateX }] },
        ]}
      >
        <PageGrain opacity={0.5} />
        <RailBody items={items} activeRoute={activeRoute} onSelect={onSelect} />
      </Animated.View>
    </Modal>
  );
}

/* --------------------------------- ledger --------------------------------- */

/**
 * A large parchment block, as if pasted onto the page: label above, figure in
 * the middle, plain-language caption below.
 */
export function StatBlock({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: number;
  caption: string;
  tone?: string;
}) {
  const p = useArchivePalette();
  const { pageWidth } = useArchiveLayout();
  const counted = useCountUp(value);
  const t = useRef(new Animated.Value(0)).current;
  const to = (v: number) =>
    Animated.spring(t, { toValue: v, useNativeDriver: true, speed: 26, bounciness: 5 }).start();
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, -4] });
  const accent = tone ?? p.ink;

  return (
    <Animated.View
      style={[styles.statWrap, { transform: [{ translateY }] }]}
      {...({ onPointerEnter: () => to(1), onPointerLeave: () => to(0) } as object)}
    >
      <View style={[styles.stat, { backgroundColor: p.pageShade, borderColor: p.rule }]}>
        <View style={[styles.statAccent, { backgroundColor: accent }]} />
        {/* Two lines are always reserved so a wrapping label ("Awaiting
            Co-sign") cannot leave the cards in a row at different heights. */}
        <Text
          style={[
            styles.statLabel,
            {
              color: p.inkDim,
              fontSize: fluid(pageWidth, 10.5, 13),
              lineHeight: fluid(pageWidth, 10.5, 13) * 1.3,
              minHeight: fluid(pageWidth, 10.5, 13) * 2.6,
            },
          ]}
          numberOfLines={2}
        >
          {label}
        </Text>
        <Text
          style={[
            styles.statValue,
            {
              color: accent,
              fontSize: fluid(pageWidth, 32, 50),
              lineHeight: fluid(pageWidth, 38, 58),
            },
          ]}
        >
          {counted}
        </Text>
        <Text
          style={[styles.statCaption, { color: p.inkFaint, fontSize: fluid(pageWidth, 10, 12) }]}
          numberOfLines={2}
        >
          {caption}
        </Text>
      </View>
    </Animated.View>
  );
}

/* ------------------------------- navigator -------------------------------- */

/** A vintage turn-arrow. Large, keyboard-reachable, disabled at the ends. */
export function TurnButton({
  direction,
  onPress,
  disabled,
  label,
  size = 40,
}: {
  direction: 'prev' | 'next';
  onPress: () => void;
  disabled?: boolean;
  label: string;
  size?: number;
}) {
  const p = useArchivePalette();
  const t = useRef(new Animated.Value(0)).current;
  const [focused, setFocused] = useState(false);
  const to = (v: number) =>
    Animated.spring(t, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 8 }).start();
  const translateX = t.interpolate({
    inputRange: [0, 1],
    outputRange: [0, direction === 'prev' ? -3 : 3],
  });
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });

  return (
    <Animated.View style={{ transform: [{ translateX }, { scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={onPress}
        hitSlop={8}
        onPressIn={() => !disabled && to(1)}
        onPressOut={() => to(0)}
        {...({
          onHoverIn: () => !disabled && to(1),
          onHoverOut: () => to(0),
          onFocus: () => setFocused(true),
          onBlur: () => setFocused(false),
        } as object)}
        style={[
          styles.turnBtn,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: focused ? p.gold : p.rule,
            backgroundColor: p.pageShade,
            opacity: disabled ? 0.32 : 1,
            borderWidth: focused ? 2 : 1,
          },
        ]}
      >
        <Ionicons
          name={direction === 'prev' ? 'chevron-back' : 'chevron-forward'}
          size={Math.round(size * 0.5)}
          color={p.ink}
        />
      </Pressable>
    </Animated.View>
  );
}

/* -------------------------------- loader ---------------------------------- */

/** A small book whose page turns, shown while an archive record is fetched. */
export function ArchiveLoader({ label = 'Opening archive…' }: { label?: string }) {
  const p = useArchivePalette();
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(220),
        Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [t, reduced]);

  const rotateY = t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-165deg'] });
  const opacity = t.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 0.75, 0] });

  return (
    <View style={styles.loader}>
      <View style={[styles.loaderBook, { borderColor: p.rule, backgroundColor: p.pageShade }]}>
        <View style={[styles.loaderSpine, { backgroundColor: p.rule }]} />
        <Animated.View
          style={[
            styles.loaderLeaf,
            {
              backgroundColor: p.page,
              borderColor: p.rule,
              opacity,
              transform: [{ perspective: 500 }, { rotateY }],
              transformOrigin: 'left center',
            },
          ]}
        />
      </View>
      <Text style={[styles.loaderText, { color: p.inkDim }]}>{label}</Text>
    </View>
  );
}

/* --------------------------------- styles --------------------------------- */

const styles = StyleSheet.create({
  flex: { flex: 1 },

  /* book */
  bookShadow: {
    alignSelf: 'center',
    // Belt and braces against horizontal overflow if a host screen ever adds
    // padding of its own on top of layout.outerPad.
    maxWidth: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 22 },
    shadowOpacity: 0.55,
    shadowRadius: 40,
    elevation: 18,
  },
  cover: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 9,
    overflow: 'hidden',
  },
  gilt: {
    position: 'absolute',
    top: 4,
    left: 4,
    right: 4,
    bottom: 4,
    borderRadius: 7,
    borderWidth: 1,
    opacity: 0.55,
  },
  pages: { flexDirection: 'row', borderRadius: 3, overflow: 'hidden' },
  pagesStacked: { flexDirection: 'column' },
  page: { overflow: 'hidden' },
  pageSpread: { flex: 1, minHeight: 320 },
  pageStacked: { alignSelf: 'stretch', flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
  pageLeft: { borderTopLeftRadius: 3, borderBottomLeftRadius: 3 },
  pageRight: { borderTopRightRadius: 3, borderBottomRightRadius: 3 },
  // paddingBottom leaves the running foot its own band, so page content can
  // never collide with the folio that is absolutely positioned over it.
  pageInner: { paddingTop: 24, paddingBottom: 34, paddingHorizontal: 26 },
  pageScrollContent: { paddingBottom: 8 },
  folio: { position: 'absolute', left: 26, right: 26, bottom: 10, alignItems: 'center', gap: 5 },
  folioRule: { height: 1, alignSelf: 'stretch', opacity: 0.7 },
  folioText: { fontFamily: serif, fontSize: 9, letterSpacing: 1.6, textTransform: 'uppercase' },
  leaf: {
    position: 'absolute',
    top: 0,
    overflow: 'hidden',
    zIndex: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 18,
    elevation: 16,
  },
  leafShade: { backgroundColor: '#000' },
  gutter: { position: 'absolute', top: 0, bottom: 0, width: 46 },
  edgeStack: { position: 'absolute', top: 0, bottom: 0, width: 3, flexDirection: 'row' },
  spineCenter: { position: 'absolute', top: 6, bottom: 6, left: 12, width: 2 },

  /* typography */
  pageTitle: { fontFamily: serif, fontWeight: '700', letterSpacing: 1.2 },
  centered: { alignItems: 'center' },
  centeredText: { textAlign: 'center' },
  sectionHeading: { fontFamily: serif, fontWeight: '700', letterSpacing: 0.4 },
  smallCaps: {
    fontFamily: serif,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  rule: { height: 1 },
  ruleOrnate: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ruleFlex: { flex: 1, height: 1 },

  /* header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: 1,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headerMark: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitles: { flex: 1 },
  headerTitle: { fontFamily: serif, fontSize: 14, fontWeight: '700', letterSpacing: 2 },
  headerSub: { fontFamily: serif, fontSize: 10, letterSpacing: 1.1, marginTop: 1, opacity: 0.85 },

  /* profile */
  profileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLarge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileName: { fontFamily: serif, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  menuCard: {
    position: 'absolute',
    width: 232,
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.42,
    shadowRadius: 22,
    elevation: 20,
  },
  menuTopBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 2 },
  menuHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2 },
  menuName: { fontFamily: serif, fontSize: 14, fontWeight: '700' },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 6,
    borderRadius: 5,
  },
  menuLabel: { fontFamily: serif, fontSize: 13.5, fontWeight: '600' },
  menuHint: { fontFamily: serif, fontSize: 10.5, marginTop: 1 },

  /* index rail */
  rail: { paddingTop: 18, borderRightWidth: 1, overflow: 'hidden' },
  railOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 236,
    paddingTop: 26,
    borderRightWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 8, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 24,
  },
  scrim: { backgroundColor: 'rgba(0,0,0,0.55)' },
  railHead: { paddingHorizontal: 16, marginBottom: 12, gap: 7 },
  railHeadText: {
    fontFamily: serif,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2.4,
    textTransform: 'uppercase',
  },
  railHeadRule: { height: 1, opacity: 0.45 },
  railList: { gap: 2, paddingHorizontal: 8, paddingBottom: 12 },
  railRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 11,
    paddingRight: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  railMark: { width: 3, alignSelf: 'stretch', borderRadius: 2, marginRight: 3 },
  railNum: { fontFamily: serif, fontSize: 13, fontWeight: '700', width: 18, textAlign: 'right' },
  railGlyph: { width: 18, textAlign: 'center' },
  railLabel: { fontFamily: serif, fontSize: 14.5, letterSpacing: 0.3, flexShrink: 1 },
  railLabelActive: { fontWeight: '700' },

  /* stat blocks */
  statWrap: { flexGrow: 1, flexBasis: '46%', minWidth: 128 },
  stat: {
    borderWidth: 1,
    borderRadius: 3,
    paddingVertical: 16,
    paddingHorizontal: 15,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 8,
    elevation: 2,
  },
  statAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 2, opacity: 0.7 },
  statLabel: {
    fontFamily: serif,
    fontWeight: '700',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  statValue: { fontFamily: serif, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 6 },
  statCaption: { fontFamily: serif, marginTop: 2 },

  /* navigator */
  turnBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 5,
    elevation: 2,
  },

  /* loader */
  loader: { alignItems: 'center', justifyContent: 'center', gap: 14, paddingVertical: 34 },
  loaderBook: { width: 76, height: 54, borderWidth: 1, borderRadius: 3, flexDirection: 'row' },
  loaderSpine: { position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1 },
  loaderLeaf: {
    position: 'absolute',
    left: '50%',
    top: 2,
    bottom: 2,
    width: '48%',
    borderWidth: 1,
    borderRadius: 2,
  },
  loaderText: { fontFamily: serif, fontSize: 12.5, letterSpacing: 0.8, fontStyle: 'italic' },
});
