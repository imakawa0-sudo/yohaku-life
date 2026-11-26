// Reproducible, artificial two-person comparison (no player saves).
// node --import tsx scripts/compare-food-supply.mts [output-directory]
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { editHouse, initialHouse, isHouse } from "../src/reform/house.ts";
import { makePersona } from "../src/reform/peopleModel.ts";
import { generateWorld, defaultWorldConfig } from "../src/reform/world.ts";
import {
  createGame,
  enableHousing,
  order,
  inspectOrder,
  advance,
  isGame,
  setPriority,
  setHousingPassage,
  type Game,
} from "../src/reform/sim.ts";
import {
  createFoodBundle,
  assignFoodHaul,
  inspectFoodHaul,
  presentFood,
} from "../src/reform/housing/food.ts";
import {
  inspectFoodSupply,
  setFoodSupply,
  setFoodSupplyEnabled,
} from "../src/reform/housing/foodSupply.ts";
import { exportSlot, importSlot } from "../src/reform/library.ts";
import {
  housingLinkId,
  housingPoint,
  housingRoomId,
  housingSlotId,
} from "../src/reform/housing/topology.ts";
import { housingStatus } from "../src/reform/housing/presentation.ts";
import { inspectSpatialRoute } from "../src/reform/spatial/route.ts";

const fixtureIds = { near: "hearth-1", far: "fixture-1" } as const;
const floors = {
  supply: housingPoint("living", 0),
  near: housingPoint("living", 6),
  far: housingPoint("yard", 5),
} as const;
const [cooker, helper] = ["person-1", "person-2"] as const;
const recipe = "cook";
type Side = keyof typeof fixtureIds;
const actor = (g: Game, id: string) =>
  g.actors.find((a) => a.person.id === id)!;
const stock = (g: Game) => ({
  food: g.food,
  ingredients: g.ingredients,
  wood: g.wood,
  coins: g.coins,
});
const bundle = (g: Game) => g.housing!.foodLogistics?.bundle;
function request(side: Side) {
  const p = floors[side];
  return {
    actorId: helper,
    roomId: housingRoomId(p.domainId)!,
    storageCell: p.cell,
  };
}
function makeFixture(): Game {
  const house = editHouse(initialHouse(), {
    type: "build",
    room: "yard",
    kind: "hearth",
    cell: 6,
  });
  assert.ok(isHouse(house));
  let game = createGame(
    [makePersona(0, 23), makePersona(1, 75)],
    generateWorld(defaultWorldConfig()),
    "village",
    house,
  );
  game.actors[0].person.skills.cook = 5;
  game.actors[1].person.skills.wood = 2;
  game.wood = 14;
  game.food = 7;
  game.ingredients = 6;
  game = enableHousing(setPriority(game, helper, "wood"), "new");
  assert.ok(isGame(game));
  for (const id of [cooker, helper])
    assert.deepEqual(game.housing!.state.actors[id].position, {
      kind: "at",
      point: floors.supply,
    });
  return game;
}
function save(g: Game, origin: Game, name: string) {
  return exportSlot({
    id: `test-h6b-${name}`,
    name: `検証専用 H6b ${name}`,
    game: g,
    origin,
  });
}
// Optional fixture output: three synthetic legal saves for browser testing.
function writeFixtures(directory: string) {
  const origin = makeFixture();
  const result = setFoodSupply(origin, request("far"));
  assert.equal(result.error, undefined);
  const configured = result.game;
  const hauling = advance(order(configured, cooker, "wait"), 1);
  assert.equal(inspectFoodSupply(hauling).state, "hauling");
  const stopped = setFoodSupplyEnabled(hauling, false);
  assert.equal(stopped.error, undefined);
  const paused = stopped.game;
  assert.equal(inspectFoodSupply(paused).state, "paused");
  assert.ok(presentFood(paused.housing)?.assignment);
  const blocked = setHousingPassage(
    configured,
    "link",
    housingLinkId("living", "bedroom"),
    false,
  );
  assert.equal(inspectFoodSupply(blocked).state, "waiting");
  assert.equal(blocked.ingredients, 6);
  assert.equal(bundle(blocked), undefined);
  for (const [name, g] of Object.entries({ hauling, blocked, paused })) {
    assert.ok(isGame(g));
    const serialized = save(g, origin, name);
    assert.equal(
      importSlot(serialized).game.housing?.foodSupply?.enabled,
      g.housing?.foodSupply?.enabled,
    );
    writeFileSync(join(directory, `test-only-${name}.json`), serialized + "\n");
  }
}
const directory = process.argv[2];
if (directory) {
  mkdirSync(directory, { recursive: true });
  writeFixtures(directory);
}

type Kind =
  "shared" | "self" | "helper-interrupt" | "helper-finish" | "helper-policy";
type Comparison = { kind: Kind; cook: Side; store?: Side };
type Event =
  | { kind: "policy" | "create"; side: Side }
  | { kind: "haul" | "wait" | "cancel"; actor: string }
  | { kind: "cook"; side: Side; physical: boolean }
  | { kind: "tick" };
const metrics = ["work", "travel", "waiting", "care", "free"] as const;
const delta = (before: Game, after: Game, id: string) =>
  Object.fromEntries(
    metrics.map((k) => [
      k,
      actor(after, id).metrics[k] - actor(before, id).metrics[k],
    ]),
  );
function assertConservation(g: Game) {
  const live = presentFood(g.housing) ? 2 : 0;
  const reserved = g.actors.reduce(
    (sum, a) => sum + (a.task?.reserved.ingredients ?? 0),
    0,
  );
  const consumed = (g.food - 7) / 2; // 4 meals per 2 ingredients in this fixture
  assert.ok([0, 2, 4, 6].includes(consumed));
  assert.equal(g.ingredients + live + reserved + consumed, 6);
  assert.equal(Object.keys(g.housing!.state.items).length, live / 2);
}
function apply(g: Game, event: Event): Game {
  const before = structuredClone(g);
  let next: Game;
  switch (event.kind) {
    case "policy": {
      const result = setFoodSupply(g, request(event.side));
      assert.equal(result.error, undefined);
      next = result.game;
      assert.deepEqual(next.actors, g.actors);
      assert.equal(next.ingredients, g.ingredients);
      assert.equal(bundle(next), undefined);
      break;
    }
    case "create": {
      const { roomId, storageCell } = request(event.side);
      const result = createFoodBundle(g, { roomId, storageCell });
      assert.equal(result.error, undefined);
      next = result.game;
      break;
    }
    case "haul": {
      const b = presentFood(g.housing)!;
      assert.ok(inspectFoodHaul(g, b.id, event.actor, "store").ok);
      const result = assignFoodHaul(g, b.id, event.actor, "store");
      assert.equal(result.error, undefined);
      next = result.game;
      break;
    }
    case "cook": {
      const selection = {
        fixtureId: fixtureIds[event.side],
        ...(event.physical ? { bundleId: bundle(g)!.id } : {}),
      };
      const preview = inspectOrder(g, cooker, "work", recipe, selection);
      assert.equal(preview.disabled, undefined);
      next = order(g, cooker, "work", recipe, selection);
      assert.equal(actor(next, cooker).task?.target, recipe);
      break;
    }
    case "tick":
      next = advance(g, 1);
      break;
    case "wait":
    case "cancel":
      next = order(g, event.actor, event.kind);
      if (event.kind === "wait")
        assert.equal(actor(next, event.actor).task?.kind, "wait");
      break;
  }
  assert.deepEqual(structuredClone(g), before);
  assert.ok(isGame(next), `${event.kind} invalid at ${g.time}`);
  assert.equal(next.time, g.time + (event.kind === "tick" ? 1 : 0));
  assertConservation(next);
  return next;
}
// Formal JSON omits undefined optional Task.target; compare exactly the shape
// that the save format stores, not object presence for an undefined value.
function savedShape(g: Game) {
  const clone = structuredClone(g);
  for (const a of clone.actors)
    if (a.task && a.task.target === undefined) delete a.task.target;
  return clone;
}
class Trace {
  origin = makeFixture();
  game = this.origin;
  events: Event[] = [];
  states: Game[] = [this.origin];
  marks = new Map<string, number>();
  step(event: Event) {
    this.game = apply(this.game, event);
    this.events.push(event);
    this.states.push(this.game);
  }
  mark(label: string) {
    if (!this.marks.has(label)) this.marks.set(label, this.events.length);
  }
  guardCooker() {
    if (!actor(this.game, cooker).task)
      this.step({ kind: "wait", actor: cooker });
  }
  phase(label: string, id: string) {
    const g = this.game,
      b = presentFood(g.housing),
      p = b ? g.housing!.state.items[b.itemId].position.kind : "none";
    this.mark(
      `${label}:${actor(g, id).task?.spatial?.kind ?? "none"}:${housingStatus(g, id).phase}:${p}`,
    );
  }
  tickGuarded(label: string, id: string) {
    this.guardCooker();
    this.step({ kind: "tick" });
    this.phase(label, id);
    assert.ok(
      this.game.time - this.origin.time < 600,
      `guard timeout ${label}: ${inspectFoodSupply(this.game).detail}`,
    );
  }
  replay() {
    for (const [label, index] of this.marks) {
      const g = this.states[index];
      const loaded = importSlot(save(g, this.origin, "replay"));
      assert.deepEqual(savedShape(loaded.game), savedShape(g), label);
      assert.deepEqual(
        savedShape(loaded.origin),
        savedShape(this.origin),
        label,
      );
      let r = loaded.game;
      for (const event of this.events.slice(index)) r = apply(r, event);
      assert.deepEqual(savedShape(r), savedShape(this.game), label);
    }
    return this.marks.size;
  }
}
function run(c: Comparison) {
  const t = new Trace(),
    cycles = [];
  if (c.kind === "helper-policy") {
    t.step({ kind: "policy", side: c.store! });
    t.mark("configured");
  }
  for (let cycle = 1; cycle <= 3; cycle++) {
    const initial = t.game;
    let helperWait = 0,
      haulMinutes = 0;
    if (c.kind === "helper-policy") {
      let haulStart: number | undefined;
      while (inspectFoodSupply(t.game).state !== "stocked") {
        t.tickGuarded(`c${cycle}:auto`, helper);
        if (
          actor(t.game, helper).task?.spatial?.foodBundleId &&
          haulStart === undefined
        ) {
          assert.equal(actor(t.game, helper).task?.mode, "auto");
          haulStart = t.game.time - 1; // first minute was already processed
        }
      }
      assert.notEqual(haulStart, undefined);
      helperWait = haulStart! - initial.time;
      haulMinutes = t.game.time - haulStart!;
    } else if (c.kind !== "shared") {
      t.step({ kind: "create", side: c.store! });
      t.mark(`c${cycle}:created`);
      const hauler = c.kind === "self" ? cooker : helper;
      if (hauler === helper && actor(t.game, helper).task) {
        const waitStart = t.game.time;
        if (c.kind === "helper-interrupt")
          t.step({ kind: "cancel", actor: helper });
        while (actor(t.game, helper).task)
          t.tickGuarded(`c${cycle}:await-helper`, helper);
        helperWait = t.game.time - waitStart;
      }
      const preview = inspectFoodHaul(
        t.game,
        presentFood(t.game.housing)!.id,
        hauler,
        "store",
      );
      assert.ok(preview.ok, preview.disabled);
      const haulStart = t.game.time;
      t.step({ kind: "haul", actor: hauler });
      t.phase(`c${cycle}:haul`, hauler);
      while (actor(t.game, hauler).task?.spatial?.foodBundleId) {
        if (hauler === helper) t.guardCooker();
        t.step({ kind: "tick" });
        t.phase(`c${cycle}:haul`, hauler);
        assert.ok(t.game.time - initial.time < 200);
      }
      haulMinutes = t.game.time - haulStart;
      assert.equal(haulMinutes, preview.minutes);
    }
    const cookStart = t.game;
    const selection = {
      fixtureId: fixtureIds[c.cook],
      ...(c.kind !== "shared" ? { bundleId: bundle(t.game)!.id } : {}),
    };
    const preview = inspectOrder(t.game, cooker, "work", recipe, selection);
    assert.equal(preview.disabled, undefined);
    t.step({ kind: "cook", side: c.cook, physical: c.kind !== "shared" });
    t.phase(`c${cycle}:cook`, cooker);
    let useStarted =
      housingStatus(t.game, cooker).phase === "use" ? t.game.time : null;
    while (actor(t.game, cooker).task) {
      t.step({ kind: "tick" });
      t.phase(`c${cycle}:cook`, cooker);
      if (
        actor(t.game, cooker).task &&
        housingStatus(t.game, cooker).phase === "use" &&
        useStarted === null
      )
        useStarted = t.game.time;
      assert.ok(t.game.time - cookStart.time < 200);
    }
    const cookMinutes = t.game.time - cookStart.time;
    const useMinutes = t.game.time - useStarted!;
    assert.equal(cookMinutes, preview.minutes);
    assert.equal(useMinutes, preview.facility!.useMinutes);
    assert.equal(t.game.ingredients, 6 - cycle * 2);
    assert.equal(t.game.food, 7 + cycle * 4);
    if (c.kind !== "shared") assert.equal(bundle(t.game)?.state, "consumed");
    t.mark(`c${cycle}:done`);
    cycles.push({
      cycle,
      helperWait,
      haulMinutes,
      cookMinutes,
      useMinutes,
      transportMinutes: cookMinutes - useMinutes,
      elapsed: t.game.time - initial.time,
      stocks: stock(t.game),
      cookerMetrics: delta(initial, t.game, cooker),
      helperMetrics: delta(initial, t.game, helper),
    });
  }
  const done = t.game;
  const commands = t.events.filter((e) => e.kind !== "tick");
  const count = (kind: Event["kind"]) =>
    commands.filter((e) => e.kind === kind).length;
  assert.equal(count("cook"), 3);
  const primary =
    count("cook") + count("create") + count("haul") + count("policy");
  assert.equal(
    primary,
    c.kind === "helper-policy" ? 4 : c.kind === "shared" ? 3 : 9,
  );
  assert.equal(done.ingredients, 0);
  assert.equal(done.food, 19);
  assert.equal(Object.keys(done.housing!.state.items).length, 0);
  if (c.kind === "helper-policy") {
    assert.equal(done.housing!.foodLogistics!.nextId, 4);
    // Continue beyond the measured window until the helper actually becomes
    // idle and gets another opportunity to start work with no stock left.
    let later = done;
    function checkExhausted() {
      assert.ok(isGame(later));
      assert.equal(later.housing!.foodLogistics!.nextId, 4);
      assert.equal(later.ingredients, 0);
      assert.equal(presentFood(later.housing), undefined);
    }
    function tickAfterWindow() {
      if (!actor(later, cooker).task) later = order(later, cooker, "wait");
      later = advance(later, 1);
      checkExhausted();
      assert.ok(later.time - done.time < 200);
    }
    while (actor(later, helper).task) tickAfterWindow();
    checkExhausted();
    assert.equal(inspectFoodSupply(later).state, "waiting");
    tickAfterWindow();
  }
  return {
    ...c,
    name: `${c.kind}-${c.store ?? "none"}-${c.cook}`,
    elapsed: done.time - t.origin.time,
    cycles,
    stocks: { start: stock(t.origin), done: stock(done) },
    cookerMetrics: delta(t.origin, done, cooker),
    helperMetrics: delta(t.origin, done, helper),
    helperWorkCompletions: done.log.filter(
      (l) => !t.origin.log.includes(l) && /木材.*を整えた/.test(l),
    ).length,
    cookingXP: actor(done, cooker).xp.cook - actor(t.origin, cooker).xp.cook,
    commands: {
      primary,
      policy: count("policy"),
      cook: count("cook"),
      create: count("create"),
      haul: count("haul"),
      wait: count("wait"),
      cancel: count("cancel"),
      ticks: t.events.filter((e) => e.kind === "tick").length,
    },
    saveChecks: t.replay(),
  };
}
const sides = ["near", "far"] as const;
const comparisons: Comparison[] = [
  ...sides.map((cook) => ({ kind: "shared" as const, cook })),
  ...(
    ["self", "helper-interrupt", "helper-finish", "helper-policy"] as const
  ).flatMap((kind) =>
    sides.flatMap((store) => sides.map((cook) => ({ kind, store, cook }))),
  ),
];
const runs = comparisons.map(run);
const origin = makeFixture();
const points = {
  ...floors,
  nearCook:
    origin.housing!.state.slots[housingSlotId("living", fixtureIds.near, 0)]
      .point,
  farCook:
    origin.housing!.state.slots[housingSlotId("yard", fixtureIds.far, 0)].point,
};
const routes = Object.fromEntries(
  Object.entries(points).flatMap(([from, p]) =>
    Object.entries(points).map(([to, q]) => {
      const r = inspectSpatialRoute(origin.housing!.state, cooker, p, q);
      assert.ok(r.ok);
      return [`${from}->${to}`, r.minutes];
    }),
  ),
);
const summary = {
  fixture: { time: origin.time, stocks: stock(origin), points, routes },
  runs,
};
if (directory)
  writeFileSync(
    join(directory, "comparison-summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
console.table(
  runs.map((r) => ({
    name: r.name,
    elapsed: r.elapsed,
    work: r.cycles.reduce((n, c) => n + c.useMinutes, 0),
    prep: r.cycles.reduce((n, c) => n + c.haulMinutes, 0),
    helperWait: r.cycles.reduce((n, c) => n + c.helperWait, 0),
    main: r.commands.primary,
    wait: r.commands.wait,
    cancel: r.commands.cancel,
    wood: r.stocks.done.wood - r.stocks.start.wood,
    helperWork: r.helperMetrics.work,
    saveChecks: r.saveChecks,
  })),
);
