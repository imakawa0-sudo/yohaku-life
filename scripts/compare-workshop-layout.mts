// node --import tsx scripts/compare-workshop-layout.mts
// H6b baseline: identical synthetic morning save, two usable hearths and two
// possible storage floors. Existing wood work has no fixture selection.
import assert from "node:assert/strict";
import { editHouse, houseValue, initialHouse } from "../src/reform/house.ts";
import { presentFood } from "../src/reform/housing/food.ts";
import {
  inspectFoodSupply,
  setFoodSupply,
} from "../src/reform/housing/foodSupply.ts";
import { exportSlot, importSlot } from "../src/reform/library.ts";
import { makePersona } from "../src/reform/peopleModel.ts";
import {
  advance,
  createGame,
  enableHousing,
  inspectOrder,
  isGame,
  order,
  type Game,
} from "../src/reform/sim.ts";
import { defaultWorldConfig, generateWorld } from "../src/reform/world.ts";

const house = editHouse(initialHouse(), {
  type: "build",
  kind: "hearth",
  room: "yard",
  cell: 6,
});
const initial = createGame(
  [makePersona(0, 23), makePersona(1, 75)],
  generateWorld(defaultWorldConfig()),
  "village",
  house,
);
initial.actors[0].person.skills.cook = 5;
initial.actors[1].person.skills.wood = 2;
initial.ingredients = 2;
const morning = enableHousing(initial, "new");
assert.ok(isGame(morning));

function save(game: Game) {
  return exportSlot({
    id: "workshop-layout-study",
    name: "検証専用・料理と木工",
    game,
    origin: morning,
  });
}

const morningSave = save(morning);
const sites = {
  living: { fixture: "hearth-1", floor: 6 },
  yard: { fixture: "fixture-1", floor: 5 },
};
type Site = keyof typeof sites;

function stocks(game: Game) {
  return {
    food: game.food,
    ingredients: game.ingredients,
    wood: game.wood,
    reservedWood: game.actors.reduce(
      (sum, a) => sum + (a.task?.reserved.wood ?? 0),
      0,
    ),
    coins: game.coins,
    bundle: presentFood(game.housing)?.id ?? null,
  };
}

function compare(store: Site | "shared", hearth: Site, woodRoom?: Site) {
  let game = importSlot(morningSave).game;
  const [cook, woodworker] = game.actors.map((a) => a.person.id);
  const restMinutes = [0, 0];
  const commands: string[] = [];
  function tick() {
    const before = game;
    game = advance(game, 1);
    for (const [i, after] of game.actors.entries()) {
      const prior = before.actors[i];
      const task = prior.task ?? after.task;
      if (task?.kind === "need" && task.target === "energy")
        restMinutes[i] += after.metrics.care - prior.metrics.care;
    }
  }
  let haul = 0;
  if (store !== "shared") {
    const configured = setFoodSupply(game, {
      actorId: woodworker,
      roomId: store,
      storageCell: sites[store].floor,
    });
    assert.equal(configured.error, undefined);
    game = configured.game;
    commands.push("supply");
    // Keep the cook available until a bundle arrives. Count this wait command.
    while (inspectFoodSupply(game).state !== "stocked") {
      assert.ok(haul < 30);
      if (!game.actors[0].task) {
        game = order(game, cook, "wait");
        commands.push("wait");
      }
      assert.equal(game.actors[0].task?.kind, "wait");
      tick();
      haul++;
    }
  }

  const selected = {
    fixtureId: sites[hearth].fixture,
    ...(store === "shared" ? {} : { bundleId: presentFood(game.housing)!.id }),
  };
  const cookPlan = inspectOrder(game, cook, "work", "cook", selected);
  assert.equal(cookPlan.disabled, undefined);
  game = order(game, cook, "work", "cook", selected);
  commands.push("cook");
  assert.equal(game.actors[0].task?.target, "cook");
  const cookStartedAt = game.time;

  // Optional manual positioning: cell 1 is ordinary walkable floor in both
  // rooms. Cooking proceeds during the move. No furniture or material queue.
  if (woodRoom) {
    const target = JSON.stringify({ roomId: woodRoom, cell: 1 });
    const move = inspectOrder(game, woodworker, "home-move", target);
    assert.equal(move.disabled, undefined);
    game = order(game, woodworker, "home-move", target);
    commands.push("move");
    while (game.actors[1].task) {
      assert.ok(game.time - cookStartedAt < 30);
      tick();
    }
    assert.equal(game.time - cookStartedAt, move.minutes);
    assert.equal(game.actors[1].room, woodRoom);
    assert.equal(game.actors[0].task?.target, "cook");
  }
  const woodPlan = inspectOrder(game, woodworker, "work", "wood");
  assert.equal(woodPlan.disabled, undefined);
  game = order(game, woodworker, "work", "wood");
  commands.push("wood");
  const woodPositionAtStart = game.housing!.state.actors[woodworker].position;
  assert.equal(game.actors[1].task?.target, "wood");
  const woodStartedAt = game.time;
  let cookFinished = 0,
    woodFinished = 0;
  while (!cookFinished || !woodFinished) {
    assert.ok(game.time - cookStartedAt < 150);
    tick();
    if (!cookFinished && !game.actors[0].task) cookFinished = game.time;
    if (!woodFinished && !game.actors[1].task) {
      woodFinished = game.time;
      assert.deepEqual(
        game.housing!.state.actors[woodworker].position,
        woodPositionAtStart,
      );
    }
  }
  assert.equal(cookFinished - cookStartedAt, cookPlan.minutes);
  assert.equal(woodFinished - woodStartedAt, woodPlan.minutes);
  assert.equal(game.food, morning.food + 4);
  const inventory = stocks(game);
  assert.equal(inventory.wood + inventory.reservedWood, morning.wood + 1);
  assert.equal(presentFood(game.housing), undefined);
  assert.equal(game.ingredients, 0);

  const morningWork = {
    haul,
    cook: cookFinished - cookStartedAt,
    cookUse: cookPlan.facility!.useMinutes,
    wood: woodFinished - woodStartedAt,
    woodMove: woodStartedAt - cookStartedAt,
    woodDoneAfter: woodFinished - morning.time,
    finishedAfter: game.time - morning.time,
    travel: game.actors.map((a) => a.metrics.travel),
    stocks: stocks(game),
  };
  const checkpoint = save(game);
  const nextMorning = morning.time + 1440;
  while (game.time < nextMorning) tick();
  assert.ok(isGame(game));
  const resumed = importSlot(checkpoint).game;
  assert.deepEqual(
    JSON.parse(save(advance(resumed, nextMorning - resumed.time))),
    JSON.parse(save(game)),
  );
  return {
    store,
    hearth,
    woodRoom: woodRoom ?? null,
    commands,
    morningWork,
    nextMorning: {
      stocks: stocks(game),
      residents: game.actors.map((a, i) => ({
        id: a.person.id,
        ...a.metrics,
        rest: restMinutes[i],
        energy: Math.round(a.needs.energy),
        action: a.task?.label ?? null,
        room: a.room,
      })),
      supply: inspectFoodSupply(game).state,
    },
  };
}

const rooms = ["living", "yard"] as const;
const runs = rooms.flatMap((hearth) =>
  (["shared", ...rooms] as const).map((store) => compare(store, hearth)),
);
for (const store of rooms) {
  for (const woodRoom of rooms) runs.push(compare(store, "living", woodRoom));
}
console.log(
  JSON.stringify(
    {
      houseValue: houseValue(house),
      standardHouseValue: houseValue(initialHouse()),
      initialStocks: stocks(morning),
      runs,
    },
    null,
    2,
  ),
);
