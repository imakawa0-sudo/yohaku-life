import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RegionPanel } from "../src/components/RegionPanel.tsx";
import { TradeHistory } from "../src/components/TradeHistory.tsx";
import { TravelPanel } from "../src/components/TravelPanel.tsx";
import { advance, command, createGame, getVillageCash, getWalletCoins, serialize } from "../src/game/engine.ts";
import { inspectRegionInteraction } from "../src/game/region.ts";
import type { Command, GameState } from "../src/game/types.ts";

const visible = (html: string) => html.replace(/<!--.*?-->/gs, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
function apply(game: GameState, cmd: Command): GameState {
  const result = command(game, cmd);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function village(): GameState {
  let game = createGame(745);
  for (const id of ["mio", "ren"]) game = apply(game, { type: "policy", residentId: id, policy: "rest" });
  game = apply(game, { type: "transfer", residentId: "aki", from: "base", to: "aki", resource: "scrap", amount: 3 });
  game = apply(game, { type: "assign", residentIds: ["aki"], kind: "move", target: "village", via: ["road", "meadow"] });
  game = advance(game, game.residents[0].action!.duration);
  assert.equal(game.residents[0].location, "village");
  return game;
}
function sell(game: GameState): GameState {
  return apply(game, { type: "region", residentId: "aki", npcId: "village-trader", choice: "sell-scrap" });
}
function region(game: GameState, selectedIds = ["aki"], focusedId = "aki"): string {
  const before = serialize(game);
  const html = renderToStaticMarkup(createElement(RegionPanel, {
    game, selectedIds, focusedId, onCommand: () => assert.fail("Rendering must not issue an instruction"),
  }));
  assert.equal(serialize(game), before);
  return html;
}
function travel(game: GameState, selectedIds = ["aki"], focusedId = "aki"): string {
  const before = serialize(game);
  const html = renderToStaticMarkup(createElement(TravelPanel, {
    game, selectedIds, focusedId, onCommand: () => assert.fail("Rendering must not issue an instruction"),
  }));
  assert.equal(serialize(game), before);
  return html;
}
function currency(html: string): string {
  const block = html.match(/<details class="region-currency"[\s\S]*?<\/details>/);
  assert.ok(block);
  return block[0];
}
function choice(html: string, name: "sell-scrap" | "buy-food" | "buy-medicine"): string {
  const block = html.match(new RegExp(`<div class="region-choice region-coin-choice" data-coin-choice="${name}">[\\s\\S]*?<\\/div>`));
  assert.ok(block);
  return block[0];
}

test("The optional cash section uses actual quotes and preserves the existing barter entry order", () => {
  const game = village();
  const html = region(game);
  const block = currency(html);
  assert.doesNotMatch(block.match(/<details[^>]*>/)![0], /\sopen(?:\s|=|>)/);
  assert.ok(html.indexOf("資材1を手当用品1と交換") < html.indexOf("region-currency"));
  assert.ok(html.indexOf("region-currency") < html.indexOf("道を知る住民"));
  assert.match(visible(block), /アキの所持銀貨 0枚/);
  assert.match(visible(block), /店の買取資金 6枚/);
  assert.match(visible(block), /店の在庫：食事6食 · 手当用品3個/);
  const preview = inspectRegionInteraction(game, "aki", "village-trader", "sell-scrap");
  assert.ok(visible(choice(block, "sell-scrap")).includes(preview.title));
  assert.match(visible(choice(block, "sell-scrap")), new RegExp(`売買後の所持銀貨：${preview.walletAfter}枚`));
  assert.doesNotMatch(choice(block, "sell-scrap").match(/<button[^>]*>/)![0], /disabled/);
  assert.match(choice(block, "buy-food").match(/<button[^>]*>/)![0], /disabled/);
  assert.match(visible(choice(block, "buy-food")), /本人の所持銀貨が足りません/);
  assert.doesNotMatch(visible(block), /undefined|NaN|所持銀貨：-\d/);
});

test("Empty, multiple and stale selections disable every region action without a hidden wallet owner", () => {
  const game = sell(village());
  for (const ids of [[], ["aki", "mio"], ["missing"]]) {
    const html = region(game, ids);
    const buttons = Array.from(html.matchAll(/<button[^>]*>/g), match => match[0]);
    assert.ok(buttons.length >= 6);
    for (const button of buttons) assert.match(button, /disabled/);
    const block = currency(html);
    assert.match(visible(block), /所持銀貨は、売買する住民を一人選ぶと表示/);
    assert.doesNotMatch(visible(block), /アキの所持銀貨|売買後の所持銀貨/);
    assert.match(html, /data-trade-history="village"/);
    assert.match(visible(html), /交換の記録（1件）/);
  }
});

test("A different selected resident uses their own balance and current location, independently of focus", () => {
  const game = sell(village());
  assert.equal(getWalletCoins(game, "aki"), 2);
  assert.equal(getWalletCoins(game, "mio"), 0);
  const block = currency(region(game, ["mio"], "aki"));
  assert.match(visible(block), /ミオの所持銀貨 0枚/);
  assert.doesNotMatch(visible(block), /アキの所持銀貨/);
  for (const name of ["sell-scrap", "buy-food", "buy-medicine"] as const) {
    assert.match(choice(block, name).match(/<button[^>]*>/)![0], /disabled/);
    assert.match(visible(choice(block, name)), /ミオを近隣の集落へ移動/);
  }
});

test("The carried wallet shows small coin weight without adding currency to transfer or cargo resources", () => {
  const initial = village();
  assert.doesNotMatch(travel(initial), /class="pack-coins"/);
  const game = sell(initial);
  const html = travel(game);
  assert.match(html, /class="pack-coins" aria-label="アキの所持銀貨"/);
  assert.match(visible(html), /銀貨 2枚\s*（0\.02kg）/);
  const resourceOptions = html.match(/<select[^>]*>[\s\S]*?<\/select>/)![0];
  assert.equal((resourceOptions.match(/<option/g) ?? []).length, 4);
  assert.doesNotMatch(resourceOptions, /銀貨/);
  assert.doesNotMatch(travel(game, ["mio"], "aki"), /class="pack-coins"/);
});

test("Coin history renders saved amounts on both sides and stays out of merchant-only history", () => {
  let game = sell(village());
  game = apply(game, { type: "region", residentId: "aki", npcId: "village-trader", choice: "buy-medicine" });
  const before = serialize(game);
  for (const scope of ["all", "village"] as const) {
    const html = renderToStaticMarkup(createElement(TradeHistory, { game, scope }));
    assert.match(visible(html), /交換の記録（2件）/);
    assert.match(visible(html), /支払：資材1 → 受取：銀貨2枚/);
    assert.match(visible(html), /支払：銀貨2枚 → 受取：手当用品1/);
    assert.doesNotMatch(visible(html), /銀貨0枚|undefined|NaN|logId|village-coins-v1/);
  }
  const merchant = renderToStaticMarkup(createElement(TradeHistory, { game, scope: "merchant" }));
  assert.match(visible(merchant), /交換の記録（0件）/);
  assert.doesNotMatch(visible(merchant), /銀貨/);
  assert.equal(serialize(game), before);
});

test("Cash and shared goods reflect completed sales and purchases rather than independent UI budgets", () => {
  let game = village();
  for (let i = 0; i < 3; i++) game = sell(game);
  let block = currency(region(game));
  assert.match(visible(block), /アキの所持銀貨 6枚/);
  assert.match(visible(block), /店の買取資金 0枚/);
  assert.match(visible(choice(block, "sell-scrap")), /店の買取資金が足りません/);
  game = apply(game, { type: "region", residentId: "aki", npcId: "village-trader", choice: "buy-food" });
  assert.equal(getVillageCash(game), 4);
  block = currency(region(game));
  assert.match(visible(block), /アキの所持銀貨 2枚/);
  assert.match(visible(block), /店の買取資金 4枚/);
  assert.match(visible(block), /店の在庫：食事3食 · 手当用品3個/);
  assert.doesNotMatch(choice(block, "buy-medicine").match(/<button[^>]*>/)![0], /disabled/);
});
