import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { editHouse, initialHouse } from "../src/reform/house";
import {
  getPreferredBed,
  setPreferredBed,
} from "../src/reform/housing/bedPreference";
import {
  appendSlot,
  branchSlot,
  emptyLibrary,
  exportSlot,
  importSlot,
  parseLibrary,
  type Slot,
} from "../src/reform/library";
import { makePersona } from "../src/reform/peopleModel";
import {
  createGame,
  enableHousing,
  isGame,
  type Game,
} from "../src/reform/sim";
import { defaultWorldConfig, generateWorld } from "../src/reform/world";

const person = makePersona(0, 23);
const mat = "mat-1";
const bed = "fixture-1";

function legacy(actorId = person.id) {
  const house = editHouse(initialHouse(), {
    type: "build",
    room: "living",
    kind: "bed",
    cell: 7,
  });
  const game = createGame(
    [{ ...person, id: actorId }],
    generateWorld(defaultWorldConfig()),
    "village",
    house,
  );
  assert.ok(isGame(game));
  return game;
}

function home(actorId = person.id) {
  const game = enableHousing(legacy(actorId), "new");
  assert.ok(isGame(game));
  return game;
}

function slotFor(game: Game): Slot {
  return {
    id: "original",
    name: "暮らし",
    game,
    origin: structuredClone(game),
  };
}

function libraryRaw(slot: Slot, format = 2) {
  return JSON.stringify({ format, activeId: slot.id, slots: [slot] });
}

test("previous saves with and without housing preserve their exported bytes and absent preferences", () => {
  for (const [game, version] of [
    [legacy(), 1],
    [home(), 2],
  ] as const) {
    const slot = slotFor(game);
    const originalExport = exportSlot(slot);
    assert.equal(JSON.parse(originalExport).version, version);
    const imported = importSlot(originalExport);
    assert.equal(exportSlot({ ...imported, id: slot.id }), originalExport);

    const originalRaw = libraryRaw(slot, version);
    const reloaded = parseLibrary(originalRaw);
    assert.equal(reloaded.format, 2);
    assert.equal(libraryRaw(reloaded.slots[0], version), originalRaw);
    for (const loaded of [imported, reloaded.slots[0]]) {
      assert.equal(loaded.game.housing?.preferredBeds, undefined);
      assert.equal(loaded.origin.housing?.preferredBeds, undefined);
      if (loaded.game.housing)
        assert.equal(
          Object.hasOwn(loaded.game.housing, "preferredBeds"),
          false,
        );
      if (loaded.origin.housing)
        assert.equal(
          Object.hasOwn(loaded.origin.housing, "preferredBeds"),
          false,
        );
    }
  }
});

test("preferences and the two snapshots survive export, import, reload, and both branch modes", () => {
  const origin = setPreferredBed(home(), person.id, mat);
  const game = setPreferredBed(origin, person.id, bed);
  assert.equal(getPreferredBed(origin, person.id), mat);
  const source: Slot = { ...slotFor(game), origin };
  const envelope = exportSlot(source);
  assert.equal(JSON.parse(envelope).version, 2);
  const imported = importSlot(envelope);
  const reloaded = parseLibrary(
    JSON.stringify(appendSlot(emptyLibrary(), imported)),
  ).slots[0];

  for (const loaded of [imported, reloaded]) {
    assert.deepEqual(loaded.game, structuredClone(game));
    assert.deepEqual(loaded.origin, structuredClone(origin));
    const currentBranch = branchSlot(loaded, false, "現在から");
    const morningBranch = branchSlot(loaded, true, "最初の朝から");
    assert.deepEqual(currentBranch.game, loaded.game);
    assert.deepEqual(morningBranch.game, loaded.origin);
    for (const branch of [currentBranch, morningBranch]) {
      assert.deepEqual(branch.origin, loaded.origin);
      assert.notEqual(branch.origin, loaded.origin);
      branch.game = setPreferredBed(branch.game, person.id, null);
      assert.equal(getPreferredBed(branch.game, person.id), undefined);
      assert.equal(getPreferredBed(branch.origin, person.id), mat);
      assert.equal(getPreferredBed(loaded.game, person.id), bed);
      assert.equal(getPreferredBed(loaded.origin, person.id), mat);
    }
  }
});

for (const [label, value] of [
  ["unknown actor", { unknown: mat }],
  ["unknown actor named __proto__", { ["__proto__"]: mat }],
  ["wrong fixture kind", { [person.id]: "hearth-1" }],
  ["missing fixture", { [person.id]: "removed-bed" }],
  ["non-string fixture ID", { [person.id]: 7 }],
  ["array map", []],
  ["null map", null],
] as const) {
  test(`rejects a saved bed preference with ${label} in either snapshot`, () => {
    for (const snapshot of ["game", "origin"] as const) {
      const slot = slotFor(home());
      Reflect.set(slot[snapshot].housing!, "preferredBeds", value);
      assert.equal(isGame(slot[snapshot]), false, snapshot);
      assert.throws(
        () => importSlot(exportSlot(slot)),
        /書き出した保存/,
        snapshot,
      );
      assert.throws(
        () => parseLibrary(libraryRaw(slot)),
        /手帳の形式/,
        snapshot,
      );
    }
  });
}

test("rejects a preference map with a custom prototype", () => {
  const game = home();
  game.housing!.preferredBeds = Object.assign(
    Object.create({ inherited: mat }),
    {
      [person.id]: mat,
    },
  );
  assert.equal(isGame(game), false);
});

test("allows plain empty maps and null-prototype dictionaries of bed preferences", () => {
  const game = home();
  game.housing!.preferredBeds = {};
  assert.ok(isGame(game));
  assert.deepEqual(
    importSlot(exportSlot(slotFor(game))).game.housing!.preferredBeds,
    {},
  );
  const dictionary: Record<string, string> = Object.create(null);
  dictionary[person.id] = mat;
  game.housing!.preferredBeds = dictionary;
  assert.ok(isGame(game));
  assert.equal(getPreferredBed(game, person.id), mat);
  assert.equal(
    getPreferredBed(importSlot(exportSlot(slotFor(game))).game, person.id),
    mat,
  );
});

test("a real resident named constructor is saved as an own preference key", () => {
  const actorId = "constructor";
  const game = home(actorId);
  game.housing!.preferredBeds = {};
  assert.equal(getPreferredBed(game, actorId), undefined);
  const configured = setPreferredBed(game, actorId, mat);
  assert.ok(Object.hasOwn(configured.housing!.preferredBeds!, actorId));
  assert.ok(isGame(configured));
  const imported = importSlot(exportSlot(slotFor(configured)));
  assert.equal(getPreferredBed(imported.game, actorId), mat);
  const cleared = setPreferredBed(imported.game, actorId, null);
  assert.equal(Object.hasOwn(cleared.housing!, "preferredBeds"), false);
});

test("invalid preference bytes in the active library block stale writes and preserve both storage keys", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "yohaku-bed-preferences-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const slot = slotFor(home());
  const originalRaw = libraryRaw(slot);
  slot.origin.housing!.preferredBeds = { [person.id]: "removed-bed" };
  const corruptRaw = " " + libraryRaw(slot);
  const legacyRaw = libraryRaw(slotFor(legacy()), 1);

  // Use Node's native localStorage in an isolated process and file.
  execFileSync(
    process.execPath,
    [
      "--experimental-webstorage",
      "--disable-warning=ExperimentalWarning",
      `--localstorage-file=${join(directory, "storage.sqlite")}`,
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `
      import assert from "node:assert/strict";
      import { readFileSync } from "node:fs";
      import { appendSlot, LIBRARY_KEY, LEGACY_LIBRARY_KEY, readLocal, writeLocal } from "./src/reform/library.ts";
      const { originalRaw, corruptRaw, legacyRaw } = JSON.parse(readFileSync(0, "utf8"));
      localStorage.setItem(LIBRARY_KEY, originalRaw);
      localStorage.setItem(LEGACY_LIBRARY_KEY, legacyRaw);
      const observed = readLocal();
      assert.equal(observed.blocked, false);
      const pending = appendSlot(observed.library, { ...observed.library.slots[0], id: "stale" });

      localStorage.setItem(LIBRARY_KEY, corruptRaw);
      const blocked = readLocal();
      assert.equal(blocked.blocked, true);
      assert.equal(blocked.raw, corruptRaw);
      assert.deepEqual(blocked.library.slots, []);
      assert.deepEqual(writeLocal(pending, observed.raw), { status: "blocked", latest: blocked });
      assert.equal(localStorage.getItem(LIBRARY_KEY), corruptRaw);
      assert.equal(localStorage.getItem(LEGACY_LIBRARY_KEY), legacyRaw);
    `,
    ],
    {
      cwd: new URL("../", import.meta.url),
      input: JSON.stringify({ originalRaw, corruptRaw, legacyRaw }),
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
});
