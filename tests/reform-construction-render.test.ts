import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import {
  advance,
  isGame,
  order,
  setHousingPassage,
  type Game,
} from "../src/reform/sim";
import { cancelRoomConstruction } from "../src/reform/housing/construction";
import { housingLinkId, housingPoint } from "../src/reform/housing/topology";
import {
  base,
  building,
  hauling,
  ok,
  one,
  planned,
  planId,
  reserved,
  staged,
  two,
} from "./helpers/construction";

register(
  "data:text/javascript," +
    encodeURIComponent(
      'export async function load(url, context, next) { if (url.endsWith(".css") || new URL(url).pathname.endsWith(".png")) return { format: "module", source: "export default " + JSON.stringify(url), shortCircuit: true }; return next(url, context); }',
    ),
);
const { Life } = await import("../src/reform/Life");
const { HouseEditor } = await import("../src/reform/HouseEditor");

const unexpectedCommand = () => assert.fail("render issued a command");
async function construction(game: Game) {
  const { ConstructionPanel } = await import("../src/reform/ConstructionPanel");
  const before = JSON.stringify(game);
  const result = render(
    createElement(ConstructionPanel, { game, onGame: unexpectedCommand }),
  );
  assert.equal(JSON.stringify(game), before);
  return result;
}

test("construction planning shows the room size, cost and required staging choice", async () => {
  const html = await construction(base());
  assert.match(html, /一室を増築する/);
  assert.match(html, /4 × 3マス/);
  assert.match(html, /木材6.*施工30分/);
  assert.match(html, /接続先/);
  assert.match(html, /仮置き床/);
  assert.match(html, /<button[^>]*disabled[^>]*>計画する/);
});

test("an unstocked plan shows free wood separately and the reason reservation is disabled", async () => {
  const g = base();
  g.wood = 3;
  const html = await construction(planned(g));
  assert.match(html, /作業室/);
  assert.match(html, /自由備蓄の木材.*3/);
  assert.match(html, /工事用木材.*未調達/);
  assert.match(html, /<button[^>]*disabled[^>]*>木材6を取り置く/);
  assert.match(html, /木材6が必要/);
  assert.match(html, /この工事を取り消す/);
  assert.match(html, /<button[^>]*disabled[^>]*>計画する/);
});

test("carried wood shows its actual route and assigned resident while delivery is active", async () => {
  const g = advance(hauling(), 2);
  const html = await construction(g);
  assert.match(html, /搬入中/);
  assert.match(html, /木材6・居間の入口 → 寝室の入口/);
  assert.ok(html.includes(g.actors[0].person.name + "が運搬中"));
  assert.match(html, /完了までの目安.*4分/);
  assert.match(html, /担当を外す/);
  assert.doesNotMatch(html, /仮置き場へ運ぶ<\/button>/);
});

test("cancelled wood carried out of the supply point must be hauled from its actual drop location", async () => {
  const cancelled = ok(cancelRoomConstruction(advance(hauling(), 2), planId));
  const safelyStopped = advance(cancelled, 2);
  const html = await construction(safelyStopped);
  assert.match(html, /回収待ち/);
  assert.match(html, /木材6・寝室の入口/);
  assert.match(html, /回収担当/);
  assert.match(html, /<button[^>]*disabled[^>]*>備蓄へ運び戻す/);
  assert.match(html, /担当者を選んでください/);
  assert.doesNotMatch(html, /供給口の木材を備蓄に戻す<\/button>/);
});

test("a source-floor return blocked by stock capacity offers only the stock retry", async () => {
  const full = reserved();
  full.wood = 1_000_000_000;
  const cancelled = ok(cancelRoomConstruction(full, planId));
  const html = await construction(cancelled);
  assert.match(html, /備蓄への返却待ち/);
  assert.match(html, /木材6・居間の入口/);
  assert.match(html, /<button[^>]*disabled[^>]*>供給口の木材を備蓄に戻す/);
  assert.match(html, /空きがありません.*木材を使って/);
  assert.doesNotMatch(html, /回収担当|備蓄へ運び戻す<\/button>/);
  const roomForReturn = { ...cancelled, wood: 999_999_994 };
  assert.ok(isGame(roomForReturn));
  assert.match(
    await construction(roomForReturn),
    /<button(?![^>]*disabled)[^>]*>供給口の木材を備蓄に戻す/,
  );
});

test("a staged bundle can be assigned expressly and a busy resident is labelled ineligible", async () => {
  const g = order(staged(), two, "wait");
  const html = await construction(g);
  assert.match(html, /木材6・寝室・3列1行/);
  assert.match(html, /施工担当/);
  assert.match(html, /<option[^>]*disabled[^>]*>[^<]*進行中の予定/);
  assert.match(html, /<button[^>]*disabled[^>]*>施工する/);
});

test("work in progress shows real time spent and remaining after a second person reaches the staging floor", async () => {
  const g = advance(building(staged(), two), 9);
  const html = await construction(g);
  assert.match(html, /施工中/);
  assert.ok(html.includes(g.actors[1].person.name));
  assert.match(html, /施工済み.*4分/);
  assert.match(html, /残り.*26分/);
  assert.match(html, /担当を外す/);
});

test("work completed with an exhausted room ID explains why the explicit completion action is unavailable", async () => {
  const active = building();
  active.house.nextId = Number.MAX_SAFE_INTEGER;
  const blocked = advance(active, 30);
  const html = await construction(blocked);
  assert.match(html, /完成反映待ち/);
  assert.match(html, /施工済み.*30分/);
  assert.match(html, /<button[^>]*disabled[^>]*>完成を反映する/);
  assert.match(html, /部屋の番号を発行できない/);
  const available = { ...blocked, house: { ...blocked.house, nextId: 61 } };
  assert.match(
    await construction(available),
    /<button(?![^>]*disabled)[^>]*>完成を反映する/,
  );
});

test("the completed room is offered by the normal life movement controls", async () => {
  const g = advance(building(), 30);
  const html = await construction(g);
  assert.match(html, /<summary>作業室・完成/);
  assert.match(html, /部屋に移動して家具を置けます/);
  assert.match(life(g), /作業室の入口へ移動/);
  assert.doesNotMatch(life(planned()), /作業室の入口へ移動/);
});

test("ordinary life cancellation during a carry describes putting the bundle down", () => {
  const travelling = advance(hauling(), 2);
  const pending = life(travelling);
  assert.match(pending, /工事用木材を運んでいます/);
  assert.match(pending, /木材を床へ下ろします/);
  const exiting = life(order(travelling, one, "cancel"));
  assert.match(
    exiting,
    /この区間の終点で運搬を終了し、持っている木材を床に下ろします/,
  );
  assert.doesNotMatch(exiting, /取り置きした物が戻ります/);
});

test("before cancelling the trip to pickup, life identifies the wood still on its original floor", () => {
  const remote = advance(
    order(
      reserved(),
      one,
      "home-move",
      JSON.stringify({ roomId: "bedroom", cell: 0 }),
    ),
    3,
  );
  const beforePickup = life(advance(hauling(remote), 1));
  assert.match(beforePickup, /木材を拾いに向かって/);
  assert.match(beforePickup, /木材は元の床に残ります/);
  assert.doesNotMatch(beforePickup, /木材を床へ下ろします/);
});

test("construction waiting explains a closed link and then the next tick after reopening it", async () => {
  const link = housingLinkId("living", "bedroom");
  const held = advance(
    setHousingPassage(advance(hauling(), 1), "link", link, false),
    1,
  );
  const closed = await construction(held);
  assert.match(closed, /目的地への通路が通れません/);
  assert.match(closed, /見積もれません/);
  const reopened = await construction(
    setHousingPassage(held, "link", link, true),
  );
  assert.match(reopened, /次の時間進行で運搬を再開します/);
  assert.match(reopened, /完了までの目安.*5分/);
});

test("the construction screen describes cancelled travel to a bundle that has not yet been picked up", async () => {
  const g = base();
  g.actors[0].room = "bedroom";
  g.housing!.state.actors[one].position = {
    kind: "at",
    point: housingPoint("bedroom", 0),
  };
  const travelling = advance(hauling(reserved(g)), 1);
  const cancelled = ok(cancelRoomConstruction(travelling, planId));
  const html = await construction(cancelled);
  assert.match(html, /担当解除中/);
  assert.match(html, /木材はまだ拾っていません/);
  assert.doesNotMatch(html, /元の床に残ります/);
});

test("HouseEditor preserves direct room addition during setup and guides in-game edits to planning", () => {
  const props = { house: base().house, onChange: unexpectedCommand };
  const setup = render(createElement(HouseEditor, props));
  assert.match(setup, /部屋を増やす（木材6）/);
  const play = render(
    createElement(HouseEditor, { ...props, allowRoomAddition: false }),
  );
  assert.doesNotMatch(play, /部屋を増やす（木材6）/);
  assert.match(play, /一室を増築する/);
  assert.match(play, /この部屋に置く/);
  assert.match(play, /通路の接続先/);
});

function life(game: Game) {
  return render(
    createElement(Life, {
      game,
      selected: one,
      onSelect: unexpectedCommand,
      onGame: unexpectedCommand,
    }),
  );
}
