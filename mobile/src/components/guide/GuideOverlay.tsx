import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArchivePalette, useArchivePalette, useReducedMotion } from '../ArchiveBook';
import { serif } from '../../lib/theme';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Spotlight-and-tooltip walkthrough step. Scrolls `scrollRef` (when given) so
 * `targetNode` is on screen, measures it in window coordinates, dims
 * everything else, draws a glowing outline around it, and places the
 * explanation card beside it — never centred, and never covering the target.
 */
export default function GuideOverlay({
  visible,
  title,
  description,
  stepIndex,
  totalSteps,
  targetNode,
  scrollRef,
  onNext,
  onSkip,
  isLast,
}: {
  visible: boolean;
  title?: string;
  description?: string;
  stepIndex: number;
  totalSteps: number;
  targetNode: View | null;
  /** The dashboard's outer ScrollView, when the current layout has one. */
  scrollRef?: React.RefObject<ScrollView | null>;
  onNext: () => void;
  onSkip: () => void;
  isLast: boolean;
}) {
  const p = useArchivePalette();
  const reduced = useReducedMotion();
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(() => makeStyles(p), [p]);

  const [rect, setRect] = useState<Rect | null>(null);
  const [cardSize, setCardSize] = useState<{ width: number; height: number } | null>(null);
  // If a step's target never resolves (e.g. an empty-state screen where the
  // element the step describes hasn't rendered), fall back to an unanchored
  // card after a short wait rather than leaving the user stuck mid-guide with
  // no visible "OK, Got It" or "Skip guide" control.
  const [timedOut, setTimedOut] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;

  // Re-measure (and scroll the target into view first) every time the step
  // changes. The node isn't necessarily laid out on the same tick the guide
  // advances, so this runs one frame later.
  useEffect(() => {
    if (!visible || !targetNode) {
      setRect(null);
      setCardSize(null);
      return;
    }
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      targetNode.measureInWindow((x, y, width, height) => {
        if (cancelled) return;
        setRect({ x, y, width, height });
      });
    };

    if (Platform.OS === 'web') {
      // findNodeHandle/measureLayout-against-a-node-handle are not supported
      // on react-native-web (findNodeHandle throws unconditionally there).
      // But react-native-web's View ref *is* the real DOM node under the
      // hood, so the browser's own scrollIntoView works directly — no need
      // to go through a RN-native-style relative scroll at all.
      const domNode = targetNode as unknown as {
        scrollIntoView?: (opts: { behavior: 'smooth'; block: 'center' }) => void;
      };
      domNode.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      setTimeout(measure, 340);
    } else if (scrollRef?.current) {
      const scrollHandle = findNodeHandle(scrollRef.current);
      if (scrollHandle != null) {
        targetNode.measureLayout(
          scrollHandle,
          (_x, y) => {
            if (cancelled) return;
            scrollRef.current?.scrollTo({ y: Math.max(0, y - 90), animated: true });
            // Give the smooth scroll time to settle before reading final coords.
            setTimeout(measure, 340);
          },
          () => setTimeout(measure, 0)
        );
      } else {
        setTimeout(measure, 0);
      }
    } else {
      setTimeout(measure, 0);
    }
    return () => {
      cancelled = true;
    };
  }, [visible, targetNode, scrollRef, stepIndex]);

  useEffect(() => {
    setTimedOut(false);
    if (!visible) return;
    const id = setTimeout(() => setTimedOut(true), 1600);
    return () => clearTimeout(id);
  }, [visible, stepIndex, targetNode]);

  const showCard = !!rect || timedOut;
  useEffect(() => {
    if (reduced) {
      fade.setValue(showCard ? 1 : 0);
      return;
    }
    Animated.timing(fade, {
      toValue: showCard ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [showCard, fade, reduced]);

  if (!visible) return null;

  const CARD_MAX_WIDTH = Math.min(320, winW - 32);
  const GAP = 14;
  const EDGE = 16;

  let cardStyle: { top?: number; left?: number; right?: number; bottom?: number } = {};
  let arrowStyle: { top?: number; left?: number; right?: number; bottom?: number } = {};
  let arrowDir: 'up' | 'down' | 'left' | 'right' = 'down';

  if (rect && cardSize) {
    const spaceRight = winW - (rect.x + rect.width);
    const spaceLeft = rect.x;
    const spaceBottom = winH - insets.bottom - (rect.y + rect.height);
    const spaceTop = rect.y - insets.top;

    const fitsRight = spaceRight >= cardSize.width + GAP;
    const fitsLeft = spaceLeft >= cardSize.width + GAP;
    const fitsBottom = spaceBottom >= cardSize.height + GAP;
    const fitsTop = spaceTop >= cardSize.height + GAP;

    let placement: 'right' | 'left' | 'bottom' | 'top';
    if (fitsRight) placement = 'right';
    else if (fitsLeft) placement = 'left';
    else if (fitsBottom) placement = 'bottom';
    else if (fitsTop) placement = 'top';
    else placement = spaceBottom >= spaceTop ? 'bottom' : 'top';

    const clampX = (x: number) => Math.min(Math.max(x, EDGE), winW - EDGE - cardSize.width);
    const clampY = (y: number) => Math.min(Math.max(y, insets.top + EDGE), winH - insets.bottom - EDGE - cardSize.height);

    // The arrow is rendered as a child of the card (itself position:absolute),
    // so its offsets must be relative to the card's own box, not the window.
    if (placement === 'right' || placement === 'left') {
      const top = clampY(rect.y + rect.height / 2 - cardSize.height / 2);
      cardStyle = placement === 'right' ? { left: rect.x + rect.width + GAP, top } : { left: rect.x - GAP - cardSize.width, top };
      arrowDir = placement === 'right' ? 'left' : 'right';
      const arrowTop = Math.min(Math.max(rect.y + rect.height / 2 - top - 8, 10), cardSize.height - 26);
      arrowStyle = placement === 'right' ? { left: -8, top: arrowTop } : { right: -8, top: arrowTop };
    } else {
      const left = clampX(rect.x + rect.width / 2 - cardSize.width / 2);
      cardStyle = placement === 'bottom' ? { top: rect.y + rect.height + GAP, left } : { top: rect.y - GAP - cardSize.height, left };
      arrowDir = placement === 'bottom' ? 'up' : 'down';
      const arrowLeft = Math.min(Math.max(rect.x + rect.width / 2 - left - 8, 10), cardSize.width - 26);
      arrowStyle = placement === 'bottom' ? { top: -8, left: arrowLeft } : { bottom: -8, left: arrowLeft };
    }
  }

  const dim = { position: 'absolute' as const, backgroundColor: 'rgba(6,6,10,0.66)' };

  return (
    <Modal transparent visible={visible} animationType="none" statusBarTranslucent onRequestClose={onSkip}>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {rect ? (
          <>
            <View style={[dim, { top: 0, left: 0, right: 0, height: Math.max(0, rect.y) }]} pointerEvents="none" />
            <View
              style={[dim, { top: Math.max(0, rect.y + rect.height), left: 0, right: 0, bottom: 0 }]}
              pointerEvents="none"
            />
            <View
              style={[dim, { top: Math.max(0, rect.y), left: 0, width: Math.max(0, rect.x), height: Math.max(0, rect.height) }]}
              pointerEvents="none"
            />
            <View
              style={[dim, { top: Math.max(0, rect.y), left: rect.x + rect.width, right: 0, height: Math.max(0, rect.height) }]}
              pointerEvents="none"
            />
            <View
              pointerEvents="none"
              style={[
                styles.spotlightRing,
                { top: rect.y - 6, left: rect.x - 6, width: Math.max(0, rect.width + 12), height: Math.max(0, rect.height + 12) },
              ]}
            />
          </>
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(6,6,10,0.66)' }]} pointerEvents="none" />
        )}

        {rect ? (
          <Animated.View
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              if (!cardSize || cardSize.width !== width || cardSize.height !== height) {
                setCardSize({ width, height });
              }
            }}
            style={[
              styles.card,
              { width: CARD_MAX_WIDTH, opacity: fade },
              cardSize ? cardStyle : { opacity: 0, top: 0, left: 0 },
            ]}
          >
            <CardBody
              title={title}
              description={description}
              stepIndex={stepIndex}
              totalSteps={totalSteps}
              isLast={isLast}
              onNext={onNext}
              onSkip={onSkip}
              styles={styles}
            />
            {cardSize ? <View style={[styles.arrow, arrowFor(arrowDir, p), arrowStyle]} /> : null}
          </Animated.View>
        ) : timedOut ? (
          <Animated.View style={[styles.card, styles.fallbackCard, { opacity: fade }]}>
            <CardBody
              title={title}
              description={description}
              stepIndex={stepIndex}
              totalSteps={totalSteps}
              isLast={isLast}
              onNext={onNext}
              onSkip={onSkip}
              styles={styles}
            />
          </Animated.View>
        ) : null}
      </View>
    </Modal>
  );
}

function CardBody({
  title,
  description,
  stepIndex,
  totalSteps,
  isLast,
  onNext,
  onSkip,
  styles,
}: {
  title?: string;
  description?: string;
  stepIndex: number;
  totalSteps: number;
  isLast: boolean;
  onNext: () => void;
  onSkip: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <>
      <Text style={styles.step}>
        STEP {stepIndex + 1} OF {totalSteps}
      </Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.desc}>{description}</Text>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Skip guide"
          onPress={onSkip}
          style={({ pressed }) => [styles.skip, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.skipText}>Skip guide</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isLast ? 'Done' : 'OK, Got It'}
          onPress={onNext}
          style={({ pressed }) => [styles.ok, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.okText}>{isLast ? 'Done' : 'OK, Got It'}</Text>
        </Pressable>
      </View>
    </>
  );
}

function arrowFor(dir: 'up' | 'down' | 'left' | 'right', p: ArchivePalette) {
  const size = 8;
  const base = {
    position: 'absolute' as const,
    width: 0,
    height: 0,
    borderStyle: 'solid' as const,
  };
  switch (dir) {
    case 'down':
      return { ...base, borderLeftWidth: size, borderRightWidth: size, borderTopWidth: size, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: p.gold };
    case 'up':
      return { ...base, borderLeftWidth: size, borderRightWidth: size, borderBottomWidth: size, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: p.gold };
    case 'left':
      return { ...base, borderTopWidth: size, borderBottomWidth: size, borderRightWidth: size, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderRightColor: p.gold };
    case 'right':
      return { ...base, borderTopWidth: size, borderBottomWidth: size, borderLeftWidth: size, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: p.gold };
  }
}

const makeStyles = (p: ArchivePalette) =>
  StyleSheet.create({
    spotlightRing: {
      position: 'absolute',
      borderWidth: 2.5,
      borderColor: p.gold,
      borderRadius: 8,
      shadowColor: p.gold,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.9,
      shadowRadius: 10,
      elevation: 8,
    },
    card: {
      position: 'absolute',
      backgroundColor: p.pageShade,
      borderWidth: 1.5,
      borderColor: p.gold,
      borderRadius: 8,
      padding: 16,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.35,
      shadowRadius: 16,
      elevation: 12,
    },
    // Unanchored fallback for a step whose target never rendered — pinned low
    // on screen so it never masquerades as the default centred placement.
    fallbackCard: { left: 16, right: 16, bottom: 28, width: undefined },
    step: {
      fontFamily: serif,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 1.6,
      color: p.gold,
      marginBottom: 6,
    },
    title: { fontFamily: serif, fontSize: 15.5, fontWeight: '700', color: p.ink, marginBottom: 6 },
    desc: { fontFamily: serif, fontSize: 13, lineHeight: 19, color: p.inkDim },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
    skip: { paddingVertical: 6, paddingRight: 8 },
    skipText: { fontFamily: serif, fontSize: 12, color: p.inkFaint, textDecorationLine: 'underline' },
    ok: { backgroundColor: p.gold, borderRadius: 5, paddingVertical: 9, paddingHorizontal: 16 },
    okText: { fontFamily: serif, fontSize: 13, fontWeight: '700', color: p.coverEdge },
    arrow: {},
  });
