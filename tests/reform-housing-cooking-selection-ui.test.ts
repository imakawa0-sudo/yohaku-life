import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FacilityAction,
  type FacilityChoiceKey,
} from "../src/reform/FacilityAction";
import { facilityLabel } from "../src/reform/facilityLabel";
import { initialHouse } from "../src/reform/house";
import { makePersona } from "../src/reform/peopleModel";
import {
  advance,
  createGame,
  enableHousing,
  inspectOrder,
  isGame,
  options,
  order,
  setHousingPassage,
  setHousingRoomAccess,
  type Game,
} from "../src/reform/sim";
import { defaultWorldConfig, generateWorld } from "../src/reform/world";

import { housingLinkId } from "../src/reform/housing/topology";

register(
  "data:text/javascript," +
    encodeURIComponent(
      'export async function load(url, context, next) { if (url.endsWith(".css") || new URL(url).pathname.endsWith(".png")) return { format: "module", source: "export default " + JSON.stringify(url), shortCircuit: true }; return next(url, context); }',
    ),
);
const { ActionCommands } = await import("../src/reform/Life");

const people = [makePersona(0, 23), makePersona(1, 75)];
const [first, second] = people;
const far = "yard-cooker";
const near = "hearth-1";
const recipes = ["cook", "cook:hard", "cook:master"] as const;
const unexpected = () => assert.fail("render issued a command");

function base(
  skill = 5,
  kind: "hearth" | "kitchen" = "hearth",
  housing = true,
  sameName = false,
) {
  const house = initialHouse();
  house.rooms[2].fixtures.push({ id: far, kind, cell: 6 });
  if (sameName) house.rooms[2].name = house.rooms[0].name;
  const game = createGame(
    people,
    generateWorld(defaultWorldConfig()),
    "village",
    house,
  );
  game.actors[0].person.skills.cook = skill;
  game.ingredients = 6;
  return housing ? enableHousing(game, "new") : game;
}

function renderRecipe(
  game: Game,
  recipe: (typeof recipes)[number],
  selectedId = "",
) {
  assert.ok(isGame(game));
  const before = JSON.stringify(game);
  const command = options(game, first.id).find(
    (command) => command.kind === "work" && command.target === recipe,
  )!;
  const html = renderToStaticMarkup(
    createElement(FacilityAction, {
      game,
      actor: game.actors[0],
      command,
      selectedId,
      onSelect: unexpected,
      onGame: unexpected,
    }),
  );
  assert.equal(JSON.stringify(game), before);
  return { html, command };
}

function expectedPreview(
  game: Game,
  recipe: (typeof recipes)[number],
  selectedId = "",
) {
  const preview = inspectOrder(
    game,
    first.id,
    "work",
    recipe,
    selectedId ? { fixtureId: selectedId } : undefined,
  );
  const facility = preview.facility!;
  const rooms = game.house.rooms;
  const room = rooms.find((room) => room.id === facility.roomId)!;
  return (
    facilityLabel(rooms, room, facility.fixtureKind, facility.fixtureCell) +
    `<br/>現在の見込み　移動${facility.moveMinutes}分 ＋ 利用${facility.useMinutes}分（合計${preview.minutes}分）<br/>取り置き 食材${preview.reserved!.ingredients}`
  );
}

test("each cooking recipe has its own labeled select, destination, movement and ingredient preview", () => {
  const game = base();
  const ids: string[] = [];
  for (const recipe of recipes) {
    const { html, command } = renderRecipe(game, recipe);
    assert.ok(html.includes(`>${command.label}ために使う設備</label>`));
    assert.ok(
      html.includes(
        '<option value="" selected="">自動（移動と利用が短い設備）</option>',
      ),
    );
    assert.ok(html.includes(expectedPreview(game, recipe)));
    assert.ok(html.includes(`data-kind="work" data-target="${recipe}"`));
    ids.push(...Array.from(html.matchAll(/ id="([^"]+)"/g), (m) => m[1]));
    const explicit = renderRecipe(game, recipe, far).html;
    assert.ok(explicit.includes(`value="${far}" selected=""`));
    assert.ok(explicit.includes(expectedPreview(game, recipe, far)));
    assert.notEqual(
      expectedPreview(game, recipe),
      expectedPreview(game, recipe, far),
    );
  }
  assert.equal(new Set(ids).size, ids.length);
});

test("master cooking keeps the existing skill restriction even with an explicit fixture", () => {
  const game = base(1);
  for (const selected of ["", far]) {
    const { html } = renderRecipe(game, "cook:master", selected);
    assert.match(html, /<button[^>]*disabled=""/);
    assert.match(html, /技能5/);
  }
});

function renderCommands(
  game: Game,
  group: "need" | "work",
  choices: Partial<Record<FacilityChoiceKey, string>> = {},
) {
  assert.ok(isGame(game));
  const before = JSON.stringify(game);
  const html = renderToStaticMarkup(
    createElement(ActionCommands, {
      game,
      actor: game.actors[0],
      group,
      cancelling: false,
      commands: options(game, first.id).filter(
        (command) => command.group === group,
      ),
      facilitySelection: { choices, choose: unexpected },
      onGame: unexpected,
    }),
  );
  assert.equal(JSON.stringify(game), before);
  return html;
}

function row(html: string, target: FacilityChoiceKey) {
  const result = [
    ...html.matchAll(
      /<div class="lf-command(?: lf-facility-command)?">([\s\S]*?)<\/div>/g,
    ),
  ]
    .map((match) => match[0])
    .find((markup) => markup.includes(`data-target="${target}"`));
  assert.ok(result, `missing ${target} command`);
  return result;
}

test("actual work rows filter non-cooking fixtures and keep recipe and need selections separate", () => {
  const game = base(5, "kitchen", true, true);
  const choices = {
    cook: far,
    "cook:hard": near,
    hunger: near,
    energy: "mat-1",
  };
  const html = renderCommands(game, "work", choices);
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal((html.match(/<select/g) ?? []).length, 3);
  for (const [recipe, selected] of [
    ["cook", far],
    ["cook:hard", near],
    ["cook:master", ""],
  ] as const) {
    const markup = row(html, recipe);
    const selectId = `lf-order-work-${recipe}-facility`;
    assert.ok(markup.includes(`<label for="${selectId}">`));
    assert.ok(markup.includes(`<select id="${selectId}">`));
    assert.ok(markup.includes(`value="${selected}" selected=""`));
    assert.ok(markup.includes(`aria-describedby="lf-order-work-${recipe}"`));
    assert.ok(markup.includes(expectedPreview(game, recipe, selected)));
    assert.match(markup, /居間・小さなかまど（4列1行、同名の1室目）/);
    assert.match(markup, /居間・台所と食卓（3列2行、同名の2室目）/);
    assert.doesNotMatch(
      markup,
      /value="(?:mat-1|bench-1|window-1|basin-1|latrine-1)"/,
    );
  }
  const needHtml = renderCommands(game, "need", choices);
  const hunger = row(needHtml, "hunger");
  assert.ok(hunger.includes(`value="${near}" selected=""`));
  assert.match(hunger, /取り置き 食事1/);
  assert.doesNotMatch(hunger, /取り置き 食材/);
  assert.match(row(needHtml, "energy"), /value="mat-1" selected=""/);
});

test("explicit reservations, passage, permission and missing selection show the reason without an alternative", () => {
  const origin = base(5, "kitchen");
  const cases = [
    [order(origin, second.id, "home-use", far), far, /予約/],
    [
      setHousingPassage(
        origin,
        "link",
        housingLinkId("bedroom", "yard"),
        false,
      ),
      far,
      /通路/,
    ],
    [setHousingRoomAccess(origin, "yard", []), far, /許可/],
    [origin, "removed", /選んだ設備がありません/],
  ] as const;
  for (const [game, selected, reason] of cases) {
    const markup = row(
      renderCommands(game, "work", { cook: selected }),
      "cook",
    );
    assert.ok(markup.includes(`value="${selected}" selected=""`));
    assert.match(markup, /<button[^>]*disabled=""/);
    assert.match(markup.match(/<small[^>]*>([\s\S]*?)<\/small>/)![1], reason);
    assert.doesNotMatch(markup, /現在の見込み|取り置き 食材/);
    const automatic = row(renderCommands(game, "work"), "cook");
    assert.ok(automatic.includes(expectedPreview(game, "cook")));
    assert.doesNotMatch(automatic, /<button[^>]*disabled=""/);
  }
});

test("legacy and outside cooking retain the ordinary work command and no new controls", () => {
  const legacy = base(5, "hearth", false);
  const home = base();
  const traveling = order(home, first.id, "travel", "landing");
  const away = advance(traveling, traveling.actors[0].task!.remaining);
  assert.equal(away.actors[0].location, "landing");
  away.actors[0].cargo.ingredients = 3;
  for (const game of [legacy, away]) {
    const html = renderCommands(game, "work", {
      cook: far,
      "cook:hard": near,
      "cook:master": far,
    });
    assert.doesNotMatch(html, /<select|lf-facility-command/);
    for (const recipe of recipes) {
      const markup = row(html, recipe);
      assert.ok(markup.includes(`data-kind="work" data-target="${recipe}"`));
      assert.doesNotMatch(markup, /<button[^>]*disabled=""/);
    }
  }
});
