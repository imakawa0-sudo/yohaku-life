import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App from "../src/App.tsx";
import { GuardAgreementAction } from "../src/components/GuardAgreementAction.tsx";
import { Landscape, describeLandscape } from "../src/components/Landscape.tsx";
import { DayTripRoutes } from "../src/components/RegionPanel.tsx";
import { advance, command, createGame, inspectGuardAgreement, serialize } from "../src/game/engine.ts";
import type { Command, GameState } from "../src/game/types.ts";

function apply(game: GameState, instruction: Command): GameState {
  const result = command(game, instruction);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function fieldReady(held?: "eat" | "move"): GameState {
  let game = createGame(562);
  for (const residentId of ["mio", "ren"])
    game = apply(game, { type: "policy", residentId, policy: "rest" });
  game = apply(game, { type: "transfer", residentId: "aki", from: "base", to: "aki", resource: "food", amount: 3 });
  if (held) {
    game = apply(game, { type: "assign", residentIds: ["aki"], kind: held,
      ...(held === "move" ? { target: "village" } : {}) });
    if (held === "move") game = advance(game, 5);
    game = apply(game, { type: "pause", residentId: "aki" });
  }
  game = apply(game, { type: "assign", residentIds: ["aki"], kind: "move", target: "ruins" });
  game = advance(game, game.residents[0].action!.duration);
  assert.equal(game.residents[0].location, "ruins");
  assert.equal(game.residents[0].action, null);
  assert.equal(game.enemy.hp, 80, "Arrival itself does not trade blows");
  return game;
}
const visible = (html: string) => html.replace(/<!--.*?-->/gs, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
function localAction(game: GameState, selectedIds = ["aki"]) {
  const before = serialize(game);
  const html = renderToStaticMarkup(createElement(GuardAgreementAction, {
    game, selectedIds, onCommand: () => assert.fail("Rendering must not make an agreement"),
  }));
  assert.equal(serialize(game), before, "A preview must not pay, cancel jobs, issue IDs, or advance time");
  return html;
}
function actionButton(html: string) {
  const buttons = html.match(/<button[^>]*data-guard-agreement-action[^>]*>/g) ?? [];
  assert.equal(buttons.length, 1, "There is one local entry, without a second actor selector");
  return buttons[0];
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
function picture(game: GameState) {
  const before = serialize(game);
  const html = renderToStaticMarkup(createElement(Landscape, { game, resident: game.residents[0] }));
  assert.equal(serialize(game), before);
  return html;
}
function routes(game: GameState, selectedIds = ["aki"]) {
  const before = serialize(game);
  const html = renderToStaticMarkup(createElement(DayTripRoutes, {
    game, selectedIds, onCommand: () => assert.fail("Reading a route must not issue a trip"),
  }));
  assert.equal(serialize(game), before);
  return html;
}

test("The local agreement shows the actual single payer, own food, clock zero, departure and separate collection", () => {
  const game = fieldReady();
  const html = localAction(game);
  assert.doesNotMatch(actionButton(html), /disabled/);
  assert.match(visible(html), /食事3を渡して立ち去ってもらう/);
  assert.match(visible(html), /アキ · 本人の未予約の食事 3 · 時間は進みません/);
  assert.match(visible(html), /守り手が置き場を譲り、立ち去ります/);
  assert.match(visible(html), /回収は別に20分/);
  assert.doesNotMatch(html, /<select|<input|<a\b/);
  assert.equal((renderHome(game).match(/data-guard-agreement-action/g) ?? []).length, 1);
  assert.doesNotMatch(renderHome(createGame()), /data-guard-agreement-action/);
});

test("Zero, multiple, duplicate, stale and remote selections cannot use the displayed person's agreement", () => {
  const game = fieldReady();
  for (const selectedIds of [[], ["aki", "mio"], ["aki", "aki"], ["missing"], ["mio"]]) {
    const preview = inspectGuardAgreement(game, selectedIds);
    assert.ok(preview.error);
    const html = localAction(game, selectedIds);
    assert.match(actionButton(html), /disabled/);
    assert.ok(visible(html).includes(preview.error!));
    if (selectedIds.length !== 1 || selectedIds[0] !== "aki")
      assert.doesNotMatch(visible(html), /アキ · 本人の未予約/);
  }
});

test("A reserved meal and food belonging to others cannot silently fund the agreement", () => {
  const game = fieldReady("eat");
  const meal = structuredClone(game.residents[0].suspended!);
  assert.equal(meal.reservationSource, "pack");
  assert.equal(meal.reserved?.food, 1);
  // Controlled stock boundary: a neighbour owns plenty, but the payer's third
  // meal is already reserved. The UI must not silently release or share it.
  game.residents[1].location = "ruins";
  game.inventory!.packs.mio.food = 6;
  const preview = inspectGuardAgreement(game, ["aki"]);
  assert.equal(preview.freeFood, 2);
  assert.ok(preview.error);
  const html = localAction(game);
  assert.match(actionButton(html), /disabled/);
  assert.match(visible(html), /本人の未予約の携行食が3食必要/);
  assert.deepEqual(game.residents[0].suspended, meal);
  assert.equal(game.inventory!.packs.aki.food, 3);
});

test("Auto combat never hides the refusal for any resident's current or held manual battle instruction", () => {
  let game = apply(fieldReady(), { type: "assign", residentIds: ["aki"], kind: "attack" });
  game = apply(game, { type: "auto-combat", enabled: true });
  for (const held of [false, true]) {
    if (held) game = apply(game, { type: "pause", residentId: "aki" });
    const html = localAction(game);
    assert.match(actionButton(html), /disabled/);
    assert.match(visible(html), /アキに攻撃・防御の指示が残っています/);
    assert.equal(game.autoCombat, true);
    assert.equal((held ? game.residents[0].suspended : game.residents[0].action)?.kind, "attack");
  }
  let other = fieldReady();
  // Controlled co-location only, then a real explicit defence command.
  other.residents[1].location = "ruins";
  other = apply(other, { type: "assign", residentIds: ["mio"], kind: "defend" });
  const html = localAction(other);
  assert.match(actionButton(html), /disabled/);
  assert.match(visible(html), /ミオに攻撃・防御の指示が残っています/);
});

test("An allowed held journey remains identical through the preview and immediate agreement", () => {
  const game = fieldReady("move");
  const held = structuredClone(game.residents[0].suspended!);
  assert.equal(held.kind, "move");
  assert.equal(held.progress, 5);
  assert.doesNotMatch(actionButton(localAction(game)), /disabled/);
  const agreed = apply(game, { type: "guard-agreement", residentIds: ["aki"] });
  assert.deepEqual(agreed.residents[0].suspended, held);
  assert.equal(agreed.minutes, game.minutes);
  assert.equal(agreed.seed, game.seed);
  assert.equal(agreed.inventory!.packs.aki.food, 0);
  assert.equal(localAction(agreed), "");
});

test("Agreement absence, visible history and untouched supplies differ from a real combat retreat", () => {
  const game = apply(fieldReady(), { type: "guard-agreement", residentIds: ["aki"] });
  assert.equal(game.enemy.defeated, false);
  assert.equal(game.enemy.hp, 80);
  assert.equal(game.flags.suppliesRecovered, false);
  const html = renderHome(game);
  assert.match(html, /data-guard-agreement-status="completed"/);
  assert.match(visible(html), /守り手は食事を受け取り、立ち去りました/);
  assert.match(visible(html), /回収は別に20分/);
  assert.match(visible(html), /置き場を譲り受けた/);
  assert.doesNotMatch(html, /data-guard-agreement-action|<strong>攻撃する<\/strong>|<strong>防御・援護する<\/strong>/);
  assert.doesNotMatch(visible(html), /ruins-guard/);
  assert.match(describeLandscape(game, game.residents[0]).description, /食事を受け取り立ち去った/);
  assert.doesNotMatch(picture(game), /data-detail="guard-present"|data-detail="guard-retreated"/);
  // Controlled legacy combat outcome: this is a distinct absence reason.
  const defeated = fieldReady();
  defeated.enemy.defeated = true;
  defeated.enemy.hp = 18;
  assert.equal(localAction(defeated), "");
  assert.match(picture(defeated), /data-detail="guard-retreated"/);
  assert.match(describeLandscape(defeated, defeated.residents[0]).description, /流れ者は退いた/);
  assert.doesNotMatch(describeLandscape(defeated, defeated.residents[0]).description, /食事を受け取り/);
});

test("World route copy reports agreement only when its real preview uses the old guard site", () => {
  const old = routes(createGame());
  assert.match(visible(old), /守り手のいる場所を通ります。遭遇に注意/);
  assert.doesNotMatch(old, /data-guard-agreement-route-status/);
  let game = apply(fieldReady(), { type: "guard-agreement", residentIds: ["aki"] });
  const origin = routes(game);
  assert.match(origin, /data-guard-agreement-route-status="completed"/);
  game = apply(game, { type: "assign", residentIds: ["aki"], kind: "move", target: "village" });
  game = advance(game, game.residents[0].action!.duration);
  assert.equal(game.residents[0].location, "village");
  const html = routes(game);
  const blocks = html.match(/<div class="route-choice">[\s\S]*?<\/div>/g) ?? [];
  const safe = blocks.find(block => visible(block).includes("川沿いの道で拠点へ帰る"));
  const short = blocks.find(block => visible(block).includes("資材置き場を通る近道で拠点へ帰る"));
  assert.ok(safe && short);
  assert.doesNotMatch(safe, /data-guard-agreement-route-status|守り手は食事/);
  assert.match(short, /data-guard-agreement-route-status="completed"/);
  assert.match(visible(short), /守り手は食事を受け取り立ち去っています/);
  assert.doesNotMatch(visible(html), /遭遇に注意/);
  for (const selectedIds of [[], ["missing"], ["aki", "mio"]])
    assert.doesNotMatch(routes(game, selectedIds), /data-guard-agreement-route-status/);
});
