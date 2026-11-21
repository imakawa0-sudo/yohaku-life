import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App from "../src/App";
import { AwayPanel } from "../src/components/AwayPanel";
import { TravelPanel } from "../src/components/TravelPanel";
import { command, createGame, serialize } from "../src/game/engine";
import { ensureInventory } from "../src/game/inventory";
import { applyRegionInteraction } from "../src/game/region";
import { recruitCompanion } from "../src/game/recruitment";
import { getInterruptedActionSummary } from "../src/game/presentation";
import type { GameState, LocationId } from "../src/game/types";

function evening(location: LocationId): GameState {
  const game = createGame(617);
  game.minutes = 1080;
  for (const person of game.residents) { person.action = null; person.suspended = null; }
  game.residents[0].location = location;
  return game;
}

function renderApp(game: GameState) {
  const before = serialize(game);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let writes = 0;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => key === "yohaku-autosave-v1" ? before : null,
      setItem: () => { writes++; },
    },
  });
  try {
    const html = renderToStaticMarkup(createElement(App));
    assert.equal(writes, 0);
    assert.equal(serialize(game), before);
    return html;
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

function sleepButton(html: string) {
  const button = (html.match(/<button class="action-card"[\s\S]*?<\/button>/g) ?? [])
    .find(value => value.includes("旅先で眠る"));
  assert.ok(button, "a field resident should discover sleep in the shared action grid");
  return button;
}

test("The field home exposes the existing sleep action, its actual resident and sheltered site without advancing", () => {
  const game = evening("village");
  const button = sleepButton(renderApp(game));
  assert.doesNotMatch(button, /disabled=""/);
  assert.match(button, /アキ：集落の休み所/);
  assert.match(button, /最長8時間/);
  assert.match(button, /時間はボタンで進めます/);
  assert.match(button, /480分 · アキ/);
  assert.equal(game.residents[0].action, null);
  const initial = renderApp(createGame());
  assert.doesNotMatch(initial, /旅先で眠る|<details class="panel away-panel">/);
});

test("Travel preparation shows the selected traveller's shelter and personal supplies without remote warehouse quantities", () => {
  const game = evening("home");
  const mio = game.residents.find(person => person.id === "mio")!;
  mio.location = "shelter";
  const inventory = ensureInventory(game);
  inventory.packs.mio.food = 3;
  inventory.packs.mio.medicine = 2;
  game.resources.food = 99;
  game.resources.medicine = 88;
  const before = serialize(game);
  let calls = 0;
  const html = renderToStaticMarkup(createElement(TravelPanel, {
    game, focusedId: "aki", selectedIds: ["mio"], onCommand: () => { calls++; return true; },
  }));
  assert.match(html, /aria-label="ミオの旅先の寝場所"/);
  assert.match(html, /木陰の雨よけ/);
  assert.match(html, /ミオの携行・未予約：食事 3食 · 手当用品 2個/);
  assert.match(html, /拠点よりゆっくり戻り、負傷は治りません/);
  assert.match(html, /倉庫との受渡しは拠点内で行います/);
  assert.match(html, /運んで届ける場合は、帰路の時間がかかります/);
  assert.doesNotMatch(html, /拠点倉庫の未予約分|食事99|手当用品88/);
  assert.equal(calls, 0);
  assert.equal(serialize(game), before);
});

test("An unsheltered field keeps the sleep action unavailable and explains the actual location requirement", () => {
  const game = evening("road");
  const html = renderApp(game);
  const button = sleepButton(html);
  assert.match(button, /disabled=""/);
  assert.match(button, /アキのいる場所には眠れる雨よけがありません/);
  assert.match(html, /ここには寝場所がありません/);
  assert.match(html, /旅先では、集落の休み所・木陰の雨よけ・舟宿の寝床で眠れます/);
});

test("The place overview shows four residents, one warehouse and each free pack once while remaining read-only", () => {
  let game = evening("village");
  game.minutes = 600;
  const mio = game.residents.find(person => person.id === "mio")!;
  mio.location = "village";
  ensureInventory(game).packs.mio.food = 3;
  for (const choice of ["talk", "deliver"] as const)
    assert.equal(applyRegionInteraction(game, "mio", "village-guide", choice).error, undefined);
  assert.equal(recruitCompanion(game, "mio", "village-guide").error, undefined);
  game.minutes = 1080;
  mio.location = "home";
  game.residents.find(person => person.id === "ren")!.location = "home";
  const haru = game.residents.find(person => person.id === "village-guide")!;
  haru.location = "shelter";
  haru.hp = 0;
  const stock = ensureInventory(game);
  for (const [id, food, medicine] of [["aki", 2, 1], ["mio", 3, 2], ["ren", 5, 3], ["village-guide", 7, 4]] as const) {
    stock.packs[id].food = food;
    stock.packs[id].medicine = medicine;
  }
  game.resources.food = 11;
  game.resources.medicine = 13;
  const eating = command(game, { type: "assign", residentIds: ["mio"], kind: "eat" });
  assert.equal(eating.error, undefined);
  game = eating.state;
  const before = serialize(game);
  const focuses: string[] = [];
  const html = renderToStaticMarkup(createElement(AwayPanel, { game, onFocus: id => focuses.push(id) }));
  assert.match(html, /<details class="panel away-panel">/);
  assert.match(html, /3か所 · 4人/);
  assert.equal((html.match(/拠点の共用倉庫：/g) ?? []).length, 1);
  assert.match(html, /拠点の共用倉庫：食事 11食 · 手当用品 13個/);
  assert.match(html, /携行・未予約：食事 7食 · 手当用品 5個/);
  assert.match(html, /携行・未予約：食事 2食 · 手当用品 1個/);
  assert.match(html, /携行・未予約：食事 7食 · 手当用品 4個/);
  assert.match(html, /ミオ<\/strong><span>食事をとる/);
  assert.match(html, /意識なし · 救助が必要/);
  for (const name of ["アキ", "ミオ", "レン", "ハル"])
    assert.match(html, new RegExp(`aria-label="${name}の場面を見る"`));
  assert.doesNotMatch(html, /aria-pressed|<select|type="checkbox"/);
  assert.deepEqual(focuses, []);
  assert.equal(serialize(game), before);
  const allAway = structuredClone(game);
  for (const person of allAway.residents) person.location = "village";
  const allAwayHtml = renderToStaticMarkup(createElement(AwayPanel, { game: allAway, onFocus: id => focuses.push(id) }));
  assert.equal((allAwayHtml.match(/拠点の共用倉庫：/g) ?? []).length, 1);
  assert.match(allAwayHtml, /拠点内でのみ利用可。離れた場所からは使えません/);
  assert.deepEqual(focuses, []);
});

test("Interrupted sleep copy never invents a missing origin or claims blocked sleep is progressing", () => {
  let game = evening("home");
  let result = command(game, { type: "assign", residentIds: ["aki"], kind: "sleep" });
  assert.equal(result.error, undefined);
  game = result.state;
  delete game.residents[0].action!.origin;
  game.residents[0].action!.duration = 1200;
  result = command(game, { type: "pause", residentId: "aki" });
  assert.equal(result.error, undefined);
  game = result.state;
  game.residents[0].location = "village";
  const missing = getInterruptedActionSummary(game, "aki")!;
  assert.match(missing.detail, /開始場所の記録がない行動/);
  assert.doesNotMatch(missing.detail, /近隣の集落で始めた/);
  assert.equal(missing.locationName, "開始場所の記録なし");

  game = evening("home");
  result = command(game, { type: "assign", residentIds: ["aki"], kind: "project", target: "wood-flower" });
  assert.equal(result.error, undefined);
  game = command(result.state, { type: "pause", residentId: "aki" }).state;
  game.residents[0].location = "village";
  result = command(game, { type: "assign", residentIds: ["aki"], kind: "sleep" });
  assert.equal(result.error, undefined);
  game = result.state;
  game.enemy.location = "village";
  const html = renderApp(game);
  assert.match(html, /睡眠は安全確認待ちです。進捗は保持しています/);
  assert.match(html, /現在の指示は「眠る（最長8時間）」です/);
  assert.doesNotMatch(html, /現在は「眠る（最長8時間）」を進めています/);
});

test("The lodge has its own stores, cooking, craft and bed in the life view", () => {
  const game = evening("lodge");
  ensureInventory(game).ground.lodge = { food: 2, ingredients: 4, medicine: 1, scrap: 0 };
  const html = renderApp(game);
  assert.match(html, /舟宿で食事をつくる/);
  assert.match(html, /小鳥の木彫りをする/);
  assert.match(html, /舟宿でひと休み/);
  assert.match(sleepButton(html), /舟宿の寝床/);
  assert.match(html, /物置に預ける/);
  assert.match(html, /物置から取り出す/);
  assert.doesNotMatch(html, /負傷は治りません/);
  assert.match(html, /葦原へ向かう/);
  const reedbank = renderApp(evening("reedbank"));
  for (const action of ["葦原で採集する", "舟宿へ向かう", "集落へ下る"])
    assert.ok(reedbank.includes(action));
});
