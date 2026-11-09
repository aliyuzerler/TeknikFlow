import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    // Not: layout tabanlı görünürlük (offsetParent) jsdom'da yoktur;
    // öznitelik tabanlı filtre hem jsdom hem tarayıcıda tutarlıdır.
    (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * ARIA diyalogları için odak tuzağı + odak geri yükleme.
 *
 * - active olduğunda: bir önceki odaklı öğe saklanır, kap içine odak taşınır,
 *   Tab/Shift+Tab döngüsü kap içinde kalır, Escape onEscape çağırır.
 * - active bittiğinde: odak, açan öğeye geri döner (WCAG 2.2 — 2.4.3/2.1.2).
 */
export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onEscape?: () => void,
): void {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;
    const captured: HTMLElement | null = containerRef.current;
    if (!captured) return;
    const container: HTMLElement = captured;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // İlk odak: ilk odaklanabilir öğe (yoksa kabın kendisi).
    const focusables = getFocusable(container);
    (focusables[0] ?? container).focus?.();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onEscapeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = getFocusable(container);
      if (items.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first: HTMLElement = items[0] as HTMLElement;
      const last: HTMLElement = items[items.length - 1] as HTMLElement;
      const current = document.activeElement;

      if (event.shiftKey && (current === first || current === container)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    }

    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      // Odak geri yükleme: öğe hâlâ belgeye bağlıysa.
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [active, containerRef]);
}
