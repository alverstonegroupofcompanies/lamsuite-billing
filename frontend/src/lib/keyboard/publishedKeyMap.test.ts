import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { centralKeyMap, findConflicts, findScopeOverrides } from "./centralKeyMap";

const published = JSON.parse(
  readFileSync(new URL("../../../../specs/keyboard-shortcuts.json", import.meta.url), "utf-8")
);

describe("published keyboard map", () => {
  it("matches the runtime central key map exactly", () => {
    expect(published.shortcuts).toEqual(
      centralKeyMap.map((s) => ({
        action: s.action,
        label: s.label,
        scope: s.scope,
        group: s.group,
        keys: s.keys,
        hidden: Boolean(s.hidden),
      }))
    );
  });

  it("publishes the current conflict result", () => {
    expect(published.conflicts).toEqual(
      findConflicts().map((bucket) =>
        bucket.map((s) => ({ action: s.action, scope: s.scope, keys: s.keys }))
      )
    );
    expect(published.counts.conflicts).toBe(0);
  });

  it("publishes every intentional screen override of a global chord", () => {
    expect(published.overrides).toEqual(
      findScopeOverrides().map((o) => ({
        chord: o.chord,
        global: o.global.action,
        screen: o.screen.action,
        screenScope: o.screen.scope,
      }))
    );
  });
});
