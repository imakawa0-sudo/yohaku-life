import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DayTripRoutes } from "../src/components/RegionPanel.tsx";
import { createGame, command, deserialize, serialize } from "../src/game/engine.ts";
import { getLocationScene, getLocationSummary } from "../src/game/content.ts";
import { getPresentEncounterAt, SECOND_ENCOUNTER_RULE } from "../src/game/encounters.ts";
import { ensureInventory } from "../src/game/inventory.ts";
import { decideAutonomy } from "../src/game/autonomy.ts";
import { previewTripSupplies } from "../src/game/trip-supplies.ts";
import { deriveAttention } from "../src/game/presentation.ts";
import { inspectSleep } from "../src/game/overnight.ts";
import { inspectRegionInteraction, regionHarvest } from "../src/game/region.ts";
import { validRoster } from "../src/game/recruitment.ts";
import type { GameState } from "../src/game/types.ts";

const person = (s: GameState, id: string) => s.residents.find(r => r.id === id)!;
const sceneText = (s: GameState, location: "ridge" | "ruins") => {
  const scene = getLocationScene(s, location);
  return [scene.title, ...scene.paragraphs, scene.detail].join(" ");
};

/** Controlled unit projection, not an actual UI or public-command play fixture.
 * Core owns the approach/intro causal tests. Here a real first agreement and a
 * typed local second encounter isolate the generic readers and location gates.
 */
function localSecond(agreed = true): GameState {
  let s = createGame(519);
  if (agreed) {
    person(s, "aki").location = "ruins";
    ensureInventory(s).packs.aki.food = 3;
    const result = command(s, { type: "guard-agreement", residentIds: ["aki"] });
    assert.equal(result.error, undefined);
    s = result.state;
  }
  person(s, "mio").location = "ridge";
  const logId = s.nextId++;
  s.version = 4;
  s.secondaryEncounter = { version: 1, hp: SECOND_ENCOUNTER_RULE.maxHp, defeated: false,
    introducedAt: s.minutes, actorId: "mio", logId };
  s.logs.push({ id: logId, time: s.minutes, type: "explore", title: "尾根で相手と出会った",
    text: "ミオが尾根の相手と対峙した。", actors: ["mio"], witnesses: ["mio"],
    encounter: { id: SECOND_ENCOUNTER_RULE.id, location: SECOND_ENCOUNTER_RULE.location } });
  return s;
}

test("A first agreement never describes the active ridge opponent as absent or the ridge as a cache", () => {
  const s = localSecond();
  const before = serialize(s);
  assert.match(getLocationSummary(s, "ridge"), /尾根の見張り.*立っている/);
  assert.match(sceneText(s, "ridge"), /尾根の見張り.*踏み跡/);
  assert.doesNotMatch(sceneText(s, "ridge"), /食事を受け取|見張りの姿はない|物資を回収/);
  assert.match(sceneText(s, "ruins"), /食事を受け取り.*立ち去った/);
  assert.match(deriveAttention(s).find(x => x.kind === "combat" && x.residentId === "mio")!.title, /尾根の見張り/);
  assert.equal(serialize(s), before, "All projections remain pure and do not introduce an encounter or history");
});

test("A defeated ridge encounter has its own local copy while the first agreement and cache remain independent", () => {
  const s = localSecond();
  const agreement = structuredClone(s.guardAgreement);
  s.secondaryEncounter!.hp = SECOND_ENCOUNTER_RULE.retreatHp;
  s.secondaryEncounter!.defeated = true;
  const before = serialize(s);
  assert.match(getLocationSummary(s, "ridge"), /尾根の見張りは退いた/);
  assert.match(sceneText(s, "ridge"), /尾根の見張りは踏み跡を離れた/);
  assert.doesNotMatch(sceneText(s, "ridge"), /食事を受け取|物資を回収/);
  assert.equal(getPresentEncounterAt(s, "ridge"), undefined);
  assert.equal(s.flags.suppliesRecovered, false);
  assert.deepEqual(s.guardAgreement, agreement);
  assert.equal(serialize(s), before);
});

test("The same short route can show first agreement and second danger without warning on the safe river route", () => {
  const s = localSecond();
  person(s, "aki").location = "village";
  const before = serialize(s);
  const html = renderToStaticMarkup(createElement(DayTripRoutes, {
    game: s, selectedIds: ["aki"], onCommand: () => true,
  }));
  const choices = html.match(/<div class="route-choice">[\s\S]*?<\/div>/g)!;
  const safe = choices.find(x => x.includes("川沿いの道"))!;
  const short = choices.find(x => x.includes("資材置き場を通る近道"))!;
  assert.match(short, /守り手は食事を受け取り立ち去っています/);
  assert.match(short, /尾根の見張りのいる場所を通ります。遭遇に注意/);
  assert.doesNotMatch(safe, /尾根の見張り|遭遇に注意/);
  assert.equal(serialize(s), before);
});

test("Food and hunger projections use the ridge opponent HP, even when the first guard HP is zero", () => {
  const s = localSecond(false);
  s.enemy.hp = 0;
  const mio = person(s, "mio");
  mio.hunger = 20;
  ensureInventory(s).packs.mio.food = 1;
  mio.action = { id: s.nextId++, kind: "eat", label: "食事をとる", progress: 0, duration: 15,
    origin: "ridge", reserved: { food: 1 }, reservationSource: "pack" };
  const before = serialize(s);
  const view = previewTripSupplies(s, ["mio"], s.minutes + 60, { estimateReturnMinutes: () => 41 });
  assert.equal(view.people[0].activeMealCredit, false);
  assert.equal(view.people[0].returnMinutes, undefined);
  assert.match(view.people[0].warnings.join(" "), /交戦/);
  assert.match(deriveAttention(s).find(x => x.kind === "hunger" && x.residentId === "mio")!.detail, /交戦/);
  const idle = structuredClone(s);
  person(idle, "mio").action = null;
  assert.equal(decideAutonomy(idle, "mio", () => 41, { food: 1, ingredients: 0, medicine: 0, scrap: 0 }), undefined);
  assert.equal(serialize(s), before);
});

test("Legacy zero-HP first guards retain the different caller HP gates without introducing a second encounter", () => {
  const s = createGame(520);
  const mio = person(s, "mio");
  mio.location = "village";
  mio.hunger = 20;
  s.enemy.location = "village";
  s.enemy.hp = 0;
  const before = serialize(s);
  assert.equal(inspectSleep(s, "mio").error, undefined, "Sleep historically requires a physically positive enemy HP");
  assert.equal(inspectRegionInteraction(s, "mio", "village-trader", "talk").error, undefined);
  assert.equal(decideAutonomy(s, "mio", () => 51, { food: 1, ingredients: 0, medicine: 0, scrap: 0 }), undefined,
    "Outdoor autonomy historically treats a present zero-HP legacy guard as unsafe");
  assert.equal(s.secondaryEncounter, undefined);
  assert.equal(serialize(s), before);
});

test("A ridge encounter does not close village interactions or the existing meadow harvest", () => {
  const s = localSecond();
  person(s, "aki").location = "village";
  assert.equal(inspectRegionInteraction(s, "aki", "village-trader", "talk").error, undefined);
  person(s, "aki").location = "meadow";
  const second = structuredClone(s.secondaryEncounter);
  assert.equal(regionHarvest(s, "aki").error, undefined);
  assert.deepEqual(s.secondaryEncounter, second);
  assert.equal(s.flags.suppliesRecovered, false);
});

test("A legitimate joined household remains valid in format4 without weakening membership proof", () => {
  let s = localSecond(false);
  person(s, "aki").location = "village";
  ensureInventory(s).packs.aki.food = 3;
  for (const choice of ["talk", "deliver"] as const) {
    const result = command(s, { type: "region", residentId: "aki", npcId: "village-guide", choice });
    assert.equal(result.error, undefined);
    s = result.state;
  }
  const result = command(s, { type: "recruit", residentId: "aki", npcId: "village-guide" });
  assert.equal(result.error, undefined);
  s = result.state;
  assert.equal(s.version, 4);
  assert.equal(s.residents.length, 4);
  assert.equal(validRoster(s), true);
  assert.equal(serialize(deserialize(serialize(s))), serialize(s), "A format4 joined save roundtrips without dropping the second encounter or membership");
  const forged = structuredClone(s);
  person(forged, "village-guide").joinedLogId!--;
  assert.equal(validRoster(forged), false, "Format4 still requires the exact old joining log and receipt proof");
  assert.throws(() => deserialize(serialize(forged)), /不正/);
  const oldFormat = structuredClone(s);
  oldFormat.version = 2;
  assert.equal(validRoster(oldFormat), false, "Formats1/2 do not gain permission for invented joined residents");
});
