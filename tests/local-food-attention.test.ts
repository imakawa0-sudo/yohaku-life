import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { command, createGame, deserialize, serialize } from "../src/game/engine.ts";
import { accessibleResources } from "../src/game/inventory.ts";
import { deriveAttention } from "../src/game/presentation.ts";

test("A real two-night UI save reports five local portions instead of eight remote warehouse portions", () => {
  const s = deserialize(readFileSync(new URL("./fixtures/two-night-hunger-v3.json", import.meta.url), "utf8"));
  const before = serialize(s);
  assert.equal(s.minutes, 3001);
  assert.equal(s.resources.food, 8);
  assert.equal(accessibleResources(s, "aki").food, 5);
  const item = deriveAttention(s).find((entry) => entry.id === "hunger:aki")!;
  assert.match(item.detail, /今いる場所の携行食/);
  assert.match(item.detail, /利用できる食事は5食/);
  assert.doesNotMatch(item.detail, /拠点へ戻って|8食/);
  assert.equal(serialize(s), before);
  const meal = command(s, { type: "assign", residentIds: ["aki"], kind: "eat" });
  assert.equal(meal.error, undefined);
  assert.equal(meal.state.resources.food, 8);
  assert.equal(meal.state.residents.find((r) => r.id === "aki")?.action?.reserved?.food, 1);
});

test("Food warnings distinguish insufficient local portions and an unsafe place", () => {
  const s = createGame();
  s.residents[0].location = "village";
  s.residents[0].hunger = 10;
  const noLocal = deriveAttention(s).find((entry) => entry.id === "hunger:aki")!;
  assert.match(noLocal.detail, /この場所で使える携行食は0食/);
  assert.doesNotMatch(noLocal.detail, /利用できる食事は6食/);
  s.inventory!.packs.aki.food = 0.5;
  assert.match(deriveAttention(s).find((entry) => entry.id === "hunger:aki")!.detail, /1食分に届かない/);
  s.enemy.location = "village";
  s.inventory!.packs.aki.food = 4;
  const unsafe = deriveAttention(s).find((entry) => entry.id === "hunger:aki")!;
  assert.match(unsafe.detail, /交戦の危険/);
  assert.doesNotMatch(unsafe.detail, /食事を選べます/);
});
