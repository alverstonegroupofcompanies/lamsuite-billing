/**
 * The one gate every global navigation shortcut asks before it leaves a screen.
 *
 * The global shell answers F1..F10 on every screen in the capture phase. A screen that is
 * holding unsaved work registers a guard here while it holds it, so a navigation chord asks
 * the screen first instead of dropping the work on the floor. Every registered guard is asked
 * in registration order; the first refusal stops the navigation and the key is consumed.
 */
export type NavigationGuard = (target: string) => boolean;

const guards: NavigationGuard[] = [];

export function registerNavigationGuard(guard: NavigationGuard): () => void {
  guards.push(guard);
  return () => {
    const index = guards.lastIndexOf(guard);
    if (index !== -1) guards.splice(index, 1);
  };
}

/** Returns false when a screen declines to let the keyboard navigation go ahead. */
export function requestKeyboardNavigation(target: string): boolean {
  for (const guard of [...guards]) {
    if (guard(target) === false) return false;
  }
  return true;
}
