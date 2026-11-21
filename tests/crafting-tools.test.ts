import test from "node:test";
import assert from "node:assert/strict";
import {
  advance, command, createGame, deserialize, getCraftSubjectChoices, getLocalProjectEffects,
  getProjectDuration, knowsCraft, serialize,
} from "../src/game/engine.ts";
import { freeBaseResources } from "../src/game/inventory.ts";
import type { ActionKind, Command, GameState } from "../src/game/types.ts";

const person = (s: GameState, id = "aki") => s.residents.find(resident => resident.id === id)!;
function act(s: GameState, cmd: Command): GameState {
  const result = command(s, cmd);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
const assign = (s: GameState, kind: ActionKind, id = "aki", target?: string) =>
  act(s, { type: "assign", residentIds: [id], kind, target });
function quiet(seed = 901): GameState {
  let s = createGame(seed);
  s.resources = { food: 50, ingredients: 50, medicine: 4, scrap: 40 };
  for (const resident of s.residents) {
    resident.hp = resident.hunger = resident.energy = 100;
    s = act(s, { type: "policy", residentId: resident.id, policy: "rest" });
  }
  return s;
}
function finish(s: GameState, id = "aki"): GameState {
  const jobId = person(s, id).action?.id;
  assert.ok(jobId);
  for (let minute = 0; minute < 1200; minute++) {
    if (person(s, id).action?.id !== jobId) return s;
    s = advance(s, 1);
  }
  assert.fail("The actual action did not finish");
}
const built = (s = quiet()) => finish(assign(s, "project", "aki", "crafting-tools"));
const tools = (s: GameState) => s.life!.upgrades!.find(upgrade => upgrade.recipeId === "crafting-tools")!;
function rejected(s: GameState, cmd: Command) {
  const before = serialize(s), result = command(s, cmd);
  assert.ok(result.error);
  assert.strictEqual(result.state, s);
  assert.equal(serialize(s), before);
}

test("A real workbench reserves three materials, retains five held minutes, completes once and stays globally unique", () => {
  let s = quiet(902);
  person(s, "aki").location = "village";
  person(s, "mio").location = "bedroom";
  s = finish(assign(s, "move", "ren", "kitchen"), "ren");
  const absentMemories = [structuredClone(person(s, "aki").memories), structuredClone(person(s, "mio").memories)];
  s = assign(s, "project", "ren", "crafting-tools");
  const job = structuredClone(person(s, "ren").action)!;
  assert.equal(job.craftingToolsId, undefined, "The unfinished workbench cannot shorten its own construction");
  assert.equal(job.duration, 45);
  assert.equal(s.resources.scrap, 40);
  assert.equal(freeBaseResources(s).scrap, 37);
  rejected(s, { type: "assign", residentIds: ["mio"], kind: "project", target: "crafting-tools" });
  s = advance(s, 5);
  s = act(s, { type: "pause", residentId: "ren" });
  const held = structuredClone(person(s, "ren").suspended);
  rejected(s, { type: "assign", residentIds: ["mio"], kind: "project", target: "crafting-tools" });
  s = deserialize(serialize(s));
  assert.deepEqual(person(s, "ren").suspended, held);
  s = finish(act(s, { type: "resume", residentId: "ren" }), "ren");
  assert.equal(s.resources.scrap, 37);
  assert.deepEqual(tools(s), { id: job.id, recipeId: "crafting-tools", creatorId: "ren", location: "kitchen", completedAt: s.minutes });
  const experience = s.life!.events.find(event => event.projectId === job.id)!;
  assert.deepEqual(experience.actors, ["ren"]);
  assert.deepEqual(experience.witnesses, ["ren"]);
  assert.ok(experience.id > job.id);
  assert.deepEqual(person(s, "aki").memories, absentMemories[0]);
  assert.deepEqual(person(s, "mio").memories, absentMemories[1]);
  assert.match(s.logs.at(-1)!.text, /手仕事台/);
  assert.doesNotMatch(s.logs.at(-1)!.text, /静かな休憩場所/);
  rejected(s, { type: "assign", residentIds: ["mio"], kind: "project", target: "crafting-tools" });
  s = advance(deserialize(serialize(s)), 5);
  assert.equal(s.life!.upgrades!.filter(upgrade => upgrade.recipeId === "crafting-tools").length, 1);
  assert.equal(s.resources.scrap, 37);
});

test("Cancellation releases the material reservation and a replacement build receives a new identity", () => {
  let s = advance(assign(quiet(903), "project", "aki", "crafting-tools"), 5);
  const oldId = person(s).action!.id;
  s = act(s, { type: "pause", residentId: "aki" });
  s = act(deserialize(serialize(s)), { type: "cancel", residentId: "aki", actionId: oldId });
  assert.equal(s.resources.scrap, 40);
  assert.equal(freeBaseResources(s).scrap, 40);
  assert.equal(s.life?.upgrades?.length ?? 0, 0);
  s = assign(s, "project", "mio", "crafting-tools");
  assert.notEqual(person(s, "mio").action!.id, oldId);
  s = finish(s, "mio");
  assert.equal(tools(s).creatorId, "mio");
  assert.equal(s.resources.scrap, 37);
});

test("Only new local hobby and projects receive one final rounding of skill, arm and workbench effects", () => {
  const local = built(quiet(904)), plain = quiet(905);
  for (const s of [local, plain]) { person(s).skills.craft = 2; person(s).wounds.arm = 1; }
  assert.equal(getLocalProjectEffects(local, "home").craftingMultiplier, 0.75);
  assert.equal(getLocalProjectEffects(local, "kitchen").craftingMultiplier, 1);
  assert.equal(getLocalProjectEffects(plain, "home").craftingMultiplier, 1);
  const expected = { "wood-flower": 46, "kitchen-tools": 47, "rest-corner": 42 };
  for (const [recipe, duration] of Object.entries(expected)) {
    const next = assign(local, "project", "aki", recipe);
    assert.equal(person(next).action!.duration, duration);
    assert.equal(getProjectDuration(local, "aki", recipe), duration);
    assert.equal(person(next).action!.craftingToolsId, tools(local).id);
  }
  assert.equal(person(assign(local, "hobby")).action!.duration, 43);
  assert.equal(person(assign(plain, "hobby")).action!.duration, 57);
  person(local).skills.craft = 10;
  assert.equal(person(assign(local, "hobby")).action!.duration, 43, "The old hobby's base remains 45 regardless of skill");
  for (const kind of ["cook", "decorate", "socialize"] as const) {
    const old = assign(plain, kind, "aki", kind === "socialize" ? "mio" : undefined);
    const next = assign(local, kind, "aki", kind === "socialize" ? "mio" : undefined);
    assert.equal(person(next).action!.duration, person(old).action!.duration);
    assert.equal(person(next).action!.craftingToolsId, undefined);
  }
  const elsewhere = finish(assign(local, "move", "aki", "kitchen"));
  assert.equal(person(assign(elsewhere, "hobby")).action!.duration, 57);
  assert.equal(person(assign(elsewhere, "hobby")).action!.craftingToolsId, undefined);
});

test("Completion leaves older active and held durations untouched, while a same-minute new action records the completed workbench", () => {
  let s = advance(assign(quiet(906), "project", "aki", "crafting-tools"), 35);
  s = assign(s, "hobby", "mio");
  s = assign(s, "project", "ren", "wood-flower");
  s = advance(s, 1);
  s = act(s, { type: "pause", residentId: "ren" });
  const oldActive = structuredClone(person(s, "mio").action)!;
  const oldHeld = structuredClone(person(s, "ren").suspended)!;
  s = advance(s, 4);
  assert.equal(person(s, "mio").action!.id, oldActive.id);
  assert.equal(person(s, "mio").action!.duration, 45);
  assert.equal(person(s, "mio").action!.progress, 5);
  assert.equal(person(s, "mio").action!.craftingToolsId, undefined);
  assert.deepEqual(person(s, "ren").suspended, oldHeld);
  const newer = assign(s, "hobby", "mio");
  const job = person(newer, "mio").action!;
  const event = s.life!.events.find(experience => experience.projectId === tools(s).id)!;
  assert.equal(newer.minutes, s.minutes);
  assert.equal(job.duration, 34);
  assert.equal(job.craftingToolsId, tools(s).id);
  assert.ok(event.id < job.id);
  assert.equal(person(newer, "mio").suspended!.id, oldActive.id);
  assert.equal(person(newer, "mio").suspended!.duration, 45);
  assert.deepEqual(deserialize(serialize(newer)), newer);
  const resumed = act(deserialize(serialize(s)), { type: "resume", residentId: "ren" });
  assert.deepEqual(person(resumed, "ren").action, oldHeld);
  assert.equal(finish(resumed, "ren").life!.crafts.filter(piece => piece.authorId === "ren").length, 1);
  const oldDone = finish(s, "mio");
  assert.equal(oldDone.life!.crafts.filter(piece => piece.authorId === "mio").length, 1);
  for (const slot of ["action", "suspended"] as const) {
    const forged = structuredClone(s), owner = slot === "action" ? "mio" : "ren";
    person(forged, owner)[slot]!.craftingToolsId = tools(s).id;
    assert.ok(tools(s).id < person(forged, owner)[slot]!.id, "The construction start alone would falsely look earlier");
    assert.throws(() => deserialize(serialize(forged)), /保存データ/);
  }
});

test("A workbench and an older bird can finish in the same minute without retroactive timing or duplicate results", () => {
  let s = advance(assign(quiet(907), "hobby", "mio"), 5);
  s = assign(s, "project", "aki", "crafting-tools");
  const birdId = person(s, "mio").action!.id;
  s = advance(s, 40);
  const bird = s.life!.crafts.find(piece => piece.id === birdId)!;
  assert.ok(bird);
  assert.equal(bird.createdAt, tools(s).completedAt);
  assert.equal(s.life!.crafts.filter(piece => piece.id === birdId).length, 1);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("A marked held job keeps its exact provenance across travel, failed remote resume, return and cancellation", () => {
  let s = advance(assign(built(quiet(908)), "project", "mio", "wood-flower"), 5);
  s = act(s, { type: "pause", residentId: "mio" });
  const job = structuredClone(person(s, "mio").suspended)!;
  assert.equal(job.duration, 37);
  assert.deepEqual(job.reserved, { scrap: 1 });
  assert.equal(job.craftingToolsId, tools(s).id);
  s = finish(assign(s, "move", "mio", "kitchen"), "mio");
  s = deserialize(serialize(s));
  rejected(s, { type: "resume", residentId: "mio" });
  assert.deepEqual(person(s, "mio").suspended, job);
  s = finish(assign(s, "move", "mio", "home"), "mio");
  s = act(s, { type: "resume", residentId: "mio" });
  assert.deepEqual(person(s, "mio").action, job);
  const completed = advance(finish(deserialize(serialize(s)), "mio"), 5);
  assert.equal(completed.life!.crafts.filter(piece => piece.id === job.id).length, 1);
  assert.equal(completed.resources.scrap, 36);
  s = act(s, { type: "cancel", residentId: "mio", actionId: job.id });
  assert.equal(person(s, "mio").action, null);
  assert.equal(s.life!.crafts.some(piece => piece.id === job.id), false);
  assert.equal(freeBaseResources(s).scrap, 37);
});

test("Help stays ten minutes and twelve progress, and an obsolete helper cannot accelerate a replacement project", () => {
  const prepared = built(quiet(909));
  person(prepared).skills.craft = 0;
  let s = assign(assign(prepared, "project", "aki", "wood-flower"), "help", "mio", "aki");
  assert.equal(person(s, "mio").action!.duration, 10);
  assert.equal(person(s, "mio").action!.craftingToolsId, undefined);
  s = advance(s, 10);
  assert.equal(person(s).action!.progress, 22);
  const duration = person(s).action!.duration;
  assert.equal(duration, 42);
  s = finish(deserialize(serialize(s)));
  assert.equal(s.life!.crafts.length, 1);
  assert.equal(s.life!.events.filter(event => event.kind === "help").length, 1);
  s = advance(s, 5);
  assert.equal(s.life!.crafts.length, 1);
  let obsolete = assign(assign(prepared, "project", "aki", "wood-flower"), "help", "mio", "aki");
  const oldId = person(obsolete).action!.id;
  obsolete = act(obsolete, { type: "cancel", residentId: "aki", actionId: oldId });
  obsolete = assign(obsolete, "project", "aki", "wood-flower");
  const relations = structuredClone(obsolete.residents.map(resident => resident.relations));
  assert.notEqual(person(obsolete).action!.id, oldId);
  obsolete = advance(deserialize(serialize(obsolete)), 10);
  assert.equal(person(obsolete).action!.progress, 10);
  assert.equal(obsolete.life!.events.some(event => event.kind === "help"), false);
  assert.deepEqual(obsolete.residents.map(resident => resident.relations), relations);
});

test("Subject work uses the same local duration without sharing the original landscape experience", () => {
  let s = quiet(910);
  s = finish(assign(s, "move", "aki", "shelter"));
  s = finish(assign(s, "observe"));
  const scene = structuredClone(s.life!.events.find(event => event.kind === "quiet")!);
  s = finish(assign(s, "move", "aki", "home"));
  s = built(s);
  for (const [kind, recipe] of [["hobby", undefined], ["project", "wood-flower"]] as const) {
    const ordinary = assign(s, kind, "aki", recipe);
    s = act(s, { type: "assign", residentIds: ["aki"], kind, target: recipe, subjectEventId: scene.id });
    assert.equal(person(s).action!.duration, person(ordinary).action!.duration);
    assert.equal(person(s).action!.craftingToolsId, tools(s).id);
    const old = serialize(s);
    rejected(s, { type: "assign", residentIds: ["aki"], kind: "project", target: "crafting-tools", subjectEventId: scene.id });
    assert.equal(serialize(s), old);
    s = finish(deserialize(serialize(s)));
    assert.equal(s.life!.crafts.at(-1)!.subjectEventId, scene.id);
    assert.equal(s.life!.crafts.at(-1)!.authorId, "aki");
  }
  assert.deepEqual(s.life!.events.find(event => event.id === scene.id), scene);
  assert.deepEqual(getCraftSubjectChoices(s, "mio"), []);
  assert.deepEqual(getCraftSubjectChoices(s, "ren"), []);
});

test("A one-sided held introduction remains twenty minutes and gives no work recognition to an unrelated builder", () => {
  let s = finish(assign(quiet(911), "move", "ren", "kitchen"), "ren");
  s = finish(assign(s, "hobby"));
  const craftId = s.life!.crafts[0].id;
  s = finish(assign(s, "move", "ren", "home"), "ren");
  assert.equal(knowsCraft(s, "ren", craftId), false);
  s = act(s, { type: "discuss-craft", residentIds: ["aki", "mio"], craftId });
  s = advance(s, 3);
  s = act(s, { type: "pause", residentId: "mio" });
  const first = structuredClone(person(s).action), second = structuredClone(person(s, "mio").suspended);
  s = finish(assign(s, "project", "ren", "crafting-tools"), "ren");
  assert.deepEqual(person(s).action, first);
  assert.deepEqual(person(s, "mio").suspended, second);
  assert.equal(first!.duration, 20);
  assert.equal(first!.craftingToolsId, undefined);
  assert.equal(second!.craftingToolsId, undefined);
  assert.equal(knowsCraft(s, "ren", craftId), false);
  s = act(deserialize(serialize(s)), { type: "resume", residentId: "mio" });
  s = finish(s);
  assert.equal(s.life!.events.filter(event => event.topic?.craftId === craftId).length, 1);
  assert.equal(knowsCraft(s, "ren", craftId), false);
});

test("Legacy saves stay unmodified and strict loading rejects fake equipment, duplicates and invalid workbench provenance", () => {
  for (const version of [1, 2, 3] as const) {
    const old = quiet(912);
    old.version = version;
    if (version === 1) { delete old.inventory; delete old.region; }
    const before = serialize(old);
    assert.equal(getLocalProjectEffects(old, "home").craftingMultiplier, 1);
    assert.equal(serialize(old), before);
    const loaded = deserialize(before);
    assert.equal(loaded.life?.upgrades, undefined);
    assert.equal(person(assign(loaded, "hobby")).action!.duration, 45);
  }
  const complete = built(quiet(913));
  const marked = assign(complete, "hobby");
  const event = marked.life!.events.find(experience => experience.projectId === tools(marked).id)!;
  const bad: ((s: GameState) => void)[] = [
    s => { person(s).action!.craftingToolsId = 0; },
    s => { person(s).action!.craftingToolsId = 1.5; },
    s => { person(s).action!.craftingToolsId = s.nextId; },
    s => { person(s).action!.origin = "kitchen"; },
    s => { person(s).action!.kind = "rest"; },
    s => { tools(s).recipeId = "kitchen-tools"; },
    s => { tools(s).recipeId = "unknown-tools" as never; },
    s => { tools(s).id = s.logs[0].id; },
    s => { tools(s).creatorId = "unknown"; },
    s => { tools(s).completedAt++; },
    s => { s.life!.events = s.life!.events.filter(experience => experience.id !== event.id); },
    s => { s.life!.upgrades!.push({ ...tools(s), id: s.nextId++ }); },
    s => { person(s).suspended = { id: s.nextId++, kind: "project", label: "手仕事台", target: "crafting-tools", origin: "home", duration: 40, progress: 0, reserved: { scrap: 3 } }; },
    s => { (s.life as unknown as Record<string, unknown>).upgrades = [null]; },
    s => { (s.life as unknown as Record<string, unknown>).events = [null]; },
  ];
  for (const change of bad) {
    const corrupt = structuredClone(marked);
    change(corrupt);
    assert.throws(() => deserialize(serialize(corrupt)), /保存データ/);
  }
  const inProgress = assign(quiet(914), "project", "aki", "crafting-tools");
  for (const slot of ["action", "suspended"] as const) {
    const corrupt = structuredClone(inProgress);
    person(corrupt, "mio")[slot] = { ...person(corrupt).action!, id: corrupt.nextId++ };
    assert.throws(() => deserialize(serialize(corrupt)), /保存データ/);
  }
  assert.deepEqual(deserialize(serialize(marked)), marked);
  const withoutProvenance = structuredClone(marked);
  delete person(withoutProvenance).action!.craftingToolsId;
  assert.deepEqual(deserialize(serialize(withoutProvenance)), withoutProvenance, "Absent old provenance is accepted without inferring it");
});
