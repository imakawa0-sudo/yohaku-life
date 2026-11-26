import type { Game } from "./sim";

export const stockLimit = 1_000_000_000;

function reservedFor(g: Game, account: object, key: "food" | MealInput) {
  return g.actors.reduce((sum, a) => {
    const source = a.location === g.home ? g : a.cargo;
    return sum + (source === account ? (a.task?.reserved[key] ?? 0) : 0);
  }, 0);
}

function freeSharedShelves(g: Game) {
  return Math.max(0, stockLimit - g.food - reservedFor(g, g, "food"));
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
  if (
    typeof pending !== "number" ||
    !Number.isSafeInteger(pending) ||
    pending < 1
  )
    return false;
  // An older save may have one refundable stock-limit reservation per resident.
  const overcommitted = g.food + reservedFor(g, g, "food") - stockLimit;
  return (
    overcommitted >= 0 &&
    pending + overcommitted <= g.actors.length * stockLimit
  );
}

type MealInput = "ingredients" | "coins";
export interface MealInputAccount {
  ingredients: number;
  coins: number;
  pendingMealInputReturns?: Partial<Record<MealInput, number>>;
}

/** Only a cook's raw ingredients or a buyer's purchase price can produce this receipt. */
export function refundMealInput(
  account: MealInputAccount,
  input: MealInput,
  count: number,
) {
  const returned = Math.min(count, stockLimit - account[input]);
  account[input] += returned;
  if (returned === count) return;
  const pending = (account.pendingMealInputReturns ??= {});
  pending[input] = (pending[input] ?? 0) + count - returned;
}

/** Reuse a returned ingredient or coin for the next recipe/purchase at that same account. */
export function reserveMealInput(
  account: MealInputAccount,
  input: MealInput,
  count: number,
) {
  const pending = account.pendingMealInputReturns;
  const held = pending?.[input] ?? 0;
  if (held) {
    const used = Math.min(held, count);
    if (held === used) delete pending![input];
    else pending![input] = held - used;
    if (!Object.keys(pending!).length) delete account.pendingMealInputReturns;
    count -= used;
  }
  account[input] -= count;
}

export function settleMealInputReturns(g: Game, account: MealInputAccount = g) {
  const pending = account.pendingMealInputReturns;
  if (!pending) return;
  for (const input of ["ingredients", "coins"] as const) {
    const count = pending[input];
    if (!count) continue;
    const free = Math.max(
      0,
      stockLimit - account[input] - reservedFor(g, account, input),
    );
    const returned = Math.min(count, free);
    account[input] += returned;
    if (returned === count) delete pending[input];
    else pending[input] = count - returned;
  }
  if (!Object.keys(pending).length) delete account.pendingMealInputReturns;
}

export function validMealInputReturns(g: Game, account: MealInputAccount = g) {
  if (!Object.hasOwn(account, "pendingMealInputReturns"))
    return account.pendingMealInputReturns === undefined;
  const pending = account.pendingMealInputReturns;
  if (!pending || typeof pending !== "object" || Array.isArray(pending))
    return false;
  const entries = Object.entries(pending);
  return (
    entries.length > 0 &&
    entries.every(([key, count]) => {
      if (
        (key !== "ingredients" && key !== "coins") ||
        typeof count !== "number" ||
        !Number.isSafeInteger(count) ||
        count < 1
      )
        return false;
      const held = reservedFor(g, account, key);
      if (account[key] + held < stockLimit) return false;
      const refundable = g.actors.reduce((sum, actor) => {
        const source = actor.location === g.home ? g : actor.cargo;
        const job = actor.task;
        const usesInput =
          key === "coins"
            ? job?.kind === "buy"
            : job?.kind === "work" && job.target?.split(":")[0] === "cook";
        return (
          sum +
          (source === account && usesInput ? (job?.reserved[key] ?? 0) : 0)
        );
      }, 0);
      const residents = account === g ? g.actors.length : 1;
      return (
        count + Math.max(0, account[key] + refundable - stockLimit) <=
        residents * stockLimit
      );
    })
  );
}
