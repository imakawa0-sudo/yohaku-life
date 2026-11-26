import type { Game } from "./sim";

export const stockLimit = 1_000_000_000;

function freeSharedShelves(g: Game) {
  const held = g.actors.reduce(
    (sum, actor) =>
      sum + (actor.location === g.home ? (actor.task?.reserved.food ?? 0) : 0),
    0,
  );
  return Math.max(0, stockLimit - g.food - held);
}

/** Food reserved for an unfinished task must still fit if that task is cancelled. */
export function mealSpace(g: Game, account: { food: number } = g) {
  if (account !== g) return stockLimit - account.food;
  return Math.max(0, freeSharedShelves(g) - (g.pendingMealReturns ?? 0));
}

export function refundMeal(g: Game, count: number) {
  const returned = Math.min(count, stockLimit - g.food);
  g.food += returned;
  if (returned < count)
    g.pendingMealReturns = (g.pendingMealReturns ?? 0) + count - returned;
}

export function settleMealReturns(g: Game) {
  if (!g.pendingMealReturns) return;
  const returned = Math.min(g.pendingMealReturns, freeSharedShelves(g));
  g.food += returned;
  g.pendingMealReturns -= returned;
  if (g.pendingMealReturns === 0) delete g.pendingMealReturns;
}

export function validMealReturns(g: Game) {
  if (!Object.hasOwn(g, "pendingMealReturns"))
    return g.pendingMealReturns === undefined;
  const pending = g.pendingMealReturns;
  if (!Number.isSafeInteger(pending) || pending! < 1) return false;
  // An older save may have one refundable stock-limit reservation per resident.
  const held = g.actors.reduce(
    (sum, actor) =>
      sum + (actor.location === g.home ? (actor.task?.reserved.food ?? 0) : 0),
    0,
  );
  const overcommitted = g.food + held - stockLimit;
  return (
    overcommitted >= 0 &&
    pending! + overcommitted <= g.actors.length * stockLimit
  );
}
