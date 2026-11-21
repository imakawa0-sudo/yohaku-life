import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App from "../src/App.tsx";
import { TravelPanel } from "../src/components/TravelPanel.tsx";
import { advance, command, createGame, serialize } from "../src/game/engine.ts";
import type { Command, GameState } from "../src/game/types.ts";

function apply(state: GameState, instruction: Command): GameState {
  const result = command(state, instruction);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function outside() {
  let state = createGame(541);
  for (const residentId of ["mio", "ren"])
    state = apply(state, { type: "policy", residentId, policy: "rest" });
  state = apply(state, { type: "transfer", residentId: "aki", from: "base", to: "aki", resource: "food", amount: 3 });
  state = apply(state, { type: "transfer", residentId: "aki", from: "base", to: "aki", resource: "scrap", amount: 2 });
  state = apply(state, { type: "assign", residentIds: ["aki"], kind: "move", target: "shelter" });
  return advance(state, state.residents[0].action!.duration);
}
function panel(state: GameState, selectedIds: string[], focusedId = "aki") {
  const before = serialize(state);
  const html = renderToStaticMarkup(createElement(TravelPanel, {
    game: state, selectedIds, focusedId,
    onCommand: () => { assert.fail("Rendering must not issue instructions"); },
  }));
  assert.equal(serialize(state), before);
  return html;
}
const visibleText = (html: string) => html.replace(/<!--.*?-->/gs, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
function cargoBlock(html: string) {
  const block = html.match(/<div class="travel-transfer cargo-return"[\s\S]*?<\/div>/);
  assert.ok(block, "The one-way cargo control is present in a wild location");
  return block[0];
}
function renderHome(state: GameState) {
  const raw = serialize(state);
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let writes = 0;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (key: string) => key === "yohaku-autosave-v1" ? raw : null, setItem: () => { writes++; } },
  });
  try {
    const html = renderToStaticMarkup(createElement(App));
    assert.equal(writes, 0);
    assert.equal(serialize(state), raw);
    return html;
  } finally {
    if (oldStorage) Object.defineProperty(globalThis, "localStorage", oldStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}
function work(html: string, kind: "running" | "suspended") {
  const found = html.match(new RegExp(`<div class="current-action ${kind}-work">([\\s\\S]*?)<div class="work-controls">([\\s\\S]*?)<\\/div>`));
  assert.ok(found, `${kind} work is visible`);
  return found[0];
}
function startCargo(state: GameState) {
  return apply(state, {
    type: "assign", residentIds: ["aki"], kind: "move", target: "home",
    cargo: { resource: "food", amount: 1 },
  });
}

test("A selected carrier previews real cargo duration with one shared input before the sleep guide", () => {
  const state = outside();
  const preview = command(state, { type: "assign", residentIds: ["aki"], kind: "move", target: "home", cargo: { resource: "food", amount: 1 } });
  assert.equal(preview.error, undefined);
  const planned = preview.state.residents[0].action!;
  assert.deepEqual(planned.cargo, { resource: "food", amount: 1 });
  const html = panel(state, ["aki"], "ren");
  const block = cargoBlock(html);
  assert.doesNotMatch(block.match(/<button[^>]*data-cargo-return[^>]*>/)![0], /disabled/);
  assert.match(visibleText(block), new RegExp(`アキ · 帰路 ${Math.ceil(planned.duration)}分 · 確保する物：食事1`));
  assert.match(visibleText(block), /手持ちの食事1を倉庫へ届ける/);
  assert.match(visibleText(block), /帰着時に指定分を収納して終了/);
  assert.match(visibleText(block), /運搬中の食事や手当には使えません/);
  assert.equal((html.match(/>動かす物</g) ?? []).length, 1);
  assert.equal((html.match(/>個数</g) ?? []).length, 1);
  assert.ok(html.indexOf("travel-inputs") < html.indexOf("travel-sleep-site"));
  assert.ok(html.indexOf("cargo-return") < html.indexOf("travel-sleep-site"));
  assert.match(visibleText(html), /倉庫へしまう/);
  assert.match(visibleText(html), /地面に置く/);
});

test("Zero, multiple or missing selections cannot use the focused person as an implicit carrier", () => {
  const state = outside();
  for (const ids of [[], ["aki", "ren"], ["missing"]]) {
    const block = cargoBlock(panel(state, ids));
    assert.match(block.match(/<button[^>]*data-cargo-return[^>]*>/)![0], /disabled/);
    assert.match(visibleText(block), /一人だけ選んでください/);
    assert.doesNotMatch(visibleText(block), /帰路 \d/);
  }
  // The existing sole selection, not the different landscape focus, owns the pack.
  assert.doesNotMatch(panel(state, ["mio"], "aki"), /data-cargo-return/);
});

test("Active and held cargo show the saved protected goods without consuming them during rendering", () => {
  let state = startCargo(outside());
  const job = structuredClone(state.residents[0].action!);
  assert.equal(state.inventory!.packs.aki.food, 3);
  const active = work(renderHome(state), "running");
  assert.match(visibleText(active), /運搬用に確保：食事 1/);
  assert.match(visibleText(active), /本人の荷物 → 拠点倉庫/);
  assert.doesNotMatch(visibleText(active), /材料予約/);
  state = advance(state, 5);
  state = apply(state, { type: "pause", residentId: "aki" });
  const held = work(renderHome(state), "suspended");
  assert.match(visibleText(held), /中断中/);
  assert.match(visibleText(held), /運搬用に確保：食事 1食/);
  assert.match(visibleText(held), /残り/);
  assert.match(held, /<progress/);
  assert.equal(state.residents[0].suspended!.id, job.id);
  assert.deepEqual(state.residents[0].suspended!.cargo, job.cargo);
  assert.equal(state.inventory!.packs.aki.food, 3);
});

test("Cargo already carried home offers a zero-time handoff instead of saved walking minutes", () => {
  let state = startCargo(outside());
  state = advance(state, 5);
  state = apply(state, { type: "pause", residentId: "aki" });
  state = apply(state, { type: "assign", residentIds: ["aki"], kind: "move", target: "home" });
  state = advance(state, state.residents[0].action!.duration);
  assert.equal(state.residents[0].location, "home");
  assert.ok(state.residents[0].suspended!.cargo);
  const pending = work(renderHome(state), "suspended");
  assert.match(visibleText(pending), /納入待ち/);
  assert.match(visibleText(pending), /倉庫へ納めて終了/);
  assert.match(visibleText(pending), /時計は進みません/);
  assert.doesNotMatch(visibleText(pending), /残り\d*\s*分|残り \d/);
  assert.doesNotMatch(pending, /<progress/);
  const readyButton = pending.match(/<button[^>]*>倉庫へ納めて終了<\/button>/)![0];
  assert.doesNotMatch(readyButton, /disabled/);

  state = apply(state, { type: "assign", residentIds: ["aki"], kind: "hobby" });
  const busy = work(renderHome(state), "suspended");
  assert.match(busy.match(/<button[^>]*>倉庫へ納めて終了<\/button>/)![0], /disabled/);
  const error = command(state, { type: "resume", residentId: "aki" }).error;
  assert.ok(error);
  assert.ok(visibleText(busy).includes(error));
});
