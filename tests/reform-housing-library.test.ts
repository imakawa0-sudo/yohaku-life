import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { confirmHandbookWrite } from "../src/reform/handbookUi";
import * as saves from "../src/reform/library";
import { initialHouse } from "../src/reform/house";
import { makePersona } from "../src/reform/peopleModel";
import {
  advance,
  createGame,
  enableHousing,
  isGame,
  nextCompletionMinutes,
  order,
  type Task,
} from "../src/reform/sim";
import { defaultWorldConfig, generateWorld } from "../src/reform/world";

const v1 = "yohaku-reform-library-v1";
const v2 = "yohaku-reform-library-v2";

function legacySlot(): saves.Slot {
  const origin = createGame(
    [makePersona(0, 23)],
    generateWorld(defaultWorldConfig()),
    "village",
    initialHouse(),
  );
  const game = advance(
    order(origin, origin.actors[0].person.id, "work", "cook"),
    2,
  );
  return { id: "original", name: "料理の途中", game, origin };
}

function libraryRaw(slot: saves.Slot, format: 1 | 2): string {
  return JSON.stringify({ format, activeId: slot.id, slots: [slot] });
}

function envelopeRaw(slot: saves.Slot, version: 1 | 2): string {
  return JSON.stringify({ type: "yohaku-reform-save", version, slot });
}

function serialized<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function fakeStorage(t: TestContext, initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial));
  const reads: string[] = [];
  const writes: string[] = [];
  const failures = { read: "", write: false };
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key: string) {
        reads.push(key);
        if (failures.read === key)
          throw new DOMException("Denied", "SecurityError");
        return entries.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        if (failures.write)
          throw new DOMException("Full", "QuotaExceededError");
        writes.push(key);
        entries.set(key, value);
      },
    },
  });
  t.after(() => {
    if (descriptor)
      Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  return { entries, reads, writes, failures };
}

test("first copy preserves the original key and legacy slot while adding an explicit housing fork", (t) => {
  const original = legacySlot();
  const legacyRaw = libraryRaw(original, 1);
  const { entries, writes } = fakeStorage(t, { [v1]: legacyRaw });
  assert.equal(saves.LIBRARY_KEY, v2);
  assert.equal(saves.LEGACY_LIBRARY_KEY, v1);

  const initial = saves.readLocal();
  const source = initial.library.slots[0];
  assert.equal(initial.raw, null);
  assert.equal(initial.legacyRaw, legacyRaw);
  assert.equal(initial.library.format, 2);
  assert.equal(initial.blocked, false);
  assert.ok(initial.warning, "the first-copy behavior is explained");
  assert.deepEqual(source, original);
  assert.deepEqual(writes, []);

  const fork = saves.upgradeHousingSlot(source, "住居のある暮らし");
  const next = saves.appendSlot(initial.library, fork);
  const result = saves.writeLocal(next, initial.raw, initial.legacyRaw);
  assert.equal(result.status, "saved");
  assert.equal(entries.get(v2), result.raw);
  assert.deepEqual(writes, [v2]);
  assert.equal(entries.get(v1), legacyRaw);
  assert.equal(libraryRaw(source, 1), legacyRaw);

  const reloaded = saves.readLocal();
  assert.deepEqual(reloaded.library, serialized(next));
  assert.equal(reloaded.raw, result.raw);
  assert.equal(reloaded.legacyRaw, undefined);
  assert.equal(reloaded.library.activeId, fork.id);
  assert.equal(reloaded.library.slots[0].game.housing, undefined);
  assert.ok(reloaded.library.slots[1].game.housing);
});

test("housing fork independently initializes the source's distinct game and origin without restarting cooking", () => {
  const original = legacySlot();
  const originalRaw = libraryRaw(original, 1);
  const fork = saves.upgradeHousingSlot(original, "住居のある暮らし");
  const actorId = original.game.actors[0].person.id;
  assert.notEqual(fork.id, original.id);
  assert.equal(fork.name, "住居のある暮らし");
  assert.equal(fork.game.housing?.state.time, original.game.time);
  assert.equal(fork.origin.housing?.state.time, original.origin.time);
  assert.notEqual(fork.game.time, fork.origin.time);
  assert.equal(fork.game.rng, original.game.rng);
  assert.equal(fork.origin.rng, original.origin.rng);
  assert.equal(
    fork.game.housing?.unlocated[actorId]?.reason,
    "legacy-unspecified",
  );
  assert.equal(
    fork.origin.housing?.unlocated[actorId]?.reason,
    "legacy-unspecified",
  );
  const oldTask = original.game.actors[0].task;
  assert.ok(oldTask);
  assert.ok(oldTask.remaining < oldTask.total);
  assert.deepEqual(oldTask.reserved, { ingredients: 2 });
  assert.deepEqual(fork.game.actors[0].task, oldTask);
  assert.equal(fork.origin.actors[0].task, null);
  assert.equal(fork.game.ingredients, original.game.ingredients);
  assert.equal(fork.origin.ingredients, original.origin.ingredients);
  const oldDone = advance(original.game, oldTask.remaining);
  const forkDone = advance(fork.game, oldTask.remaining);
  assert.equal(forkDone.food, oldDone.food);
  assert.equal(forkDone.ingredients, oldDone.ingredients);
  assert.equal(forkDone.actors[0].task, null);

  const oldBranch = saves.branchSlot(original, false, "旧形式の分岐");
  const newBranch = saves.branchSlot(fork, true, "空間のある最初の朝");
  assert.equal(oldBranch.game.housing, undefined);
  assert.ok(newBranch.game.housing);

  assert.ok(fork.game.housing && fork.origin.housing);
  fork.game.actors[0].task!.reserved.ingredients = 9;
  fork.game.house.rooms[0].fixtures[0].cell += 1;
  fork.game.housing.unlocated[actorId].room = "yard";
  assert.notEqual(
    fork.game.house.rooms[0].fixtures[0].cell,
    fork.origin.house.rooms[0].fixtures[0].cell,
  );
  assert.equal(fork.origin.housing.unlocated[actorId].room, "living");
  assert.equal(libraryRaw(original, 1), originalRaw);
});

test("housing envelope and library reload continue a spatial order with its original reservation", () => {
  const source = legacySlot();
  const origin = enableHousing(source.origin, "new");
  const game = advance(
    order(origin, origin.actors[0].person.id, "work", "cook"),
    3,
  );
  assert.ok(game.actors[0].task?.spatial);
  assert.equal(game.ingredients, origin.ingredients - 2);
  const slot = { ...source, origin, game };
  const json = saves.exportSlot(slot);
  assert.equal(JSON.parse(json).version, 2);
  const imported = saves.importSlot(json);
  const reloaded = saves.parseLibrary(libraryRaw(slot, 2)).slots[0];
  assert.notEqual(imported.id, slot.id);
  assert.deepEqual(imported.game, serialized(game));
  assert.deepEqual(imported.origin, serialized(origin));
  assert.deepEqual(reloaded, serialized(slot));
  const remaining = nextCompletionMinutes(game);
  assert.ok(remaining);
  const expected = advance(game, remaining);
  assert.deepEqual(
    serialized(advance(imported.game, remaining)),
    serialized(expected),
  );
  assert.deepEqual(
    serialized(advance(reloaded.game, remaining)),
    serialized(expected),
  );
  assert.equal(expected.ingredients, game.ingredients);
  assert.ok(expected.food > origin.food);
});

test("legacy export stays at version 1 and housing in either snapshot requires version 2", () => {
  const slot = legacySlot();
  assert.equal(JSON.parse(saves.exportSlot(slot)).version, 1);
  assert.deepEqual(saves.importSlot(saves.exportSlot(slot)).game, slot.game);
  for (const key of ["game", "origin"] as const) {
    const mixed = { ...slot, [key]: enableHousing(slot[key], "legacy") };
    assert.equal(JSON.parse(saves.exportSlot(mixed)).version, 2);
    assert.deepEqual(
      saves.importSlot(envelopeRaw(mixed, 2))[key],
      serialized(mixed[key]),
    );
    assert.throws(() => saves.importSlot(envelopeRaw(mixed, 1)));
    assert.throws(() => saves.parseLibrary(libraryRaw(mixed, 1)));
  }
});

test("a bound task without housing and a corrupt origin individually invalidate the entire slot", () => {
  const slot = legacySlot();
  const fakeTask: Task = {
    ...slot.game.actors[0].task!,
    spatial: { orderId: "fabricated", kind: "use" },
  };
  for (const key of ["game", "origin"] as const) {
    const smuggled = structuredClone(slot);
    smuggled[key].actors[0].task = fakeTask;
    assert.throws(() => saves.importSlot(envelopeRaw(smuggled, 1)));
    assert.throws(() => saves.parseLibrary(libraryRaw(smuggled, 1)));
  }

  const fork = saves.upgradeHousingSlot(slot, "破損の検証");
  assert.ok(isGame(fork.game));
  assert.ok(isGame(fork.origin));
  fork.origin.housing!.state.time += 1;
  assert.ok(isGame(fork.game));
  assert.equal(isGame(fork.origin), false);
  assert.throws(() => saves.importSlot(envelopeRaw(fork, 2)));
  assert.throws(() => saves.parseLibrary(libraryRaw(fork, 2)));
});

test("a valid v2 takes priority and current writes never consult the retired key", (t) => {
  const older = legacySlot();
  const current = { ...older, id: "current", name: "新しい保存" };
  const v2Raw = libraryRaw(current, 2);
  const { entries, writes, failures } = fakeStorage(t, {
    [v1]: libraryRaw(older, 1),
    [v2]: v2Raw,
  });
  failures.read = v1;
  const initial = saves.readLocal();
  assert.equal(initial.blocked, false);
  assert.equal(initial.raw, v2Raw);
  assert.equal(initial.legacyRaw, undefined);
  assert.deepEqual(initial.library.slots, [current]);
  assert.deepEqual(writes, []);

  const next = saves.appendSlot(initial.library, { ...current, id: "next" });
  const result = saves.writeLocal(next, initial.raw, initial.legacyRaw);
  assert.equal(result.status, "saved");
  assert.equal(entries.get(v2), result.raw);
  assert.deepEqual(writes, [v2]);
});

test("present malformed v2 blocks v1 fallback even for an empty string", (t) => {
  const slot = legacySlot();
  const legacyRaw = libraryRaw(slot, 1);
  const { entries, writes } = fakeStorage(t, { [v1]: legacyRaw });
  for (const corrupt of ["", "{", '{"format":2,"slots":[]}']) {
    entries.set(v2, corrupt);
    const initial = saves.readLocal();
    assert.equal(initial.raw, corrupt);
    assert.equal(initial.legacyRaw, undefined);
    assert.equal(initial.blocked, true);
    assert.ok(initial.warning);
    assert.deepEqual(initial.library, saves.emptyLibrary());

    const result = saves.writeLocal(saves.emptyLibrary(), corrupt);
    assert.equal(result.status, "blocked");
    assert.deepEqual(result.latest, initial);
    assert.equal(entries.get(v2), corrupt);
  }
  assert.deepEqual(writes, []);
});

test("a syntactically changed v2 raw aborts the stale action and returns a retry source", (t) => {
  const source = legacySlot();
  const raw = libraryRaw(source, 2);
  const { entries, writes } = fakeStorage(t, { [v2]: raw });
  const initial = saves.readLocal();
  const replacementRaw = " " + raw;
  entries.set(v2, replacementRaw);
  const pending = saves.appendSlot(initial.library, { ...source, id: "stale" });
  const result = saves.writeLocal(pending, initial.raw);
  assert.equal(result.status, "conflict");
  assert.equal(result.latest.raw, replacementRaw);
  assert.equal(result.latest.legacyRaw, undefined);
  assert.deepEqual(result.latest.library.slots, [source]);
  assert.equal(entries.get(v2), replacementRaw);
  assert.deepEqual(writes, []);

  const retry = saves.appendSlot(result.latest.library, {
    ...source,
    id: "retry",
  });
  assert.equal(saves.writeLocal(retry, result.latest.raw).status, "saved");
  assert.deepEqual(
    saves.readLocal().library.slots.map((s) => s.id),
    [source.id, "retry"],
  );
});

test("when v2 is created before the first write it wins over the observed legacy raw", (t) => {
  const slot = legacySlot();
  const { entries, writes } = fakeStorage(t, { [v1]: libraryRaw(slot, 1) });
  const initial = saves.readLocal();
  const current = { ...slot, name: "別タブの保存" };
  const raw = libraryRaw(current, 2);
  entries.set(v2, raw);
  const result = saves.writeLocal(
    initial.library,
    initial.raw,
    initial.legacyRaw,
  );
  assert.equal(result.status, "conflict");
  assert.equal(result.latest.raw, raw);
  assert.equal(result.latest.legacyRaw, undefined);
  assert.deepEqual(result.latest.library.slots, [current]);
  assert.equal(entries.get(v2), raw);
  assert.deepEqual(writes, []);
});

test("a changed or removed v1 witness aborts the first copy and returns the latest witness", (t) => {
  const slot = legacySlot();
  const oldRaw = libraryRaw(slot, 1);
  const latest = { ...slot, name: "別のタブの旧保存" };
  const latestRaw = libraryRaw(latest, 1);
  const { entries, writes } = fakeStorage(t, { [v1]: oldRaw });
  const initial = saves.readLocal();

  entries.set(v1, latestRaw);
  const changed = saves.writeLocal(
    initial.library,
    initial.raw,
    initial.legacyRaw,
  );
  assert.equal(changed.status, "conflict");
  assert.equal(changed.latest.raw, null);
  assert.equal(changed.latest.legacyRaw, latestRaw);
  assert.deepEqual(changed.latest.library.slots, [latest]);
  assert.deepEqual(writes, []);

  entries.delete(v1);
  const removed = saves.writeLocal(
    changed.latest.library,
    changed.latest.raw,
    changed.latest.legacyRaw,
  );
  assert.equal(removed.status, "conflict");
  assert.equal(removed.latest.raw, null);
  assert.equal(removed.latest.legacyRaw, null);
  assert.deepEqual(removed.latest.library, saves.emptyLibrary());
  assert.equal(entries.has(v2), false);
  assert.deepEqual(writes, []);
});

test("a first write started with no keys cannot ignore a newly appeared v1 save", (t) => {
  const { entries, writes } = fakeStorage(t);
  const initial = saves.readLocal();
  assert.equal(initial.raw, null);
  assert.equal(initial.legacyRaw, null);
  const legacyRaw = libraryRaw(legacySlot(), 1);
  entries.set(v1, legacyRaw);
  for (const witness of [initial.legacyRaw, undefined]) {
    const result = saves.writeLocal(initial.library, initial.raw, witness);
    assert.equal(result.status, "conflict");
    assert.equal(result.latest.legacyRaw, legacyRaw);
  }
  assert.deepEqual(writes, []);
});

test("a removed v2 returns its replacement legacy witness without copying over the deletion", (t) => {
  const source = legacySlot();
  const legacyRaw = libraryRaw(source, 1);
  const newer = { ...source, name: "削除される保存" };
  const raw = libraryRaw(newer, 2);
  const { entries, writes } = fakeStorage(t, { [v1]: legacyRaw, [v2]: raw });
  const initial = saves.readLocal();
  entries.delete(v2);
  const result = saves.writeLocal(initial.library, initial.raw);
  assert.equal(result.status, "conflict");
  assert.equal(result.latest.raw, null);
  assert.equal(result.latest.legacyRaw, legacyRaw);
  assert.deepEqual(result.latest.library.slots, [source]);
  assert.equal(entries.has(v2), false);
  assert.deepEqual(writes, []);
});

test("corruption of either authoritative key protects the bytes from a stale write", (t) => {
  const slot = legacySlot();
  const legacyRaw = libraryRaw(slot, 1);
  const { entries, writes } = fakeStorage(t, { [v1]: legacyRaw });
  const initial = saves.readLocal();
  entries.set(v1, "");
  const oldKeyResult = saves.writeLocal(
    initial.library,
    initial.raw,
    initial.legacyRaw,
  );
  assert.equal(oldKeyResult.status, "blocked");
  assert.equal(oldKeyResult.latest.raw, null);
  assert.equal(oldKeyResult.latest.legacyRaw, "");
  assert.equal(entries.get(v1), "");
  assert.equal(entries.has(v2), false);

  entries.set(v2, "{ bad json");
  const newKeyResult = saves.writeLocal(
    initial.library,
    initial.raw,
    initial.legacyRaw,
  );
  assert.equal(newKeyResult.status, "blocked");
  assert.equal(newKeyResult.latest.raw, "{ bad json");
  assert.equal(newKeyResult.latest.legacyRaw, undefined);
  assert.equal(entries.get(v2), "{ bad json");
  assert.deepEqual(writes, []);
});

test("storage access and quota failures keep the persisted bytes and report unavailability", (t) => {
  const slot = legacySlot();
  const raw = libraryRaw(slot, 2);
  const { entries, writes, failures } = fakeStorage(t, { [v2]: raw });
  const initial = saves.readLocal();
  const next = saves.appendSlot(initial.library, { ...slot, id: "unsaved" });
  failures.write = true;
  const full = saves.writeLocal(next, initial.raw, initial.legacyRaw);
  assert.equal(full.status, "unavailable");
  assert.ok(full.warning);
  assert.equal(entries.get(v2), raw);
  assert.deepEqual(writes, []);

  for (const deniedKey of [v2, v1]) {
    if (deniedKey === v1) entries.delete(v2);
    failures.read = deniedKey;
    const denied = saves.readLocal();
    assert.equal(denied.blocked, false);
    assert.equal(denied.raw, null);
    assert.equal(denied.legacyRaw, undefined);
    assert.ok(denied.warning);
    assert.deepEqual(denied.library, saves.emptyLibrary());
    assert.equal(
      saves.writeLocal(next, denied.raw, denied.legacyRaw).status,
      "unavailable",
    );
  }
  assert.deepEqual(writes, []);
});

function fakeNavigator(
  t: TestContext,
  locks?: {
    request(
      name: string,
      options: { mode: LockMode },
      run: () => saves.LocalWriteResult,
    ): Promise<saves.LocalWriteResult>;
  },
) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { locks },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
  });
}

test("the exclusive lock precedes comparison and serializes two writes with the same witness", async (t) => {
  const { reads, writes } = fakeStorage(t);
  const requests: { name: string; mode: LockMode }[] = [];
  const grants: (() => void)[] = [];
  fakeNavigator(t, {
    request(name, options, run) {
      requests.push({ name, mode: options.mode });
      return new Promise((resolve) => grants.push(() => resolve(run())));
    },
  });

  const initial = saves.readLocal();
  reads.length = 0;
  const firstSlot = legacySlot();
  const first = saves.writeLocalCoordinated(
    saves.appendSlot(initial.library, firstSlot),
    initial.raw,
    initial.legacyRaw,
  );
  const second = saves.writeLocalCoordinated(
    saves.appendSlot(initial.library, { ...firstSlot, id: "stale" }),
    initial.raw,
    initial.legacyRaw,
  );
  const lockName = "yohaku-reform-library-v2:write";
  assert.equal(saves.LOCAL_LIBRARY_LOCK, lockName);
  assert.deepEqual(requests, [
    { name: lockName, mode: "exclusive" },
    { name: lockName, mode: "exclusive" },
  ]);
  assert.deepEqual(reads, []);
  assert.deepEqual(writes, []);

  grants[0]();
  const saved = await first;
  assert.equal(saved.status, "saved");
  assert.equal(saved.warning, undefined);
  assert.deepEqual(writes, [v2]);
  grants[1]();
  const conflict = await second;
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.latest.raw, saved.raw);
  assert.deepEqual(conflict.latest.library.slots, [firstSlot]);
  assert.deepEqual(writes, [v2]);
});

test("without Web Locks, fallback still compares before writing and warns on success", async (t) => {
  const { entries, writes } = fakeStorage(t);
  fakeNavigator(t);
  const initial = saves.readLocal();
  const source = legacySlot();
  const next = saves.appendSlot(initial.library, source);
  const result = await saves.writeLocalCoordinated(
    next,
    initial.raw,
    initial.legacyRaw,
  );
  assert.equal(result.status, "saved");
  assert.match(result.warning ?? "", /複数のタブ/);
  assert.deepEqual(writes, [v2]);
  assert.equal(entries.get(v2), result.raw);
  const conflict = await saves.writeLocalCoordinated(
    initial.library,
    initial.raw,
    initial.legacyRaw,
  );
  assert.equal(conflict.status, "conflict");
  assert.deepEqual(writes, [v2]);
});

test("a rejected lock acquisition reports unavailability without accessing storage", async (t) => {
  const { reads, writes } = fakeStorage(t);
  fakeNavigator(t, {
    request() {
      return Promise.reject(new DOMException("Denied", "SecurityError"));
    },
  });
  const result = await saves.writeLocalCoordinated(saves.emptyLibrary(), null);
  assert.equal(result.status, "unavailable");
  assert.ok(result.warning);
  assert.deepEqual(reads, []);
  assert.deepEqual(writes, []);
});

test("invalid proposed bytes never replace either key and a later authoritative change still wins", async (t) => {
  const first = legacySlot();
  const library = saves.appendSlot(
    saves.appendSlot(saves.emptyLibrary(), first),
    { ...first, id: "other" },
  );
  const raw = JSON.stringify(library);
  const legacy = libraryRaw(first, 1);
  const { entries, writes } = fakeStorage(t, { [v1]: legacy, [v2]: raw });
  fakeNavigator(t);
  const visible = saves.readLocal();
  // The candidate looks valid in memory. The bytes actually written would lose the slot name.
  const proposal = {
    ...library,
    toJSON: () => ({ ...library, slots: [{ ...first, name: " " }] }),
  };
  for (const result of [
    saves.writeLocal(proposal, raw),
    await saves.writeLocalCoordinated(proposal, raw),
  ]) {
    assert.equal(result.status, "invalid");
    assert.match(result.warning, /保存.*内容|内容.*保存/);
    assert.deepEqual(confirmHandbookWrite(result), result);
    assert.deepEqual(saves.readLocal(), visible);
    entries.set(v2, raw + " ");
    assert.equal(confirmHandbookWrite(result).status, "conflict");
    entries.set(v2, raw);
  }
  assert.deepEqual(writes, []);
  assert.equal(entries.get(v1), legacy);
  assert.equal(entries.get(v2), raw);
});

for (const snapshot of ["game", "origin"] as const) {
  test(
    "unconvertible legacy cooking in " +
      snapshot +
      " preserves old progress and other slots",
    (t) => {
      const source = legacySlot();
      source[snapshot] = structuredClone(source.game);
      source[snapshot].actors[0].task!.station = "hearth-1#2";
      const imported = saves.importSlot(saves.exportSlot(source));
      const sibling = { ...legacySlot(), id: "other" };
      const library = saves.appendSlot(
        saves.appendSlot(saves.emptyLibrary(), sibling),
        imported,
      );
      const raw = JSON.stringify(library);
      const legacy = libraryRaw(source, 1);
      const { entries, writes } = fakeStorage(t, { [v1]: legacy, [v2]: raw });
      const visible = saves.readLocal();
      assert.equal(visible.blocked, false);
      assert.throws(
        () => saves.upgradeHousingSlot(visible.library.slots[1], "分岐"),
        snapshot === "origin" ? /最初の朝.*旧方式/ : /現在.*旧方式/,
      );
      assert.deepEqual(saves.readLocal(), visible);
      assert.equal(entries.get(v1), legacy);
      assert.equal(entries.get(v2), raw);
      assert.deepEqual(writes, []);
      const [other, original] = visible.library.slots;
      assert.deepEqual(
        saves.importSlot(saves.exportSlot(other)).game,
        other.game,
      );
      for (const g of [other.game, original[snapshot]]) {
        const done = advance(g, g.actors[0].task!.remaining);
        assert.equal(done.actors[0].task, null);
        assert.ok(done.food > g.food);
      }
    },
  );
}

test("import trims before bounding a name and the resulting slot opens after storage reload", (t) => {
  const source = legacySlot();
  const first = libraryRaw(source, 1);
  const { entries } = fakeStorage(t, { [v1]: first });
  const before = saves.readLocal();
  const entry = saves.importSlot(
    saves.exportSlot({ ...source, name: " ".repeat(80) + "朝" }),
  );
  assert.equal(entry.name, "朝");
  const next = saves.appendSlot(before.library, entry);
  assert.equal(
    saves.writeLocal(next, before.raw, before.legacyRaw).status,
    "saved",
  );
  assert.deepEqual(saves.readLocal().library, next);
  assert.equal(entries.get(v1), first);
});
