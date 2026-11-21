import type { GameState, Resources } from "./types";

export const DEFAULT_FOOD_PRODUCTION_TARGET = 6;
export const MAX_FOOD_PRODUCTION_TARGET = 99;

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const validTarget = (target: unknown): target is number => typeof target === "number"
  && Number.isInteger(target) && target >= 0 && target <= MAX_FOOD_PRODUCTION_TARGET;

/** Optional configuration has no action identities, completion history or stock. */
export function validFoodProduction(s: GameState): boolean {
  if (!record(s)) return false;
  if (s.foodProduction === undefined) return true;
  const settings = s.foodProduction;
  return record(settings) && settings.version === 1 && validTarget(settings.target)
    && Object.keys(settings).every(key => ["version", "target"].includes(key));
}

/** Reading legacy saves retains their original six-meal threshold without writing it. */
export function getFoodProductionTarget(s: GameState): number {
  return validFoodProduction(s) && s.foodProduction
    ? s.foodProduction.target : DEFAULT_FOOD_PRODUCTION_TARGET;
}

/** Use the same local, unreserved inputs at the initial decision and actual arrival. */
export function needsFoodProduction(s: GameState, free: Resources): boolean {
  return record(free) && typeof free.food === "number" && Number.isFinite(free.food)
    && typeof free.ingredients === "number" && Number.isFinite(free.ingredients)
    && free.food < getFoodProductionTarget(s) && free.ingredients >= 2;
}

/** The engine owns the outer clone. A setting never starts, cancels or reserves work. */
export function setFoodProductionTarget(s: GameState, target: number): { changed: boolean; error?: string } {
  if (!record(s) || typeof s.ended !== "boolean" || !validFoodProduction(s))
    return { changed: false, error: "自動調理の補充目安の保存内容を確認してください。" };
  if (s.ended) return { changed: false, error: "この試行は終了しています。保存から再開してください。" };
  if (!validTarget(target)) return { changed: false, error: "自動調理の補充目安は0から99食の整数で指定してください。" };
  if (target === getFoodProductionTarget(s)) return { changed: false };
  s.foodProduction = { version: 1, target };
  return { changed: true };
}
