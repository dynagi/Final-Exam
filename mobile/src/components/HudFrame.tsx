import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../context/ThemeContext';

const SIZE = 18;
const THICK = 2;

/**
 * Sci-fi HUD corner brackets, absolutely positioned over whatever they wrap.
 * Purely decorative overlay — render as the last child of a `position:
 * relative`/default View so it sits on top; pointerEvents disabled so it
 * never blocks touches.
 */
export function HudFrame({ inset = 0 }: { inset?: number }) {
  const { colors } = useTheme();
  const color = colors.accent;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: inset, left: inset, right: inset, bottom: inset }}>
      <Corner color={color} style={{ top: 0, left: 0 }} />
      <Corner color={color} style={{ top: 0, right: 0, transform: [{ scaleX: -1 }] }} />
      <Corner color={color} style={{ bottom: 0, left: 0, transform: [{ scaleY: -1 }] }} />
      <Corner color={color} style={{ bottom: 0, right: 0, transform: [{ scaleX: -1 }, { scaleY: -1 }] }} />
    </View>
  );
}

function Corner({ color, style }: { color: string; style: object }) {
  return (
    <View style={[{ position: 'absolute', width: SIZE, height: SIZE }, style]}>
      <View style={{ position: 'absolute', top: 0, left: 0, width: SIZE, height: THICK, backgroundColor: color, opacity: 0.85, borderRadius: 1 }} />
      <View style={{ position: 'absolute', top: 0, left: 0, width: THICK, height: SIZE, backgroundColor: color, opacity: 0.85, borderRadius: 1 }} />
    </View>
  );
}
