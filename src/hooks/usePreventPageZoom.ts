import { useEffect, useMemo, type RefObject } from 'react';
import { EditorView } from '@codemirror/view';

const SAFARI_MIN_FOCUS_FONT_PX = 16;
const MIN_FONT_SIZE_PX = 8;
const MAX_FONT_SIZE_PX = 32;
const DOUBLE_TAP_THRESHOLD_MS = 300;
const ZOOM_SHORTCUT_KEYS = new Set(['+', '=', '-', '_', '0']);

type UsePreventPageZoomOptions = {
  /** Container do editor (para garantir font-size 16px no foco sem bloquear scroll de 1 dedo) */
  containerRef: RefObject<HTMLElement | null>;
  /** Tamanho visual desejado em px (ex.: 11px) */
  visualFontSize: number;
  /** Ativa/desativa o bloqueio global (padrão: true) */
  enabled?: boolean;
};

/**
 * Previne qualquer tipo de zoom na página (pinch, gesturestart do Safari,
 * double-tap, Ctrl/Cmd + Wheel e Ctrl/Cmd + +/-/0) e fornece a extensão
 * do CodeMirror que emula 16px reais no DOM para o iOS Safari enquanto
 * preserva o tamanho visual idêntico ao `visualFontSize`.
 */
export function usePreventPageZoom({
  containerRef,
  visualFontSize,
  enabled = true,
}: UsePreventPageZoomOptions) {
  // 1. Garante meta viewport restritiva no <head> sem sobrescrever atributos existentes úteis
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;

    let meta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
    const previousContent = meta?.getAttribute('content') ?? null;
    const lockedViewport =
      'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', lockedViewport);

    // Bloqueia double-tap zoom via CSS touch-action no root sem matar scroll vertical/horizontal
    const prevTouchAction = document.documentElement.style.touchAction;
    document.documentElement.style.touchAction = 'pan-x pan-y';

    return () => {
      document.documentElement.style.touchAction = prevTouchAction;
      if (meta && previousContent !== null) {
        meta.setAttribute('content', previousContent);
      }
    };
  }, [enabled]);

  // 2. Intercepta gestos multi-touch, pinch, drag-zoom, double-tap, wheel-zoom e atalhos de teclado
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    let lastTouchEnd = 0;

    // Bloqueia pinch-to-zoom (2+ dedos) e drag-zoom em qualquer lugar da página,
    // preservando arraste/scroll normal de 1 dedo dentro do CodeMirror e resizers.
    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length > 1) {
        event.preventDefault();
      }
    };

    const handleTouchMove = (event: TouchEvent) => {
      // event.scale !== 1 detecta pinch/zoom mesmo antes de touches.length estabilizar no Safari
      const touchScale = (event as TouchEvent & { scale?: number }).scale;
      if (event.touches.length > 1 || (typeof touchScale === 'number' && touchScale !== 1)) {
        event.preventDefault();
      }
    };

    // Bloqueia double-tap zoom rápido no iOS Safari
    const handleTouchEnd = (event: TouchEvent) => {
      const now = Date.now();
      if (now - lastTouchEnd <= DOUBLE_TAP_THRESHOLD_MS) {
        event.preventDefault();
      }
      lastTouchEnd = now;
    };

    // Eventos exclusivos do Safari/WebKit para gestos de pinça
    const handleGesture = (event: Event) => {
      event.preventDefault();
    };

    // Bloqueia Ctrl/Cmd + Scroll (trackpad pinch no macOS/iPadOS e mouse wheel zoom)
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
      }
    };

    // Bloqueia Ctrl/Cmd + (+ / - / 0)
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && ZOOM_SHORTCUT_KEYS.has(event.key)) {
        event.preventDefault();
      }
    };

    // Se o VisualViewport sofrer escala residual no iOS, força reset de scroll/escala
    const handleViewportResize = () => {
      const vv = window.visualViewport;
      if (vv && vv.scale > 1) {
        window.scrollTo(0, 0);
      }
    };

    // Listener non-passive é obrigatório no iOS Safari para preventDefault() funcionar
    const nonPassive: AddEventListenerOptions = { passive: false, capture: true };

    document.addEventListener('touchstart', handleTouchStart, nonPassive);
    document.addEventListener('touchmove', handleTouchMove, nonPassive);
    document.addEventListener('touchend', handleTouchEnd, nonPassive);
    document.addEventListener('gesturestart', handleGesture, nonPassive);
    document.addEventListener('gesturechange', handleGesture, nonPassive);
    document.addEventListener('gestureend', handleGesture, nonPassive);
    window.addEventListener('wheel', handleWheel, nonPassive);
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.visualViewport?.addEventListener('resize', handleViewportResize);

    return () => {
      document.removeEventListener('touchstart', handleTouchStart, true);
      document.removeEventListener('touchmove', handleTouchMove, true);
      document.removeEventListener('touchend', handleTouchEnd, true);
      document.removeEventListener('gesturestart', handleGesture, true);
      document.removeEventListener('gesturechange', handleGesture, true);
      document.removeEventListener('gestureend', handleGesture, true);
      window.removeEventListener('wheel', handleWheel, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.visualViewport?.removeEventListener('resize', handleViewportResize);
    };
  }, [enabled]);

  // 3. Garante que qualquer <input>, <select>, <textarea> ou [contenteditable] focado
  // dentro do container tenha computed font-size >= 16px para o Safari nunca dar auto-zoom.
  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const computedSize = parseFloat(window.getComputedStyle(target).fontSize || '16');
      if (computedSize < SAFARI_MIN_FOCUS_FONT_PX) {
        target.style.fontSize = `${SAFARI_MIN_FOCUS_FONT_PX}px`;
      }
    };

    container.addEventListener('focusin', handleFocusIn, true);
    return () => container.removeEventListener('focusin', handleFocusIn, true);
  }, [containerRef, enabled]);

  // 4. Extensão CodeMirror: mantém 16px reais no .cm-content (engana o heurístico de zoom
  // do Safari no foco) e aplica zoom CSS proporcional (visualFontSize / 16) para
  // ficar visualmente 100% idêntico ao tamanho escolhido sem deslocar o caret.
  const safariNoZoomFontExtension = useMemo(() => {
    const clamped = Math.max(MIN_FONT_SIZE_PX, Math.min(MAX_FONT_SIZE_PX, visualFontSize));
    const scaleRatio = clamped / SAFARI_MIN_FOCUS_FONT_PX;
    const basePx = `${SAFARI_MIN_FOCUS_FONT_PX}px`;

    return EditorView.theme({
      '&': {
        fontSize: basePx,
        zoom: String(scaleRatio),
        touchAction: 'pan-x pan-y',
      },
      '.cm-scroller': {
        touchAction: 'pan-x pan-y',
        WebkitTextSizeAdjust: '100%',
      },
      '.cm-content': {
        fontSize: basePx,
        WebkitTextSizeAdjust: '100%',
      },
    });
  }, [visualFontSize]);

  return { safariNoZoomFontExtension };
}
