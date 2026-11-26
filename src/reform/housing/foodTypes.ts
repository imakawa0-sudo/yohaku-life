import type { Game } from "../sim";
import type { SpatialPoint } from "../spatial/types";

export const foodBundleQuantity = 2;
export type FoodAssignment = {
  kind: "store" | "return" | "cook";
  actorId: string;
  orderId: string;
};
type BundleRecord = {
  id: string;
  material: "vegetables";
  quantity: typeof foodBundleQuantity;
  createdAt: number;
};
export type PresentFood = BundleRecord & {
  state: "present";
  source: SpatialPoint;
  storage: SpatialPoint;
  itemId: string;
  assignment?: FoodAssignment;
};
export type FoodBundle =
  | PresentFood
  | (BundleRecord & {
      state: "consumed" | "returned";
      settledAt: number;
    });
export type FoodLogistics = { version: 1; nextId: number; bundle: FoodBundle };
export type FoodResult = { game: Game; error?: string; bundleId?: string };
export type FoodInspection = {
  ok: boolean;
  disabled?: string;
  minutes: number | null;
};
