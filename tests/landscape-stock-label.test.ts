import test from "node:test";
import assert from "node:assert/strict";
import { command, createGame, serialize } from "../src/game/engine.ts";
import { accessibleResources, freeBaseResources } from "../src/game/inventory.ts";
import { describeLandscape } from "../src/components/Landscape.tsx";

test("The base landscape identifies warehouse stock separately from accessible carried food", () => {
  const transfer = command(createGame(), { type: "transfer", residentId: "aki", from: "base", to: "aki", resource: "food", amount: 2 });
  assert.equal(transfer.error, undefined);
  const state = transfer.state;
  const before = serialize(state);
  const warehouse = freeBaseResources(state).food;
  const local = accessibleResources(state, "mio").food;
  assert.equal(local, warehouse + 2);
  const landscape = describeLandscape(state, state.residents.find(person => person.id === "mio")!);
  assert.ok(landscape.description.includes(`倉庫の未予約：食事${warehouse}食`));
  assert.doesNotMatch(landscape.description, /利用できる食事/);
  assert.equal(serialize(state), before);
});
