import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App from "../src/App";
import { TripPlanPanel, TripSupplyBudget, TravelPlanReminders } from "../src/components/TripPlanPanel";
import { command, createGame, serialize } from "../src/game/engine";
import { ensureInventory } from "../src/game/inventory";
import type { GameState } from "../src/game/types";

function makePlan(game: GameState, residentIds = ["aki", "ren"], purpose = "集落の話を集める", returnAt = 2520) {
  const result = command(game, { type: "plan-trip", residentIds, purpose, returnAt });
  assert.equal(result.error, undefined);
  assert.ok(result.state.travelPlans?.entries.length);
  return result.state;
}

function renderApp(game: GameState) {
  const raw = serialize(game);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let writes = 0;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (key: string) => key === "yohaku-autosave-v1" ? raw : null, setItem: () => { writes++; } },
  });
  try {
    const html = renderToStaticMarkup(createElement(App));
    assert.equal(writes, 0);
    assert.equal(serialize(game), raw);
    return html;
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

test("The collapsed memo uses the shared selection and an absolute next-day deadline without running commands", () => {
  const game = createGame();
  const before = serialize(game);
  let calls = 0;
  const html = renderToStaticMarkup(createElement(TripPlanPanel, {
    game, selectedIds: ["aki", "ren"], onCommand: () => { calls++; return true; },
  }));
  assert.match(html, /<details class="panel trip-plan-panel"/);
  assert.doesNotMatch(html, /<details class="panel trip-plan-panel"[^>]* open=/);
  assert.match(html, /予定の住民：<strong>アキ・レン/);
  assert.match(html, /maxLength="80"/i);
  assert.match(html, /type="number" min="1" step="1"[^>]*value="2"/);
  assert.match(html, /type="time" step="60"[^>]*value="18:00"/);
  assert.match(html, /保存・変更・閉じる操作では時計も仕事も変わりません/);
  assert.doesNotMatch(html, /type="checkbox"|aria-pressed|<select/);
  assert.equal(calls, 0);
  assert.equal(serialize(game), before);
  assert.doesNotMatch(renderApp(game), /<details class="panel trip-plan-panel"/);
});

test("Open memo cards retain their own members and report current locations, jobs and return estimates", () => {
  let game = createGame();
  game.residents[0].location = "village";
  game = makePlan(game);
  const before = serialize(game);
  const html = renderToStaticMarkup(createElement(TripPlanPanel, { game, selectedIds: ["mio"], onCommand: () => true }));
  const card = html.match(/<article class="trip-plan-card[\s\S]*?<\/article>/)?.[0];
  assert.ok(card);
  assert.match(card, /集落の話を集める/);
  assert.match(card, /第2日 18:00 帰還目安/);
  assert.match(card, /アキ<\/strong><span>近隣の集落/);
  assert.match(card, /レン<\/strong>/);
  assert.doesNotMatch(card, /ミオ/);
  assert.match(card, /現在の帰路 約\d+分/);
  assert.match(card, /予定と補給を見る・編集/);
  assert.match(card, /予定を閉じる/);
  assert.match(html, /予定の住民：<strong>ミオ/);
  assert.equal(serialize(game), before);
});

test("Food estimates keep separated deficits visible and do not fund them from remote surplus or a warehouse", () => {
  const game = createGame();
  game.minutes = 1080;
  for (const person of game.residents) { person.hunger = 100; person.action = null; person.suspended = null; }
  game.residents[0].location = "village";
  const inventory = ensureInventory(game);
  inventory.packs.aki.food = 10;
  inventory.packs.ren.food = 0;
  inventory.packs.mio.food = 100;
  game.resources.food = 100;
  const before = serialize(game);
  const html = renderToStaticMarkup(createElement(TripSupplyBudget, { game, residentIds: ["aki", "ren"], returnAt: 2520 }));
  assert.match(html, /帰還時に満腹度35を残す食事の目安（適時食べる想定）/);
  assert.match(html, /必要目安 <strong>2食/);
  assert.match(html, /携行・未予約 <strong>10食/);
  assert.match(html, /不足目安 <strong>1食/);
  assert.match(html, /近隣の集落 · アキ/);
  assert.match(html, /必要 1食 \/ 携行 10食 \/ 不足 0食/);
  assert.match(html, /必要 1食 \/ 携行 0食 \/ 不足 1食/);
  assert.match(html, /別の場所の余りは不足と相殺しません/);
  assert.match(html, /倉庫・未選択の仲間・今後の生産や交換は、補給の確約に含めません/);
  assert.match(html, /到着を保証するものではありません/);
  assert.equal(serialize(game), before);
});

test("Due reminders remain management notes at the base and follow combat/care notices without changing state", () => {
  const game = makePlan(createGame(), ["aki", "ren"], "集落の話を集める", 600);
  game.minutes = 600;
  const before = serialize(game);
  const opens: number[] = [];
  const html = renderToStaticMarkup(createElement(TravelPlanReminders, { game, onOpen: id => opens.push(id) }));
  assert.match(html, /旅の予定を確認する時刻です/);
  assert.match(html, /アキ・レンは現在、拠点内にいます/);
  assert.match(html, /aria-label="集落の話を集めるの予定を確認"/);
  assert.doesNotMatch(html, /帰宅遅れ|帰還完了|旅を終え/);
  assert.deepEqual(opens, []);
  assert.equal(serialize(game), before);
  game.residents.find(person => person.id === "ren")!.location = game.enemy.location;
  const app = renderApp(game);
  assert.ok(app.indexOf('aria-label="対応が必要な出来事"') >= 0);
  assert.ok(app.indexOf('aria-label="対応が必要な出来事"') < app.indexOf('aria-label="帰還目安の予定を確認"'));
  assert.equal((app.match(/aria-label="帰還目安の予定を確認"/g) ?? []).length, 1);
  const closed = command(game, { type: "close-trip", planId: game.travelPlans!.entries[0].id });
  assert.equal(closed.error, undefined);
  assert.equal(renderToStaticMarkup(createElement(TravelPlanReminders, { game: closed.state, onOpen: () => {} })), "");
});
