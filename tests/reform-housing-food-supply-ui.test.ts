import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FoodLogisticsPanel } from "../src/reform/FoodLogisticsPanel";
import { FacilityAction } from "../src/reform/FacilityAction";
import {
  assignFoodHaul,
  createFoodBundle,
  presentFood,
} from "../src/reform/housing/food";
import {
  foodBundleStatus,
  foodTaskMinutes,
} from "../src/reform/housing/foodPresentation";
import {
  clearFoodSupply,
  inspectFoodSupply,
  setFoodSupply,
  setFoodSupplyEnabled,
} from "../src/reform/housing/foodSupply";
import { editHouse } from "../src/reform/house";
import { housingLinkId, housingPoint } from "../src/reform/housing/topology";
import {
  advance,
  enableHousing,
  isGame,
  options,
  order,
  setHousingPassage,
  setHousingRoomAccess,
  type Game,
} from "../src/reform/sim";
import { base, ok, one, two } from "./helpers/construction";

const request = { actorId: one, roomId: "bedroom", storageCell: 2 };
const unexpected = () => assert.fail("render changed game");
function stock() {
  const g = base();
  g.actors[0].person.name = "アオ";
  g.actors[1].person.name = "ミドリ";
  g.ingredients = 6;
  g.food = 10;
  // Keep the other worker from making a separate autonomous reservation.
  return order(g, two, "work", "care");
}
const configured = (g = stock()) => ok(setFoodSupply(g, request));
function panel(g: Game) {
  const before = structuredClone(g);
  const html = renderToStaticMarkup(
    createElement(FoodLogisticsPanel, {
      game: g,
      onGame: unexpected,
    }),
  );
  assert.deepEqual(g, before);
  return html;
}
function supplyRegion(html: string) {
  const region = html.match(
    /<section[^>]*aria-label="一束の補充を任せる"[^>]*>[\s\S]*?<\/section>/,
  );
  assert.ok(region, "補充担当の領域がある");
  return region[0];
}
function select(html: string, label: string) {
  const match = html.match(
    new RegExp(
      `<label[^>]*>${label}<select[^>]*>[\\s\\S]*?<\\/select><\\/label>`,
    ),
  );
  assert.ok(match, `${label} の選択欄がある`);
  return match[0];
}
function button(html: string, label: string) {
  const match = html.match(new RegExp(`<button[^>]*>${label}<\\/button>`));
  assert.ok(match, `${label} の操作がある`);
  return match[0];
}
function assertDetail(g: Game, html: string) {
  assert.ok(html.includes(inspectFoodSupply(g).detail));
  assert.doesNotMatch(
    html.replace(/<[^>]*>/g, ""),
    /resident-one|resident-two|food-bundle-|food-material-|\b(?:unset|paused|hauling|stocked|waiting|ready)\b/,
  );
}

test("unset policy renders named choices while preserving manual separation and shared stock cooking", () => {
  const g = stock();
  const html = panel(g);
  const region = supplyRegion(html);
  assertDetail(g, region);
  assert.match(region, /<h3>一束の補充を任せる<\/h3>/);
  for (const label of ["補充担当", "補充先の部屋", "補充先の床"])
    select(region, label);
  assert.match(button(region, "この担当で補充する"), /disabled=""/);
  assert.doesNotMatch(
    region,
    /補充を一時停止<\/button>|補充を再開<\/button>|補充担当を解除<\/button>/,
  );
  assert.match(html, /共同備蓄の食材 <strong>6<\/strong>/);
  assert.match(html, /野菜の一束を取り分ける<\/button>/);
  const recipe = renderToStaticMarkup(
    createElement(FacilityAction, {
      game: g,
      actor: g.actors[0],
      command: options(g, one).find(
        (c) => c.kind === "work" && c.target === "cook",
      )!,
      selectedId: "hearth-1",
      selectedBundleId: "",
      onSelect: unexpected,
      onSelectBundle: unexpected,
      onGame: unexpected,
    }),
  );
  assert.match(recipe, /共同備蓄/);
  assert.match(recipe, /取り置き 食材2/);
});

test("saved ready policy shows resident, floor, state, selected form values, and conditional preview", () => {
  const g = configured();
  assert.equal(inspectFoodSupply(g).state, "ready");
  const region = supplyRegion(panel(g));
  assertDetail(g, region);
  assert.match(region, /今の条件なら補充を始められます。/);
  assert.match(region, /継続中/);
  assert.match(region, /寝室・3列1行/);
  assert.ok(region.includes(g.actors[0].person.name));
  assert.match(
    select(region, "補充担当"),
    /<option[^>]*value="resident-one"[^>]*selected=""/,
  );
  assert.match(
    select(region, "補充先の部屋"),
    /<option[^>]*value="bedroom"[^>]*selected=""/,
  );
  assert.match(
    select(region, "補充先の床"),
    /<option[^>]*value="2"[^>]*selected=""/,
  );
  assert.doesNotMatch(button(region, "この担当で補充する"), /disabled=""/);
  button(region, "補充を一時停止");
  button(region, "補充担当を解除");
  assert.match(region, /完了までの目安.*分/);
});

test("busy and away residents can remain selected as future supply workers", () => {
  const busy = order(stock(), one, "wait");
  const trip = order(stock(), one, "travel", "landing");
  const away = advance(trip, trip.actors[0].task!.remaining);
  assert.notEqual(away.actors[0].location, away.home);
  for (const [g, reason] of [
    [busy, /手が空く/],
    [away, /帰宅/],
  ] as const) {
    const pending = configured(g);
    const region = supplyRegion(panel(pending));
    assertDetail(pending, region);
    assert.equal(inspectFoodSupply(pending).state, "waiting");
    assert.match(region, reason);
    const resident = select(region, "補充担当").match(
      /<option[^>]*value="resident-one"[^>]*>/,
    )![0];
    assert.match(resident, /selected=""/);
    assert.doesNotMatch(resident, /disabled=/);
    assert.doesNotMatch(button(region, "この担当で補充する"), /disabled=""/);
  }
});

test("blocked route and insufficient ingredients display engine waiting reasons without claiming work started", () => {
  const blocked = setHousingPassage(
    configured(),
    "link",
    housingLinkId("living", "bedroom"),
    false,
  );
  const poor = { ...configured(), ingredients: 1 };
  for (const g of [blocked, poor]) {
    const region = supplyRegion(panel(g));
    assert.equal(inspectFoodSupply(g).state, "waiting");
    assertDetail(g, region);
    assert.doesNotMatch(region, /今の条件なら補充を始められます。/);
  }
});

test("paused or cleared policy does not hide a live physical haul, and auto cancellation explains the pause", () => {
  const hauling = advance(configured(), 1);
  assert.equal(inspectFoodSupply(hauling).state, "hauling");
  const active = panel(hauling);
  const region = supplyRegion(active);
  assertDetail(hauling, region);
  assert.match(region, /一束を保管床へ運搬中/);
  assert.match(region, /一時停止.*解除.*進行中の運搬.*終え/);
  assert.match(active, /担当を外す<\/button>.*補充方針も一時停止/);
  const paused = ok(setFoodSupplyEnabled(hauling, false));
  const pausedHtml = panel(paused);
  const pausedRegion = supplyRegion(pausedHtml);
  assertDetail(paused, pausedRegion);
  assert.match(pausedRegion, /一時停止/);
  button(pausedRegion, "補充を再開");
  button(pausedRegion, "補充担当を解除");
  assert.doesNotMatch(pausedRegion, /補充を一時停止<\/button>/);
  assert.match(pausedHtml, /担当を外す<\/button>/);
  const cleared = ok(clearFoodSupply(hauling));
  assertDetail(cleared, supplyRegion(panel(cleared)));
  assert.match(panel(cleared), /担当を外す<\/button>/);
});

test("stored and separately assigned manual bundles keep their actual status distinct from the policy", () => {
  const hauling = advance(configured(), 1);
  const stored = advance(hauling, foodTaskMinutes(hauling, one)!);
  const region = supplyRegion(panel(stored));
  assert.equal(inspectFoodSupply(stored).state, "stocked");
  assertDetail(stored, region);
  assert.match(region, /保管床に一束あります/);
  const manual = ok(
    assignFoodHaul(
      order(ok(createFoodBundle(configured(), request)), two, "cancel"),
      "food-bundle-1",
      two,
      "store",
    ),
  );
  const html = panel(manual);
  assertDetail(manual, supplyRegion(html));
  assert.equal(inspectFoodSupply(manual).state, "waiting");
  assert.ok(
    html.includes(`<dt>担当</dt><dd>${manual.actors[1].person.name}</dd>`),
  );
  assert.ok(supplyRegion(html).includes(manual.actors[0].person.name));
  assert.doesNotMatch(
    html,
    /担当を外す<\/button><small[^>]*>[^<]*補充方針も一時停止/,
  );
});

for (const reason of ["permission revoked", "cancel then resume"] as const) {
  test(`interrupted supply waits for safe exit without a delivery forecast: ${reason}`, () => {
    const moving = advance(configured(), 2);
    const closing =
      reason === "permission revoked"
        ? setHousingRoomAccess(moving, "bedroom", [])
        : ok(setFoodSupplyEnabled(order(moving, one, "cancel"), true));
    assert.ok(isGame(closing));
    assert.equal(
      closing.housing!.state.actors[one].order?.phase,
      "exiting-after-cancel",
    );
    const html = panel(closing);
    const region = supplyRegion(html);
    const before = inspectFoodSupply(closing);
    assert.equal(before.state, "waiting");
    assert.equal(before.minutes, null);
    assert.match(region, /区間.*出.*待/);
    assert.doesNotMatch(region, /一束を保管床へ運搬中|完了までの目安/);
    assert.match(html, /区間を出て担当を解除/);
    assert.match(html, /<dt>区間を出るまで<\/dt><dd>2分<\/dd>/);

    const id = presentFood(closing.housing)!.id;
    const dropped = advance(closing, 2);
    const bundle = presentFood(dropped.housing)!;
    assert.equal(bundle.id, id);
    assert.equal(bundle.assignment, undefined);
    assert.deepEqual(dropped.housing!.state.items[bundle.itemId].position, {
      kind: "at",
      point: housingPoint("bedroom", 0),
    });
    assert.equal(dropped.ingredients, 4);
    assert.ok(isGame(dropped));

    const accessible =
      reason === "permission revoked"
        ? setHousingRoomAccess(dropped, "bedroom", [one, two])
        : dropped;
    const retry = advance(accessible, 1);
    assert.equal(presentFood(retry.housing)!.id, id);
    assert.equal(presentFood(retry.housing)!.assignment?.actorId, one);
    assert.equal(inspectFoodSupply(retry).state, "hauling");
    const stored = advance(retry, foodTaskMinutes(retry, one)!);
    assert.equal(inspectFoodSupply(stored).state, "stocked");
    assert.equal(stored.ingredients, 4);
    assert.equal(presentFood(stored.housing)!.id, id);
    assert.ok(isGame(stored));
  });
}

function sameNames() {
  const g = base();
  g.actors.forEach((a) => {
    a.person.name = "スイ";
  });
  g.food = 10;
  g.ingredients = 6;
  // Build the duplicate room in the initial house, before spatial activation.
  delete g.housing;
  g.house = editHouse(g.house, {
    type: "room",
    name: "寝室",
    neighbor: "living",
  });
  const seeded = enableHousing(g, "new");
  assert.ok(isGame(seeded));
  return ok(setFoodSupply(seeded, { ...request, roomId: "room-1" }));
}

test("colliding room and resident names distinguish manual and policy selections and saved destination", () => {
  const g = sameNames();
  const html = panel(g);
  const region = supplyRegion(html);
  assert.match(
    select(region, "補充担当"),
    /value="resident-one" selected="">スイ（同名の1人目）<\/option>/,
  );
  assert.match(
    select(region, "補充担当"),
    /value="resident-two">スイ（同名の2人目）<\/option>/,
  );
  assert.ok(
    region.includes("<dt>設定中の担当</dt><dd>スイ（同名の1人目）</dd>"),
  );
  assert.ok(
    region.includes("<dt>補充先</dt><dd>寝室（同名の2室目）・3列1行</dd>"),
  );
  for (const choices of [
    select(html, "保管する部屋"),
    select(region, "補充先の部屋"),
  ]) {
    assert.match(choices, /value="bedroom">寝室（同名の1室目）<\/option>/);
    assert.match(
      choices,
      /value="room-1"(?: selected="")?>寝室（同名の2室目）<\/option>/,
    );
    assert.match(choices, /value="living">居間<\/option>/);
  }
  const made = ok(createFoodBundle(g, request));
  const manual = select(panel(made), "運搬担当");
  assert.match(manual, /value="resident-one">スイ（同名の1人目）<\/option>/);
  assert.match(manual, /value="resident-two">スイ（同名の2人目）<\/option>/);
});

test("colliding names distinguish configured worker and actual carrier, and both same-name destinations", () => {
  const g = ok(createFoodBundle(sameNames(), request));
  const hauling = advance(
    ok(assignFoodHaul(g, "food-bundle-1", two, "store")),
    2,
  );
  assert.ok(isGame(hauling));
  const html = panel(hauling);
  const region = supplyRegion(html);
  assert.ok(
    region.includes("<dt>設定中の担当</dt><dd>スイ（同名の1人目）</dd>"),
  );
  assert.ok(
    region.includes("<dt>補充先</dt><dd>寝室（同名の2室目）・3列1行</dd>"),
  );
  assert.ok(html.includes("<dt>担当</dt><dd>スイ（同名の2人目）</dd>"));
  assert.ok(
    html.includes("<dt>保管先</dt><dd>寝室（同名の1室目）・3列1行</dd>"),
  );
  assert.match(html, /スイ（同名の2人目）の手元（.*寝室（同名の1室目）の入口/);
  assert.match(
    select(region, "補充担当"),
    /value="resident-two">スイ（同名の2人目）・行動中<\/option>/,
  );
  const stored = advance(hauling, foodTaskMinutes(hauling, two)!);
  assert.equal(
    foodBundleStatus(stored)?.location,
    "寝室（同名の1室目）・3列1行",
  );
  assert.ok(
    panel(stored).includes(
      "<dt>現在地</dt><dd>寝室（同名の1室目）・3列1行</dd>",
    ),
  );
});
