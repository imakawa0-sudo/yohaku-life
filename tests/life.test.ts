import test from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  command,
  createGame,
  deserialize,
  getResidentLife,
  getWishProgress,
  serialize,
} from "../src/game/engine.ts";
import { assignSelection } from "../src/game/selection.ts";
import type { ActionKind, Command, GameState } from "../src/game/types.ts";

const resident = (state: GameState, id = "aki") =>
  state.residents.find((person) => person.id === id)!;

function act(state: GameState, instruction: Command): GameState {
  const result = command(state, instruction);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}

function assign(
  state: GameState,
  kind: ActionKind,
  id = "aki",
  target?: string,
): GameState {
  return act(state, {
    type: "assign",
    residentIds: [id],
    kind,
    target,
  });
}

function finish(state: GameState, id = "aki", limit = 2000): GameState {
  const actionId = resident(state, id).action?.id;
  assert.notEqual(actionId, undefined, "A real action must be reserved first");
  for (let step = 0; step < limit; step++) {
    if (resident(state, id).action?.id !== actionId) return state;
    state = advance(state, 1);
  }
  assert.fail("The reserved action did not finish within the expected time");
}

function quiet(seed = 20261120): GameState {
  let state = createGame(seed);
  for (const person of state.residents)
    state = act(state, {
      type: "policy",
      residentId: person.id,
      policy: "rest",
    });
  return state;
}

function move(state: GameState, target: string, id = "aki"): GameState {
  return finish(assign(state, "move", id, target), id);
}

function madeAndShelved(state = quiet()): GameState {
  state = finish(assign(state, "hobby"));
  return finish(assign(state, "decorate"));
}

function quietNight(seed = 20261120): GameState {
  const state = quiet(seed);
  // These tests isolate overnight callbacks. Start from a controlled,
  // well-fed evening instead of relying on an obsolete twenty-hour sleep.
  state.minutes = 22 * 60;
  for (const person of state.residents) person.hunger = 100;
  return state;
}

function reachTimeWithoutCareWarning(state: GameState, target: number): GameState {
  while (state.minutes < target) {
    const next = advance(state, Math.min(60, target - state.minutes));
    assert.ok(next.minutes > state.minutes);
    assert.doesNotMatch(next.pauseReason ?? "", /空腹|活力|疲れ/);
    state = next;
  }
  return state;
}

function sleepAndReachMorning(state: GameState, ids = ["aki"]): GameState {
  let morning = Math.floor(state.minutes / 1440) * 1440 + 480;
  if (morning <= state.minutes) morning += 1440;
  const sleeping = assignSelection(state, ids, "sleep");
  assert.equal(sleeping.error, undefined, sleeping.error);
  state = finish(sleeping.state, ids[0]);
  return reachTimeWithoutCareWarning(state, morning);
}

test("Reading life progress and reflections never advances or rewrites the shared world", () => {
  const state = createGame(140);
  const before = serialize(state);
  for (const person of state.residents) {
    assert.equal(getWishProgress(state, person.id).completed, false);
    assert.ok(getResidentLife(state, person.id).wish);
    getResidentLife(state, person.id);
    getWishProgress(state, person.id);
  }
  assert.equal(serialize(state), before);
});

test("A maker completes the personal wish only after spending time displaying their own finished work", () => {
  let state = quiet(20);
  const started = state.minutes;
  state = assign(state, "hobby");
  assert.equal(state.minutes, started);
  assert.equal(getResidentLife(state, "aki").crafts.length, 0);
  state = finish(state);
  assert.equal(getResidentLife(state, "aki").crafts.length, 1);
  assert.equal(getResidentLife(state, "mio").crafts.length, 0);
  assert.equal(getWishProgress(state, "aki").completed, false);
  state = finish(assign(state, "decorate"));
  assert.equal(getWishProgress(state, "aki").completed, false);
  const beforeDisplay = state.minutes;
  const materials = { ...state.resources };
  state = assign(state, "place-craft");
  assert.equal(state.minutes, beforeDisplay);
  assert.deepEqual(state.resources, materials);
  assert.equal(resident(state).action?.duration, 5);
  state = advance(state, 4);
  assert.equal(getWishProgress(state, "aki").completed, false);
  state = finish(state);
  assert.equal(state.minutes, beforeDisplay + 5);
  assert.equal(getWishProgress(state, "aki").completed, true);
  const completedAt = getWishProgress(state, "aki").completedAt;
  assert.equal(completedAt, state.minutes);
  state = deserialize(serialize(state));
  assert.equal(getWishProgress(state, "aki").completedAt, completedAt);
  const repeated = command(state, {
    type: "assign",
    residentIds: ["aki"],
    kind: "place-craft",
  });
  assert.ok(
    repeated.error,
    "The same object cannot be displayed a second time",
  );
  assert.equal(getWishProgress(repeated.state, "aki").completedAt, completedAt);
});

test("Displaying an object requires its maker and the shelf's actual room", () => {
  let state = madeAndShelved();
  const wrongMaker = command(state, {
    type: "assign",
    residentIds: ["mio"],
    kind: "place-craft",
  });
  assert.ok(wrongMaker.error);
  assert.strictEqual(wrongMaker.state, state);
  state = move(state, "bedroom");
  const awayFromShelf = command(state, {
    type: "assign",
    residentIds: ["aki"],
    kind: "place-craft",
  });
  assert.ok(awayFromShelf.error);
  assert.strictEqual(awayFromShelf.state, state);
  state = move(state, "home");
  state = finish(assign(state, "place-craft"));
  assert.equal(getWishProgress(state, "aki").completed, true);
});

test("Cancelling a saved interrupted display preserves the object without awarding completion", () => {
  let state = madeAndShelved();
  state = advance(assign(state, "place-craft"), 2);
  const displayId = resident(state).action!.id;
  state = act(state, { type: "pause", residentId: "aki" });
  state = deserialize(serialize(state));
  assert.equal(resident(state).suspended?.id, displayId);
  state = act(state, {
    type: "cancel",
    residentId: "aki",
    actionId: displayId,
  });
  assert.equal(getResidentLife(state, "aki").crafts.length, 1);
  assert.equal(getWishProgress(state, "aki").completed, false);
  state = finish(assign(state, "place-craft"));
  assert.equal(getWishProgress(state, "aki").completed, true);
  assert.equal(getResidentLife(state, "aki").crafts.length, 1);
});

test("A multi-person display request fails atomically instead of choosing an implicit maker", () => {
  let state = quiet(70);
  const group = assignSelection(state, ["aki", "mio"], "hobby");
  assert.equal(group.error, undefined);
  state = finish(group.state);
  state = finish(assign(state, "decorate"));
  const before = serialize(state);
  const result = assignSelection(state, ["aki", "mio"], "place-craft");
  assert.ok(result.error);
  assert.strictEqual(result.state, state);
  assert.equal(serialize(state), before);
  assert.equal(getWishProgress(state, "aki").completed, false);
});

test("Old shared hobby flags do not invent a maker, and an old shelf can be made usable for new work", () => {
  const legacy = quiet(11);
  delete legacy.life;
  legacy.flags.hobbyFinished = true;
  legacy.flags.decorated = true;
  let state = deserialize(serialize(legacy));
  assert.equal(getResidentLife(state, "aki").crafts.length, 0);
  assert.equal(getWishProgress(state, "aki").completed, false);
  state = finish(assign(state, "hobby"));
  assert.equal(getResidentLife(state, "aki").crafts.length, 1);
  // Registering the old shelf must use a real action, rather than guessing a
  // historical place or making new wishes permanently impossible to complete.
  const beforeRestoring = state.minutes;
  const resources = { ...state.resources };
  state = assign(state, "decorate");
  assert.equal(state.minutes, beforeRestoring);
  assert.equal(resident(state).action?.duration, 10);
  assert.deepEqual(state.resources, resources);
  assert.deepEqual(resident(state).action?.reserved ?? {}, {});
  state = finish(deserialize(serialize(state)));
  assert.equal(state.minutes, beforeRestoring + 10);
  assert.deepEqual(state.resources, resources);
  state = finish(assign(state, "place-craft"));
  assert.equal(getWishProgress(state, "aki").completed, true);
  assert.deepEqual(deserialize(serialize(state)), state);
});

test("Mio's shared-meal wish requires actual meal completion by all three people", () => {
  let alone = quiet(12);
  alone = finish(assign(alone, "eat", "mio"), "mio");
  assert.equal(getWishProgress(alone, "mio").completed, false);

  let sleeping = quiet(12);
  sleeping = assign(sleeping, "sleep", "ren");
  let pair = assignSelection(sleeping, ["aki", "mio"], "eat");
  assert.equal(pair.error, undefined);
  sleeping = finish(pair.state);
  assert.equal(getWishProgress(sleeping, "mio").completed, false);

  let shared = quiet(12);
  const group = assignSelection(shared, ["aki", "mio", "ren"], "eat");
  assert.equal(group.error, undefined);
  shared = group.state;
  assert.equal(getWishProgress(shared, "mio").completed, false);
  shared = finish(shared);
  assert.equal(getWishProgress(shared, "mio").completed, true);
  assert.equal(getWishProgress(shared, "aki").completed, false);
  assert.deepEqual(deserialize(serialize(shared)), shared);
});

test("Meals in different rooms or more than five minutes apart do not invent a shared table", () => {
  let separate = quiet(32);
  resident(separate, "ren").location = "kitchen";
  const inDifferentRooms = assignSelection(
    separate,
    ["aki", "mio", "ren"],
    "eat",
  );
  assert.equal(inDifferentRooms.error, undefined);
  separate = finish(inDifferentRooms.state);
  assert.equal(getWishProgress(separate, "mio").completed, false);

  let late = quiet(32);
  const earlierPair = assignSelection(late, ["aki", "mio"], "eat");
  assert.equal(earlierPair.error, undefined);
  late = advance(earlierPair.state, 6);
  late = finish(assign(late, "eat", "ren"), "ren");
  assert.equal(getWishProgress(late, "mio").completed, false);
});

test("Ren's wish belongs to the person who collected and returned, not every nearby resident", () => {
  let state = quiet(25);
  state = move(state, "shelter", "ren");
  state = finish(assign(state, "gather", "ren"), "ren");
  assert.equal(getWishProgress(state, "ren").completed, false);
  state = move(state, "home", "ren");
  assert.equal(getWishProgress(state, "ren").completed, true);

  let otherCollector = quiet(25);
  otherCollector = move(otherCollector, "shelter");
  otherCollector = finish(assign(otherCollector, "gather"));
  otherCollector = move(otherCollector, "home");
  assert.equal(getWishProgress(otherCollector, "ren").completed, false);
});

test("Ren can still satisfy the supply wish in the garden after someone else used the one-time side route", () => {
  let state = quiet(63);
  state = move(state, "shelter");
  state = finish(assign(state, "gather"));
  state = move(state, "home");
  assert.equal(state.flags.safeSuppliesRecovered, true);
  assert.equal(getWishProgress(state, "ren").completed, false);
  state = move(state, "garden", "ren");
  state = assign(state, "gather", "ren");
  assert.equal(getWishProgress(state, "ren").completed, false);
  state = finish(state, "ren");
  assert.equal(getWishProgress(state, "ren").completed, true);
  const completion = state.life!.wishes.ren;
  const source = state.life!.events.find(
    (event) => event.id === completion.eventId,
  );
  assert.ok(source);
  assert.equal(source.kind, "supply");
  assert.equal(source.location, "garden");
  assert.deepEqual(source.actors, ["ren"]);
  assert.deepEqual(deserialize(serialize(state)), state);
});

test("A morning reflection is produced once from a known prior experience and survives a split save replay", () => {
  let state = madeAndShelved(quietNight());
  state = finish(assign(state, "place-craft"));
  assert.equal(getResidentLife(state, "aki").reflection, undefined);
  state = assign(state, "sleep");
  const morning = 1440 + 480;
  state = reachTimeWithoutCareWarning(state, morning - 2);
  const saved = serialize(state);
  const whole = advance(state, 2);
  const split = advance(advance(deserialize(saved), 1), 1);
  assert.deepEqual(split, whole);
  assert.equal(whole.minutes, morning);
  const reflection = getResidentLife(whole, "aki").reflection;
  assert.ok(reflection);
  assert.equal(reflection.residentId, "aki");
  assert.equal(reflection.time, morning);
  const source = whole.life!.events.find(
    (event) => event.id === reflection.eventId,
  );
  assert.ok(source, "A reflection must refer to a real recorded experience");
  assert.ok(source.actors.includes("aki") || source.witnesses.includes("aki"));
  assert.ok(source.time < morning);
  const count = whole.life!.reflections.filter(
    (item) => item.residentId === "aki" && item.day === reflection.day,
  ).length;
  assert.equal(count, 1);
  const later = advance(deserialize(serialize(whole)), 1);
  assert.equal(
    later.life!.reflections.filter(
      (item) => item.residentId === "aki" && item.day === reflection.day,
    ).length,
    1,
    "Loading or advancing after 08:00 must not award the same reflection twice",
  );
});

test("A reflection does not call an after-midnight experience yesterday when it happened this morning", () => {
  let state = quiet(57);
  // Controlled clock fixture: the action itself still runs through normal
  // commands, saves, and minute updates from the early hours of day two.
  state.minutes = 1440 + 60;
  state = finish(assign(state, "hobby"));
  state = finish(assign(state, "sleep"));
  assert.equal(state.minutes, 1440 + 480);
  const reflection = getResidentLife(state, "aki").reflection;
  assert.ok(reflection);
  const source = state.life!.events.find(
    (event) => event.id === reflection.eventId,
  );
  assert.ok(source);
  assert.ok(source.time >= 1440);
  assert.doesNotMatch(reflection.text, /昨日/);
});

test("An unconscious rescued person is not credited with knowing who carried them", () => {
  let state = quiet(46);
  resident(state).hp = 0;
  resident(state).wounds.body = 2;
  resident(state).location = "road";
  resident(state, "mio").location = "road";
  state = finish(assign(state, "rescue", "mio", "aki"), "mio");
  const rescue = state.life!.events.find((event) => event.kind === "rescue");
  assert.ok(rescue);
  assert.ok(rescue.actors.includes("mio"));
  assert.equal(rescue.actors.includes("aki"), false);
  assert.equal(rescue.witnesses.includes("aki"), false);
  assert.equal(
    getResidentLife(state, "aki").recentExperiences.some(
      (event) => event.id === rescue.id,
    ),
    false,
  );
  assert.ok(
    getResidentLife(state, "mio").recentExperiences.some(
      (event) => event.id === rescue.id,
    ),
  );
});

test("An observer's morning words distinguish seeing treatment from administering it", () => {
  let state = quietNight(83);
  resident(state, "ren").hp = 40;
  resident(state, "ren").wounds.arm = 1;
  state = finish(assign(state, "heal", "mio", "ren"), "mio");
  state = sleepAndReachMorning(state);
  const reflection = getResidentLife(state, "aki").reflection;
  assert.ok(reflection);
  const source = state.life!.events.find(
    (event) => event.id === reflection.eventId,
  );
  assert.ok(source);
  assert.equal(source.kind, "heal");
  assert.equal(source.actors.includes("aki"), false);
  assert.equal(source.subjectId, "ren");
  assert.doesNotMatch(reflection.text, /手当をした/);
  assert.match(reflection.text, /見|様子|受けるところ/);
});

test("Malformed attributed-life records are rejected before they replace a playable world", () => {
  const valid = madeAndShelved();
  const corruptions: Array<(state: GameState) => void> = [
    (state) => {
      state.life!.version = 99 as 1;
    },
    (state) => {
      state.life!.crafts[0].authorId = "absent-person";
    },
    (state) => {
      state.life!.crafts.push({ ...state.life!.crafts[0] });
    },
    (state) => {
      state.life!.crafts[0].createdAt = state.minutes + 1;
    },
    (state) => {
      state.life!.shelf!.location = "not-a-place" as "home";
    },
    (state) => {
      state.life!.events[0].witnesses.push("absent-person");
    },
    (state) => {
      state.life!.wishes.aki = {
        completedAt: state.minutes,
        eventId: state.nextId + 20,
      };
    },
  ];
  const before = serialize(valid);
  for (const corrupt of corruptions) {
    const broken = structuredClone(valid);
    corrupt(broken);
    assert.throws(() => deserialize(serialize(broken)));
  }
  assert.equal(serialize(valid), before);
  assert.deepEqual(deserialize(before), valid);
});

test("Morning priorities preserve each person's own fulfilled wish while a serious rescue can take precedence", () => {
  let fulfilled = madeAndShelved(quietNight());
  fulfilled = finish(assign(fulfilled, "place-craft"));
  fulfilled = move(fulfilled, "shelter", "ren");
  fulfilled = finish(assign(fulfilled, "gather", "ren"), "ren");
  fulfilled = move(fulfilled, "home", "ren");
  const meal = assignSelection(fulfilled, ["aki", "mio", "ren"], "eat");
  assert.equal(meal.error, undefined);
  fulfilled = finish(meal.state);
  for (const id of ["aki", "mio", "ren"])
    assert.equal(getWishProgress(fulfilled, id).completed, true);

  function nextMorning(state: GameState): GameState {
    return sleepAndReachMorning(state, ["aki", "mio", "ren"]);
  }

  const peacefulMorning = nextMorning(deserialize(serialize(fulfilled)));
  for (const [id, kind] of [
    ["aki", "display"],
    ["mio", "meal"],
    ["ren", "return"],
  ] as const) {
    const reflection = getResidentLife(peacefulMorning, id).reflection;
    assert.ok(reflection);
    assert.equal(reflection.eventId, fulfilled.life!.wishes[id].eventId);
    assert.equal(
      peacefulMorning.life!.events.find((event) => event.id === reflection.eventId)?.kind,
      kind,
    );
  }

  // Controlled injury fixture after those achievements: the conscious patient
  // and the carrier experience a real rescue action, so both know what happened.
  let rescued = deserialize(serialize(fulfilled));
  resident(rescued, "ren").location = "road";
  resident(rescued, "ren").hp = 20;
  rescued = move(rescued, "road");
  rescued = finish(assign(rescued, "rescue", "aki", "ren"));
  const rescueEvent = rescued.life!.events.find((event) => event.kind === "rescue");
  assert.ok(rescueEvent);
  rescued = nextMorning(rescued);
  for (const id of ["aki", "ren"]) {
    const reflection = getResidentLife(rescued, id).reflection;
    assert.ok(reflection);
    assert.equal(reflection.eventId, rescueEvent.id);
  }
  assert.equal(
    getResidentLife(rescued, "mio").reflection?.eventId,
    fulfilled.life!.wishes.mio.eventId,
    "An observer's rescue sighting should not displace her own fulfilled meal wish",
  );
});

test("Witnessing a return, a solo meal, or a conversation does not invent participation", () => {
  const cases = [
    {
      kind: "return",
      prepare: (state: GameState) => move(move(state, "road", "mio"), "home", "mio"),
      expected: /ミオが拠点へ帰ってきた/,
      forbidden: /家へ帰ってこられた|仲間と言葉を交わした/,
    },
    {
      kind: "meal",
      prepare: (state: GameState) => finish(assign(state, "eat", "mio"), "mio"),
      expected: /ミオが食事をとるところを見た/,
      forbidden: /食卓を囲んだ|仲間と言葉を交わした/,
    },
    {
      kind: "conversation",
      prepare: (state: GameState) => finish(assign(state, "socialize", "mio", "ren"), "mio"),
      expected: /言葉を交わすところを見た/,
      forbidden: /仲間と言葉を交わした/,
    },
  ];
  for (const scenario of cases) {
    let state = scenario.prepare(quietNight(104));
    state = sleepAndReachMorning(state);
    const reflection = getResidentLife(state, "aki").reflection;
    assert.ok(reflection, scenario.kind);
    const source = state.life!.events.find((event) => event.id === reflection.eventId);
    assert.ok(source, scenario.kind);
    assert.equal(source.kind, scenario.kind);
    assert.equal(source.actors.includes("aki"), false);
    assert.ok(source.witnesses.includes("aki"));
    assert.match(reflection.text, scenario.expected);
    assert.doesNotMatch(reflection.text, scenario.forbidden);
  }
});
