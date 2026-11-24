import assert from "node:assert/strict";
import {
  advance,
  order,
  createGame,
  enableHousing,
  type Game,
} from "../../src/reform/sim";
import { makePersona } from "../../src/reform/peopleModel";
import { initialHouse } from "../../src/reform/house";
import { defaultWorldConfig, generateWorld } from "../../src/reform/world";
import {
  createRoomConstruction,
  reserveConstructionMaterial,
  assignConstructionHaul,
  assignConstructionBuild,
} from "../../src/reform/housing/construction";
import type { ConstructionResult } from "../../src/reform/housing/constructionTypes";

export const one = "resident-one",
  two = "resident-two";
export const request = {
  name: "  作業室  ",
  neighborId: "bedroom",
  stagingCell: 2,
};
export const planId = "construction-1",
  itemId = "construction-material-1";
export function base(
  mode: "new" | "legacy" = "new",
  firstId = one,
  extraIds: string[] = [],
) {
  const people = [firstId, two, ...extraIds].map((id, i) => ({
    ...makePersona(i, i + 12),
    id,
  }));
  const g = createGame(
    people,
    generateWorld(defaultWorldConfig()),
    "village",
    initialHouse(),
  );
  g.wood = 6;
  return enableHousing(g, mode);
}
export function ok(result: ConstructionResult) {
  assert.equal(result.error, undefined);
  return result.game;
}
export const planned = (g = base()) => ok(createRoomConstruction(g, request));
export const reserved = (g = base()) =>
  ok(reserveConstructionMaterial(planned(g), planId));
export const hauling = (
  g = reserved(),
  id = one,
  dir: "deliver" | "return" = "deliver",
) => ok(assignConstructionHaul(g, planId, id, dir));
export const plan = (g: Game) => g.housing!.construction!.plans[planId];
export const bundle = (g: Game) => g.housing!.state.items[itemId];

export const staged = (g = base()) =>
  order(
    advance(order(hauling(reserved(g)), two, "work", "care"), 6),
    two,
    "cancel",
  );
export const building = (g = staged(), id = one) =>
  ok(assignConstructionBuild(g, planId, id));
