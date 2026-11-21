import type { GameState, Resident, ResidentRoutine, WishKind } from "./types";

const DEFAULT_ROUTINE: ResidentRoutine = { workRole: "support", home: "home", leisure: "quiet" };
const LEGACY_ROUTINES: Record<string, ResidentRoutine> = {
  aki: DEFAULT_ROUTINE,
  mio: { workRole: "cook", home: "home", leisure: "social" },
  ren: { workRole: "gather", home: "bedroom", leisure: "quiet" },
};
const LEGACY_WISHES: Record<string, WishKind> = {
  aki: "display", mio: "household-meal", ren: "safe-return",
};

/** Read projections retain old-save defaults without initializing or sharing mutable data. */
export function getRoutine(resident: Resident): ResidentRoutine {
  const legacy = Object.hasOwn(LEGACY_ROUTINES, resident.id) ? LEGACY_ROUTINES[resident.id] : DEFAULT_ROUTINE;
  return { ...(resident.routine ?? legacy) };
}

export function getWishKind(resident: Resident): WishKind {
  return resident.wishKind ?? (Object.hasOwn(LEGACY_WISHES, resident.id) ? LEGACY_WISHES[resident.id] : "settle");
}

export function validRoutine(value: unknown): value is ResidentRoutine {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const profile = value as Record<string, unknown>;
  return Object.keys(profile).length === 3
    && ["cook", "gather", "support"].includes(profile.workRole as string)
    && ["home", "kitchen", "bedroom", "garden"].includes(profile.home as string)
    && ["social", "quiet"].includes(profile.leisure as string);
}

/** Called only when creating a household or accepting a previously validated old save. */
export function initializeResidentProfiles(state: GameState): void {
  for (const resident of state.residents) {
    resident.routine ??= getRoutine(resident);
    resident.wishKind ??= getWishKind(resident);
  }
}
