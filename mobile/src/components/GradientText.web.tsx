import React from 'react';
import { StyleProp, StyleSheet, TextStyle } from 'react-native';

export interface GradientTextProps {
  children: string;
  colors?: readonly string[];
  style?: StyleProp<TextStyle>;
}

/** Web: real gradient text via CSS background-clip on a DOM span. */
export default function GradientText({
  children,
  colors = ['#8B2E2E', '#A9812F', '#D8B85C'],
  style,
}: GradientTextProps) {
  const f = (StyleSheet.flatten(style) || {}) as TextStyle;
  const glow = f.textShadowColor
    ? `0 0 ${f.textShadowRadius ?? 12}px ${String(f.textShadowColor)}`
    : undefined;
  const css: Record<string, unknown> = {
    backgroundImage: `linear-gradient(95deg, ${colors.join(', ')})`,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
    fontSize: f.fontSize,
    fontWeight: f.fontWeight as unknown as number,
    letterSpacing: f.letterSpacing,
    lineHeight: f.lineHeight,
    fontFamily: f.fontFamily,
    textShadow: glow,
    margin: 0,
    display: 'inline-block',
  };
  return React.createElement('span', { style: css }, children);
}
