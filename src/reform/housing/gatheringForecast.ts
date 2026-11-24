import type { Game } from "../sim";
import { advanceHousingMinute } from "./bridge";
import {
  finishGatheringMinute,
  heldGatheringOrders,
} from "./gatheringProgress";

/** Project the currently booked participants to the first release. The world,
 * RNG, autonomous decisions, needs, memories and relationships never advance. */
export function nextGatheringCompletionMinutes(g: Game): number | null {
  if (!g.housing?.gatherings || !Object.keys(g.housing.gatherings).length)
    return null;
  const original = g.actors
    .filter((a) => a.task?.spatial?.gatheringId)
    .map((a) => ({ id: a.person.id, order: a.task!.spatial!.orderId }));
  if (!original.length) return null;
  const trial = {
    ...g,
    housing: structuredClone(g.housing),
    actors: g.actors.map((a) => ({
      ...a,
      task: a.task?.spatial?.gatheringId ? structuredClone(a.task) : null,
    })),
  };
  // Non-members never contend for an already reserved seat. Their position
  // remains available for rebuilding room permissions at an admitted crossing.
  for (const a of trial.actors)
    if (!a.task && Object.hasOwn(trial.housing.state.actors, a.person.id))
      trial.housing.state.actors[a.person.id].order = null;

  while (Number.isSafeInteger(trial.time + 1)) {
    const held = heldGatheringOrders(trial);
    trial.time++;
    const minutes = advanceHousingMinute(trial, held);
    finishGatheringMinute(trial, minutes, false);
    if (
      original.some(
        (o) =>
          trial.actors.find((a) => a.person.id === o.id)?.task?.spatial
            ?.orderId !== o.order,
      )
    )
      return trial.time - g.time;

    // Closed passages can keep an entire collecting group stationary until its
    // deadline. Skip only minutes with neither movement nor use nor active clocks.
    const groups = Object.values(trial.housing.gatherings!);
    if (
      groups.every((group) => group.startedAt === null) &&
      [...minutes.values()].every((minute) => minute.metric === "waiting") &&
      original.every((o) =>
        ["waiting", "use"].includes(
          trial.housing.state.actors[o.id].order!.phase,
        ),
      )
    ) {
      const next = Math.min(...groups.map((group) => group.deadline)) - 1;
      if (next > trial.time) trial.time = trial.housing.state.time = next;
    }
  }
  return null;
}
