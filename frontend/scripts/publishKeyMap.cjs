#!/usr/bin/env node
/**
 * Regenerate specs/keyboard-shortcuts.json from the runtime key map.
 *
 * The published file is the contract QA and the docs quote; publishedKeyMap.test.ts fails when it
 * drifts from centralKeyMap.ts, so the only safe way to keep them equal is to generate one from the
 * other. Run `node scripts/publishKeyMap.cjs` from frontend/ after editing centralKeyMap.ts.
 */
const { build } = require("esbuild");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");

const MAP = join(__dirname, "..", "src", "lib", "keyboard", "centralKeyMap.ts");
const OUT = join(__dirname, "..", "..", "specs", "keyboard-shortcuts.json");

const SCOPE_PRIORITY = ["modal", "preview", "edit", "pos", "bills", "purchase", "salesReturns", "stock", "login", "global"];

async function main() {
  const out = await build({
    entryPoints: [MAP],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    target: "node18",
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(
    mod,
    mod.exports,
    require
  );

  const { centralKeyMap, findConflicts, findScopeOverrides } = mod.exports;
  const advertised = centralKeyMap.filter((s) => !s.hidden).length;

  const doc = {
    name: "LamSuite Billing keyboard shortcuts",
    version: require(join(__dirname, "..", "package.json")).version,
    updated: new Date().toISOString().slice(0, 10),
    rule:
      "A screen scope always wins over the global scope. Two bindings in the same scope are a conflict and fail CI.",
    scopePriority: SCOPE_PRIORITY,
    counts: {
      total: centralKeyMap.length,
      advertised,
      conflicts: findConflicts().length,
    },
    shortcuts: centralKeyMap.map((s) => ({
      action: s.action,
      label: s.label,
      scope: s.scope,
      group: s.group,
      keys: s.keys,
      hidden: Boolean(s.hidden),
    })),
    conflicts: findConflicts().map((bucket) =>
      bucket.map((s) => ({ action: s.action, scope: s.scope, keys: s.keys }))
    ),
    overrides: findScopeOverrides().map((o) => ({
      chord: o.chord,
      global: o.global.action,
      screen: o.screen.action,
      screenScope: o.screen.scope,
    })),
  };

  writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(
    `Wrote ${OUT} — ${doc.counts.total} bindings (${doc.counts.advertised} advertised), ` +
      `${doc.counts.conflicts} conflicts, ${doc.overrides.length} screen overrides.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
