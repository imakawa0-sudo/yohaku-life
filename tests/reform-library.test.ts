import assert from "node:assert/strict";
import test from "node:test";
import {
  appendSlot,
  branchSlot,
  emptyLibrary,
  exportSlot,
  importSlot,
  parseLibrary,
} from "../src/reform/library";
import { advance, createGame, order } from "../src/reform/sim";
import { makePersona } from "../src/reform/peopleModel";
import { defaultWorldConfig, generateWorld } from "../src/reform/world";

function sample() {
  const origin = createGame(
    [makePersona(0, 127)],
    generateWorld(defaultWorldConfig()),
    "forest",
  );
  const game = advance(
    order(origin, origin.actors[0].person.id, "work", "wood"),
    1,
  );
  return { id: "original", name: "検証の朝", origin, game };
}

test("A new morning, an in-progress branch and an imported save each retain their own continuation", () => {
  const slot = sample();
  assert.ok(slot.game.actors[0].task);
  const morning = branchSlot(slot, true, "最初から");
  const now = branchSlot(slot, false, "途中から");
  let book = appendSlot(emptyLibrary(), slot);
  for (const entry of [morning, now, importSlot(exportSlot(slot))])
    book = appendSlot(book, entry);
  assert.deepEqual(parseLibrary(JSON.stringify(book)), book);
  assert.equal(morning.game.time, 480);
  assert.equal(now.game.time, 481);
  assert.deepEqual(advance(slot.game, 50), advance(now.game, 50));
  morning.game.actors[0].person.name = "別の住人";
  assert.notEqual(slot.origin.actors[0].person.name, "別の住人");
});
test("Corrupted residents, a public-53 save, and duplicate slot identities cannot replace an existing reform save", () => {
  const original = sample();
  const invalid = JSON.parse(exportSlot(original));
  invalid.slot.game.actors[0].location = "unknown-place";
  assert.throws(() => importSlot(JSON.stringify(invalid)));
  assert.throws(() =>
    importSlot(JSON.stringify({ minutes: 480, residents: [] })),
  );
  assert.throws(() =>
    parseLibrary(
      JSON.stringify({
        format: 1,
        activeId: "original",
        slots: [original, original],
      }),
    ),
  );
  assert.throws(() =>
    parseLibrary(
      JSON.stringify({ format: 1, activeId: "lost", slots: [original] }),
    ),
  );
});

test("the distributed morning opens as a playable two-person branch", async () => {
  const { readFile } = await import("node:fs/promises");
  const json = await readFile(
    new URL("../public/woodworkers-morning.json", import.meta.url),
    "utf8",
  );
  const slot = importSlot(json);
  assert.equal(slot.game.time, 480);
  assert.equal(slot.game.actors.length, 2);
  assert.deepEqual(slot.origin, slot.game);
  assert.deepEqual(
    slot.game.actors.map((a) => a.person.skills.wood),
    [7, 1],
  );
});
