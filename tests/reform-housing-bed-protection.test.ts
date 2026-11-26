import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { editHouse } from "../src/reform/house";
import { setPreferredBed } from "../src/reform/housing/bedPreference";
import { reserveConstructionMaterial } from "../src/reform/housing/construction";
import { createRoomInsulation } from "../src/reform/housing/insulation";
import { applyHousingHouseEdit } from "../src/reform/housing/runtime";
import { housingSlotId } from "../src/reform/housing/topology";
import {
  advance,
  inspectOrder,
  isGame,
  order,
  type Game,
} from "../src/reform/sim";
import {
  base,
  building,
  hauling,
  ok,
  one,
  planId,
  two,
} from "./helpers/construction";

register(
  "data:text/javascript," +
    encodeURIComponent(
      'export async function load(url, context, next) { if (url.endsWith(".css") || new URL(url).pathname.endsWith(".png")) return { format: "module", source: "export default " + JSON.stringify(url), shortCircuit: true }; return next(url, context); }',
    ),
);
const { Life } = await import("../src/reform/Life");

function furnishedHome() {
  const initial = base();
  initial.wood = 20;
  const extraBed = editHouse(initial.house, {
    type: "build",
    room: "living",
    kind: "bed",
    cell: 7,
  });
  const withYard = editHouse(extraBed, {
    type: "build",
    room: "yard",
    kind: "mat",
    cell: 6,
  });
  const equipped = ok(applyHousingHouseEdit(initial, withYard));
  const planned = ok(
    createRoomInsulation(equipped, { roomId: "bedroom", stagingCell: 2 }),
  );
  const delivered = advance(
    order(
      hauling(ok(reserveConstructionMaterial(planned, planId))),
      two,
      "work",
      "care",
    ),
    6,
  );
  return advance(building(delivered), 30);
}
const bed = "fixture-1";
const yardMat = "fixture-2";
const warmMat = "mat-1";

function restControls(game: Game, selection = "") {
  assert.ok(isGame(game));
  const before = JSON.stringify(game);
  const noChange = () => assert.fail("reading a forecast issued an order");
  const html = renderToStaticMarkup(
    createElement(Life, {
      game,
      selected: one,
      onSelect: noChange,
      onGame: noChange,
      facilitySelection: { choices: { energy: selection }, choose: noChange },
    }),
  );
  assert.equal(JSON.stringify(game), before);
  const rest = html.match(
    /<div class="lf-command lf-facility-command">(?=<label[^>]*>休息に使う設備<\/label>)([\s\S]*?)<\/div>/,
  )?.[1];
  assert.ok(
    rest,
    "the ordinary life screen should offer a destination for rest",
  );
  const detail = rest.match(/<small[^>]*>([\s\S]*?)<\/small>/)?.[1];
  assert.ok(detail);
  const policy = html.match(
    /が優先する寝床<\/label><select[^>]*>([\s\S]*?)<\/select>/,
  )?.[1];
  assert.ok(policy);
  return { rest, detail, policy };
}

test("rest options distinguish the insulated bedroom, untreated bed and outdoor mat without changing the order", () => {
  const game = furnishedHome();
  const original = structuredClone(game);
  const automatic = inspectOrder(game, one, "need", "energy");
  assert.equal(automatic.facility?.fixtureId, bed);
  const automaticGame = order(game, one, "need", "energy");
  const preview = restControls(game);
  for (const picker of [preview.rest, preview.policy]) {
    assert.match(
      picker,
      /<option value="mat-1"[^>]*>寝室・敷きむしろ[^<]*一室対策済み<\/option>/,
    );
    assert.match(
      picker,
      /<option value="fixture-1"[^>]*>居間・布張りの寝台[^<]*未対策<\/option>/,
    );
    assert.match(
      picker,
      /<option value="fixture-2"[^>]*>裏庭・敷きむしろ[^<]*屋外・未対策<\/option>/,
    );
  }
  assert.match(preview.detail, /休息先の寒さ対策　未対策/);
  assert.match(
    restControls(game, warmMat).detail,
    /休息先の寒さ対策　一室対策済み/,
  );
  assert.match(
    restControls(game, yardMat).detail,
    /休息先の寒さ対策　屋外・未対策/,
  );
  assert.deepEqual(order(game, one, "need", "energy"), automaticGame);
  assert.equal(
    automaticGame.actors[0].task?.station,
    housingSlotId("living", bed, 0),
  );
  const specified = order(game, one, "home-use", warmMat);
  assert.equal(
    specified.actors[0].task?.station,
    housingSlotId("bedroom", warmMat, 0),
  );
  assert.deepEqual(game, original);
});

test("the forecast follows the available bed when the preferred insulated room is inaccessible", () => {
  const game = setPreferredBed(furnishedHome(), one, warmMat);
  const preferred = restControls(game);
  assert.match(preferred.detail, /休息先の寒さ対策　一室対策済み/);
  const reserved = order(game, two, "home-use", warmMat);
  assert.equal(
    reserved.actors[1].task?.station,
    housingSlotId("bedroom", warmMat, 0),
  );
  const after = inspectOrder(reserved, one, "need", "energy");
  assert.equal(after.facility?.bedPreference?.outcome, "fallback");
  assert.equal(after.facility?.fixtureId, bed);
  const fallback = restControls(reserved).detail;
  assert.match(fallback, /休息先の寒さ対策　未対策/);
  assert.match(fallback, /別の寝床を使う見込み/);
  assert.doesNotMatch(fallback, /休息先の寒さ対策　一室対策済み/);

  const blocked = restControls(reserved, warmMat).detail;
  assert.match(blocked, /予約/);
  assert.doesNotMatch(blocked, /休息先の寒さ対策/);
});

test("whole-home protection also applies to a yard bed; the message changes at the local frost threshold", () => {
  const game = furnishedHome();
  const frost = game.world.sites.find((place) => place.id === game.home)!.frost;
  const early = restControls({ ...game, insulated: true }, yardMat);
  assert.match(early.detail, /休息先の寒さ対策　家全体で対策済み/);
  assert.match(early.detail, new RegExp(`初霜（${frost}日目）から`));
  const frosty = structuredClone(game);
  frosty.time = (frost - 1) * 1440 + 480;
  frosty.housing!.state.time = frosty.time;
  delete frosty.housing!.roomStay;
  const untreated = restControls(frosty, yardMat);
  const covered = restControls({ ...frosty, insulated: true }, yardMat);
  assert.match(untreated.detail, /休息先の寒さ対策　屋外・未対策/);
  assert.match(covered.detail, /休息先の寒さ対策　家全体で対策済み/);
  assert.match(untreated.detail, /初霜を迎えたため/);
  assert.match(covered.detail, /初霜を迎えたため/);
  assert.doesNotMatch(early.detail, /初霜を迎えたため/);
  assert.doesNotMatch(covered.detail, /日目）から/);
});
