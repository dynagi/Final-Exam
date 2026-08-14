/**
 * Chart primitives for the archive book theme.
 *
 * Two forms only, chosen by job (see the dataviz method): a DONUT for
 * part-to-whole / funnel-stage breakdowns, and a magnitude BAR LIST for
 * ranked counts (top subjects, top actions) where there are too many
 * categories for a donut to stay legible.
 *
 * Color is never eyeballed here — every palette this file is handed
 * (ordinal gold ramp, the 4-hue team-role set, the reserved status colors)
 * was run through the dataviz skill's validator for both light and dark
 * archive surfaces before being wired in from the screen that uses it.
 * This file only draws; it does not choose hues.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { ArchivePalette } from './ArchiveBook';
import { serif } from '../lib/theme';

export interface ChartSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

/**
 * Donut / ring chart. Segments are drawn as stroked circle arcs (the
 * standard SVG ring technique) with a `strokeLinecap="round"` — the "4px
 * rounded data-end" mark spec applied to an arc — and a small angular gap
 * between segments standing in for the method's 2px surface-gap spacer, so
 * adjacent slices of the same color family never visually fuse.
 *
 * A legend (swatch + label + count) always renders alongside — the
 * dependable identity channel the method requires for 2+ series, and the
 * secondary encoding that makes a borderline-CVD adjacent pair legal.
 */
export function DonutChart({
  segments,
  palette: p,
  size = 132,
  thickness = 20,
  centerLabel,
}: {
  segments: ChartSegment[];
  palette: ArchivePalette;
  size?: number;
  thickness?: number;
  /** Small caption under the center total — e.g. "papers". */
  centerLabel?: string;
}) {
  const styles = useMemo(() => makeStyles(p), [p]);
  const total = segments.reduce((n, s) => n + s.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const gapLen = Math.min(circumference * 0.012, 6);

  let cumulative = 0;
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const fraction = total > 0 ? s.value / total : 0;
      const rawLen = fraction * circumference;
      const len = Math.max(0, rawLen - gapLen);
      const offset = -((cumulative / Math.max(total, 1)) * circumference) - gapLen / 2;
      cumulative += s.value;
      return { ...s, len, offset };
    });

  return (
    <View style={styles.donutRow}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={p.rule}
              strokeWidth={thickness}
              fill="none"
            />
            {arcs.map((a) => (
              <Circle
                key={a.key}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke={a.color}
                strokeWidth={thickness}
                strokeDasharray={`${a.len} ${circumference - a.len}`}
                strokeDashoffset={a.offset}
                strokeLinecap="round"
                fill="none"
              />
            ))}
          </G>
        </Svg>
        <View style={[StyleSheet.absoluteFill, styles.donutCenter]} pointerEvents="none">
          <Text style={styles.donutTotal}>{total}</Text>
          {centerLabel ? <Text style={styles.donutCenterLabel}>{centerLabel}</Text> : null}
        </View>
      </View>

      <View style={styles.legend}>
        {segments.map((s) => (
          <View key={s.key} style={styles.legendRow}>
            <View style={[styles.swatch, { backgroundColor: s.color }]} />
            <Text style={styles.legendLabel} numberOfLines={1}>
              {s.label}
            </Text>
            <Text style={styles.legendValue}>{s.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Ranked magnitude bars — for "top N" lists where there are too many
 * categories for a donut (the form the method calls for once part-to-whole
 * gives way to plain magnitude comparison). One sequential hue; the value
 * sits at the bar's tip, never inside it, since a short bar has no room.
 */
export function MagnitudeBars({
  items,
  palette: p,
  color,
}: {
  items: { key: string; label: string; value: number }[];
  palette: ArchivePalette;
  /** Defaults to gold — pass a different validated hue for a different section. */
  color?: string;
}) {
  const styles = useMemo(() => makeStyles(p), [p]);
  const max = Math.max(1, ...items.map((i) => i.value));
  const tint = color ?? p.gold;
  return (
    <View>
      {items.map((item) => (
        <View key={item.key} style={styles.barRow}>
          <Text style={styles.barLabel} numberOfLines={1}>
            {item.label}
          </Text>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                { width: `${Math.max(4, (item.value / max) * 100)}%`, backgroundColor: tint },
              ]}
            />
          </View>
          <Text style={styles.barValue}>{item.value}</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (p: ArchivePalette) =>
  StyleSheet.create({
    donutRow: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
    donutCenter: { alignItems: 'center', justifyContent: 'center' },
    donutTotal: { fontFamily: serif, fontSize: 22, fontWeight: '800', color: p.ink },
    donutCenterLabel: {
      fontFamily: serif,
      fontSize: 9,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: p.inkFaint,
      marginTop: 1,
    },
    legend: { flex: 1, minWidth: 130, gap: 6 },
    legendRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    swatch: { width: 10, height: 10, borderRadius: 2.5 },
    legendLabel: { flex: 1, fontFamily: serif, fontSize: 11.5, color: p.inkDim },
    legendValue: {
      fontFamily: serif,
      fontSize: 12,
      fontWeight: '800',
      color: p.ink,
      fontVariant: ['tabular-nums'],
    },

    barRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 9 },
    barLabel: { width: 92, fontFamily: serif, fontSize: 11, color: p.inkDim },
    barTrack: {
      flex: 1,
      height: 8,
      borderRadius: 4,
      backgroundColor: p.pageShade,
      overflow: 'hidden',
    },
    barFill: { height: '100%', borderTopRightRadius: 4, borderBottomRightRadius: 4 },
    barValue: {
      width: 30,
      textAlign: 'right',
      fontFamily: serif,
      fontSize: 11,
      fontWeight: '800',
      color: p.ink,
      fontVariant: ['tabular-nums'],
    },
  });
