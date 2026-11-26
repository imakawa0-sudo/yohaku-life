import {
  freeSharedShelves,
  sharedSpaceAfterMealReturns,
  stockLimit,
} from "./mealStock";
import type { Game } from "./sim";

export type PackReturns = Partial<
  Record<"wood" | "ingredients" | "coins", number>
>;
const keys = ["wood", "ingredients", "coins"] as const;

function takePending(g: Game, key: keyof PackReturns, count: number) {
  const pending = g.pendingPackReturns;
  if (!pending?.[key]) return 0;
  const used = Math.min(count, pending[key]);
  if (used === pending[key]) delete pending[key];
  else pending[key] -= used;
  if (Object.keys(pending).length === 0) delete g.pendingPackReturns;
  return used;
}

export function reserveForPacking(
  g: Game,
  key: keyof PackReturns,
  count: number,
) {
  g[key] -= count - takePending(g, key, count);
}

/** An older pack order can have filled both its original shelf and its carrier's bag. */
export function refundPacking(g: Game, key: keyof PackReturns, count: number) {
  const returned = Math.min(count, freeSharedShelves(g, key));
  g[key] += returned;
  if (returned < count) {
    const pending = (g.pendingPackReturns ??= {});
    pending[key] = (pending[key] ?? 0) + count - returned;
  }
}

export function settlePackReturns(g: Game) {
  if (!g.pendingPackReturns) return;
  for (const key of keys) {
    if (!g.pendingPackReturns?.[key]) continue;
    g[key] += takePending(g, key, sharedSpaceAfterMealReturns(g, key));
  }
}

export function validPackReturns(g: Game) {
  if (!Object.hasOwn(g, "pendingPackReturns")) return true;
  const pending = g.pendingPackReturns;
  if (!pending || typeof pending !== "object" || Array.isArray(pending))
    return false;
  const entries = Object.entries(pending);
  return (
    entries.length > 0 &&
    entries.every(([key, count]) => {
      if (key !== "wood" && key !== "ingredients" && key !== "coins")
        return false;
      if (
        !Number.isSafeInteger(count) ||
        count < 1 ||
        sharedSpaceAfterMealReturns(g, key) > 0
      )
        return false;
      const reserved = g.actors.reduce(
        (sum, a) =>
          sum +
          (a.location === g.home && a.task?.kind === "pack"
            ? (a.task.reserved[key] ?? 0)
            : 0),
        0,
      );
      return (
        count + Math.max(0, g[key] + reserved - stockLimit) <=
        g.actors.length * stockLimit
      );
    })
  );
}
