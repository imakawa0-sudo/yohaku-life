import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  editHouse,
  initialHouse,
  type House,
  type Need,
} from "../src/reform/house";
import { applyHousingHouseEdit } from "../src/reform/housing/runtime";
import { makePersona } from "../src/reform/peopleModel";
import {
  advance,
  createGame,
  enableHousing,
  isGame,
  order,
  type Game,
} from "../src/reform/sim";
import { defaultWorldConfig, generateWorld } from "../src/reform/world";

register(
  "data:text/javascript," +
    encodeURIComponent(
      'export async function load(url, context, next) { if (url.endsWith(".css") || new URL(url).pathname.endsWith(".png")) return { format: "module", source: "export default " + JSON.stringify(url), shortCircuit: true }; return next(url, context); }',
    ),
);
const { Life } = await import("../src/reform/Life");
const person = makePersona(0, 23);

function morning(house?: House) {
  if (!house) {
    house = initialHouse();
    house.rooms[0].fixtures.push({ id: "near-books", kind: "shelf", cell: 4 });
    house.rooms[1].fixtures.push({ id: "far-books", kind: "shelf", cell: 6 });
  }
  return createGame(
    [person],
    generateWorld(defaultWorldConfig()),
    "village",
    house,
  );
}

function actions(game: Game, choices: Partial<Record<Need, string>> = {}) {
  const before = JSON.stringify(game);
  const unexpectedCommand = () => assert.fail("render issued a command");
  const html = renderToStaticMarkup(
    createElement(Life, {
      game,
      selected: person.id,
      onSelect: unexpectedCommand,
      onGame: unexpectedCommand,
      facilitySelection: { choices, choose: unexpectedCommand },
    }),
  );
  assert.equal(JSON.stringify(game), before);
  const panel = html.match(
    /<section[^>]*aria-label="行動の指示"[^>]*>([\s\S]*?)<\/section>/,
  )?.[1];
  assert.ok(panel);
  return panel;
}

test("the six home need actions each have a labeled automatic choice", () => {
  const html = actions(enableHousing(morning(), "new"));
  const labels = [
    ...html.matchAll(
      /<label[^>]*>(食事|用足し|身支度|休息|交流|楽しみ)に使う設備<\/label>/g,
    ),
  ];
  assert.deepEqual(
    labels.map((label) => label[1]),
    ["食事", "用足し", "身支度", "休息", "交流", "楽しみ"],
  );
  assert.equal(
    [
      ...html.matchAll(
        /<option[^>]*selected="">自動（移動と利用が短い設備）<\/option>/g,
      ),
    ].length,
    6,
  );
});

test("the default reading destination shows furniture and breaks down the time estimate", () => {
  const html = actions(enableHousing(morning(), "new"));
  assert.match(
    html,
    /<option value="near-books">居間・本棚と読書椅子（1列2行）<\/option>/,
  );
  assert.match(
    html,
    /<option value="far-books">寝室・本棚と読書椅子（3列2行）<\/option>/,
  );
  assert.match(
    html,
    /<small[^>]*>居間・本棚と読書椅子[\s\S]*?現在の見込み[\s\S]*?移動0分 ＋ 利用14分（合計14分）/,
  );
});

test("the meal preview names the reserved food", () => {
  const html = actions(enableHousing(morning(), "new"));
  assert.match(
    html,
    /<small[^>]*>居間・小さなかまど(?:(?!<\/small>)[\s\S])*?取り置き 食事1/,
  );
});

test("legacy and away actions keep their existing rows without a furniture select", () => {
  const legacy = morning();
  const housed = enableHousing(morning(), "new");
  const away = advance(order(housed, person.id, "travel", "landing"), 20);
  assert.equal(away.actors[0].location, "landing");
  for (const game of [legacy, away]) {
    const html = actions(game);
    assert.match(
      html,
      /<button[^>]*data-kind="need"[^>]*data-target="hunger"[^>]*>食事をとる/,
    );
    assert.doesNotMatch(html, /<select|に使う設備/);
  }
});

test("a removed selected fixture stays selected and disables its action even when automatic use is possible", () => {
  const game = enableHousing(morning(), "new");
  const edit = applyHousingHouseEdit(
    game,
    editHouse(game.house, { type: "remove", id: "far-books" }),
  );
  assert.equal(edit.error, undefined);
  const html = actions(edit.game, { fun: "far-books" });
  assert.match(
    html,
    /<option value="far-books" selected="">選んだ設備がありません<\/option>/,
  );
  assert.match(
    html,
    /<button[^>]*data-target="fun"[^>]*disabled[^>]*>好きなことをして休む<\/button>/,
  );
  assert.match(html, /<small[^>]*>選んだ設備がありません<\/small>/);
  assert.match(
    html,
    /<option value="near-books">居間・本棚と読書椅子（1列2行）<\/option>/,
  );
  assert.match(
    actions(edit.game),
    /<button[^>]*data-target="fun"(?![^>]*disabled)[^>]*>好きなことをして休む<\/button>/,
  );
});

test("automatic reading names the actual fixture's cell when two shelves share a room", () => {
  const firstShelf = editHouse(initialHouse(), {
    type: "build",
    room: "living",
    kind: "shelf",
    cell: 7,
  });
  const house = editHouse(firstShelf, {
    type: "build",
    room: "living",
    kind: "shelf",
    cell: 4,
  });
  const game = enableHousing(morning(house), "new");
  assert.ok(isGame(game));
  const booked = order(game, person.id, "need", "fun");
  assert.equal(
    booked.actors[0].task?.station,
    '["slot","living","fixture-2",0]',
  );
  const html = actions(game);
  assert.match(
    html,
    /<option value="fixture-1">居間・本棚と読書椅子（4列2行）<\/option>/,
  );
  assert.match(
    html,
    /<small id="lf-order-need-fun">居間・本棚と読書椅子（1列2行）<br/,
  );
});

test("same-cell shelves in rooms sharing a name have distinguishable choices", () => {
  const rooms = editHouse(initialHouse(), {
    type: "room",
    name: "居間",
    neighbor: "living",
  });
  const firstShelf = editHouse(rooms, {
    type: "build",
    room: "living",
    kind: "shelf",
    cell: 4,
  });
  const house = editHouse(firstShelf, {
    type: "build",
    room: "room-1",
    kind: "shelf",
    cell: 4,
  });
  const game = enableHousing(morning(house), "new");
  assert.ok(isGame(game));
  const html = actions(game, { fun: "fixture-3" });
  assert.match(
    html,
    /<option value="fixture-2">居間・本棚と読書椅子（1列2行、同名の1室目）<\/option>/,
  );
  assert.match(
    html,
    /<option value="fixture-3" selected="">居間・本棚と読書椅子（1列2行、同名の2室目）<\/option>/,
  );
  assert.match(
    html,
    /<small id="lf-order-need-fun">居間・本棚と読書椅子（1列2行、同名の2室目）<br/,
  );
});
