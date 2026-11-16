import {
  centralKeyMap,
  matchesChord,
  type ShortcutAction,
  type ShortcutDefinition,
  type ShortcutScope,
  type KeyEventLike,
} from "./centralKeyMap";

export type ShortcutHandler = (event: KeyboardEvent | KeyEventLike) => boolean | void;

export interface ShortcutScopeRegistration {
  /** Human readable id for debugging, e.g. "pos-main". */
  id: string;
  scope: ShortcutScope;
  /** Higher wins. Screen scopes default above global; overlays above screens. */
  priority?: number;
  /** Optional gate, e.g. pharmacy-only doctor/patient keys. */
  isActive?: () => boolean;
  handlers: Partial<Record<ShortcutAction, ShortcutHandler>>;
}

const DEFAULT_PRIORITY: Record<ShortcutScope, number> = {
  preview: 100,
  modal: 90,
  login: 80,
  edit: 70,
  pos: 60,
  bills: 60,
  purchase: 60,
  stock: 60,
  global: 10,
};

interface Registration extends ShortcutScopeRegistration {
  priority: number;
  order: number;
}

export class ShortcutDispatcher {
  private registrations = new Map<string, Registration>();
  private order = 0;
  private installed = false;
  private listener: ((event: KeyboardEvent) => void) | null = null;

  register(registration: ShortcutScopeRegistration): () => void {
    const entry: Registration = {
      ...registration,
      priority: registration.priority ?? DEFAULT_PRIORITY[registration.scope] ?? 50,
      order: this.order++,
    };
    this.registrations.set(registration.id, entry);
    return () => {
      this.registrations.delete(registration.id);
    };
  }

  getRegistrations(): ReadonlyArray<ShortcutScopeRegistration> {
    return Array.from(this.registrations.values()).sort(
      (a, b) => b.priority - a.priority || a.order - b.order
    );
  }

  private *matches(event: KeyEventLike): Generator<{ registration: ShortcutScopeRegistration; definition: ShortcutDefinition }> {
    for (const registration of this.getRegistrations()) {
      if (registration.isActive && !registration.isActive()) continue;
      const definitions = centralKeyMap.filter((d) => d.scope === registration.scope);
      for (const definition of definitions) {
        if (!registration.handlers[definition.action]) continue;
        if (definition.keys.some((chord) => matchesChord(event, chord))) {
          yield { registration, definition };
        }
      }
    }
  }

  /**
   * Resolve the first active registration that advertises this event.
   * Returns null when nothing claims the key.
   */
  resolve(event: KeyEventLike): { registration: ShortcutScopeRegistration; definition: ShortcutDefinition } | null {
    for (const match of this.matches(event)) return match;
    return null;
  }

  /** Dispatch a (possibly synthetic) key event. Returns true when claimed. */
  dispatch(event: KeyEventLike & Partial<Pick<KeyboardEvent, "preventDefault" | "stopPropagation" | "stopImmediatePropagation" | "defaultPrevented" | "isComposing">>): boolean {
    if (event.defaultPrevented || event.isComposing) return false;

    // A handler that returns false declines the key, so lower-priority
    // registrations get a chance instead of the key being swallowed.
    for (const match of this.matches(event)) {
      const handler = match.registration.handlers[match.definition.action];
      if (!handler) continue;

      let handled = true;
      try {
        handled = handler(event as KeyboardEvent) !== false;
      } catch (error) {
        console.error(`[shortcuts] ${match.definition.action} failed`, error);
        handled = false;
      }
      if (!handled) continue;

      event.preventDefault?.();
      event.stopPropagation?.();
      event.stopImmediatePropagation?.();
      return true;
    }
    return false;
  }

  /** Install one capture-phase listener. Idempotent. */
  install(): () => void {
    if (this.installed || typeof window === "undefined") return () => {};
    this.installed = true;
    this.listener = (event: KeyboardEvent) => {
      this.dispatch(event);
    };
    window.addEventListener("keydown", this.listener, true);
    return () => this.uninstall();
  }

  uninstall(): void {
    if (this.listener && typeof window !== "undefined") {
      window.removeEventListener("keydown", this.listener, true);
    }
    this.listener = null;
    this.installed = false;
  }
}

export const shortcutDispatcher = new ShortcutDispatcher();
