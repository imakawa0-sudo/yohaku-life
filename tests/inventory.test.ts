import test from "node:test";
import assert from "node:assert/strict";
import type { Action, GameState, Resident, Resources } from "../src/game/types.ts";
import {
  accessibleResources, addResourcesAt, changeEquipment, consumeActionResources,
  ensureInventory, freeBaseResources, getCarryLoad, ownFreeResources,
  reserveActionResources, totalResources, transferResources, validInventory,
} from "../src/game/inventory.ts";

const empty = (): Resources => ({ food: 0, ingredients: 0, medicine: 0, scrap: 0 });
function state(): GameState {
  const residents = ["aki", "mio", "ren"].map((id, index): Resident => ({
    id, name: id, role: "住民", traits: [], wish: "", location: "home",
    hp: 100, hunger: 100, energy: 100, mood: 50,
    skills: { cooking: 2, combat: 2, craft: 2 }, weapon: index === 0 ? "knife" : index === 1 ? "staff" : "spear",
    armor: false, policy: "rest", action: null, suspended: null,
    relations: {}, memories: [], wounds: { arm: 0, leg: 0, body: 0 },
  }));
  return { version: 1, minutes: 480, seed: 123, residents,
    resources: { food: 10, ingredients: 8, medicine: 3, scrap: 6 }, logs: [],
    enemy: { hp: 100, location: "ruins", defeated: false },
    flags: { decorated: false, hobbyFinished: false, suppliesRecovered: false }, nextId: 10, ended: false };
}
const resident = (s: GameState, id = "aki") => s.residents.find((r) => r.id === id)!;
const job = (id: number, reserved: Partial<Resources>, kind: Action["kind"] = "eat"): Action => ({
  id, kind, label: "作業", progress: 0, duration: 20, reserved,
});
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function must(result: string | undefined): void { assert.equal(result, undefined); }

test("Inventory projections remain pure on legacy saves and distinguish stock from free reservations", () => {
  const s = state();
  resident(s).action = job(1, { ingredients: 2 }, "cook");
  const before = JSON.stringify(s);
  freeze(s);
  assert.equal(freeBaseResources(s).ingredients, 6);
  assert.deepEqual(ownFreeResources(s, "aki"), empty());
  assert.equal(accessibleResources(s, "aki").food, 10);
  assert.equal(totalResources(s).ingredients, 8);
  assert.equal(getCarryLoad(s, "aki").weight, 0.5);
  assert.equal(validInventory(s), true);
  assert.equal(JSON.stringify(s), before);
});

test("Moving goods between base, person and local ground conserves resources, time and seed", () => {
  const s = state();
  const total = totalResources(s), clock = s.minutes, seed = s.seed;
  must(transferResources(s, "aki", "base", "aki", "food", 3));
  assert.equal(s.resources.food, 7);
  assert.equal(s.inventory!.packs.aki.food, 3);
  must(transferResources(s, "aki", "aki", "ground", "food", 2));
  assert.equal(s.inventory!.ground.home!.food, 2);
  must(transferResources(s, "aki", "ground", "aki", "food", 2));
  must(transferResources(s, "aki", "aki", "mio", "food", 1));
  must(transferResources(s, "mio", "mio", "base", "food", 1));
  assert.deepEqual(totalResources(s), total);
  assert.equal(s.minutes, clock);
  assert.equal(s.seed, seed);
  assert.equal(validInventory(s), true);
});

test("Remote, moving and unrelated-person transfers fail without any state mutation", () => {
  const s = state();
  ensureInventory(s).packs.aki.food = 3;
  resident(s, "mio").location = "road";
  for (const invoke of [
    () => transferResources(s, "aki", "aki", "mio", "food", 1),
    () => transferResources(s, "aki", "mio", "ren", "food", 1),
    () => transferResources(s, "aki", "aki", "ground", "food", -1),
    () => transferResources(s, "aki", "aki", "ground", "food", 0.5),
  ]) {
    const before = JSON.stringify(s);
    assert.ok(invoke());
    assert.equal(JSON.stringify(s), before);
  }
  resident(s).location = "road";
  assert.ok(transferResources(s, "aki", "base", "aki", "food", 1));
  resident(s).action = { id: 1, kind: "move", label: "移動", duration: 10, progress: 2 };
  const before = JSON.stringify(s);
  assert.ok(transferResources(s, "aki", "aki", "ground", "food", 1));
  assert.equal(JSON.stringify(s), before);
});

test("Automatic sharing locks medicine or food to the user before its donor leaves", () => {
  const s = state();
  const inv = ensureInventory(s);
  for (const r of s.residents) r.location = "road";
  inv.packs.mio.food = 2;
  inv.packs.mio.ingredients = 3;
  inv.packs.ren.food = 8;
  resident(s, "ren").action = { id: 4, kind: "move", label: "移動", duration: 10, progress: 0 };
  assert.equal(accessibleResources(s, "aki").food, 2);
  assert.equal(accessibleResources(s, "aki").ingredients, 0, "craft inputs are not silently borrowed");
  const a = job(1, { food: 1 });
  must(reserveActionResources(s, resident(s), a));
  resident(s).action = a;
  assert.equal(a.reservationSource, "pack");
  assert.deepEqual(a.materialTransfers, [{ from: "mio", resource: "food", amount: 1 }]);
  assert.equal(inv.packs.aki.food, 1);
  assert.equal(inv.packs.mio.food, 1);
  assert.equal(ownFreeResources(s, "aki").food, 0);
  resident(s, "mio").location = "village";
  consumeActionResources(s, resident(s), a);
  resident(s).action = null;
  assert.equal(inv.packs.aki.food, 0);
  assert.equal(inv.packs.mio.food, 1, "finishing does not consume a remote donor's second meal");
  assert.equal(validInventory(s), true);
});

test("Two users cannot reserve the same shared last item", () => {
  const s = state(), inv = ensureInventory(s);
  for (const r of s.residents) r.location = "meadow";
  inv.packs.mio.medicine = 1;
  const first = job(1, { medicine: 1 }, "heal");
  must(reserveActionResources(s, resident(s), first));
  resident(s).action = first;
  const before = JSON.stringify(s);
  const second = job(2, { medicine: 1 }, "heal");
  assert.ok(reserveActionResources(s, resident(s, "ren"), second));
  assert.equal(JSON.stringify(s), before);
  assert.equal(second.reservationSource, undefined);
  assert.equal(validInventory(s), true);
});

test("Existing base work keeps its material in base stock until actual completion", () => {
  const s = state(), a = job(1, { ingredients: 2 }, "cook");
  must(reserveActionResources(s, resident(s), a));
  resident(s).action = a;
  assert.equal(a.reservationSource, "base");
  assert.equal(s.resources.ingredients, 8);
  assert.equal(freeBaseResources(s).ingredients, 6);
  assert.equal(s.inventory, undefined, "a base-only reservation does not create unrelated pack data");
  consumeActionResources(s, resident(s), a);
  resident(s).action = null;
  assert.equal(s.resources.ingredients, 6);
});

test("Mixed-source reservation is atomic and uses personal material before borrowing", () => {
  const s = state(), inv = ensureInventory(s);
  inv.packs.aki.food = 1;
  inv.packs.mio.food = 2;
  s.resources.food = 0;
  s.resources.medicine = 0;
  const before = JSON.stringify(s);
  assert.ok(reserveActionResources(s, resident(s), job(1, { food: 2, medicine: 1 })));
  assert.equal(JSON.stringify(s), before, "failure on a later key must not move an earlier material");
  const a = job(2, { food: 2 });
  must(reserveActionResources(s, resident(s), a));
  resident(s).action = a;
  assert.equal(inv.packs.aki.food, 2);
  assert.equal(inv.packs.mio.food, 1);
  assert.deepEqual(a.materialTransfers, [{ from: "mio", resource: "food", amount: 1 }]);
});

test("Active and suspended pack reservations protect their items, and cancellation releases only its lock", () => {
  const s = state(), inv = ensureInventory(s);
  inv.packs.aki.food = 2;
  const active = job(1, { food: 1 }), paused = job(2, { food: 1 });
  active.reservationSource = paused.reservationSource = "pack";
  resident(s).action = active;
  resident(s).suspended = paused;
  assert.equal(ownFreeResources(s, "aki").food, 0);
  const before = JSON.stringify(s);
  assert.ok(transferResources(s, "aki", "aki", "base", "food", 1));
  assert.equal(JSON.stringify(s), before);
  resident(s).suspended = null;
  assert.equal(ownFreeResources(s, "aki").food, 1);
  must(transferResources(s, "aki", "aki", "base", "food", 1));
  assert.equal(inv.packs.aki.food, 1);
  assert.equal(validInventory(s), true);
});

test("Local production has a physical destination and totals include ground without making it remotely usable", () => {
  const s = state();
  addResourcesAt(s, resident(s), { food: 3 });
  assert.equal(s.resources.food, 13);
  resident(s).location = "meadow";
  addResourcesAt(s, resident(s), { scrap: 4 });
  assert.equal(s.resources.scrap, 6);
  assert.equal(s.inventory!.packs.aki.scrap, 4);
  must(transferResources(s, "aki", "aki", "ground", "scrap", 2));
  resident(s).location = "village";
  assert.equal(totalResources(s).scrap, 10);
  assert.equal(accessibleResources(s, "aki").scrap, 2);
  assert.ok(transferResources(s, "aki", "ground", "aki", "scrap", 1));
});

test("Equipment exchanges conserve real items and stage all requested changes before applying any", () => {
  const s = state(), inv = ensureInventory(s), r = resident(s);
  const count = (weapon: Resident["weapon"]) => inv.baseGear[weapon] + s.residents.filter((p) => p.weapon === weapon).length;
  const counts = [count("knife"), count("spear"), count("staff")];
  must(changeEquipment(s, r, "spear", true));
  assert.equal(r.weapon, "spear");
  assert.equal(r.armor, true);
  assert.deepEqual([count("knife"), count("spear"), count("staff")], counts);
  const before = JSON.stringify(s);
  must(changeEquipment(s, r, "spear", true));
  assert.equal(JSON.stringify(s), before, "requesting the same gear does not generate another item");
  inv.baseGear.armor = 0;
  const mio = resident(s, "mio"), failed = JSON.stringify(s);
  assert.ok(changeEquipment(s, mio, "knife", true));
  assert.equal(JSON.stringify(s), failed, "unavailable armour does not partially swap the weapon");
  r.location = "road";
  assert.ok(changeEquipment(s, r, "knife"));
});

test("Carried reserved goods and worn equipment weigh normally, while overload still permits movement", () => {
  const s = state(), inv = ensureInventory(s), r = resident(s);
  inv.packs.aki.food = 23;
  assert.equal(getCarryLoad(s, "aki").weight, 12);
  assert.equal(getCarryLoad(s, "aki").multiplier, 1);
  r.action = job(1, { food: 1 });
  r.action.reservationSource = "pack";
  assert.equal(getCarryLoad(s, "aki").weight, 12, "reserving an item does not make it weightless");
  inv.packs.aki.scrap = 12;
  assert.equal(getCarryLoad(s, "aki").weight, 24);
  assert.equal(getCarryLoad(s, "aki").multiplier, 1.25);
  r.wounds.arm = r.wounds.body = 3;
  const load = getCarryLoad(s, "aki");
  assert.equal(load.capacity, 8);
  assert.equal(load.label, "過積載");
  assert.equal(load.multiplier, 1.75);
  assert.ok(Number.isFinite(load.multiplier));
});

test("Rescue adds a patient's body and their belongings without changing ownership or recursing", () => {
  const s = state(), inv = ensureInventory(s);
  resident(s).location = resident(s, "mio").location = "road";
  resident(s).hp = 30;
  resident(s, "mio").hp = 20;
  inv.packs.mio.scrap = 4;
  resident(s).action = { id: 1, kind: "rescue", target: "mio", label: "救助", progress: 0, duration: 20 };
  const before = JSON.stringify(s);
  assert.equal(getCarryLoad(s, "aki").weight, 60.5);
  assert.equal(getCarryLoad(s, "mio").weight, 5);
  assert.equal(JSON.stringify(s), before);
  resident(s, "mio").action = { id: 2, kind: "rescue", target: "aki", label: "境界", progress: 0, duration: 20 };
  assert.equal(getCarryLoad(s, "aki").weight, 60.5, "a malformed cycle cannot cause recursive load evaluation");
});

test("An obsolete home rescue or unconscious carrier cannot lock local supplies or add phantom carrying weight", () => {
  for (const slot of ["action", "suspended"] as const) {
    const s = state(), inv = ensureInventory(s), patient = resident(s), carrier = resident(s, "mio");
    patient.hp = 20;
    carrier[slot] = { id: 1, kind: "rescue", target: "aki", label: "古い救助", progress: 1, duration: 20 };
    assert.equal(accessibleResources(s, "aki").food, 10, "already-home patients can use their base again");
    assert.equal(getCarryLoad(s, "mio").weight, 1, "a home patient is not still being carried");
    must(transferResources(s, "aki", "base", "aki", "food", 1));
    assert.equal(inv.packs.aki.food, 1);

    patient.location = carrier.location = "road";
    carrier.hp = 0;
    inv.packs.ren.food = 1;
    resident(s, "ren").location = "road";
    assert.equal(accessibleResources(s, "aki").food, 2, "a collapsed old carrier cannot block another person's help");
    must(transferResources(s, "aki", "ren", "aki", "food", 1));
    assert.equal(getCarryLoad(s, "mio").weight, 1);
  }
});

test("A valid paused outside rescue still protects its patient until the claim stops being physically valid", () => {
  const s = state(), inv = ensureInventory(s), patient = resident(s), carrier = resident(s, "mio");
  patient.location = carrier.location = resident(s, "ren").location = "road";
  patient.hp = 20;
  carrier.suspended = { id: 1, kind: "rescue", target: "aki", label: "救助", progress: 1, duration: 20 };
  inv.packs.ren.food = 1;
  assert.equal(accessibleResources(s, "aki").food, 0);
  assert.ok(transferResources(s, "aki", "ren", "aki", "food", 1));
  patient.hp = 36;
  assert.equal(accessibleResources(s, "aki").food, 1, "a recovered person is no longer treated as a carried casualty");
  must(transferResources(s, "aki", "ren", "aki", "food", 1));
});

test("Inventory validation rejects malformed ownership, negative or reserved-away stock, and unknown ground locations", () => {
  const good = state();
  good.version = 2;
  assert.equal(validInventory(good), false);
  ensureInventory(good);
  assert.equal(validInventory(good), true);
  const mutations: ((s: GameState) => void)[] = [
    (s) => { s.inventory!.packs.stranger = empty(); },
    (s) => { delete s.inventory!.packs.aki; },
    (s) => { s.inventory!.packs.aki.food = -1; },
    (s) => { s.inventory!.packs.aki.food = Infinity; },
    (s) => { (s.inventory!.ground as Record<string, Resources>).unknown = empty(); },
    (s) => { s.inventory!.baseGear.knife = 0.5; },
    (s) => { resident(s).action = { ...job(1, { food: 1 }), reservationSource: "pack" }; },
    (s) => { resident(s).action = { ...job(1, { food: 1 }), materialTransfers: [{ from: "stranger", resource: "food", amount: 1 }] }; },
    (s) => {
      s.inventory!.packs.aki.food = 1;
      resident(s).action = { ...job(1, { food: 1 }), reservationSource: "pack",
        materialTransfers: [{ from: "mio", resource: "food", amount: 2 }] };
    },
  ];
  for (const mutate of mutations) {
    const broken = structuredClone(good);
    mutate(broken);
    const before = JSON.stringify(broken);
    assert.equal(validInventory(broken), false);
    assert.equal(JSON.stringify(broken), before);
  }
  const current = structuredClone(good);
  current.inventory!.ground.village = empty();
  assert.equal(validInventory(current), true);
  assert.equal(validInventory(current, ["home"]), false);
});

test("Legacy migration cannot create an unfunded personal reservation that later spends a negative meal", async () => {
  const { createGame, deserialize, serialize, advance } = await import("../src/game/engine.ts");
  const legacy = createGame(77);
  legacy.version = 1;
  delete legacy.inventory;
  delete legacy.region;
  for (const r of legacy.residents) { r.policy = "rest"; r.hunger = 100; r.energy = 100; }
  const a = { ...job(legacy.nextId++, { food: 1 }), duration: 15, origin: "home" as const };
  resident(legacy).action = a;
  const forged = structuredClone(legacy);
  resident(forged).action!.reservationSource = "pack";
  assert.equal(validInventory(forged), false);
  assert.throws(() => deserialize(serialize(forged)), /保存データ/);

  const migrated = deserialize(serialize(legacy));
  assert.equal(migrated.version, 3);
  assert.equal(validInventory(migrated), true);
  assert.equal(migrated.inventory!.packs.aki.food, 0);
  const finished = advance(migrated, 15);
  assert.equal(finished.resources.food, legacy.resources.food - 1);
  assert.equal(finished.inventory!.packs.aki.food, 0);
  assert.equal(validInventory(finished), true);
});
