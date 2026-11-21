import { getPresentEncounterAt } from "./encounters";
import { canShareAtCurrentLocation, isBaseLocation, ownFreeResources } from "./inventory";
import type { GameState, LocationId, Resident } from "./types";

export const TARGET_HUNGER = 35;
export const HUNGER_PER_MINUTE = 0.055;
const MEAL_GAIN = 55;
const MEAL_MINUTES = 15;
const EPSILON = 1e-9;
const ASSUMPTION = "帰還時に満腹度35を残す食事の目安／適時食べる想定";

export type TripSupplyPerson = {
  residentId: string;
  freeFood: number;
  /** Food physically in this pack but locked by a current or held order. */
  reservedFood: number;
  activeMealCredit: boolean;
  heldMealFood: number;
  requiredMeals: number;
  projectedHungerWithoutNewMeals: number;
  warnings: string[];
  returnMinutes?: number;
};
export type TripSupplyGroup = {
  key: string;
  shareable: boolean;
  location: LocationId;
  residentIds: string[];
  requiredMeals: number;
  freeFood: number;
  shortfall: number;
};
export type TripSupplyPreview = {
  until: number;
  horizonMinutes: number;
  overdue: boolean;
  targetHunger: typeof TARGET_HUNGER;
  assumption: string;
  people: TripSupplyPerson[];
  groups: TripSupplyGroup[];
  requiredMeals: number;
  freeFood: number;
  /** Sum of whole-portion deficits at each present location, never a net stock. */
  shortfall: number;
  error?: string;
};
export type TripSupplyOptions = {
  estimateReturnMinutes?: (residentId: string) => number | undefined;
};

function activeMealProblem(s: GameState, resident: Resident, horizon: number): string | undefined {
  const meal = resident.action!;
  if (resident.hp <= 0) return "意識がないため、食事の完了を見込んでいません。";
  if ((getPresentEncounterAt(s, resident.location)?.hp ?? 0) > 0)
    return "交戦の危険があるため、食事の完了を見込んでいません。";
  if (meal.origin !== undefined ? meal.origin !== resident.location : !isBaseLocation(resident.location))
    return "食事を始めた場所を確認できないため、完了を見込んでいません。";
  const stock = meal.reservationSource === "pack"
    ? s.inventory?.packs[resident.id]?.food ?? 0
    : isBaseLocation(resident.location) ? s.resources.food : 0;
  if ((meal.reserved?.food ?? 0) < 1 || stock < 1)
    return "予約した食事の所在を確認できないため、完了を見込んでいません。";
  const remaining = Math.max(1, Math.ceil(meal.duration - meal.progress));
  if (remaining > horizon)
    return "食事中ですが帰還目安までに完了しないため、満腹度の回復を含めていません。";
  return undefined;
}

/**
 * A food budget, not a simulation or a command queue. Only selected people's
 * unreserved packs fund it. Meals must actually be ordered and completed;
 * production, trade, the warehouse and other people's packs are not promised.
 */
export function previewTripSupplies(
  s: GameState,
  ids: string[],
  until: number,
  options: TripSupplyOptions = {},
): TripSupplyPreview {
  const validUntil = Number.isSafeInteger(until) && until >= 0;
  const result: TripSupplyPreview = {
    until: validUntil ? until : s.minutes,
    horizonMinutes: validUntil ? Math.max(0, until - s.minutes) : 0,
    overdue: validUntil && until < s.minutes,
    targetHunger: TARGET_HUNGER,
    assumption: ASSUMPTION,
    people: [], groups: [], requiredMeals: 0, freeFood: 0, shortfall: 0,
  };
  if (!validUntil) return { ...result, error: "帰還目安は、0以上の整数の時刻を指定してください。" };
  if (!Array.isArray(ids) || !ids.length)
    return { ...result, error: "見通しを確認する住民を一覧で選んでください。" };
  if (ids.some(id => typeof id !== "string" || !s.residents.some(resident => resident.id === id)))
    return { ...result, error: "見通しを確認する住民が見つかりません。" };

  const groups = new Map<string, TripSupplyGroup>();
  for (const id of new Set(ids)) {
    const resident = s.residents.find(person => person.id === id)!;
    const freeFood = Math.max(0, ownFreeResources(s, id).food);
    const packFood = s.inventory?.packs[id]?.food ?? 0;
    const reservedFood = Math.max(0, packFood - freeFood);
    const heldMealFood = resident.suspended?.kind === "eat"
      ? Math.max(0, resident.suspended.reserved?.food ?? 0) : 0;
    const warnings: string[] = [];
    const shareable = canShareAtCurrentLocation(s, id);
    if (!shareable)
      warnings.push("移動・運搬中のため、この人の携行食を他の人の不足へ融通していません。");
    let hunger = resident.hunger;
    let remainingMinutes = result.horizonMinutes;
    let activeMealCredit = false;
    if (resident.action?.kind === "eat") {
      const problem = activeMealProblem(s, resident, remainingMinutes);
      if (problem) warnings.push(problem);
      else {
        const untilMeal = Math.max(1, Math.ceil(resident.action.duration - resident.action.progress));
        hunger = Math.min(100, Math.max(0, hunger - HUNGER_PER_MINUTE * untilMeal) + MEAL_GAIN);
        remainingMinutes -= untilMeal;
        activeMealCredit = true;
      }
    }
    const requiredMeals = Math.max(0, Math.ceil(
      (TARGET_HUNGER + HUNGER_PER_MINUTE * remainingMinutes - hunger - EPSILON) / MEAL_GAIN,
    ));
    const projectedHungerWithoutNewMeals = Math.max(0, hunger - HUNGER_PER_MINUTE * remainingMinutes);
    if (resident.hp <= 0)
      warnings.push("意識がありません。食事や自力の帰還を見込まず、先に救助と手当を確認してください。");
    if (resident.hunger < TARGET_HUNGER)
      warnings.push("満腹度が35未満です。今の食事と、眠る前の体調を確認してください。");
    if (requiredMeals > 0 && result.horizonMinutes < MEAL_MINUTES)
      warnings.push("食事には15分かかります。食料があっても、帰還目安までに食べ終えるとは限りません。");
    if (heldMealFood > 0) {
      warnings.push("中断中の食事は、再開を指示するまで満腹度の見通しに含めていません。");
      if ((resident.suspended?.reservationSource ?? "base") === "base")
        warnings.push("中断した食事の拠点予約は、携行食には含めていません。");
    }
    const travelling = [resident.action, resident.suspended].some(action =>
      action && ["move", "rescue"].includes(action.kind));
    const fighting = (resident.action && ["attack", "defend"].includes(resident.action.kind))
      || ((getPresentEncounterAt(s, resident.location)?.hp ?? 0) > 0);
    let returnMinutes: number | undefined;
    if (resident.hp <= 0 || travelling || fighting || !canShareAtCurrentLocation(s, id))
      warnings.push("移動・運搬・交戦や意識の状態を確認するまで、帰路の所要時間は見込んでいません。");
    else {
      const estimate = options.estimateReturnMinutes?.(id);
      if (typeof estimate === "number" && Number.isFinite(estimate) && estimate >= 0) {
        returnMinutes = Math.ceil(estimate);
        if (returnMinutes > result.horizonMinutes)
          warnings.push("いま帰っても帰還目安を過ぎる見通しです。帰路や予定を見直してください。");
      } else warnings.push("帰路の所要時間は未確認です。移動と帰り道を確かめてください。");
    }
    const person: TripSupplyPerson = {
      residentId: id, freeFood, reservedFood, activeMealCredit, heldMealFood,
      requiredMeals, projectedHungerWithoutNewMeals, warnings,
      ...(returnMinutes === undefined ? {} : { returnMinutes }),
    };
    result.people.push(person);
    const key = shareable ? `location:${resident.location}` : `person:${id}`;
    const group = groups.get(key) ?? {
      key, shareable, location: resident.location, residentIds: [], requiredMeals: 0, freeFood: 0, shortfall: 0,
    };
    group.residentIds.push(id);
    group.requiredMeals += requiredMeals;
    group.freeFood += freeFood;
    groups.set(key, group);
  }
  result.groups = [...groups.values()].map(group => ({
    ...group, shortfall: Math.max(0, Math.ceil(group.requiredMeals - group.freeFood - EPSILON)),
  }));
  result.requiredMeals = result.people.reduce((sum, person) => sum + person.requiredMeals, 0);
  result.freeFood = result.people.reduce((sum, person) => sum + person.freeFood, 0);
  result.shortfall = result.groups.reduce((sum, group) => sum + group.shortfall, 0);
  return result;
}
