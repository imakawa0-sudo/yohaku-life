import type { LifeExperience, LocationId } from "./types";

const SCENERY_NAMES = {
  road: "草の道",
  shelter: "木陰の迂回路",
  ruins: "旧い資材置き場",
  village: "近隣の集落",
  meadow: "川沿いの採集地",
  reedbank: "上流の葦原",
  ridge: "尾根の近道",
} as const;

/** Outdoor places where an actual quiet visit can become a remembered subject. */
export function isSceneryLocation(
  location: LocationId,
): location is keyof typeof SCENERY_NAMES {
  return Object.hasOwn(SCENERY_NAMES, location);
}

export function sceneryName(location: LocationId): string {
  return isSceneryLocation(location) ? SCENERY_NAMES[location] : "この場所";
}

/** Base quiet leisure keeps its existing meaning and presentation. */
export function isOutdoorQuiet(
  event: Pick<LifeExperience, "kind" | "location">,
): boolean {
  return event.kind === "quiet" && isSceneryLocation(event.location);
}
