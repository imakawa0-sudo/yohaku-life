import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CoinTransferHistory } from "../src/components/CoinTransferHistory.tsx";
import { TradeHistory } from "../src/components/TradeHistory.tsx";
import { TravelPanel } from "../src/components/TravelPanel.tsx";
import { advance, command, createGame, getWalletCoins, inspectCoinTransfer, serialize } from "../src/game/engine.ts";
import type { Command, GameState } from "../src/game/types.ts";

const visible = (html: string) => html.replace(/<!--.*?-->/gs, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
function apply(game: GameState, cmd: Command): GameState {
  const result = command(game, cmd);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function home(sellerId = "aki"): GameState {
  let game = createGame(746);
  for (const residentId of ["mio", "ren"]) game = apply(game, { type: "policy", residentId, policy: "rest" });
  game = apply(game, { type: "transfer", residentId: sellerId, from: "base", to: sellerId, resource: "scrap", amount: 1 });
  game = apply(game, { type: "assign", residentIds: [sellerId], kind: "move", target: "village", via: ["road", "meadow"] });
  game = advance(game, game.residents.find(person => person.id === sellerId)!.action!.duration);
  game = apply(game, { type: "region", residentId: sellerId, npcId: "village-trader", choice: "sell-scrap" });
  game = apply(game, { type: "assign", residentIds: [sellerId], kind: "move", target: "home" });
  game = advance(game, game.residents.find(person => person.id === sellerId)!.action!.duration);
  assert.equal(game.residents.find(person => person.id === sellerId)!.location, "home");
  assert.equal(getWalletCoins(game, sellerId), 2);
  return game;
}
function panel(game: GameState, selectedIds = ["aki"], focusedId = "aki"): string {
  const before = serialize(game);
  const html = renderToStaticMarkup(createElement(TravelPanel, {
    game, selectedIds, focusedId, onCommand: () => assert.fail("Rendering must not transfer coins"),
  }));
  assert.equal(serialize(game), before);
  return html;
}
function controls(html: string): string {
  const block = html.match(/<section class="coin-transfer-controls"[\s\S]*?<\/section>/);
  assert.ok(block);
  return block[0];
}
function button(html: string, direction: "give" | "take"): string {
  const found = html.match(new RegExp(`<button[^>]*data-coin-transfer="${direction}"[^>]*>`));
  assert.ok(found);
  return found[0];
}
function handoff(game: GameState, actor: string, from: string, to: string, amount: number): GameState {
  return apply(game, { type: "transfer-coins", residentId: actor, from, to, amount });
}

test("The local coin control previews the real transfer without changing the resource form or current work", () => {
  let game = home();
  game = apply(game, { type: "assign", residentIds: ["aki"], kind: "hobby" });
  game = advance(game, 5);
  const job = structuredClone(game.residents[0].action);
  const html = panel(game);
  const block = controls(html);
  const preview = inspectCoinTransfer(game, "aki", "aki", "mio", 1);
  assert.equal(preview.error, undefined);
  assert.match(visible(block), /アキ 2枚 · ミオ 0枚/);
  assert.match(visible(block), new RegExp(`実行後：アキ ${preview.fromAfter}枚 · ミオ ${preview.toAfter}枚`));
  assert.match(button(block, "give"), /aria-label="銀貨1枚をミオへ渡す"/);
  assert.doesNotMatch(button(block, "give"), /disabled/);
  assert.match(button(block, "take"), /disabled/);
  assert.match(visible(block), /銀貨の枚数/);
  assert.equal((html.match(/>動かす物</g) ?? []).length, 1);
  const resources = html.match(/<select[^>]*>[\s\S]*?<\/select>/)![0];
  assert.equal((resources.match(/<option/g) ?? []).length, 4);
  assert.doesNotMatch(resources, /銀貨/);
  assert.deepEqual(game.residents[0].action, job);
});

test("A selected receiver can take from the peer, while zero, multiple or stale selections cannot act", () => {
  const game = home();
  const block = controls(panel(game, ["mio"], "ren"));
  assert.match(button(block, "take"), /aria-label="アキから銀貨1枚を受け取る"/);
  assert.doesNotMatch(button(block, "take"), /disabled/);
  assert.match(button(block, "give"), /disabled/);
  assert.match(visible(block), /実行後：アキ 1枚 · ミオ 1枚/);
  for (const ids of [[], ["aki", "mio"], ["missing"]]) {
    const invalid = controls(panel(game, ids));
    assert.match(button(invalid, "give"), /disabled/);
    assert.match(button(invalid, "take"), /disabled/);
    assert.match(visible(invalid), /住民一覧で一人だけ選んでください/);
    assert.doesNotMatch(visible(invalid), /実行後/);
  }
});

test("Two empty selected wallets add no form and a richer different peer remains discoverable without auto-selection", () => {
  const fresh = createGame(747);
  assert.doesNotMatch(panel(fresh), /coin-transfer-controls|coin-transfer-history/);
  assert.equal(fresh.currency, undefined);
  const game = home("ren");
  const html = panel(game);
  assert.doesNotMatch(html, /coin-transfer-controls/);
  const peerSelect = html.match(/同じ場所の仲間<select[\s\S]*?<\/select>/)![0];
  assert.match(peerSelect, /value="mio" selected=""/);
  assert.match(peerSelect, /レン（銀貨2枚）/);
  assert.doesNotMatch(peerSelect, /value="ren" selected=""/);
});

test("Transfer history keeps saved place and actual actor after the balance reaches zero and the peer leaves", () => {
  let game = handoff(home(), "mio", "aki", "mio", 2);
  assert.equal(getWalletCoins(game, "aki"), 0);
  game = apply(game, { type: "assign", residentIds: ["mio"], kind: "move", target: "kitchen" });
  game = advance(game, game.residents.find(person => person.id === "mio")!.action!.duration);
  const html = panel(game);
  assert.doesNotMatch(html, /coin-transfer-controls/);
  assert.match(html, /class="coin-transfer-history" aria-label="アキの銀貨の受渡し履歴"/);
  const history = html.match(/<details class="coin-transfer-history"[\s\S]*?<\/details>/)![0];
  assert.doesNotMatch(history.match(/<details[^>]*>/)![0], /\sopen(?:\s|=|>)/);
  assert.match(visible(history), /銀貨の受渡し（1件）/);
  assert.match(visible(history), /共同の居間/);
  assert.match(visible(history), /アキ → ミオ · 銀貨2枚/);
  assert.match(visible(history), /操作：ミオ/);
  assert.doesNotMatch(visible(history), /ありがとう|感謝|「|台所/);
});

test("The separate history shows at most ten involving entries and never changes external trade counts", () => {
  let game = home();
  for (let i = 0; i < 12; i++) game = i % 2 === 0
    ? handoff(game, "aki", "aki", "mio", 1)
    : handoff(game, "mio", "mio", "aki", 1);
  const before = serialize(game);
  const html = renderToStaticMarkup(createElement(CoinTransferHistory, { game, residentId: "aki" }));
  assert.match(visible(html), /銀貨の受渡し（12件）/);
  assert.match(visible(html), /新しい日時の10件/);
  assert.equal((html.match(/<li>/g) ?? []).length, 10);
  assert.equal(renderToStaticMarkup(createElement(CoinTransferHistory, { game, residentId: "ren" })), "");
  const trades = renderToStaticMarkup(createElement(TradeHistory, { game }));
  assert.match(visible(trades), /交換の記録（1件）/);
  assert.doesNotMatch(visible(trades), /銀貨の受渡し/);
  assert.equal(getWalletCoins(game, "aki"), 2);
  assert.equal(serialize(game), before);
});

test("Coin controls follow the shared body guard, allowing held travel and sleeping peers without fake dialogue", () => {
  const homeGame = home();
  const moving = apply(homeGame, { type: "assign", residentIds: ["aki"], kind: "move", target: "road" });
  assert.match(button(controls(panel(moving)), "give"), /disabled/);
  const held = apply(moving, { type: "pause", residentId: "aki" });
  assert.doesNotMatch(button(controls(panel(held)), "give"), /disabled/);
  const asleep = apply(homeGame, { type: "assign", residentIds: ["aki"], kind: "sleep" });
  assert.match(button(controls(panel(asleep)), "give"), /disabled/);
  assert.doesNotMatch(button(controls(panel(asleep, ["mio"])), "take"), /disabled/);
  const received = handoff(asleep, "mio", "aki", "mio", 1);
  const html = renderToStaticMarkup(createElement(CoinTransferHistory, { game: received, residentId: "aki" }));
  assert.match(visible(html), /アキ → ミオ · 銀貨1枚.*操作：ミオ/);
  assert.doesNotMatch(visible(html), /ありがとう|感謝|「/);
});
