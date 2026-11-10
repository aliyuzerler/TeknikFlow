import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Icon } from '../icons.js';

/**
 * Normalize imza noktası/stroke'u — @teknikflow/contracts SignatureStroke
 * ile YAPISAL olarak birebir (tasarım sistemi paketi sözleşmeye bağımlı
 * tutulmaz; alan adları ve sınırlar kilitli).
 */
export interface SignaturePadPoint {
  x: number;
  y: number;
  t: number;
}
export type SignaturePadStroke = SignaturePadPoint[];

/**
 * Faz 08 — imza tuvali (web): işaretçi/klavye erişimli HTML canvas.
 * Koordinatlar 0..1 normalize edilmiş yol noktaları olarak toplanır;
 * sunucuya JSON strokes olarak gider (SVG yok — script enjeksiyon yüzeyi
 * yok, bağımlılık yok). Temizle düğmesi + boş-imza koruması.
 */

export interface SignaturePadProps {
  label?: string;
  height?: number;
  /** Strokes değiştiğinde (0..1 normalize noktalar). */
  onStrokesChange?: (strokes: SignaturePadStroke[]) => void;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
}

const LOGICAL_WIDTH = 640;

export function SignaturePad({
  label = 'İmza',
  height = 180,
  onStrokesChange,
  disabled = false,
  className,
  style,
  'aria-label': ariaLabel = 'İmza tuvali',
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<SignaturePadStroke[]>([]);
  const activeRef = useRef<SignaturePadStroke>([]);
  const drawingRef = useRef(false);
  const [pointCount, setPointCount] = useState(0);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const ratio = window.devicePixelRatio ?? 1;
    const width = canvas.clientWidth || LOGICAL_WIDTH;
    if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
      canvas.width = width * ratio;
      canvas.height = height * ratio;
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const allStrokes =
      activeRef.current.length > 0
        ? [...strokesRef.current, activeRef.current]
        : strokesRef.current;
    ctx.strokeStyle = 'var(--tf-ink, #0f172a)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of allStrokes) {
      if (stroke.length < 2) continue;
      ctx.beginPath();
      stroke.forEach((point, index) => {
        const x = point.x * width;
        const y = point.y * height;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }, [height]);

  useEffect(() => {
    redraw();
  }, [redraw, pointCount]);

  function toPoint(clientX: number, clientY: number): { x: number; y: number; t: number } {
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    const width = rect?.width ?? LOGICAL_WIDTH;
    const left = rect?.left ?? clientX;
    const top = rect?.top ?? clientY;
    return {
      x: clamp01((clientX - left) / width),
      y: clamp01((clientY - top) / height),
      t: Date.now() % 1_000_000,
    };
  }

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    drawingRef.current = true;
    activeRef.current = [toPoint(event.clientX, event.clientY)];
    setPointCount((count) => count + 1);
    redraw();
  }

  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || disabled) return;
    activeRef.current.push(toPoint(event.clientX, event.clientY));
    setPointCount((count) => count + 1);
    redraw();
  }

  function pointerUp() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (activeRef.current.length >= 2) {
      strokesRef.current = [...strokesRef.current, activeRef.current];
    }
    activeRef.current = [];
    onStrokesChange?.(strokesRef.current);
    setPointCount(strokesRef.current.reduce((total, stroke) => total + stroke.length, 0));
    redraw();
  }

  function clear() {
    strokesRef.current = [];
    activeRef.current = [];
    onStrokesChange?.([]);
    setPointCount(0);
    redraw();
  }

  return (
    <div className={`tf-signature ${className ?? ''}`.trim()} style={style}>
      <div className="tf-signature__bar">
        <span className="tf-signature__label">{label}</span>
        <button
          type="button"
          className="tf-signature__clear"
          onClick={clear}
          disabled={disabled || pointCount === 0}
        >
          <Icon name="close" size={14} />
          Temizle
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="tf-signature__canvas"
        style={{ height }}
        role="img"
        aria-label={`${ariaLabel} — ${pointCount} nokta`}
        data-testid="tf-signature-canvas"
        data-points={pointCount}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerLeave={pointerUp}
        onPointerCancel={pointerUp}
      />
      <p className="tf-signature__hint" data-testid="tf-signature-hint">
        {pointCount === 0
          ? 'Fare veya parmakla buraya imzalayın'
          : `${pointCount} nokta · ${strokesRef.current.length} çizgi${
              pointCount < 4 ? ' — imza çok kısa' : ''
            }`}
      </p>
    </div>
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Normalize stroke'ları temizler (tek noktalıları düşürür). */
export function sanitizeStrokes(strokes: SignaturePadStroke[]): SignaturePadStroke[] {
  return strokes.filter((stroke) => stroke.length >= 2);
}
