import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { counterGraceService, type GraceArm } from "./counterGraceService";
import { sqliteStorage, getMockDatabase } from "../db/sqliteStorage";
import { resetMockHandlers } from "../ipc/ipcBridge";

/**
 * CNT-011: an active counter keeps working for the grace its owner set, and
 * stops when that window closes. The server cannot reach a machine that is dark,
 * so it hands the till an absolute deadline measured on the server's own clock;
 * the till converts it into hours counted on its own and closes from there.
 */

const HOUR = 60 * 60 * 1000;

/** What the server answers when it shakes hands: a window and the clock it read. */
function windowOf(graceHours: number, opts: { tillBehindMs?: number; from?: number } = {}): GraceArm {
  // The till's clock is `tillBehindMs` behind the server's, so the server's
  // timestamps all sit that much ahead of this machine's own reading.
  const serverNow = Date.now() + (opts.tillBehindMs ?? 0);
  const watermark = opts.from ?? serverNow;

  return {
    server_time: new Date(serverNow).toISOString(),
    offline: {
      grace_hours: graceHours,
      last_seen_at: new Date(watermark).toISOString(),
      grace_until: new Date(watermark + graceHours * HOUR).toISOString(),
    },
  };
}

describe("Counter offline grace clock (CNT-011)", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T06:00:00Z"));

    resetMockHandlers();
    sqliteStorage.registerMockIpcHandlers();
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    await counterGraceService.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("arms the window the server answered with", async () => {
    await counterGraceService.arm("cntr_7", windowOf(6));

    const state = counterGraceService.state("cntr_7");
    expect(state.allowed).toBe(true);
    expect(state.reason).toBe("within_grace");
    expect(state.grace_hours).toBe(6);
    expect(state.remaining_ms).toBe(HOUR * 6);
  });

  it("counts the hours the owner granted, not the hours on the till's clock", async () => {
    // A workstation whose clock runs five hours behind the store server's still
    // gets six granted hours — not eleven it invented from a clock that lies.
    await counterGraceService.arm("cntr_8a", windowOf(6, { tillBehindMs: 5 * HOUR }));
    expect(counterGraceService.state("cntr_8a").remaining_ms).toBe(6 * HOUR);

    // The other direction must not shorten the window either.
    await counterGraceService.arm("cntr_8b", windowOf(6, { tillBehindMs: -5 * HOUR }));
    expect(counterGraceService.state("cntr_8b").remaining_ms).toBe(6 * HOUR);
  });

  it("closes the window when the hours run out", async () => {
    await counterGraceService.arm("cntr_9", windowOf(2));

    vi.advanceTimersByTime(90 * 60 * 1000);
    expect(counterGraceService.state("cntr_9").allowed).toBe(true);
    expect(counterGraceService.state("cntr_9").remaining_ms).toBe(30 * 60 * 1000);

    vi.advanceTimersByTime(45 * 60 * 1000);
    const closed = counterGraceService.state("cntr_9");
    expect(closed.allowed).toBe(false);
    expect(closed.reason).toBe("grace_expired");
    expect(closed.remaining_ms).toBe(0);
  });

  it("refuses the window the owner never granted", async () => {
    await counterGraceService.arm("cntr_10", windowOf(0));

    const state = counterGraceService.state("cntr_10");
    expect(state.grace_hours).toBe(0);
    expect(state.allowed).toBe(false);
    expect(state.reason).toBe("grace_expired");
  });

  it("keeps a till the server never measured working", () => {
    const state = counterGraceService.state("cntr_never_armed");

    expect(state.allowed).toBe(true);
    expect(state.reason).toBe("unmeasured");
    expect(state.deadline_ms).toBeNull();
  });

  it("refuses billing once the window is spent", async () => {
    await counterGraceService.arm("cntr_1", windowOf(2));
    counterGraceService.use("cntr_1");

    expect(() => counterGraceService.assertWorkAllowed()).not.toThrow();

    vi.advanceTimersByTime(3 * HOUR);

    expect(() => counterGraceService.assertWorkAllowed()).toThrow(/offline longer than the store allows/i);

    try {
      counterGraceService.assertWorkAllowed();
    } catch (err) {
      expect((err as { code?: string }).code).toBe("counter_grace_expired");
    }
  });

  it("remembers the deadline across a restart", async () => {
    await counterGraceService.arm("cntr_2", windowOf(4));
    counterGraceService.unload();

    expect(counterGraceService.state("cntr_2").reason).toBe("unmeasured");

    await counterGraceService.hydrate("cntr_2");
    const state = counterGraceService.state("cntr_2");
    expect(state.allowed).toBe(true);
    expect(state.grace_hours).toBe(4);
    expect(state.deadline_ms).toBe(Date.now() + 4 * HOUR);

    // The window keeps closing while the till was shut, from the same deadline.
    vi.advanceTimersByTime(5 * HOUR);
    await counterGraceService.hydrate("cntr_2");
    expect(counterGraceService.state("cntr_2").allowed).toBe(false);
  });

  it("keeps one counter's window off another counter's till", async () => {
    await counterGraceService.arm("cntr_3", windowOf(24));
    await counterGraceService.arm("cntr_4", windowOf(0));

    expect(counterGraceService.state("cntr_3").allowed).toBe(true);
    expect(counterGraceService.state("cntr_4").allowed).toBe(false);

    // The rows are per counter, so a store switch cannot read the peer's clock.
    const rows = await sqliteStorage.findAll<{ counter_key: string }>("counter_grace");
    expect(rows.map((r) => r.counter_key).sort()).toEqual(["cntr_3", "cntr_4"]);
  });

  it("is wiped with the claim it belonged to", async () => {
    await counterGraceService.arm("cntr_5", windowOf(8));
    counterGraceService.use("cntr_5");
    expect(counterGraceService.activeCounterKey()).toBe("cntr_5");

    await counterGraceService.clear();

    expect(counterGraceService.activeCounterKey()).toBeNull();
    expect(counterGraceService.state("cntr_5").reason).toBe("unmeasured");
    expect(await sqliteStorage.findAll("counter_grace")).toEqual([]);
  });

  it("ignores an answer that carries no clock", async () => {
    await counterGraceService.arm("cntr_6", { offline: null });
    expect(counterGraceService.state("cntr_6").reason).toBe("unmeasured");

    await counterGraceService.arm("cntr_6", { offline: { grace_hours: 3 } });
    expect(counterGraceService.state("cntr_6").reason).toBe("unmeasured");

    expect(await sqliteStorage.findAll("counter_grace")).toEqual([]);
  });
});
