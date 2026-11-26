// node --import tsx scripts/compare-insulation-investment.mts
// Starting in an ordinary generated home, advance uninterrupted through frost.
// Room minutes count the start side of crossings, exactly as cold protection.
import assert from "node:assert/strict";
import { initialHouse } from "../src/reform/house.ts";
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
import {
  housingRoomId,
  housingSourcePoint,
} from "../src/reform/housing/topology.ts";

const people = [makePersona(0, 4), makePersona(1, 27)];
const start = enableHousing(
  createGame(
    people,
    generateWorld({ ...defaultWorldConfig(), climate: "cool" }),
    "forest",
    initialHouse(),
  ),
  "new",
);
const frost = places(start.world).find((p) => p.id === start.home)!.frost;
const frostTime = (frost - 1) * 1440;
const installer = start.actors[0].person.id;
const stock = (g: Game) => ({
  wood: g.wood,
  food: g.food,
  ingredients: g.ingredients,
  coins: g.coins,
});
const save = (game: Game) =>
  exportSlot({
    id: "frost-study",
    name: "検証専用・初霜",
    game,
    origin: start,
  });
function tally(g: Game) {
  return g.actors.map(() => ({
    rooms: {} as Record<string, number>,
    protected: 0,
    rest: 0,
    work: 0,
    care: 0,
    travel: 0,
    free: 0,
    waiting: 0,
    lowEnergy: 0,
  }));
}
function observe(before: Game, after: Game, totals: ReturnType<typeof tally>) {
  for (const [i, a] of before.actors.entries()) {
    const b = after.actors[i],
      t = totals[i];
    const actor = before.housing!.state.actors[a.person.id];
    const pos = actor && housingSourcePoint(actor);
    const room =
      a.location === before.home &&
      !before.housing!.unlocated[a.person.id] &&
      pos
        ? housingRoomId(pos.domainId)!
        : "outside-or-unlocated";
    t.rooms[room] = (t.rooms[room] ?? 0) + 1;
    if (homeColdProtection(before, a)) t.protected++;
    for (const m of ["work", "care", "travel", "free", "waiting"] as const)
      t[m] += b.metrics[m] - a.metrics[m];
    const task = a.task ?? b.task;
    if (task?.kind === "need" && task.target === "energy")
      t.rest += b.metrics.care - a.metrics.care;
    if (a.needs.energy < 42) t.lowEnergy++;
  }
}
function measure(g: Game, minutes: number) {
  const totals = tally(g);
  for (let n = 0; n < minutes; n++) {
    const next = advance(g, 1);
    observe(g, next, totals);
    g = next;
  }
  for (const t of totals) {
    assert.equal(
      Object.values(t.rooms).reduce((a, b) => a + b, 0),
      minutes,
    );
    assert.equal(t.work + t.care + t.travel + t.free + t.waiting, minutes);
  }
  assert.ok(isGame(g));
  return { game: g, totals };
}
// Actual life starts day 1 08:00. Inspect the day before making the decision.
const startOfSurvey = frostTime - 1440 * 2 + 480;
const survey = measure(advance(start, startOfSurvey - start.time), 1440);
let fork = survey.game;
while (fork.actors[0].task) {
  assert.ok(fork.time - survey.game.time < 240);
  fork = advance(fork, 1);
}
assert.ok(isGame(fork));
const forkSave = save(fork);
const modes = ["none", "living", "bedroom", "whole"] as const;
function run(mode: (typeof modes)[number]) {
  let g = importSlot(forkSave).game;
  let commands = 0,
    woodCost = 0,
    construction = 0,
    haul = 0;
  if (mode === "whole") {
    const preview = inspectOrder(g, installer, "work", "wood:master");
    if (preview.disabled) return { mode, unavailable: preview.disabled };
    g = order(g, installer, "work", "wood:master");
    commands++;
    woodCost = fork.wood - g.wood;
    while (g.actors[0].task) {
      assert.ok(g.time - fork.time < 180);
      g = advance(g, 1);
    }
    construction = g.time - fork.time;
    if (!g.insulated)
      return { mode, failure: g.actors[0].reason, woodCost, construction };
  } else if (mode !== "none") {
    const project = createRoomInsulation(g, { roomId: mode, stagingCell: 2 });
    assert.equal(project.error, undefined);
    const id = project.planId!;
    const reserved = reserveConstructionMaterial(project.game, id);
    assert.equal(reserved.error, undefined);
    woodCost = g.wood - reserved.game.wood;
    const assigned = assignConstructionHaul(
      reserved.game,
      id,
      installer,
      "deliver",
    );
    assert.equal(assigned.error, undefined);
    g = assigned.game;
    while (g.housing!.construction!.plans[id].assignment) {
      assert.ok(g.time - fork.time < 100);
      g = advance(g, 1);
    }
    haul = g.time - fork.time;
    const build = assignConstructionBuild(g, id, installer);
    assert.equal(build.error, undefined);
    g = build.game;
    while (g.housing!.construction!.plans[id].status !== "completed") {
      assert.ok(g.time - fork.time - haul <= 30);
      g = advance(g, 1);
    }
    construction = g.time - fork.time - haul;
    commands = 4;
    assert.equal(woodCost, 1);
    assert.equal(construction, 30);
  }
  const warmup = advance(g, frostTime - g.time);
  assert.equal(warmup.time, frostTime);
  const cold = measure(warmup, 1440 * 3);
  assert.equal(cold.game.time, frostTime + 3 * 1440);
  for (const resident of cold.totals) {
    const expected =
      mode === "whole"
        ? 3 * 1440
        : mode === "none"
          ? 0
          : (resident.rooms[mode] ?? 0);
    assert.equal(resident.protected, expected);
  }
  assert.deepEqual(
    JSON.parse(save(cold.game)),
    JSON.parse(save(advance(importSlot(save(warmup)).game, 3 * 1440))),
  );
  return {
    mode,
    commands,
    woodCost,
    haul,
    construction,
    atFrost: stock(warmup),
    postFrost: cold.totals,
    ends: stock(cold.game),
    energy: cold.game.actors.map((a) => Math.round(a.needs.energy * 10) / 10),
  };
}
console.log(
  JSON.stringify(
    {
      world: start.world.config,
      people: people.map((p) => ({
        id: p.id,
        name: p.name,
        body: p.body,
        likes: p.likes,
      })),
      frostDay: frost,
      forkDay: Math.floor(fork.time / 1440) + 1,
      forkTime: fork.time % 1440,
      forkStock: stock(fork),
      forkSkill: fork.actors[0].person.skills.wood,
      preSurvey: survey.totals,
      runs: modes.map(run),
    },
    null,
    2,
  ),
);
