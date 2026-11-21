import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App from "../src/App.tsx";
import { RouteWorkAction } from "../src/components/RouteWorkAction.tsx";
import { DayTripRoutes } from "../src/components/RegionPanel.tsx";
import { advance, command, createGame, getRouteWorkSummary, RIVER_PATH_RULE, serialize } from "../src/game/engine.ts";
import { assignSelection } from "../src/game/selection.ts";
import type { Command, GameState } from "../src/game/types.ts";

function apply(game: GameState, instruction: Command): GameState {
  const result = command(game, instruction);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function fieldReady(): GameState {
  let game = createGame(561);
  for (const residentId of ["mio", "ren"])
    game = apply(game, { type: "policy", residentId, policy: "rest" });
  game = apply(game, { type: "transfer", residentId: "aki", from: "base", to: "aki", resource: "scrap", amount: 2 });
  game = apply(game, { type: "assign", residentIds: ["aki"], kind: "move", target: "meadow" });
  game = advance(game, game.residents[0].action!.duration);
  assert.equal(game.residents[0].location, "meadow");
  assert.equal(game.residents[0].action, null);
  return game;
}
const visible = (html: string) => html.replace(/<!--.*?-->/gs, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
function localAction(game: GameState, selectedIds = ["aki"]) {
  const before = serialize(game);
  const html = renderToStaticMarkup(createElement(RouteWorkAction, {
    game, selectedIds, onCommand: () => assert.fail("Rendering must not place an order"),
  }));
  assert.equal(serialize(game), before, "A view must not reserve goods, ids, or time");
  return html;
}
function routes(game: GameState, selectedIds = ["aki"]) {
  const before = serialize(game);
  const html = renderToStaticMarkup(createElement(DayTripRoutes, {
    game, selectedIds, onCommand: () => assert.fail("Rendering must not place an order"),
  }));
  assert.equal(serialize(game), before);
  return html;
}
function renderHome(game: GameState) {
  const before = serialize(game);
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => key === "yohaku-autosave-v1" ? before : null,
    setItem: () => assert.fail("Rendering must not autosave"),
  } });
  try {
    const html = renderToStaticMarkup(createElement(App));
    assert.equal(serialize(game), before);
    return html;
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}
function actionButton(html: string) {
  const found = html.match(/<button[^>]*data-route-work-action[^>]*>/);
  assert.ok(found, "There is exactly one local work entry");
  assert.equal((html.match(/data-route-work-action/g) ?? []).length, 1);
  return found[0];
}
function routeBlocks(html: string) {
  return html.match(/<div class="route-choice">[\s\S]*?<\/div>/g) ?? [];
}

test("The one local work entry previews the actual actor duration, own cost and limited edge benefit without writing state", () => {
  const game = fieldReady();
  game.residents[0].wounds.arm = 2;
  const html = localAction(game);
  assert.doesNotMatch(actionButton(html), /disabled/);
  assert.match(visible(html), /60分 · アキ · 本人の資材 2個を予約/);
  assert.match(visible(html), /任意/);
  assert.match(visible(html), /完了後の区間基準14分（現在18分）/);
  assert.doesNotMatch(html, /<select|<input|手仕事台/);
  const home = renderHome(game);
  assert.equal((home.match(/data-route-work-action/g) ?? []).length, 1);
  assert.doesNotMatch(renderHome(createGame()), /data-route-work-action/);
  const gathering = apply(fieldReady(), { type: "assign", residentIds: ["aki"], kind: "gather" });
  const current = structuredClone(gathering.residents[0].action!);
  assert.ok(visible(localAction(gathering)).includes(`「${current.label}」は中断して保持`));
  assert.deepEqual(gathering.residents[0].action, current);
  assert.equal(gathering.residents[0].suspended, null);
});

test("Zero, multiple, stale and remote selections cannot substitute the displayed resident or someone else's materials", () => {
  const game = fieldReady();
  for (const selectedIds of [[], ["aki", "mio"], ["missing"], ["mio"]]) {
    const preview = assignSelection(game, selectedIds, "repair-route", RIVER_PATH_RULE.id);
    assert.ok(preview.error);
    const html = localAction(game, selectedIds);
    assert.match(actionButton(html), /disabled/);
    assert.ok(visible(html).includes(preview.error!));
    assert.doesNotMatch(visible(html), /\d+分 · アキ/);
  }
  // Controlled material boundary: the owner lacks input while a neighbour and
  // the base still own plenty. The UI must follow the engine's own-pack rule.
  game.inventory!.packs.aki.scrap = 0;
  game.residents[1].location = "meadow";
  game.inventory!.packs.mio.scrap = 5;
  const preview = assignSelection(game, ["aki"], "repair-route", RIVER_PATH_RULE.id);
  assert.ok(preview.error);
  const html = localAction(game);
  assert.match(actionButton(html), /disabled/);
  assert.ok(visible(html).includes(preview.error!));
});

test("Running and held road work use the existing progress and independent resume/cancel controls", () => {
  let game = apply(fieldReady(), { type: "assign", residentIds: ["aki"], kind: "repair-route", target: RIVER_PATH_RULE.id });
  game = advance(game, 5);
  const job = structuredClone(game.residents[0].action!);
  assert.match(actionButton(localAction(game)), /disabled/);
  let html = renderHome(game);
  assert.match(visible(html), /アキ：川沿いの道を整える/);
  assert.match(visible(html), /5 \/ 40分/);
  assert.match(visible(html), /材料予約：資材 2/);
  game = apply(game, { type: "pause", residentId: "aki" });
  assert.match(visible(localAction(game)), /アキが整備を中断中/);
  html = renderHome(game);
  assert.match(visible(html), /川沿いの道を整える（中断中）/);
  assert.match(visible(html), /残り35分/);
  assert.match(html, />再開する<\/button>/);
  assert.equal(game.residents[0].suspended!.id, job.id);
  game.residents[0].location = "village";
  html = renderHome(game);
  assert.match(visible(html), /中断した場所へ戻ってから再開してください/);
  assert.doesNotMatch(html, /data-route-work-action/);
});

test("Road conditions follow the actual preview edge including the village return origin, not a route label", () => {
  let game = fieldReady();
  const outward = routes(game);
  const outwardRiver = routeBlocks(outward).find(block => visible(block).includes("川沿いの道で集落へ"));
  assert.ok(outwardRiver);
  assert.match(outwardRiver, /data-route-work-status/);
  assert.match(visible(outwardRiver), /区間の基準18分/);
  // A detour that explicitly first goes meadow→village also uses the edge,
  // but must not promise a shortcut from this starting point.
  const outwardDetour = routeBlocks(outward).find(block => visible(block).includes("資材置き場を通る道で拠点へ帰る"));
  assert.ok(outwardDetour);
  assert.doesNotMatch(visible(outwardDetour), /資材置き場を通る近道/);
  assert.match(outwardDetour, /data-route-work-status/);
  game = apply(game, { type: "assign", residentIds: ["aki"], kind: "move", target: "village", via: ["road", "meadow"] });
  game = advance(game, game.residents[0].action!.duration);
  assert.equal(game.residents[0].location, "village");
  const returning = routes(game);
  const homeRiver = routeBlocks(returning).find(block => visible(block).includes("川沿いの道で拠点へ帰る"));
  const short = routeBlocks(returning).find(block => visible(block).includes("資材置き場を通る近道"));
  assert.ok(homeRiver && short);
  assert.match(homeRiver, /data-route-work-status/);
  assert.doesNotMatch(short, /data-route-work-status/);
  for (const selection of [[], ["missing"], ["aki", "mio"]])
    assert.doesNotMatch(routes(game, selection), /data-route-work-status/);
});

test("Completed work replaces only its local entry and reports the permanent edge without reoffering a job", () => {
  let game = apply(fieldReady(), { type: "assign", residentIds: ["aki"], kind: "repair-route", target: RIVER_PATH_RULE.id });
  game = advance(game, game.residents[0].action!.duration);
  assert.ok(game.routeWorks?.riverPath);
  const html = localAction(game, []);
  assert.match(html, /data-route-work-complete/);
  assert.match(visible(html), /川辺–集落の道は整備済み/);
  assert.match(visible(html), /この区間の基準 18分 → 14分/);
  assert.doesNotMatch(html, /<button|<select|<input/);
  assert.match(visible(routes(game)), /整備済み（区間の基準14分）/);
});


test("A blocked road job reports the shared safety reason instead of silently appearing to progress", () => {
  let game = apply(fieldReady(), { type: "assign", residentIds: ["aki"], kind: "observe" });
  game = apply(game, { type: "assign", residentIds: ["aki"], kind: "repair-route", target: RIVER_PATH_RULE.id });
  // Controlled safety boundary, not a claim that the normal guard patrols here.
  game.enemy.location = "meadow";
  const reason = getRouteWorkSummary(game).working?.blockedReason;
  assert.ok(reason);
  const html = localAction(game);
  assert.match(actionButton(html), /disabled/);
  assert.ok(visible(html).includes(`待機中：${reason}`));
  // A separate traveller has a real route preview; the worker with both task
  // slots occupied cannot preview a third instruction just to show a status.
  game.residents[1].location = "village";
  assert.ok(visible(routes(game, ["mio"])).includes(`整備は待機中。${reason}`));
});
