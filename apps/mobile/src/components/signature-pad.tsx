import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

/**
 * Faz 08 — imza tuvali: dokunma yolu koordinatları (0..1 normalize)
 * toplar; sunucuya JSON strokes olarak gider (SVG yok — script
 * enjeksiyon yüzeyi yok). Temizle + boş-imza koruması.
 */

export interface SignaturePadPoint {
  x: number;
  y: number;
  t: number;
}

export interface SignaturePadProps {
  /** Boyut/renk uyarlamaları için yükseklik (px). */
  height?: number;
  label?: string;
  /** Her stroke değişiminde güncel strokes. */
  onStrokesChange?: (strokes: SignaturePadPoint[][]) => void;
  testIDPrefix?: string;
}

export function SignaturePad({
  height = 200,
  label = 'Müşteri imzası',
  onStrokesChange,
  testIDPrefix = 'signature-pad',
}: SignaturePadProps) {
  const strokesRef = useRef<SignaturePadPoint[][]>([]);
  const activeRef = useRef<SignaturePadPoint[]>([]);
  const [, forceRender] = useState(0);
  const startTimeRef = useRef<number>(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        startTimeRef.current = Date.now();
        activeRef.current = [
          normalize(event.nativeEvent.locationX, event.nativeEvent.locationY, 0, height),
        ];
      },
      onPanResponderMove: (event) => {
        const point = normalize(
          event.nativeEvent.locationX,
          event.nativeEvent.locationY,
          Date.now() - startTimeRef.current,
          height,
        );
        activeRef.current.push(point);
        forceRender((n) => n + 1);
      },
      onPanResponderRelease: () => {
        if (activeRef.current.length >= 2) {
          strokesRef.current = [...strokesRef.current, activeRef.current];
        }
        activeRef.current = [];
        onStrokesChange?.(strokesRef.current);
        forceRender((n) => n + 1);
      },
      onPanResponderTerminate: () => {
        activeRef.current = [];
        forceRender((n) => n + 1);
      },
    }),
  ).current;

  const pointCount = strokesRef.current.reduce((total, stroke) => total + stroke.length, 0);

  function clear() {
    strokesRef.current = [];
    activeRef.current = [];
    onStrokesChange?.(strokesRef.current);
    forceRender((n) => n + 1);
  }

  return (
    <View style={styles.wrap} testID={`${testIDPrefix}`}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>{label}</Text>
        <Text
          onPress={clear}
          style={styles.clear}
          accessibilityRole="button"
          accessibilityLabel="İmzayı temizle"
          testID={`${testIDPrefix}-clear`}
        >
          Temizle
        </Text>
      </View>
      <View
        style={[styles.canvas, { height }]}
        accessibilityLabel="İmza tuvali"
        testID={`${testIDPrefix}-canvas`}
        {...panResponder.panHandlers}
      >
        {pointCount === 0 && activeRef.current.length === 0 ? (
          <Text style={styles.hint} pointerEvents="none">
            Buraya imzalayın
          </Text>
        ) : null}
        {strokesRef.current.map((stroke, strokeIndex) => (
          <Polyline key={strokeIndex} stroke={stroke} height={height} />
        ))}
        {activeRef.current.length > 0 ? (
          <Polyline stroke={activeRef.current} height={height} active />
        ) : null}
      </View>
      <Text style={styles.counter} testID={`${testIDPrefix}-counter`}>
        {pointCount} nokta · {strokesRef.current.length} çizgi
        {pointCount > 0 && pointCount < 4 ? ' — çok kısa' : ''}
      </Text>
    </View>
  );
}

/** Normalize nokta: 0..1 tuval ölçeği + göreli zaman (ms). */
function normalize(
  locationX: number,
  locationY: number,
  t: number,
  height: number,
): SignaturePadPoint {
  const CANVAS_WIDTH = 320; // Tuval sabit mantıksal genişlik — ölçek taşınır.
  return {
    x: clamp01(locationX / CANVAS_WIDTH),
    y: clamp01(locationY / height),
    t: Math.max(0, Math.round(t)),
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function Polyline({
  stroke,
  height,
  active = false,
}: {
  stroke: SignaturePadPoint[];
  height: number;
  active?: boolean;
}) {
  // RN'de çizgi segmentleri View'larla çizilir (svg bağımlılığı yok).
  const CANVAS_WIDTH = 320;
  return (
    <>
      {stroke.slice(0, -1).map((point, index) => {
        const next = stroke[index + 1]!;
        const left = Math.min(point.x, next.x) * CANVAS_WIDTH;
        const top = Math.min(point.y, next.y) * height;
        const width = Math.max(1.5, Math.abs(next.x - point.x) * CANVAS_WIDTH);
        const vertical = Math.max(1.5, Math.abs(next.y - point.y) * height);
        return (
          <View
            key={`${index}-${point.t}-${next.t}`}
            style={{
              position: 'absolute',
              left,
              top,
              width,
              height: vertical,
              borderRadius: 2,
              backgroundColor: active ? theme.blue700 : theme.ink900,
              opacity: active ? 0.8 : 1,
            }}
          />
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  label: {
    fontSize: theme.textSm,
    fontWeight: '700',
    color: theme.textStrong,
    textTransform: 'uppercase',
  },
  clear: {
    fontSize: theme.textSm,
    color: theme.blue700,
    fontWeight: '600',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  canvas: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radiusMd,
    backgroundColor: theme.surface,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hint: {
    color: theme.muted,
    fontSize: theme.textBase,
  },
  counter: {
    marginTop: 6,
    fontSize: theme.textXs,
    color: theme.muted,
  },
});
