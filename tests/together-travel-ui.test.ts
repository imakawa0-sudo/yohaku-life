import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App from "../src/App.tsx";
import { TogetherMoveStatus, TogetherTravelPanel } from "../src/components/TogetherTravelPanel.tsx";
import { DayTripRoutes } from "../src/components/RegionPanel.tsx";
import { AwayPanel } from "../src/components/AwayPanel.tsx";
import { getTogetherMoveInfo, getTogetherTravelScope, type TogetherRouteRequest } from "../src/components/together-travel.ts";
import { command, createGame, inspectTogetherMove, serialize } from "../src/game/engine.ts";
import { ensureInventory } from "../src/game/inventory.ts";
import type { GameState, LocationId } from "../src/game/types.ts";

const ids = ["mio", "ren"];
const visible = (html: string) => html.replace(/<!--.*?-->/gs, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
// Controlled SSR setup, not a normal-play export or actual browser test.
function villagePair() {
  const s = createGame(561);
  for (const id of ids) s.residents.find(r => r.id === id)!.location = "village";
  ensureInventory(s).packs.ren.scrap = 12;
  return s;
}
function panel(s: GameState, selectedIds = ids, target?: LocationId, via?: LocationId[], request?: TogetherRouteRequest, session = 0) {
  const before = serialize(s), scope = getTogetherTravelScope(s, selectedIds, session);
  const html = renderToStaticMarkup(createElement(TogetherTravelPanel, { game: s, selectedIds, scope,
    openRequest: request ?? (target ? { scope, target, ...(via ? { via } : {}) } : null),
    onCommand: () => assert.fail("Rendering cannot reserve a move"),
  }));
  assert.equal(serialize(s), before);
  return html;
}
function app(s: GameState) {
  const raw = serialize(s), original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => key === "yohaku-autosave-v1" ? raw : null,
    setItem: () => assert.fail("SSR cannot save the world"),
  } });
  try { return renderToStaticMarkup(createElement(App)); }
  finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
    assert.equal(serialize(s), raw);
  }
}

test("Only the actual same-place selection of two opens the one destination control", () => {
  const s = villagePair();
  for (const selected of [[], ["mio"], ["aki", "mio", "ren"], ["mio", "mio"], ["mio", "missing"], ["aki", "mio"]]) {
    const html = panel(s, selected);
    assert.match(visible(html), /同じ場所の住民2人/);
    assert.doesNotMatch(html, /<select|data-move-together/);
  }
  const html = panel(s);
  assert.equal((html.match(/<select/g) ?? []).length, 1);
  assert.match(html, /aria-label="同行する二人の行き先"/);
  assert.match(visible(html), /指示対象：ミオ・レン · 近隣の集落から/);
  assert.doesNotMatch(html, /checkbox|radio/);
});

test("The arbitrary ridge preview shows both individual costs, common cost and the actual danger without ordering", () => {
  const s = villagePair();
  s.version = 4;
  s.secondaryEncounter = { version: 1, hp: 60, defeated: false, introducedAt: s.minutes, actorId: "mio", logId: s.nextId++ };
  const preview = inspectTogetherMove(s, ids, "ridge");
  assert.equal(preview.error, undefined);
  assert.notEqual(preview.residents[0].individualMinutes, preview.residents[1].individualMinutes);
  const text = visible(panel(s, ids, "ridge"));
  for (const resident of preview.residents) assert.ok(text.includes(`${resident.name}${resident.individualMinutes}分`));
  assert.ok(text.includes(`同行は${preview.minutes}分`));
  assert.match(text, /途中も一緒/);
  assert.match(text, /尾根の見張り.*到着後の攻防は別/);
  assert.match(text, /2人で尾根の近道へ出発/);
  const invalid = panel(s, ids, "village");
  assert.match(invalid, /data-together-error/);
  assert.match(invalid, /data-move-together[^>]*disabled/);
});

test("A route draft belongs to the selected people, physical origin and loaded-world session", () => {
  const s = villagePair(), oldScope = getTogetherTravelScope(s, ids);
  const request = { scope: oldScope, target: "home" as const, via: ["ridge", "ruins", "road"] as LocationId[] };
  assert.match(panel(s, ids, undefined, undefined, request), /data-together-route-draft/);
  assert.doesNotMatch(panel(s, ids, undefined, undefined, request, 1), /data-together-route-draft/);
  assert.doesNotMatch(panel(s, ["ren", "mio"], undefined, undefined, request), /data-together-route-draft/);
  s.residents.find(r => r.id === "mio")!.location = "meadow";
  s.residents.find(r => r.id === "ren")!.location = "meadow";
  assert.doesNotMatch(panel(s, ids, undefined, undefined, request), /data-together-route-draft/);
});

test("Day-trip route CTAs select a draft only for two actual co-located people and keep ordinary buttons", () => {
  const s = villagePair(), before = serialize(s);
  const html = renderToStaticMarkup(createElement(DayTripRoutes, { game: s, selectedIds: ids,
    onCommand: () => assert.fail("No render-time ordinary command"),
    onTogetherRoute: () => assert.fail("No render-time paired command or route request"),
  }));
  assert.match(html, /data-together-route="home-safe"/);
  assert.match(html, /data-together-route="home-short"/);
  assert.match(visible(html), /2人の道順に選ぶ/);
  assert.match(visible(html), /川沿いの道で拠点へ帰る/);
  const solo = renderToStaticMarkup(createElement(DayTripRoutes, { game: s, selectedIds: ["mio"], onCommand: () => true, onTogetherRoute: () => {} }));
  assert.doesNotMatch(solo, /data-together-route/);
  assert.equal(serialize(s), before);
});

test("Current reciprocal jobs show peer and remaining time; individual pause removes the badge without rewriting labels", () => {
  const s = villagePair(), result = command(s, { type: "move-together", residentIds: ids, target: "ridge" });
  assert.equal(result.error, undefined);
  const moving = result.state, before = serialize(moving), remaining = getTogetherMoveInfo(moving, "mio")!.remaining;
  const names = moving.residents.filter(r => ids.includes(r.id)).map(r => r.action!.label);
  const text = visible(panel(moving));
  assert.match(text, /一緒に移動中/);
  assert.ok(text.includes(`残り${remaining}分`));
  assert.match(visible(app(moving)), /レンと同行中|ミオと同行中/);
  assert.match(visible(renderToStaticMarkup(createElement(AwayPanel, { game: moving, onFocus: () => {} }))), /同行中/);
  assert.deepEqual(moving.residents.filter(r => ids.includes(r.id)).map(r => r.action!.label), names);
  assert.equal(serialize(moving), before);
  const stopped = command(moving, { type: "pause", residentId: "mio" });
  assert.equal(stopped.error, undefined);
  for (const id of ids) assert.equal(renderToStaticMarkup(createElement(TogetherMoveStatus, { game: stopped.state, residentId: id })), "");
  assert.equal(stopped.state.residents.find(r => r.id === "ren")!.action!.label, names[1]);
});
