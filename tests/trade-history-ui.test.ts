import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TradeHistory } from "../src/components/TradeHistory.tsx";
import { createGame } from "../src/game/engine.ts";
import type { GameState } from "../src/game/types.ts";

function freeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}
function render(game: GameState, scope?: "all" | "merchant" | "village"): string {
  const before = structuredClone(game);
  freeze(game);
  const html = renderToStaticMarkup(createElement(TradeHistory, { game, scope }));
  assert.deepEqual(game, before, "History must not initialize extensions, sort saved arrays or change the world");
  return html;
}
const text = (html: string) => html.replace(/<!--.*?-->/gs, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
function withHistory(): GameState {
  const game = createGame(644);
  // Controlled rendering input: snapshots deliberately differ from today's offers.
  // This test does not claim that the unchanged legacy loader accepts a new rate.
  game.trade = { version: 1, nextArrival: 2160, receipts: [
    { id: 12, visitId: 0, actorId: "mio", time: 460, offerId: "meal-for-scrap", paid: { food: 8 }, received: { scrap: 5 } },
  ] };
  game.region = {
    version: 1, stockDay: 0, stock: { food: 6, medicine: 3 },
    trust: { "village-trader": {}, "village-guide": {} },
    talked: { "village-trader": [], "village-guide": [] },
    knownRoute: false, routeKnownBy: [], harvests: [], receipts: [
      { actorId: "ren", npcId: "village-trader", time: 470, choice: "trade-medicine", paid: { scrap: 7 }, received: { medicine: 2 }, trustGain: 0 },
      { actorId: "aki", npcId: "village-trader", time: 471, choice: "talk", paid: {}, received: {}, trustGain: 1 },
      { actorId: "aki", npcId: "village-guide", time: 472, choice: "deliver", paid: { food: 3 }, received: { medicine: 2 }, trustGain: 2 },
    ],
  };
  return game;
}

test("Historical amounts and actors are rendered from unversioned snapshots rather than current offers", () => {
  const game = withHistory();
  const html = render(game);
  const visible = text(html);
  assert.match(visible, /交換の記録（2件）/);
  assert.match(visible, /第1日 07:40 ミオ · 行商 支払：食事8 → 受取：資材5/);
  assert.match(visible, /第1日 07:50 レン · 集落 支払：資材7 → 受取：手当用品2/);
  assert.ok(visible.indexOf("07:50") < visible.indexOf("07:40"));
  assert.doesNotMatch(visible, /07:51|07:52|信用|価格版|termsId|meal-for-scrap/);
  assert.doesNotMatch(html.match(/<details[^>]*>/)![0], /\sopen(?:\s|=|>)/);
  assert.equal(game.trade!.receipts[0].termsId, undefined);
});

test("Venue scopes include only actual exchanges and need no participant selection", () => {
  const merchant = render(withHistory(), "merchant");
  assert.match(merchant, /data-trade-history="merchant" aria-label="行商の交換の記録"/);
  assert.match(text(merchant), /交換の記録（1件）.*ミオ · 行商/);
  assert.doesNotMatch(text(merchant), /レン|支払：食事3/);
  const village = render(withHistory(), "village");
  assert.match(village, /data-trade-history="village" aria-label="集落の交換の記録"/);
  assert.match(text(village), /交換の記録（1件）.*レン · 集落/);
  assert.doesNotMatch(text(village), /ミオ|アキ|支払：食事3/);
});

test("Large histories show at most ten entries and explicitly describe the displayed limit", () => {
  const game = withHistory();
  game.region = undefined;
  game.trade!.receipts = Array.from({ length: 12 }, (_, i) => ({
    id: 20 + i, visitId: 0, actorId: "mio", time: 400 + i,
    offerId: "meal-for-scrap", paid: { food: 1000 + i }, received: { scrap: 1 },
  }));
  const html = render(game);
  assert.match(text(html), /交換の記録（12件）/);
  assert.match(text(html), /新しい日時の10件を表示しています/);
  assert.equal((html.match(/<li>/g) ?? []).length, 10);
  assert.match(text(html), /支払：食事1011/);
  assert.match(text(html), /支払：食事1002/);
  assert.doesNotMatch(text(html), /支払：食事1000|支払：食事1001\D/);
});

test("Missing legacy extensions stay absent when an empty history is read", () => {
  const game = createGame(645);
  delete game.trade;
  delete game.region;
  for (const scope of ["all", "merchant", "village"] as const) {
    const html = render(game, scope);
    assert.match(text(html), /交換の記録（0件）.*交換の記録はまだありません/);
    assert.doesNotMatch(html, /<ul|<li/);
  }
  assert.equal(game.trade, undefined);
  assert.equal(game.region, undefined);
});
