/**
 * Keep the mobile editor viewport at a stable scale while preserving scrolling
 * and ordinary editor shortcuts. Browser/OS accessibility zoom is outside app control.
 */
export function installPageZoomGuard(): () => void {
  const preventGesture = (event: Event) => event.preventDefault();
  const preventPinchWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) event.preventDefault();
  };
  const preventZoomShortcut = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (['+', '=', '-', '_', '0'].includes(event.key)) event.preventDefault();
  };
  let lastTouchEnd = 0;
  const preventDoubleTapZoom = (event: TouchEvent) => {
    if (event.changedTouches.length !== 1) return;
    const target = event.target;
    // Do not swallow editor input, focus or text-selection interactions.
    if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"], .cm-editor')) {
      lastTouchEnd = 0;
      return;
    }
    const now = Date.now();
    if (now - lastTouchEnd < 300) event.preventDefault();
    lastTouchEnd = now;
  };
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, preventGesture, { passive: false });
  }
  document.addEventListener('wheel', preventPinchWheel, { passive: false });
  document.addEventListener('keydown', preventZoomShortcut, { capture: true });
  document.addEventListener('touchend', preventDoubleTapZoom, { passive: false });
  return () => {
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      document.removeEventListener(type, preventGesture);
    }
    document.removeEventListener('wheel', preventPinchWheel);
    document.removeEventListener('keydown', preventZoomShortcut, true);
    document.removeEventListener('touchend', preventDoubleTapZoom);
  };
}
