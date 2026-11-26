import { furnishings } from "../house";
import type { Game } from "../sim";
import { sameSpatialPoint } from "../spatial/route";
import { createHousingRuntime } from "./runtime";
import { buildHousingTopology, legacyHousingStation } from "./topology";
import type { HousingRuntime } from "./types";

export function inspectHousingLayoutUpgrade(
  g: Game,
): { ok: true; housing: HousingRuntime } | { ok: false; reason: string } {
  const housing = g.housing
    ? structuredClone(g.housing)
    : createHousingRuntime(g, "legacy");
  if (housing.layoutVersion === 2) return { ok: true, housing };

  const actors = housing.state.actors;
  const ids = Object.keys(actors);
  const before = buildHousingTopology(
    g.house,
    ids,
    housing.controls,
    actors,
    undefined,
    housing.construction,
    housing.gatherings,
    housing.lodging,
  );
  const after = buildHousingTopology(
    g.house,
    ids,
    housing.controls,
    actors,
    2,
    housing.construction,
    housing.gatherings,
    housing.lodging,
  );
  for (const actor of g.actors) {
    const task = actor.task;
    if (!task?.station || task.kind === "home-build") continue;
    const oldSlot = task.spatial
      ? before.slots[task.station]
      : Object.values(before.slots).find(
          (slot) =>
            slot.roomId === task.room &&
            legacyHousingStation(slot) === task.station,
        );
    const newSlot = oldSlot && after.slots[oldSlot.id];
    if (
      !oldSlot ||
      !newSlot ||
      !sameSpatialPoint(oldSlot.point, newSlot.point)
    ) {
      const fixture = oldSlot ? furnishings[oldSlot.kind].name : "設備";
      return {
        ok: false,
        reason: `${actor.person.name}が予約した${fixture}の席を保てないため、今は集まりを始められません。`,
      };
    }
  }
  Object.assign(housing.state, after.geometry);
  housing.layoutVersion = 2;
  return { ok: true, housing };
}
