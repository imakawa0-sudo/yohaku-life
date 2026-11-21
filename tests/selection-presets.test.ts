import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { advance, command, createGame, deserialize, serialize } from "../src/game/engine.ts";
import { assignSelection } from "../src/game/selection.ts";
import {
  deleteSelectionPreset, getSelectionPresets, MAX_SELECTION_PRESET_NAME,
  saveSelectionPreset, validSelectionPresets,
} from "../src/game/selection-presets.ts";
import type { Command, GameState } from "../src/game/types.ts";

const person = (s: GameState, id = "aki") => s.residents.find(resident => resident.id === id)!;
const input = (name = "外出組", residentIds = ["ren", "aki"]) => ({ name, residentIds });
const snapshot = (s: GameState) => JSON.stringify(s);
const world = (s: GameState) => {
  const { selectionPresets: _presets, ...rest } = s;
  return rest;
};
function act(s: GameState, cmd: Command): GameState {
  const result = command(s, cmd);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function freezeDeep(value: unknown) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) freezeDeep(entry);
    Object.freeze(value);
  }
}

test("Legacy reads do not initialize presets, and returned presets are independent copies", () => {
  for (const version of [1, 2, 3] as const) {
    const old = createGame(801);
    old.version = version;
    if (version === 1) { delete old.inventory; delete old.region; }
    const before = snapshot(old);
    freezeDeep(old);
    assert.equal(validSelectionPresets(old), true);
    assert.deepEqual(getSelectionPresets(old), []);
    assert.equal(snapshot(old), before);
    const restored = deserialize(serialize(old));
    assert.equal(restored.version, 3);
    assert.equal(restored.selectionPresets, undefined);
  }
  const s = createGame();
  const saved = saveSelectionPreset(s, input());
  assert.equal(saved.error, undefined);
  const before = snapshot(s);
  saved.preset!.name = "返り値だけ";
  saved.preset!.residentIds.pop();
  const projected = getSelectionPresets(s);
  projected[0].name = "投影だけ";
  projected[0].residentIds.reverse();
  assert.equal(snapshot(s), before);
  freezeDeep(s);
  assert.equal(getSelectionPresets(s).length, 1);
  assert.equal(snapshot(s), before);
});

test("Create, edit and delete preserve the complete world including active and held reservations and due plans", () => {
  let s = createGame(802);
  for (const resident of s.residents) s = act(s, { type: "policy", residentId: resident.id, policy: "rest" });
  s = act(s, { type: "assign", residentIds: ["mio"], kind: "cook" });
  s = advance(s, 5);
  s = act(s, { type: "assign", residentIds: ["mio"], kind: "eat" });
  assert.equal(person(s, "mio").action?.reserved?.food, 1);
  assert.equal(person(s, "mio").suspended?.reserved?.ingredients, 2);
  person(s).hp = 0;
  person(s).location = "village";
  person(s, "ren").location = "shelter";
  s = act(s, { type: "plan-trip", residentIds: ["aki", "ren"], purpose: "道と食事を確認する", returnAt: s.minutes + 1 });
  s = advance(s, 1);
  assert.equal(s.travelPlans!.entries[0].remindedAt, s.minutes);
  s.pauseReason = "既存の遭遇・体調確認";
  const source = s;
  const original = structuredClone(s);
  const before = snapshot(s);
  s = act(s, { type: "save-selection-preset", ...input("  外出組  ", ["ren", "aki", "ren"]) });
  assert.equal(snapshot(source), before);
  assert.deepEqual(world(s), original);
  assert.equal(s.selectionPresets!.entries[0].name, "外出組");
  assert.deepEqual(s.selectionPresets!.entries[0].residentIds, ["ren", "aki"]);
  assert.deepEqual(deserialize(serialize(s)), s);
  const id = s.selectionPresets!.entries[0].id;
  s = act(s, { type: "save-selection-preset", presetId: id, ...input("全員", ["mio", "ren", "aki"]) });
  assert.deepEqual(world(s), original);
  assert.equal(s.selectionPresets!.nextPresetId, 2);
  s = act(s, { type: "delete-selection-preset", presetId: id });
  assert.deepEqual(world(s), original);
  assert.deepEqual(s.selectionPresets, { version: 1, nextPresetId: 2, entries: [] });
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("Selection order and overlapping presets survive, and canonical identical updates return the original world", () => {
  let s = createGame(803);
  const members = ["ren", "aki", "mio", "ren"];
  s = act(s, { type: "save-selection-preset", ...input("話す人", members) });
  assert.deepEqual(members, ["ren", "aki", "mio", "ren"]);
  const id = s.selectionPresets!.entries[0].id;
  const same = command(s, { type: "save-selection-preset", presetId: id, ...input(" 話す人 ", members) });
  assert.equal(same.error, undefined);
  assert.strictEqual(same.state, s);
  s = act(s, { type: "save-selection-preset", ...input("全員", ["ren", "aki", "mio"]) });
  assert.equal(s.selectionPresets!.entries.length, 2);
  assert.equal(s.selectionPresets!.nextPresetId, 3);
  const selected = getSelectionPresets(s)[0].residentIds;
  const result = assignSelection(s, selected, "socialize");
  const manual = assignSelection(s, ["ren", "aki", "mio"], "socialize");
  assert.equal(result.error, undefined);
  assert.equal(manual.error, undefined);
  assert.deepEqual(result.state, manual.state, "Recalling the saved order produces the same real commands as manual selection");
  selected.forEach((id, index) => assert.equal(person(result.state, id).action?.target, selected[(index + 1) % selected.length]));
  const changed = act(s, { type: "save-selection-preset", presetId: id, ...input("話す人", ["mio", "aki", "ren"]) });
  assert.deepEqual(changed.selectionPresets!.entries[0].residentIds, ["mio", "aki", "ren"]);
  assert.equal(changed.selectionPresets!.nextPresetId, 3);
});

test("Local IDs may equal world IDs, never get recycled after deletion, and stale IDs fail atomically", () => {
  let s = createGame(804);
  assert.equal(s.logs[0].id, 1);
  const nextId = s.nextId;
  s = act(s, { type: "save-selection-preset", ...input() });
  assert.equal(s.selectionPresets!.entries[0].id, 1);
  assert.equal(s.nextId, nextId);
  s = act(s, { type: "delete-selection-preset", presetId: 1 });
  s = deserialize(serialize(s));
  s = act(s, { type: "save-selection-preset", ...input() });
  assert.equal(s.selectionPresets!.entries[0].id, 2);
  assert.equal(s.selectionPresets!.nextPresetId, 3);
  assert.equal(s.nextId, nextId);
  for (const cmd of [
    { type: "delete-selection-preset", presetId: 1 },
    { type: "save-selection-preset", presetId: 1, ...input("古い編集") },
  ] as Command[]) {
    const before = snapshot(s);
    const failed = command(s, cmd);
    assert.ok(failed.error);
    assert.strictEqual(failed.state, s);
    assert.equal(snapshot(s), before);
  }
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("New members are never added implicitly, but an explicit update may include a person who has joined", () => {
  let s = deserialize(readFileSync(new URL("./fixtures/mio-village-v2.json", import.meta.url), "utf8"));
  assert.ok(saveSelectionPreset(s, input("まだ仲間ではない", ["village-guide"])).error);
  assert.equal(s.selectionPresets, undefined);
  assert.equal(saveSelectionPreset(s, input("留守番", ["aki", "ren"])).error, undefined);
  const existing = structuredClone(s.selectionPresets);
  assert.equal(s.region!.trust["village-guide"].mio, 3);
  s = act(s, { type: "recruit", residentId: "mio", npcId: "village-guide" });
  assert.deepEqual(s.selectionPresets, existing);
  const joinedWorld = structuredClone(world(s));
  const result = saveSelectionPreset(s, { presetId: 1, ...input("留守番", ["aki", "village-guide", "ren"]) });
  assert.equal(result.error, undefined);
  assert.equal(result.preset!.id, 1);
  assert.deepEqual(world(s), joinedWorld);
  assert.deepEqual(person(s, "village-guide").memories, []);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("Invalid input, duplicate names and ended edits reject without partial initialization or mutation", () => {
  const s = createGame(806);
  for (const bad of [null, {}, { ...input(), name: null }, input(" "), input("あ".repeat(MAX_SELECTION_PRESET_NAME + 1)),
    input("隊", []), input("隊", ["unknown"]), input("隊", [null as never]),
    { ...input(), presetId: 0 }, { ...input(), presetId: 999 }]) {
    const before = snapshot(s);
    assert.ok(saveSelectionPreset(s, bad as never).error);
    assert.equal(snapshot(s), before);
  }
  assert.equal(saveSelectionPreset(s, input()).error, undefined);
  const before = snapshot(s);
  assert.ok(saveSelectionPreset(s, input(" 外出組 ", ["mio"])).error);
  assert.ok(deleteSelectionPreset(s, 0).error);
  assert.ok(deleteSelectionPreset(s, Number.NaN).error);
  assert.equal(snapshot(s), before);
  s.ended = true;
  for (const cmd of [
    { type: "save-selection-preset", ...input("新規") },
    { type: "save-selection-preset", presetId: 1, ...input("変更") },
    { type: "save-selection-preset", presetId: 1, ...input() },
    { type: "delete-selection-preset", presetId: 1 },
  ] as Command[]) {
    const endedBefore = snapshot(s);
    const failed = command(s, cmd);
    assert.ok(failed.error);
    assert.strictEqual(failed.state, s);
    assert.equal(snapshot(s), endedBefore);
  }
});

test("An exhausted local counter blocks only creation and still permits rename, member edit and deletion", () => {
  let s = createGame(807);
  s = act(s, { type: "save-selection-preset", ...input() });
  s.selectionPresets!.nextPresetId = Number.MAX_SAFE_INTEGER;
  s = deserialize(serialize(s));
  const before = snapshot(s);
  const failed = command(s, { type: "save-selection-preset", ...input("新規") });
  assert.ok(failed.error);
  assert.strictEqual(failed.state, s);
  assert.equal(snapshot(s), before);
  s = act(s, { type: "save-selection-preset", presetId: 1, ...input("名前と人を変更", ["mio"]) });
  assert.equal(s.selectionPresets!.nextPresetId, Number.MAX_SAFE_INTEGER);
  s = act(s, { type: "delete-selection-preset", presetId: 1 });
  assert.deepEqual(s.selectionPresets, { version: 1, nextPresetId: Number.MAX_SAFE_INTEGER, entries: [] });
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("Malformed extensions are rejected by actual deserialization and projections never mutate them", () => {
  const entry = { id: 1, name: "外出組", residentIds: ["ren", "aki"] };
  const extension = { version: 1, nextPresetId: 2, entries: [entry] };
  const bad = [
    null, [], {}, { ...extension, version: 2 }, { ...extension, nextPresetId: 0 },
    { ...extension, nextPresetId: 1.5 }, { ...extension, nextPresetId: Number.MAX_SAFE_INTEGER + 1 },
    { ...extension, extra: true }, { ...extension, entries: null }, { ...extension, entries: [null] },
    { ...extension, entries: [{ ...entry, extra: true }] },
    { ...extension, entries: [{ ...entry, id: 0 }] }, { ...extension, entries: [{ ...entry, id: 2 }] },
    { ...extension, entries: [{ ...entry, id: 0.5 }] },
    { ...extension, entries: [{ ...entry, name: "" }] }, { ...extension, entries: [{ ...entry, name: " 外出組 " }] },
    { ...extension, entries: [{ ...entry, name: "あ".repeat(25) }] },
    { ...extension, entries: [{ ...entry, residentIds: [] }] },
    { ...extension, entries: [{ ...entry, residentIds: ["ren", "ren"] }] },
    { ...extension, entries: [{ ...entry, residentIds: ["village-guide"] }] },
    { ...extension, entries: [{ ...entry, residentIds: [null] }] },
    { ...extension, nextPresetId: 3, entries: [entry, { ...entry, id: 2 }] },
    { ...extension, entries: [entry, { ...entry, name: "別名" }] },
  ];
  for (const value of bad) {
    const s = createGame(808);
    (s as unknown as Record<string, unknown>).selectionPresets = value;
    const before = snapshot(s);
    assert.equal(validSelectionPresets(s), false, JSON.stringify(value));
    assert.deepEqual(getSelectionPresets(s), []);
    assert.ok(saveSelectionPreset(s, input()).error);
    assert.ok(deleteSelectionPreset(s, 1).error);
    assert.equal(snapshot(s), before);
    assert.throws(() => deserialize(serialize(s)), /保存データ/);
  }
  for (const value of [null, undefined, "unknown", []]) {
    assert.equal(validSelectionPresets(value as never), false);
    assert.deepEqual(getSelectionPresets(value as never), []);
    assert.ok(saveSelectionPreset(value as never, input()).error);
    assert.ok(deleteSelectionPreset(value as never, 1).error);
  }
});
