import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Landscape, describeLandscape } from "../src/components/Landscape.tsx";
import { createGame, LOCATIONS, serialize } from "../src/game/engine.ts";
import { getLocationScene, getLocationSummary, LOCATION_SCENES } from "../src/game/content.ts";
import { regionHarvest, regionNPCsAt } from "../src/game/region.ts";
import { isOutdoorQuiet, isSceneryLocation, sceneryName } from "../src/game/scenery.ts";
import type { GameState, LocationId } from "../src/game/types.ts";

const REGION_PLACES = ["village", "meadow", "ridge"] as const;
function svg(state: GameState, place: LocationId) {
  return renderToStaticMarkup(createElement(Landscape, {
    game: state, resident: state.residents[0], location: place,
  }));
}
function artwork(markup: string) {
  return markup.replace(/<title\b[^>]*>[\s\S]*?<\/title>/g, "")
    .replace(/<desc\b[^>]*>[\s\S]*?<\/desc>/g, "")
    .replace(/\s(?:aria-[\w-]+|data-[\w-]+)="[^"]*"/g, "");
}

test("The three regional places have different illustrations and actual accessible place names", () => {
  const world = createGame(428);
  const drawings = new Set<string>();
  for (const place of REGION_PLACES) {
    world.residents[0].location = place;
    const before = serialize(world);
    const image = svg(world, place);
    assert.match(image, /role="img"/);
    assert.ok(image.includes(LOCATIONS[place].name));
    assert.equal(describeLandscape(world, world.residents[0], place).locationLabel, LOCATIONS[place].name);
    drawings.add(artwork(image));
    const scene = getLocationScene(world, place);
    scene.paragraphs.push("A caller cannot rewrite the location.");
    assert.equal(LOCATION_SCENES[place].paragraphs.length, 2);
    assert.equal(serialize(world), before);
  }
  assert.equal(drawings.size, 3, "The place itself changes, not only the caption");
});

test("Village neighbours are depicted only in their actual place and opening hours", () => {
  const world = createGame(428);
  world.residents[0].location = "village";
  world.residents[1].location = "meadow";
  world.residents[2].location = "home";
  const open = svg(world, "village");
  assert.match(open, /present-region-neighbours/);
  for (const person of regionNPCsAt(world, "village")) assert.ok(open.includes(person.name));
  assert.doesNotMatch(open, /ミオ|レン/);
  assert.doesNotMatch(svg(world, "meadow"), /present-region-neighbours/);
  world.minutes = 18 * 60;
  const before = serialize(world);
  const closed = svg(world, "village");
  assert.doesNotMatch(closed, /present-region-neighbours/);
  assert.match(getLocationScene(world, "village").detail, /店じまい/);
  assert.match(getLocationSummary(world, "village"), /08:00〜18:00/);
  assert.equal(serialize(world), before, "Checking hours never advances or creates a world fact");
});

test("Meadow depletion changes copy and artwork only after a harvest and becomes available the next day", () => {
  const world = createGame(428);
  world.residents[0].location = "meadow";
  const growing = artwork(svg(world, "meadow"));
  assert.match(getLocationSummary(world, "meadow"), /採集できる/);
  const harvested = regionHarvest(world, "aki");
  assert.equal(harvested.error, undefined);
  const before = serialize(world);
  assert.match(getLocationScene(world, "meadow").detail, /今日の採集は終了/);
  assert.match(describeLandscape(world, world.residents[0]).description, /今日の採集はひと区切り/);
  assert.notEqual(artwork(svg(world, "meadow")), growing);
  assert.equal(serialize(world), before);
  world.minutes += 1440;
  assert.match(getLocationSummary(world, "meadow"), /採集できる/);
  assert.equal(artwork(svg(world, "meadow")), growing);
});

test("A displaced guard is described at the real regional place without inventing a local threat elsewhere", () => {
  const world = createGame(428);
  world.residents[0].location = "meadow";
  world.enemy.location = "meadow";
  for (const read of [getLocationSummary(world, "meadow"), getLocationScene(world, "meadow").detail])
    assert.match(read, /流れ者|相手がいる/);
  assert.match(svg(world, "meadow"), /guard-present/);
  assert.doesNotMatch(svg(world, "village"), /guard-present/);
  world.enemy.defeated = true;
  assert.doesNotMatch(getLocationSummary(world, "meadow"), /流れ者/);
  assert.doesNotMatch(svg(world, "meadow"), /guard-present/);
});

test("New quiet places keep their exact identity as possible remembered scenery", () => {
  for (const place of REGION_PLACES) {
    assert.equal(isSceneryLocation(place), true);
    assert.equal(sceneryName(place), LOCATIONS[place].name);
    assert.equal(isOutdoorQuiet({ kind: "quiet", location: place }), true);
    assert.equal(isOutdoorQuiet({ kind: "supply", location: place }), false);
  }
  assert.equal(isOutdoorQuiet({ kind: "quiet", location: "home" }), false);
});

test("Regional art follows the existing day and night palette without leaking absent residents", () => {
  const world = createGame(428);
  world.residents[0].location = "ridge";
  const morning = artwork(svg(world, "ridge"));
  const daytimeText = describeLandscape(world, world.residents[0]).description;
  assert.match(daytimeText, /アキ/);
  assert.doesNotMatch(daytimeText, /ここにいる住民：[^。]*(ミオ|レン)/);
  world.minutes = 22 * 60;
  const before = serialize(world);
  assert.notEqual(artwork(svg(world, "ridge")), morning);
  assert.equal(describeLandscape(world, world.residents[0]).period, "night");
  assert.equal(serialize(world), before);
});

test("Upper river scenery shows only the local harvest and stock, and remembers the reedbank view", () => {
  const world = createGame(650);
  const actor = world.residents[0];
  actor.location = "reedbank";
  assert.match(svg(world, "reedbank"), /reedbank-driftwood/);
  assert.match(getLocationSummary(world, "reedbank"), /採集できる/);
  assert.equal(sceneryName("reedbank"), LOCATIONS.reedbank.name);
  assert.equal(regionHarvest(world, actor.id).error, undefined);
  assert.doesNotMatch(svg(world, "reedbank"), /reedbank-driftwood/);
  assert.match(getLocationScene(world, "reedbank").detail, /今日の採集は終了/);
  assert.match(getLocationSummary(world, "meadow"), /採集できる/);
  actor.location = "lodge";
  world.inventory!.ground.lodge = { food: 2, ingredients: 1, medicine: 0, scrap: 3 };
  const before = serialize(world);
  assert.match(svg(world, "lodge"), /boathouse-workshop/);
  assert.match(describeLandscape(world, actor).description, /舟宿の物置：食事2食・食材1個/);
  assert.equal(serialize(world), before);
});
