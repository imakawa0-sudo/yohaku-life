import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FacilityAction } from "../src/reform/FacilityAction";
import {
  assignFoodHaul,
  createFoodBundle,
  inspectFoodHaul,
  returnFoodBundle,
} from "../src/reform/housing/food";
import { housingLinkId, housingPoint } from "../src/reform/housing/topology";
import {
  advance,
  options,
  order,
  setHousingPassage,
  type Game,
} from "../src/reform/sim";
import { base, ok, one, two } from "./helpers/construction";

const id = "food-bundle-1";
const request = { roomId: "bedroom", storageCell: 2 };
const unexpected = () => assert.fail("render changed game");
function stock() {
  const g = base();
  g.ingredients = 6;
  return g;
}
function picked(g = stock()) {
  return ok(createFoodBundle(g, request));
}
async function panel(g: Game) {
  const { FoodLogisticsPanel } =
    await import("../src/reform/FoodLogisticsPanel");
  const before = JSON.stringify(g);
  const html = renderToStaticMarkup(
    createElement(FoodLogisticsPanel, {
      game: g,
      onGame: unexpected,
    }),
  );
  assert.equal(JSON.stringify(g), before);
  return html;
}
function recipe(
  g: Game,
  selectedBundleId = "",
  selectedId = "",
  target = "cook",
  actorId = one,
) {
  const before = JSON.stringify(g);
  const html = renderToStaticMarkup(
    createElement(FacilityAction, {
      game: g,
      actor: g.actors.find((a) => a.person.id === actorId)!,
      command: options(g, actorId).find(
        (c) => c.kind === "work" && c.target === target,
      )!,
      selectedId,
      selectedBundleId,
      onSelect: unexpected,
      onSelectBundle: unexpected,
      onGame: unexpected,
    }),
  );
  assert.equal(JSON.stringify(g), before);
  return html;
}

test("without a bundle the storage panel distinguishes available food and the missing floor choice", async () => {
  const html = await panel(stock());
  assert.match(html, /共同備蓄の食材 <strong>6<\/strong>/);
  assert.match(html, /現物の一束はありません/);
  assert.match(html, /歩ける保管床を選んでください/);
  const poor = stock();
  poor.ingredients = 1;
  assert.match(await panel(poor), /共同備蓄に食材2が必要/);
});

test("a newly separated bundle remains at the supply point, not the selected storage floor", async () => {
  const html = await panel(picked());
  assert.match(html, /共同備蓄の食材 <strong>4<\/strong>/);
  assert.match(html, /野菜の一束（食材2）/);
  assert.match(html, /供給口.*居間の入口/);
  assert.match(html, /保管先.*寝室・3列1行/);
  assert.match(html, /担当者を選んでください/);
  assert.match(html, /備蓄に戻す<\/button>/);
});

test("haul, storage, cooking and return show the actual location, worker and stage", async () => {
  const start = picked();
  const hauling = advance(
    order(ok(assignFoodHaul(start, id, one, "store")), two, "work", "care"),
    2,
  );
  const inTransit = await panel(hauling);
  assert.match(inTransit, /保管用の一束を運搬中/);
  assert.match(inTransit, /の手元/);
  assert.match(inTransit, /担当を外す/);
  assert.match(inTransit, /完了までの目安.*分/);

  const stored = advance(hauling, 4);
  assert.match(await panel(stored), /保管中/);
  assert.match(await panel(stored), /一束はすでに届け先にあり/);
  const booked = order(stored, one, "work", "cook", {
    fixtureId: "hearth-1",
    bundleId: id,
  });
  assert.match(await panel(booked), /料理用の一束を拾いに移動中/);
  let progressed = booked;
  for (
    let i = 0;
    i < 20 && progressed.actors[0].task?.spatial?.kind !== "use";
    i++
  )
    progressed = advance(progressed, 1);
  assert.match(await panel(progressed), /料理中/);
  assert.match(await panel(progressed), /共同備蓄の食材 <strong>4<\/strong>/);

  const returned = ok(returnFoodBundle(start, id));
  const final = await panel(returned);
  assert.match(final, /返却済み/);
  assert.match(final, /現物の一束はありません/);
  assert.match(final, /共同備蓄の食材 <strong>6<\/strong>/);
  assert.doesNotMatch(final, /担当を外す/);
});

test("a stored bundle explains a blocked return in the resident choice and becomes returnable when the passage reopens", async () => {
  const stored = advance(
    order(ok(assignFoodHaul(picked(), id, one, "store")), two, "work", "care"),
    6,
  );
  const link = housingLinkId("living", "bedroom");
  const closed = setHousingPassage(stored, "link", link, false);
  assert.equal(closed.actors[0].task, null);
  assert.equal(closed.ingredients, 4);
  assert.deepEqual(closed.housing!.state.items["food-material-1"].position, {
    kind: "at",
    point: housingPoint("bedroom", 2),
  });
  assert.match(
    inspectFoodHaul(closed, id, one, "return").disabled!,
    /目的地への通路が通れません/,
  );
  assert.ok(assignFoodHaul(closed, id, one, "return").error);
  const residentChoice = /<option[^>]*value="resident-one"[^>]*>[^<]*<\/option>/;
  const blockedChoice = (await panel(closed)).match(residentChoice)![0];
  assert.match(blockedChoice, /目的地への通路が通れません/);
  assert.doesNotMatch(
    blockedChoice,
    /disabled=/,
    "住人を選んで方向別の理由を読める",
  );

  const reopened = setHousingPassage(closed, "link", link, true);
  assert.equal(inspectFoodHaul(reopened, id, one, "return").ok, true);
  assert.equal(reopened.time, closed.time);
  assert.equal(reopened.ingredients, closed.ingredients);
  const openChoice = (await panel(reopened)).match(residentChoice)![0];
  assert.doesNotMatch(openChoice, /disabled=|目的地への通路が通れません/);
  const returning = ok(assignFoodHaul(reopened, id, one, "return"));
  assert.equal(returning.time, reopened.time);
  assert.equal(returning.ingredients, 4);
});

test("basic cooking never falls back from a stale or unselected physical bundle to free stock", () => {
  const g = picked();
  const unselected = recipe(g, id);
  assert.match(unselected, /設備を選ぶ/);
  assert.match(unselected, /料理に使う設備を指定してください/);
  assert.match(unselected, /<button[^>]*disabled=""/);
  const preview = recipe(g, id, "hearth-1");
  assert.match(preview, /居間の入口/);
  assert.match(preview, /食材を拾い、運ぶ見込み.*分.*料理.*分.*合計/);
  assert.doesNotMatch(preview, /取り置き 食材2|<button[^>]*disabled=""/);
  const stale = recipe(ok(returnFoodBundle(g, id)), id, "hearth-1");
  assert.match(stale, /選んだ食材の一束がありません/);
  assert.match(stale, /<button[^>]*disabled=""/);
  const assigned = ok(assignFoodHaul(g, id, one, "store"));
  assert.match(
    recipe(assigned, id, "hearth-1", "cook", two),
    /すでに担当者が確保/,
  );
  const automatic = recipe(g);
  assert.match(automatic, /共同備蓄/);
  assert.match(automatic, /取り置き 食材2/);
  assert.doesNotMatch(
    recipe(g, id, "hearth-1", "cook:hard"),
    /材料を選ぶ|食材を拾い/,
  );
});
