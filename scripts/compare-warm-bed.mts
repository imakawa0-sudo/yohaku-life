// node --import tsx scripts/compare-warm-bed.mts
// Controlled day-of-frost rest comparisons (not a forecast or climate policy).
import assert from "node:assert/strict";
import { editHouse, initialHouse } from "../src/reform/house.ts";
import {
  createGame,
  enableHousing,
  advance,
  inspectOrder,
  order,
  isGame,
  type Game,
} from "../src/reform/sim.ts";
import {
  defaultWorldConfig,
  generateWorld,
  places,
} from "../src/reform/world.ts";
import { makePersona } from "../src/reform/peopleModel.ts";
import { exportSlot, importSlot } from "../src/reform/library.ts";
import {
  createRoomInsulation,
  homeColdProtection,
} from "../src/reform/housing/insulation.ts";
import {
  assignConstructionBuild,
  assignConstructionHaul,
  reserveConstructionMaterial,
} from "../src/reform/housing/construction.ts";
import { setPreferredBed } from "../src/reform/housing/bedPreference.ts";
import { housingSlotId, housingPoint } from "../src/reform/housing/topology.ts";
import type { ConstructionResult } from "../src/reform/housing/constructionTypes.ts";

function ok(result: ConstructionResult) {
  assert.equal(result.error, undefined);
  return result.game;
}
const coldBed = "fixture-1",
  warmBed = "mat-1";
const sleeper = "person-1",
  peer = "person-2";
function waitFor(g: Game, done: (g: Game) => boolean) {
  const limit = g.time + 180;
  while (!done(g)) {
    assert.ok(g.time < limit);
    g = advance(g, 1);
  }
  return g;
}
function waitPeer(g: Game) {
  if (g.actors[1].task) return g;
  return order(g, peer, "wait");
}
function makeFixture(remote: boolean) {
  let h = editHouse(initialHouse(), {
    type: "build",
    room: "living",
    kind: "mat",
    cell: 1,
  });
  const warmRoom = remote ? "room-2" : "bedroom";
  if (remote) {
    h = editHouse(h, { type: "room", name: "奥の寝室", neighbor: "yard" });
    h = editHouse(h, { type: "move", room: warmRoom, id: warmBed, cell: 10 });
  }
  let g = enableHousing(
    createGame(
      [makePersona(0, 4), makePersona(1, 27)],
      generateWorld({ ...defaultWorldConfig(), climate: "cool" }),
      "forest",
      h,
    ),
    "new",
  );
  const source = g;
  const p = createRoomInsulation(g, { roomId: warmRoom, stagingCell: 2 });
  const id = p.planId!;
  g = ok(
    assignConstructionHaul(
      ok(reserveConstructionMaterial(ok(p), id)),
      id,
      sleeper,
      "deliver",
    ),
  );
  g = waitFor(g, (g) => !g.housing!.construction!.plans[id].assignment);
  g = ok(assignConstructionBuild(g, id, sleeper));
  g = waitFor(
    g,
    (g) => g.housing!.construction!.plans[id].status === "completed",
  );
  // Let the household actually live to the first frost; control the start of
  // the rest trial separately. We are measuring a conditional choice.
  const frostDay = places(g.world).find((p) => p.id === g.home)!.frost;
  const morning = (frostDay - 1) * 1440 + 480;
  g = advance(g, morning - g.time);
  for (const id of [sleeper, peer]) {
    g = order(g, id, "cancel");
    g = waitFor(g, (g) => !g.actors.find((a) => a.person.id === id)!.task);
  }
  // The second resident's wait prevents an autonomous bed reservation during positioning.
  g = waitPeer(g);
  const entry = JSON.stringify({ roomId: "living", cell: 0 });
  g = order(g, sleeper, "home-move", entry);
  while (g.actors[0].task) g = advance(waitPeer(g), 1);
  assert.deepEqual(g.housing!.state.actors[sleeper].position, {
    kind: "at",
    point: housingPoint("living", 0),
  });
  for (const a of g.actors)
    for (const n of Object.keys(a.needs) as (keyof typeof a.needs)[])
      a.needs[n] = 88;
  g.actors[0].needs.energy = 30;
  assert.ok(!g.insulated && isGame(g));
  return {
    save: exportSlot({
      id: "bed-trial",
      name: "検証専用・寝床",
      game: g,
      origin: source,
    }),
    warmRoom,
  };
}
const twoDecimals = (n: number) => Math.round(n * 100) / 100;
function compare(
  fixture: ReturnType<typeof makeFixture>,
  body: "cold" | "ordinary",
  mode: "near" | "warm" | "auto" | "prefer-warm" | "warm-reserved",
) {
  const slot = importSlot(fixture.save);
  let g = slot.game;
  g.actors[0].person.body = body;
  const energized = g.time;
  const automatic =
    mode === "auto" || mode === "prefer-warm" || mode === "warm-reserved";
  if (mode === "prefer-warm" || mode === "warm-reserved")
    g = setPreferredBed(g, sleeper, warmBed);
  if (mode === "warm-reserved") {
    const p = inspectOrder(g, peer, "home-use", warmBed);
    assert.equal(p.disabled, undefined);
    g = order(g, peer, "home-use", warmBed);
    assert.ok(inspectOrder(g, sleeper, "home-use", warmBed).disabled);
  }
  const target = automatic ? "energy" : mode === "near" ? coldBed : warmBed;
  const command = automatic ? "need" : "home-use";
  const forecast = inspectOrder(g, sleeper, command, target);
  assert.ok(forecast.facility && !forecast.disabled);
  const chosen = forecast.facility.fixtureId;
  assert.equal(
    chosen,
    mode === "warm" || mode === "prefer-warm" ? warmBed : coldBed,
  );
  if (mode === "warm-reserved")
    assert.equal(forecast.facility.bedPreference?.outcome, "fallback");
  if (!automatic) g = order(g, sleeper, command, target);
  let warmWalk = 0,
    warmRest = 0,
    coldWalk = 0,
    coldRest = 0;
  function tick() {
    const prev = g;
    g = advance(waitPeer(g), 1);
    const warm = !!homeColdProtection(prev, prev.actors[0]);
    if (g.actors[0].metrics.travel > prev.actors[0].metrics.travel) {
      if (warm) warmWalk++;
      else coldWalk++;
    } else if (g.actors[0].metrics.care > prev.actors[0].metrics.care) {
      if (warm) warmRest++;
      else coldRest++;
    }
  }
  tick();
  assert.equal(g.actors[0].task?.target, "energy");
  assert.equal(g.actors[0].task?.mode, automatic ? "auto" : "direct");
  assert.equal(
    g.actors[0].task!.station,
    housingSlotId(forecast.facility.roomId, chosen, 0),
  );
  while (g.actors[0].task) {
    assert.ok(g.time - energized <= 120);
    tick();
  }
  const elapsed = g.time - energized;
  const energyAtFinish = twoDecimals(g.actors[0].needs.energy);
  assert.equal(elapsed, forecast.minutes);
  assert.equal(warmWalk + coldWalk, forecast.facility.moveMinutes);
  assert.equal(warmRest + coldRest, forecast.facility.useMinutes);
  assert.equal(warmRest + coldRest, 85);
  assert.ok(isGame(g));
  // Stay at each chosen sleeping floor after completion, without allowing
  // another need or autonomous job to confound the common-clock comparison.
  let energyAt97 = g.time === energized + 97 ? g.actors[0].needs.energy : null;
  while (g.time < energized + 110) {
    if (!g.actors[0].task) g = order(g, sleeper, "wait");
    g = advance(waitPeer(g), 1);
    if (g.time === energized + 97) energyAt97 = g.actors[0].needs.energy;
  }
  assert.ok(energyAt97 !== null && isGame(g));
  return {
    startClock: energized % 1440,
    warmRoom: fixture.warmRoom,
    body,
    mode,
    chosen,
    elapsed,
    warmWalk,
    coldWalk,
    warmRest,
    coldRest,
    energyAtFinish,
    energyAt97: twoDecimals(energyAt97),
    energyAt110: twoDecimals(g.actors[0].needs.energy),
  };
}
const fixtures = [makeFixture(false), makeFixture(true)];
const runs = fixtures.flatMap((f) =>
  (["cold", "ordinary"] as const).flatMap((b) =>
    (["near", "warm", "auto", "prefer-warm", "warm-reserved"] as const).map(
      (m) => compare(f, b, m),
    ),
  ),
);
console.log(
  JSON.stringify({ startEnergy: 30, matchedMinutes: [97, 110], runs }, null, 2),
);
