import { workSite } from "./types";
import type { CraftPiece, GameState, LocationId, ProjectRecipeId, ProjectUpgrade, Resources } from "./types";

export type { ProjectRecipeId, ProjectUpgrade } from "./types";
export type ProjectRecipe = {
  id: ProjectRecipeId;
  title: string;
  description: string;
  cost: Partial<Resources>;
  effect: string;
  repeatable: boolean;
  baseMinutes: number;
  minMinutes: number;
  craftReduction: number;
};
export type ProjectSummary = {
  recipe: ProjectRecipe;
  completed?: ProjectUpgrade;
  working?: { residentId: string; paused: boolean };
};
export const PROJECT_RECIPES: readonly ProjectRecipe[] = [
  {
    id: "wood-flower", title: "木彫りの花",
    description: "回収材から一輪の花を彫る。作者の手元に残り、窓辺へ飾ることもできる。",
    cost: { scrap: 1 }, effect: "自分の作品が一つ増える。携帯・展示できる。", repeatable: true,
    baseMinutes: 55, minMinutes: 25, craftReduction: 3,
  },
  {
    id: "kitchen-tools", title: "料理道具を整える",
    description: "使いやすい調理道具を、この場所に揃える。共同の食事を少し早く用意できる。",
    cost: { scrap: 3 }, effect: "この場所で新しく始める料理の時間を25%短縮。食材と完成数は同じ。", repeatable: false,
    baseMinutes: 60, minMinutes: 30, craftReduction: 5,
  },
  {
    id: "rest-corner", title: "静かな休憩場所",
    description: "背を預けて休める場所を、この部屋に整える。生活の合間を少し心地よくする。",
    cost: { scrap: 3 }, effect: "この場所での休息完了時、活力をさらに8、体力をさらに2回復。", repeatable: false,
    baseMinutes: 50, minMinutes: 25, craftReduction: 3,
  },
  {
    id: "crafting-tools", title: "手仕事台を整える",
    description: "彫る道具と組み立てる道具を、この場所に揃える。木彫りや設備の制作を少し早く進められる。",
    cost: { scrap: 3 }, effect: "この場所で新しく始める小鳥・花・設備制作の時間を25%短縮。材料と完成数は同じ。", repeatable: false,
    baseMinutes: 60, minMinutes: 30, craftReduction: 5,
  },
];
export function getProjectRecipe(id: string | undefined): ProjectRecipe | undefined {
  return PROJECT_RECIPES.find((recipe) => recipe.id === id);
}
export function getProjectDuration(state: GameState, residentId: string, recipeId: string): number | undefined {
  const resident = state.residents.find((r) => r.id === residentId);
  const recipe = getProjectRecipe(recipeId);
  if (!resident || !recipe) return undefined;
  return Math.ceil(Math.max(recipe.minMinutes, recipe.baseMinutes - resident.skills.craft * recipe.craftReduction)
    * (1 + resident.wounds.arm * 0.25) * getLocalProjectEffects(state, resident.location).craftingMultiplier);
}
export function getProjectSummary(state: GameState, location: LocationId = "home"): ProjectSummary[] {
  return PROJECT_RECIPES.map((recipe) => {
    const completed = state.life?.upgrades?.find((upgrade) => upgrade.recipeId === recipe.id && workSite(upgrade.location) === workSite(location));
    for (const resident of state.residents) {
      for (const [action, paused] of [[resident.action, false], [resident.suspended, true]] as const) {
        if (action?.kind === "project" && action.target === recipe.id && workSite(action.origin) === workSite(location))
          return { recipe, ...(completed ? { completed } : {}), working: { residentId: resident.id, paused } };
      }
    }
    return { recipe, ...(completed ? { completed } : {}) };
  });
}
export function getCraftTitle(piece: CraftPiece): string {
  return piece.design === "flower" ? "木彫りの花" : "小鳥の木彫り";
}
export function getLocalProjectEffects(state: GameState, location: LocationId): {
  cookingMultiplier: number; restEnergyBonus: number; restHpBonus: number; craftingMultiplier: number;
} {
  const local = state.life?.upgrades?.filter((upgrade) => upgrade.location === location) ?? [];
  const cooking = local.some((upgrade) => upgrade.recipeId === "kitchen-tools");
  const rest = local.some((upgrade) => upgrade.recipeId === "rest-corner");
  const crafting = local.some((upgrade) => upgrade.recipeId === "crafting-tools");
  return { cookingMultiplier: cooking ? 0.75 : 1, restEnergyBonus: rest ? 8 : 0, restHpBonus: rest ? 2 : 0,
    craftingMultiplier: crafting ? 0.75 : 1 };
}
