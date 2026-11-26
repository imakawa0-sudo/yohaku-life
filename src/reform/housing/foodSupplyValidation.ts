import type { Game } from "../sim";
import { sameSpatialPoint } from "../spatial/route";
import { constructionFloor } from "./constructionTopology";
import type { FoodSupplyPolicy } from "./foodTypes";
import { fields, point } from "./saveFields";
import { housingPoint } from "./topology";
import type { HousingRuntime } from "./types";

export function isFoodSupply(
  value: unknown,
  game: Game,
  housing: HousingRuntime,
): value is FoodSupplyPolicy {
  const source = housingPoint("living", 0);
  return (
    fields(value, ["version", "actorId", "storage", "enabled"]) &&
    value.version === 1 &&
    typeof value.actorId === "string" &&
    game.actors.some((a) => a.person.id === value.actorId) &&
    typeof value.enabled === "boolean" &&
    point(value.storage) &&
    !sameSpatialPoint(value.storage, source) &&
    constructionFloor(housing, source) &&
    constructionFloor(housing, value.storage)
  );
}
