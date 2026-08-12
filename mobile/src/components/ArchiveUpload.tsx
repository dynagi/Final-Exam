/**
 * ArchiveUpload — the physical objects the teacher's upload flow is built from:
 * a king's scroll that unrolls to ask how questions should be added, small
 * parchment popups for the pickers, a drop zone cut into the page, antique page
 * arrows, a folio indicator you can type into, and a quill to sign with.
 *
 * Presentation only. Every one of these takes its data and its actions from the
 * screen; none of them talk to the API.
 */
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { serif } from '../lib/theme';
import { PageGrain, useArchivePalette, useReducedMotion } from './ArchiveBook';

/* ------------------------------ king's scroll ----------------------------- */

export interface ScrollChoice {
  key: string;
  label: string;
  hint: string;
  icon: keyof typeof Ionicons.glyphMap;
}

/**
 * A royal scroll that unrolls horizontally: the rods part, the parchment opens
 * out between them, and only then does the writing appear.
 */
export function KingsScroll({
  visible,
  title,
  choices,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  choices: ScrollChoice[];
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  const p = useArchivePalette();
  const { isDark } = useTheme();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const t = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) setMounted(true);
    if (reduced) {
      t.setValue(visible ? 1 : 0);
      if (!visible) setMounted(false);
      return;
    }
    Animated.timing(t, {
      toValue: visible ? 1 : 0,
      // Unrolling takes longer than letting it snap shut.
      duration: visible ? 880 : 420,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      if (!visible) setMounted(false);
    });
  }, [visible, t, reduced]);

  const sheetWidth = Math.min(width - 80, 640);
  const half = sheetWidth / 2;

  const scaleX = t.interpolate({ inputRange: [0, 1], outputRange: [0.02, 1] });
  // The rods ride the parchment's edges as it opens.
  const leftRod = t.interpolate({ inputRange: [0, 1], outputRange: [half, 0] });
  const rightRod = t.interpolate({ inputRange: [0, 1], outputRange: [-half, 0] });
  // Writing appears only once there is parchment to write on.
  const ink = t.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 0, 1] });

  const rod = (translateX: Animated.AnimatedInterpolation<number>) => (
    <Animated.View style={[styles.rodWrap, { transform: [{ translateX }] }]}>
      <LinearGradient
        colors={[p.coverEdge, p.cover, p.coverEdge]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.rod}
      />
      <View style={[styles.rodCap, { backgroundColor: p.gold }]} />
      <View style={[styles.rodCapBottom, { backgroundColor: p.gold }]} />
    </Animated.View>
  );

  return (
    <Modal transparent visible={mounted} animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: t }]}>
        <BlurView intensity={isDark ? 30 : 22} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.scrim]} />
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close" onPress={onClose} />
      </Animated.View>

      <View style={styles.center} pointerEvents="box-none">
        <View style={[styles.scrollRow, { width: sheetWidth + 26 }]}>
          {rod(leftRod)}

          <Animated.View
            style={[
              styles.parchment,
              {
                width: sheetWidth,
                backgroundColor: p.pamphlet,
                borderColor: p.pamphletEdge,
                transform: [{ scaleX }],
              },
            ]}
          >
            <LinearGradient
              colors={[p.pamphletShade, p.pamphlet, p.pamphletShade]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
            <PageGrain />

            <Animated.View style={{ opacity: ink }}>
              <View style={styles.crest}>
                <Ionicons name="ribbon" size={16} color={p.pamphletEdge} />
              </View>
              <Text style={[styles.scrollTitle, { color: p.pamphletInk }]}>{title}</Text>
              <View style={[styles.scrollRule, { backgroundColor: `${p.pamphletEdge}77` }]} />

              <View style={styles.choices}>
                {choices.map((c) => (
                  <ScrollChoiceButton key={c.key} choice={c} onPress={() => onSelect(c.key)} />
                ))}
              </View>
            </Animated.View>
          </Animated.View>

          {rod(rightRod)}
        </View>
      </View>
    </Modal>
  );
}

function ScrollChoiceButton({ choice, onPress }: { choice: ScrollChoice; onPress: () => void }) {
  const p = useArchivePalette();
  const t = useRef(new Animated.Value(0)).current;
  const [focused, setFocused] = useState(false);
  const to = (v: number) =>
    Animated.spring(t, { toValue: v, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });

  return (
    <Animated.View style={[styles.choiceWrap, { transform: [{ translateY }] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={choice.label}
        onPress={onPress}
        onPressIn={() => to(1)}
        onPressOut={() => to(0)}
        {...({
          onHoverIn: () => to(1),
          onHoverOut: () => to(0),
          onFocus: () => setFocused(true),
          onBlur: () => setFocused(false),
        } as object)}
        style={[
          styles.choice,
          {
            backgroundColor: `${p.pamphletEdge}1A`,
            borderColor: focused ? p.gold : p.pamphletEdge,
            borderWidth: focused ? 2 : 1,
          },
        ]}
      >
        <Ionicons name={choice.icon} size={22} color={p.pamphletEdge} />
        <Text style={[styles.choiceLabel, { color: p.pamphletInk }]}>{choice.label}</Text>
        <Text style={[styles.choiceHint, { color: p.pamphletInkDim }]} numberOfLines={2}>
          {choice.hint}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/* ------------------------------ small popup ------------------------------- */

/** A slip of parchment lifted off the page — used for the pickers. */
export function VintagePopup({
  visible,
  title,
  onClose,
  children,
  width = 380,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  const p = useArchivePalette();
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) setMounted(true);
    if (reduced) {
      t.setValue(visible ? 1 : 0);
      if (!visible) setMounted(false);
      return;
    }
    Animated.timing(t, {
      toValue: visible ? 1 : 0,
      duration: visible ? 260 : 170,
      easing: visible ? Easing.out(Easing.back(1.1)) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      if (!visible) setMounted(false);
    });
  }, [visible, t, reduced]);

  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });

  return (
    <Modal transparent visible={mounted} animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: t }]}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close" onPress={onClose} />
      </Animated.View>
      <View style={styles.center} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.popup,
            {
              width,
              maxWidth: '100%',
              backgroundColor: p.pamphlet,
              borderColor: p.pamphletEdge,
              opacity: t,
              transform: [{ scale }, { translateY }],
            },
          ]}
        >
          <PageGrain />
          <Text style={[styles.popupTitle, { color: p.pamphletInk }]}>{title}</Text>
          <View style={[styles.popupRule, { backgroundColor: `${p.pamphletEdge}66` }]} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

/** A row inside a VintagePopup. */
export function PopupRow({
  label,
  hint,
  tag,
  active,
  onPress,
}: {
  label: string;
  hint?: string;
  tag?: string;
  active?: boolean;
  onPress: () => void;
}) {
  const p = useArchivePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.popupRow,
        { borderColor: active ? p.pamphletEdge : 'transparent' },
        (active || pressed) && { backgroundColor: `${p.pamphletEdge}22` },
      ]}
    >
      <View style={styles.flex}>
        <Text style={[styles.popupRowLabel, { color: p.pamphletInk }]}>{label}</Text>
        {hint ? (
          <Text style={[styles.popupRowHint, { color: p.pamphletInkDim }]} numberOfLines={2}>
            {hint}
          </Text>
        ) : null}
      </View>
      {tag ? (
        <Text style={[styles.popupTag, { color: p.warning, borderColor: p.warning }]}>{tag}</Text>
      ) : null}
      {active ? <Ionicons name="checkmark" size={16} color={p.pamphletEdge} /> : null}
    </Pressable>
  );
}

/* ------------------------------- drop zone -------------------------------- */

/** The cut-out in the page where a PDF is dropped. */
export function UploadDropZone({
  title,
  fileName,
  busy,
  onPress,
}: {
  title: string;
  fileName?: string | null;
  busy?: boolean;
  onPress: () => void;
}) {
  const p = useArchivePalette();
  const t = useRef(new Animated.Value(0)).current;
  const [focused, setFocused] = useState(false);
  const to = (v: number) =>
    Animated.spring(t, { toValue: v, useNativeDriver: true, speed: 26, bounciness: 5 }).start();
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.01] });

  return (
    <Animated.View style={[styles.flex, { transform: [{ scale }] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={fileName ? `Replace ${fileName}` : 'Choose a PDF'}
        onPress={onPress}
        disabled={busy}
        onPressIn={() => to(1)}
        onPressOut={() => to(0)}
        {...({
          onHoverIn: () => to(1),
          onHoverOut: () => to(0),
          onFocus: () => setFocused(true),
          onBlur: () => setFocused(false),
        } as object)}
        style={[
          styles.drop,
          {
            borderColor: focused ? p.gold : p.pamphletEdge,
            backgroundColor: `${p.pageShade}88`,
            opacity: busy ? 0.6 : 1,
          },
        ]}
      >
        <View style={[styles.dropIcon, { borderColor: `${p.gold}88` }]}>
          <Ionicons name="cloud-upload-outline" size={30} color={p.gold} />
        </View>
        <Text style={[styles.dropTitle, { color: p.ink }]}>{title}</Text>
        <Text style={[styles.dropLine, { color: p.inkDim }]}>Drop your PDF here</Text>
        <Text style={[styles.dropOr, { color: p.inkFaint }]}>or</Text>
        <Text style={[styles.dropLink, { color: p.gold }]}>click to choose a PDF</Text>
        <Text style={[styles.dropNote, { color: p.inkFaint }]}>
          {fileName ? fileName : 'PDF files only'}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/* -------------------------------- quill ----------------------------------- */

/** The pen the teacher signs a question into the bank with. */
export function QuillButton({
  title,
  onPress,
  loading,
  disabled,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const p = useArchivePalette();
  const t = useRef(new Animated.Value(0)).current;
  const [focused, setFocused] = useState(false);
  const off = disabled || loading;
  const to = (v: number) =>
    Animated.spring(t, { toValue: v, useNativeDriver: true, speed: 28, bounciness: 6 }).start();
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });
  const nib = t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-14deg'] });

  return (
    <Animated.View style={{ transform: [{ translateY }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: !!off, busy: !!loading }}
        disabled={off}
        onPress={onPress}
        onPressIn={() => !off && to(1)}
        onPressOut={() => to(0)}
        {...({
          onHoverIn: () => !off && to(1),
          onHoverOut: () => to(0),
          onFocus: () => setFocused(true),
          onBlur: () => setFocused(false),
        } as object)}
        style={[
          styles.quill,
          {
            borderColor: focused ? p.gold : p.pamphletEdge,
            borderWidth: focused ? 2 : 1.5,
            opacity: off ? 0.45 : 1,
          },
        ]}
      >
        <LinearGradient
          colors={[`${p.gold}3A`, `${p.gold}18`]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {/* The pen itself forms the left of the plate. */}
        <Animated.View style={{ transform: [{ rotate: nib }] }}>
          <Ionicons name={loading ? 'hourglass-outline' : 'brush'} size={19} color={p.gold} />
        </Animated.View>
        <View style={[styles.quillRule, { backgroundColor: `${p.gold}66` }]} />
        <Text style={[styles.quillText, { color: p.ink }]}>{title}</Text>
      </Pressable>
    </Animated.View>
  );
}

/* ------------------------------ book arrows ------------------------------- */

/** An engraved brass page arrow for the corners of the spread. */
export function BookArrow({
  direction,
  onPress,
  disabled,
  label,
  variant = 'page',
}: {
  direction: 'prev' | 'next' | 'back';
  onPress: () => void;
  disabled?: boolean;
  label: string;
  /** `back` is the escape hatch above the book, not a page turn. */
  variant?: 'page' | 'back';
}) {
  const p = useArchivePalette();
  const t = useRef(new Animated.Value(0)).current;
  const [focused, setFocused] = useState(false);
  const to = (v: number) =>
    Animated.spring(t, { toValue: v, useNativeDriver: true, speed: 34, bounciness: 8 }).start();
  const shift = direction === 'prev' || direction === 'back' ? -4 : 4;
  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [0, shift] });

  const icon =
    direction === 'back' ? 'arrow-undo' : direction === 'prev' ? 'chevron-back' : 'chevron-forward';

  return (
    <Animated.View style={{ transform: [{ translateX }] }}>
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
          styles.arrow,
          variant === 'back' && styles.arrowBack,
          {
            borderColor: focused ? p.gold : p.pamphletEdge,
            backgroundColor: variant === 'back' ? p.cover : p.pageShade,
            opacity: disabled ? 0.3 : 1,
          },
        ]}
      >
        <LinearGradient
          colors={[`${p.gold}44`, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Ionicons name={icon} size={17} color={variant === 'back' ? p.onCover : p.ink} />
      </Pressable>
    </Animated.View>
  );
}

/* ----------------------------- folio indicator ---------------------------- */

/**
 * "Page 3 out of 40", where the number is a control. Typing a folio is
 * validated against the real range — no zero, no fractions, nothing past the
 * last page.
 */
export function PageIndicator({
  page,
  pageCount,
  onGo,
}: {
  page: number;
  pageCount: number;
  onGo: (page: number) => void;
}) {
  const p = useArchivePalette();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(String(page));
  const [error, setError] = useState<string | null>(null);

  const openInput = () => {
    setText(String(page));
    setError(null);
    setOpen(true);
  };

  const commit = () => {
    const trimmed = text.trim();
    if (!/^\d+$/.test(trimmed)) {
      setError('Folios are whole numbers.');
      return;
    }
    const n = Number(trimmed);
    if (n < 1) {
      setError('The first folio is 1.');
      return;
    }
    if (n > pageCount) {
      setError(`This volume ends at folio ${pageCount}.`);
      return;
    }
    setOpen(false);
    onGo(n);
  };

  return (
    <>
      <View style={styles.folio}>
        <Text style={[styles.folioText, { color: p.onCover }]}>Page</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Page ${page} of ${pageCount}. Go to a folio`}
          onPress={openInput}
          style={[styles.folioBtn, { borderColor: p.gold, backgroundColor: `${p.gold}22` }]}
        >
          <Text style={[styles.folioNum, { color: p.onCover }]}>{page}</Text>
        </Pressable>
        <Text style={[styles.folioText, { color: p.onCover }]}>out of {pageCount}</Text>
      </View>

      <VintagePopup visible={open} title="Go to folio" onClose={() => setOpen(false)} width={300}>
        <Text style={[styles.goHint, { color: p.pamphletInkDim }]}>
          Folios 1 to {pageCount}.
        </Text>
        <TextInput
          value={text}
          onChangeText={(v) => {
            // Digits only, so a fraction or a minus can never be typed.
            setText(v.replace(/[^0-9]/g, ''));
            setError(null);
          }}
          onSubmitEditing={commit}
          keyboardType="number-pad"
          autoFocus
          accessibilityLabel="Folio number"
          style={[
            styles.goInput,
            { color: p.pamphletInk, borderColor: error ? p.danger : p.pamphletEdge },
          ]}
        />
        {error ? <Text style={[styles.goError, { color: p.danger }]}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go"
          onPress={commit}
          style={[styles.goBtn, { borderColor: p.pamphletEdge, backgroundColor: `${p.pamphletEdge}22` }]}
        >
          <Text style={[styles.goBtnText, { color: p.pamphletInk }]}>Go</Text>
        </Pressable>
      </VintagePopup>
    </>
  );
}

/* --------------------------- working animation ---------------------------- */

/** A quill scratching away while the archive is read. */
export function ArchiveWorking({ label }: { label: string }) {
  const p = useArchivePalette();
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [t, reduced]);

  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [-34, 34] });
  const rotate = t.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['-8deg', '2deg', '-8deg'] });
  const inkWidth = t.interpolate({ inputRange: [0, 1], outputRange: ['8%', '92%'] });

  return (
    <View style={styles.working}>
      <View style={styles.workingStage}>
        <Animated.View style={{ transform: [{ translateX }, { rotate }] }}>
          <Ionicons name="brush" size={26} color={p.gold} />
        </Animated.View>
        <View style={[styles.workingRule, { backgroundColor: `${p.rule}` }]}>
          <Animated.View style={[styles.workingInk, { width: inkWidth, backgroundColor: p.gold }]} />
        </View>
      </View>
      <Text style={[styles.workingText, { color: p.inkDim }]}>{label}</Text>
    </View>
  );
}

/* --------------------------------- styles --------------------------------- */

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  scrim: { backgroundColor: 'rgba(0,0,0,0.5)' },

  /* scroll */
  scrollRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  rodWrap: { width: 13, alignItems: 'center', zIndex: 2 },
  rod: {
    width: 13,
    height: 210,
    borderRadius: 7,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 10,
  },
  rodCap: { position: 'absolute', top: -5, width: 19, height: 7, borderRadius: 4 },
  rodCapBottom: { position: 'absolute', bottom: -5, width: 19, height: 7, borderRadius: 4 },
  parchment: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: 20,
    paddingHorizontal: 26,
    minHeight: 190,
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.42,
    shadowRadius: 20,
    elevation: 14,
  },
  crest: { alignItems: 'center', marginBottom: 6 },
  scrollTitle: {
    fontFamily: serif,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 2.6,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  scrollRule: { height: 1, marginTop: 10, marginBottom: 16 },
  choices: { flexDirection: 'row', gap: 14, justifyContent: 'center', flexWrap: 'wrap' },
  choiceWrap: { flexGrow: 1, flexBasis: 190, maxWidth: 260 },
  choice: { alignItems: 'center', gap: 5, borderRadius: 4, paddingVertical: 16, paddingHorizontal: 14 },
  choiceLabel: {
    fontFamily: serif,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginTop: 3,
  },
  choiceHint: { fontFamily: serif, fontSize: 11, lineHeight: 15, textAlign: 'center' },

  /* popup */
  popup: {
    borderWidth: 1,
    borderRadius: 4,
    paddingVertical: 16,
    paddingHorizontal: 18,
    maxHeight: '80%',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 20,
  },
  popupTitle: {
    fontFamily: serif,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  popupRule: { height: 1, marginTop: 9, marginBottom: 10 },
  popupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 3,
    paddingVertical: 9,
    paddingHorizontal: 10,
    marginBottom: 4,
  },
  popupRowLabel: { fontFamily: serif, fontSize: 13.5, fontWeight: '600' },
  popupRowHint: { fontFamily: serif, fontSize: 10.5, marginTop: 2, lineHeight: 14 },
  popupTag: {
    fontFamily: serif,
    fontSize: 8.5,
    fontWeight: '700',
    letterSpacing: 0.6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },

  /* drop zone */
  drop: {
    flex: 1,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 22,
    paddingHorizontal: 18,
    gap: 3,
  },
  dropIcon: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  dropTitle: {
    fontFamily: serif,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  dropLine: { fontFamily: serif, fontSize: 13.5, marginTop: 6 },
  dropOr: { fontFamily: serif, fontSize: 11, fontStyle: 'italic' },
  dropLink: { fontFamily: serif, fontSize: 13.5, fontWeight: '700' },
  dropNote: { fontFamily: serif, fontSize: 10.5, marginTop: 10, letterSpacing: 0.8 },

  /* quill */
  quill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 4,
    paddingVertical: 12,
    paddingHorizontal: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.24,
    shadowRadius: 9,
    elevation: 4,
  },
  quillRule: { width: 1, height: 18, opacity: 0.8 },
  quillText: { fontFamily: serif, fontSize: 13.5, fontWeight: '700', letterSpacing: 1.4 },

  /* arrows */
  arrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius: 6,
    elevation: 4,
  },
  arrowBack: { width: 38, height: 38, borderRadius: 19 },

  /* folio */
  folio: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' },
  folioText: { fontFamily: serif, fontSize: 12, letterSpacing: 1.2 },
  folioBtn: { minWidth: 34, borderWidth: 1, borderRadius: 3, paddingHorizontal: 9, paddingVertical: 3 },
  folioNum: {
    fontFamily: serif,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  goHint: { fontFamily: serif, fontSize: 11.5, textAlign: 'center', marginBottom: 9 },
  goInput: {
    fontFamily: serif,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    borderWidth: 1,
    borderRadius: 3,
    paddingVertical: 9,
    marginBottom: 8,
  },
  goError: { fontFamily: serif, fontSize: 11, textAlign: 'center', marginBottom: 8 },
  goBtn: { borderWidth: 1, borderRadius: 3, paddingVertical: 9, alignItems: 'center' },
  goBtnText: {
    fontFamily: serif,
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },

  /* working */
  working: { alignItems: 'center', gap: 14, paddingVertical: 30 },
  workingStage: { alignItems: 'center', gap: 8, width: 160 },
  workingRule: { height: 1, width: '100%', overflow: 'hidden' },
  workingInk: { height: 1 },
  workingText: { fontFamily: serif, fontSize: 12.5, fontStyle: 'italic', letterSpacing: 0.8 },
});
