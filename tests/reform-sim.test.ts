import assert from "node:assert/strict";
import test from "node:test";
import {
  advance,
  createGame,
  inspectOrder,
  isGame,
  options,
  order,
  setBond,
  setPriority,
  specialize,
  type Game,
} from "../src/reform/sim";
import { makePersona, type Persona } from "../src/reform/peopleModel";
import { defaultWorldConfig, generateWorld } from "../src/reform/world";
import { editHouse, initialHouse } from "../src/reform/house";

const apprentice: Persona = {
  ...makePersona(0, 23),
  name: "栞",
  personality: "curious",
  likes: "wood",
  dislikes: "cook",
  talent: "wood",
  skills: { wood: 1, cook: 1, care: 1, trade: 1 },
};
const artisan: Persona = {
  ...makePersona(1, 75),
  name: "梢",
  personality: "social",
  likes: "cook",
  dislikes: "wood",
  talent: "care",
  skills: { wood: 7, cook: 2, care: 4, trade: 2 },
};
function game(people = [apprentice, artisan], site = "village") {
  return createGame(people, generateWorld(defaultWorldConfig()), site);
}
function act(g: Game, id: string, kind: string, target?: string) {
  const queued = order(g, id, kind, target);
  const a = queued.actors.find((p) => p.person.id === id)!;
  assert.equal(a.task?.kind, kind, queued.log[0]);
  assert.equal(
    a.task.target,
    target ?? (kind === "return" || kind === "withdraw" ? g.home : undefined),
  );
  return advance(queued, a.task.remaining);
}
const first = apprentice.id,
  second = artisan.id;

test("same morning shows autonomous preferences and current skill, mood, learning independently", () => {
  const g = game();
  const auto = advance(g, 1);
  assert.equal(auto.actors[0].task?.target, "wood");
  assert.equal(auto.actors[1].task?.target, "cook");
  const bySkill = g.actors.map((a) => {
    const single = game([a.person]);
    const ready = order(single, a.person.id, "work", "wood");
    const minutes = ready.actors[0].task!.remaining;
    const done = advance(ready, minutes);
    return {
      minutes,
      units: done.wood - single.wood,
      xp: done.actors[0].xp.wood,
      mood: done.actors[0].mood,
    };
  });
  assert.ok(bySkill[0].minutes > bySkill[1].minutes);
  assert.ok(bySkill[0].units < bySkill[1].units);
  assert.ok(bySkill[0].xp > bySkill[1].xp);
  assert.ok(bySkill[0].mood > bySkill[1].mood);
  assert.equal(g.actors[0].task, null);
});

test("reservations, station conflicts, replacement rejection, save and cancellation", () => {
  const g = game();
  const firstOrder = order(g, first, "work", "cook");
  assert.equal(firstOrder.ingredients, g.ingredients - 2);
  assert.match(
    inspectOrder(firstOrder, second, "work", "cook").disabled!,
    /設備/,
  );
  const denied = order(firstOrder, first, "travel", "missing");
  assert.equal(denied.actors[0].task?.kind, "work");
  assert.equal(denied.ingredients, g.ingredients - 2);
  const step = advance(denied, 2);
  const atSave = JSON.parse(JSON.stringify(step));
  assert.ok(isGame(atSave));
  assert.deepEqual(advance(step, 180), advance(atSave, 180));
  const canceled = order(denied, first, "cancel");
  assert.equal(canceled.ingredients, g.ingredients);
  assert.equal(canceled.time, g.time);
  assert.equal(order(canceled, first, "cancel").ingredients, g.ingredients);
});

test("improving plumbing and moving rooms reclaim household minutes", () => {
  const g = game([apprentice]);
  const firstTime = inspectOrder(g, first, "need", "hygiene").minutes!;
  const improved = editHouse(initialHouse(), {
    type: "build",
    room: "living",
    kind: "bath",
  });
  const newGame = createGame([apprentice], g.world, g.home, improved);
  const newTime = inspectOrder(newGame, first, "need", "hygiene").minutes!;
  assert.ok(newTime + 10 < firstTime);
  const washed = act(newGame, first, "need", "hygiene");
  assert.equal(washed.actors[0].room, "living");
  assert.ok(washed.actors[0].needs.hygiene > 95);
});

test("social memories and autonomous mood respond to company, confrontation, future expiry", () => {
  const base = game();
  const warm = setBond(base, first, second, "lover"),
    tense = setBond(base, first, second, "rival");
  assert.ok(warm.actors[0].mood > tense.actors[0].mood);
  const argument = order(warm, first, "argue", second);
  const saved = JSON.parse(JSON.stringify(argument));
  assert.ok(isGame(saved));
  const done = advance(argument, argument.actors[0].task!.remaining);
  assert.ok(done.actors.every((a) => a.task === null));
  assert.ok(
    done.actors[0].relations[second].trust >
      done.actors[1].relations[first].trust,
  );
  assert.ok(
    done.actors[1].memories.some(
      (m) => m.value < 0 && m.label.includes("言い争い"),
    ),
  );
  const later = advance(done, 600);
  assert.ok(
    !later.actors[1].memories.some((m) => m.label.includes("言い争い")),
  );
  const orphan = structuredClone(saved);
  orphan.actors[1].task = null;
  assert.equal(isGame(orphan), false);
});

test("skills and experience unlock choices; difficult training has greater yield with same person", () => {
  const g = game([apprentice]);
  assert.match(inspectOrder(g, first, "work", "wood:master").disabled!, /技能/);
  const easy = act(g, first, "work", "wood"),
    hard = act(g, first, "work", "wood:hard");
  assert.ok(hard.actors[0].experience > easy.actors[0].experience);
  let growing = g;
  for (let i = 0; i < 6; i++)
    growing = act(growing, first, "work", "wood:hard");
  assert.ok(growing.actors[0].level >= 2);
  const specialized = specialize(growing, first, "wood");
  const renovated = act(specialized, first, "work", "wood:master");
  assert.equal(renovated.insulated, true);
  assert.equal(renovated.wood, specialized.wood - 3);
  assert.match(
    inspectOrder(renovated, first, "work", "wood:master").disabled!,
    /完成/,
  );
});

test("wood must be carried to the bridge; supplies and local merchants respond", () => {
  let g = game([apprentice]);
  g = act(g, first, "pack", "wood");
  assert.equal(g.actors[0].cargo.wood, 4);
  g = act(g, first, "travel", "landing");
  const pre = structuredClone(g);
  const pending = order(g, first, "project", "bridge");
  assert.equal(pending.actors[0].cargo.wood, 0);
  assert.equal(order(pending, first, "cancel").actors[0].cargo.wood, 4);
  const bridge = act(g, first, "project", "bridge");
  assert.ok(bridge.world.bridge);
  const nextDay = advance(bridge, 1440),
    unchanged = advance(pre, 1440);
  assert.ok(nextDay.world.trade.bridge > 0 && nextDay.world.trade.ferry === 0);
  assert.ok(
    unchanged.world.trade.ferry > 0 && unchanged.world.trade.bridge === 0,
  );
  assert.ok(nextDay.world.trade.stock > unchanged.world.trade.stock);
});

test("exploration stops the clock for a choice, field rescue brings both residents home", () => {
  let g = game([apprentice, artisan]);
  g = act(g, first, "travel", "pass");
  const searching = order(g, first, "explore");
  const encounter = advance(searching, 1440);
  assert.equal(
    encounter.time,
    searching.time + searching.actors[0].task!.remaining,
  );
  assert.ok(encounter.actors[0].danger);
  for (const k of ["negotiate", "defend", "withdraw"])
    assert.equal(inspectOrder(encounter, first, k).disabled, undefined);
  const withdrawn = act(encounter, first, "withdraw");
  assert.equal(withdrawn.actors[0].location, g.home);
  let injured = structuredClone(g);
  injured.actors[0].injury = 80;
  injured = act(injured, second, "travel", "pass");
  const carried = act(injured, second, "rescue", first);
  assert.ok(carried.actors.every((a) => a.location === g.home));
  const after = act(carried, second, "aid", first);
  assert.ok(after.actors[0].injury < carried.actors[0].injury);
});

test("the same 28 days agree across chunked advance and saved reloads; all needs and clocks remain finite", () => {
  const roster = [
    game([apprentice], "landing"),
    game(),
    setPriority(game([artisan]), second, "trade"),
  ];
  for (let scenario = 0; scenario < roster.length; scenario++) {
    let start = roster[scenario];
    if (scenario === 0) start = act(start, first, "travel", "orchard");
    const entire = advance(start, 28 * 1440);
    let split = start;
    for (let d = 0; d < 28; d++)
      split = advance(JSON.parse(JSON.stringify(split)), 1440);
    assert.deepEqual(entire, split);
    assert.ok(isGame(entire));
    assert.ok(
      entire.actors.every(
        (a) =>
          Object.values(a.metrics).reduce((n, k) => n + k, 0) ===
          entire.time - 480,
      ),
    );
    assert.ok(
      entire.actors.some((a) => a.experience > 0 && a.metrics.free > 0),
    );
    assert.ok(
      entire.actors.every((a) =>
        options(entire, a.person.id).some((o) => !o.disabled),
      ),
    );
  }
});

test("the other resident immediately feels the result of a conversation; work late in a shift does not obscure the change",()=>{
  const g=game();
  const friendly=act(g,first,"talk",second);
  const hostile=act(g,first,"argue",second);
  assert.equal(friendly.time,hostile.time);
  assert.ok(friendly.actors[1].mood>hostile.actors[1].mood);
  assert.ok(friendly.actors[0].mood>hostile.actors[0].mood);
});

test("autonomous production is bounded by useful stocks and trade remains viable into week four",()=>{
  let household=setPriority(game(),first,"wood");
  household=advance(household,28*1440);
  assert.ok(household.wood<60);
  assert.ok(household.actors[0].person.skills.wood>=3 && household.actors[0].person.skills.wood<10);
  const trader={...artisan,likes:"trade" as const,talent:"trade" as const,skills:{wood:1,cook:2,care:1,trade:5}};
  const start=setPriority(game([trader]),trader.id,"trade");
  const week=advance(start,7*1440), month=advance(week,21*1440);
  assert.ok(month.coins>week.coins);
  assert.ok(month.actors[0].experience>week.actors[0].experience);
  assert.ok(month.actors[0].person.skills.trade<10);
  const taxed=structuredClone(month);
  taxed.wood=0;
  const returnedToTrade=advance(taxed,3*1440);
  assert.ok(returnedToTrade.coins>taxed.coins);
});
