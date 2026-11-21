import type { InventoryState } from "./inventory";
import type { RegionChoice, RegionState } from "./region";
import type { CoinChoice, CoinTransferFact, CurrencyState } from "./currency";
import type { RouteWorkFact, RouteWorksState } from "./route-works";
import type { GuardAgreementFact, GuardAgreementState } from "./guard-agreement";

export const LOCATION_IDS = [
  "home", "kitchen", "bedroom", "garden", "road", "ruins", "shelter",
  "village", "meadow", "ridge", "reedbank", "lodge",
] as const;
export type LocationId = (typeof LOCATION_IDS)[number];
/** Both households own separate pots and workshop fittings. Legacy jobs used the main house. */
export function workSite(location?: LocationId): "home" | "lodge" {
  return location === "lodge" ? "lodge" : "home";
}
export function isKnownLocation(value: unknown): value is LocationId {
  return typeof value === "string" && (LOCATION_IDS as readonly string[]).includes(value);
}
export type ActionKind =
  | "cook"
  | "eat"
  | "rest"
  | "socialize"
  | "hobby"
  | "decorate"
  | "place-craft"
  | "project"
  | "repair-route"
  | "approach-ridge"
  | "gather"
  | "observe"
  | "move"
  | "attack"
  | "defend"
  | "rescue"
  | "heal"
  | "sleep"
  | "help";
export type Resources = {
  food: number;
  ingredients: number;
  medicine: number;
  scrap: number;
};
/** One existing pack resource reserved for a single trip to the base store. */
export type MoveCargo = { resource: keyof Resources; amount: number };
export type EncounterId = "ruins-guard" | "ridge-watch";
export type EncounterFact = { id: EncounterId; location: LocationId };
export type SecondaryEncounterState = {
  version: 1;
  hp: number;
  defeated: boolean;
  alerted?: boolean;
  introducedAt: number;
  actorId: string;
  logId: number;
};
export type ResidentRoutine = {
  workRole: "cook" | "gather" | "support";
  home: "home" | "kitchen" | "bedroom" | "garden";
  leisure: "social" | "quiet";
};
export type WishKind = "display" | "household-meal" | "safe-return" | "settle";
/** An intention for one advance call, never a saved pause mode. */
export type AdvanceOptions = { stopAtActionEnd?: boolean };
export type Action = {
  id: number;
  kind: ActionKind;
  label: string;
  progress: number;
  duration: number;
  target?: string;
  /** Missing remains the old guard; only second-target combat saves this field. */
  encounterId?: EncounterId;
  reserved?: Partial<Resources>;
  reservationSource?: "base" | "pack";
  materialTransfers?: { from: string; resource: keyof Resources; amount: number }[];
  automatic?: boolean;
  path?: LocationId[];
  segment?: number;
  segmentProgress?: number;
  segmentDuration?: number;
  origin?: LocationId;
  /** Delivery stays physically in the owner's pack until final arrival. */
  cargo?: MoveCargo;
  /** Only two current manual moves may share this single trip. */
  together?: { peerResidentId: string; peerActionId: number };
  /** An old save already owns a shelf, but has not recorded its place. */
  restoringShelf?: boolean;
  /** The exact work originally offered help; absent only in older saves. */
  targetActionId?: number;
  autonomyReason?: AutonomyReason;
  autonomyNext?: "cook" | "gather" | "rest";
  /** An explicitly chosen outdoor quiet experience, never inferred from timing. */
  subjectEventId?: number;
  /** Completed local workbench used when this handwork action was first started. */
  craftingToolsId?: number;
  /** Two reciprocal jobs share this particular object, not its past creation. */
  topic?: { kind: "craft"; craftId: number; peerActionId: number };
};
export type Resident = {
  id: string;
  name: string;
  role: string;
  traits: string[];
  wish: string;
  location: LocationId;
  hp: number;
  hunger: number;
  energy: number;
  mood: number;
  skills: { cooking: number; combat: number; craft: number };
  weapon: "knife" | "spear" | "staff";
  armor: boolean;
  policy: "balanced" | "cook" | "gather" | "rest";
  action: Action | null;
  suspended: Action | null;
  relations: Record<string, { closeness: number; trust: number }>;
  memories: string[];
  wounds: { arm: number; leg: number; body: number };
  routine?: ResidentRoutine;
  wishKind?: WishKind;
  /** New household membership does not grant any earlier experiences. */
  joinedAt?: number;
  joinedLogId?: number;
  sourceNpcId?: string;
};
export type GameLog = {
  id: number;
  time: number;
  type: "life" | "work" | "social" | "explore" | "combat" | "system";
  title: string;
  text: string;
  actors: string[];
  witnesses: string[];
  /** Structured fact for one actual currency transaction; absent on older logs. */
  coinTrade?: { choice: CoinChoice; termsId: "village-coins-v1" };
  coinTransfer?: CoinTransferFact;
  /** One actual completed local roadwork, paired with its saved result. */
  routeWork?: RouteWorkFact;
  guardAgreement?: GuardAgreementFact;
  /** The shopkeeper heard the agreement from its participant. References its original log. */
  reportedGuardAgreementId?: number;
  encounter?: EncounterFact;
};
export type TravelPlan = {
  id: number;
  revisionId: number;
  createdAt: number;
  updatedAt: number;
  residentIds: string[];
  purpose: string;
  returnAt: number;
  remindedAt?: number;
  closedAt?: number;
};
export type TravelPlanState = { version: 1; entries: TravelPlan[] };
export type SelectionPreset = { id: number; name: string; residentIds: string[] };
export type SelectionPresetState = { version: 1; nextPresetId: number; entries: SelectionPreset[] };
export type FoodProductionSettings = { version: 1; target: number };
export type GameState = {
  /** Missing for the original three founders, including all older saves. */
  origin?: "solo" | "trader";
  version: 1 | 2 | 3 | 4 | 5;
  minutes: number;
  seed: number;
  residents: Resident[];
  resources: Resources;
  /** resources is the base warehouse; carried and dropped stock has its own location. */
  inventory?: InventoryState;
  region?: RegionState;
  /** Only created by a real local coin handoff; wallets remain derived. */
  currency?: CurrencyState;
  /** Created only after the one local roadwork actually completes. */
  routeWorks?: RouteWorksState;
  /** The existing guard departed by agreement, without a combat defeat. */
  guardAgreement?: GuardAgreementState;
  /** Exists only after an actual local approach, never on read/createGame. */
  secondaryEncounter?: SecondaryEncounterState;
  /** Management intentions only; plans never execute an action or create knowledge. */
  travelPlans?: TravelPlanState;
  /** Selection shortcuts only; their local IDs never identify world actions or events. */
  selectionPresets?: SelectionPresetState;
  /** Replenishment threshold for food the autonomous cook can actually access. */
  foodProduction?: FoodProductionSettings;
  logs: GameLog[];
  enemy: {
    hp: number;
    location: LocationId;
    defeated: boolean;
    alerted?: boolean;
  };
  flags: {
    decorated: boolean;
    hobbyFinished: boolean;
    suppliesRecovered: boolean;
    safeSuppliesRecovered?: boolean;
  };
  nextId: number;
  ended: boolean;
  /** Missing in older version-1 saves; absence means automatic battle is off. */
  autoCombat?: boolean;
  /** Optional extension: older saves have no attributed objects or experiences. */
  life?: LifeState;
  autonomy?: AutonomyState;
  trade?: TradeState;
  pauseReason?: string;
};
export type CraftPiece = {
  id: number;
  authorId: string;
  createdAt: number;
  createdLocation: LocationId;
  displayedAt?: number;
  displayLocation?: LocationId;
  /** Missing on older attributed works means the original bird design. */
  design?: "bird" | "flower";
  /** The author's own experience selected when this work was started. */
  subjectEventId?: number;
};
export type ProjectRecipeId = "wood-flower" | "kitchen-tools" | "rest-corner" | "crafting-tools";
export type ProjectUpgrade = {
  id: number;
  recipeId: "kitchen-tools" | "rest-corner" | "crafting-tools";
  creatorId: string;
  location: LocationId;
  completedAt: number;
};
export type LifeExperienceKind =
  | "craft"
  | "shelf"
  | "display"
  | "village-art-feedback"
  | "meal"
  | "help"
  | "rescue"
  | "heal"
  | "supply"
  | "return"
  | "wish"
  | "conversation"
  | "project"
  | "quiet";
/** Information heard in this completed conversation, never a new eyewitness. */
export type ConversationReport = {
  sourceEventId: number;
  speakerId: string;
  listenerId: string;
};
export type EventKnowledge =
  | { status: "unknown" }
  | { status: "direct"; knownAt: number }
  | { status: "reported"; knownAt: number; speakerId: string; conversationEventId: number };
export type LifeExperience = {
  id: number;
  time: number;
  kind: LifeExperienceKind;
  location: LocationId;
  actors: string[];
  witnesses: string[];
  /** Individual finishes at the lodge; a shared table may include earlier diners. */
  lodgeMealFinishers?: string[];
  title: string;
  text: string;
  subjectId?: string;
  craftId?: number;
  health?: number;
  /** The actual collectors' health when supplies were recovered. */
  healthByActor?: Record<string, number>;
  projectId?: number;
  report?: ConversationReport;
  /** A completed, explicitly selected object-sharing scene. */
  topic?: { kind: "craft"; craftId: number };
};
export type MorningReflection = {
  residentId: string;
  day: number;
  time: number;
  eventId: number;
  text: string;
};
export type LifeState = {
  version: 1;
  crafts: CraftPiece[];
  shelf?: { location: LocationId; creatorId: string; time: number };
  wishes: Record<string, { completedAt: number; eventId: number }>;
  events: LifeExperience[];
  reflections: MorningReflection[];
  meals: { residentId: string; time: number; location: LocationId }[];
  upgrades?: ProjectUpgrade[];
};
export type AutonomyReason = {
  code: "food" | "recovery" | "cooking" | "gathering" | "return" | "quiet" | "help" | "social";
  text: string;
  decidedAt: number;
};
export type AutonomyState = {
  version: 1;
  leisure: Record<string, { day: number; startedAt: number; kind: "help" | "social" | "quiet"; actionId: number }>;
  manualStays: Record<string, { time: number; location: LocationId; source: "arrival" | "cancel" }>;
  conversations: Record<string, { day: number; count: number; time: number; eventId: number }>;
  mealPairs: Record<string, { time: number; location: LocationId; eventId: number }>;
};
export type TradeOfferId = "meal-for-scrap" | "ingredients-for-scrap" | "meal-for-medicine" | "ingredients-for-medicine";
export type MerchantTermsId = "merchant-barter-v1";
export type TradeReceipt = {
  id: number;
  visitId: number;
  actorId: string;
  time: number;
  offerId: TradeOfferId;
  /** Missing on older receipts means the original merchant barter terms. */
  termsId?: MerchantTermsId;
  paid: Partial<Resources>;
  received: Partial<Resources>;
  lowFoodConfirmed?: boolean;
};
export type MerchantVisit = {
  id: number;
  arrivesAt: number;
  leavesAt: number;
  status: "open" | "departed";
  stock: { scrap: number; medicine: number };
  /** Set only when a real visit starts; absent on older saved visits. */
  termsId?: MerchantTermsId;
};
export type TradeState = { version: 1; nextArrival: number; visit?: MerchantVisit; receipts: TradeReceipt[] };
export type Command =
  | { type: "move-together"; residentIds: string[]; target: LocationId; via?: LocationId[] }
  | { type: "guard-agreement"; residentIds: string[] }
  | { type: "food-production-target"; target: number }
  | { type: "save-selection-preset"; presetId?: number; name: string; residentIds: string[] }
  | { type: "delete-selection-preset"; presetId: number }
  | { type: "plan-trip"; planId?: number; residentIds: string[]; purpose: string; returnAt: number }
  | { type: "close-trip"; planId: number }
  | { type: "recruit"; residentId: string; npcId: string }
  | { type: "routine"; residentId: string; routine: ResidentRoutine }
  | { type: "transfer"; residentId: string; from: string; to: string; resource: keyof Resources; amount: number }
  | { type: "transfer-coins"; residentId: string; from: string; to: string; amount: number }
  | { type: "region"; residentId: string; npcId: string; choice: RegionChoice }
  | { type: "trade"; residentId: string; visitId: number; offerId: TradeOfferId; allowLowFood?: boolean; confirmationKey?: string }
  | { type: "auto-combat"; enabled: boolean }
  | { type: "assign"; residentIds: string[]; kind: ActionKind; target?: string; encounterId?: EncounterId; subjectEventId?: number; via?: LocationId[]; cargo?: MoveCargo }
  | { type: "exhibit-village-art"; residentId: string; craftId: number }
  | { type: "hear-village-art"; residentId: string }
  | { type: "discuss-craft"; residentIds: string[]; craftId: number }
  | { type: "cancel"; residentId: string; actionId?: number }
  | { type: "pause" | "resume"; residentId: string }
  | { type: "policy"; residentId: string; policy: Resident["policy"] }
  | {
      type: "equip";
      residentId: string;
      weapon?: Resident["weapon"];
      armor?: boolean;
    };
export type Location = {
  id: LocationId;
  name: string;
  description: string;
  kind: "base" | "wild";
  connections: LocationId[];
};
