import { useEffect, useRef, useState } from "react";
import { OpeningPicker, PreviousOpenings, preserveBeforeSwitch } from "./components/WorldOpenings";
import { OPENINGS, type WorldOrigin } from "./game/origins";
import { TogetherTravelPanel, TogetherMoveStatus } from "./components/TogetherTravelPanel";
import { getTogetherMoveInfo, getTogetherTravelScope, type TogetherRouteRequest } from "./components/together-travel";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Backpack,
  BedDouble,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Coffee,
  Compass,
  Feather,
  Flag,
  Footprints,
  Hammer,
  Heart,
  HeartHandshake,
  House,
  Leaf,
  MapPin,
  Moon,
  Package,
  Play,
  Plus,
  RotateCcw,
  Save,
  Shield,
  Sparkles,
  Sprout,
  Sun,
  Swords,
  TentTree,
  Upload,
  Users,
  Utensils,
  Wheat,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  LOCATIONS,
  inspectTravelRoute,
  getMerchantOffers,
  getCombatants,
  command,
  createGame,
  deserialize,
  formatTime,
  getAutonomyReason,
  getIncomingConversation,
  getCraftTitle,
  getCraftSubject,
  getCraftSubjectChoices,
  getCraftSubjectText,
  getCraftDisplayTitle,
  getCraftConversationStatus,
  knowsCraft,
  getProjectRecipe,
  getProjectDuration,
  getProjectSummary,
  getRouteWorkSummary,
  GUARD_AGREEMENT_RULE,
  getPresentEncounterAt,
  getLocalEncounter,
  getEncounters,
  SECOND_ENCOUNTER_RULE,
  getRidgeApproachProblem,
  getMerchantStatus,
  getResidentLife,
  getWishProgress,
  previewTrade,
  serialize,
  tradeSelection,
} from "./game/engine";
import type {
  ActionKind,
  Command,
  GameLog,
  GameState,
  LocationId,
  ProjectRecipeId,
  Resident,
  ResidentRoutine,
  Resources,
  TradeOfferId,
} from "./game/types";
import {
  GUIDE_STEPS,
  getLocationScene,
  PLAY_ROUTES,
  SOLO_ROUTES,
} from "./game/content";
import {
  assignSelection,
  assignSubjectCraftSelection,
  assignCraftConversationSelection,
} from "./game/selection";
import { Landscape, describeLandscape } from "./components/Landscape";
import { CarryLine, TravelPanel } from "./components/TravelPanel";
import { AwayPanel } from "./components/AwayPanel";
import { SquadPanel } from "./components/SquadPanel";
import { FoodProductionPanel } from "./components/FoodProductionPanel";
import { TradeHistory } from "./components/TradeHistory";
import { TripPlanPanel, TravelPlanReminders, type TripPlanOpenRequest } from "./components/TripPlanPanel";
import { Destinations } from "./components/Destinations";
import { DayTripRoutes, RegionPanel } from "./components/RegionPanel";
import { RouteWorkAction } from "./components/RouteWorkAction";
import { GuardAgreementAction } from "./components/GuardAgreementAction";
import { RidgeApproachAction } from "./components/RidgeApproachAction";
import { accessibleResources, freeBaseResources, isBaseLocation, ownFreeResources, totalResources } from "./game/inventory";
import { HARVEST_SITES, hasReportedGuardAgreement, isHarvestLocation, REGION_NPCS, regionHarvestAvailable } from "./game/region";
import { getRoutine } from "./game/routines";
import { getSleepSite, inspectSleep } from "./game/overnight";
import {
  deriveAttention,
  formatVitalValue,
  getHomeHistoryItems,
  getLogFocusResident,
  getInterruptedActionSummary,
} from "./game/presentation";
import {
  advanceFromControls,
  advanceToNextBoundaryFromControls,
  advanceTimeShortcutFromControls,
  getTimeControls,
  previewTimeShortcut,
} from "./game/time-controls";

type View = "life" | "residents" | "base" | "world" | "journal";
type Modal = "save" | "help" | "reset" | "craft" | "trade" | null;
type TradeConfirmation = {
  visitId: number;
  offerId: TradeOfferId;
  actorId: string;
  key: string;
  state: GameState;
  selection: string[];
};
const AUTO_KEY = "yohaku-autosave-v1";
const SAVE_KEY = "yohaku-save-v1";
const policyNames = {
  balanced: "暮らしを優先",
  cook: "食事を整える",
  gather: "食材を集める",
  rest: "休養を優先",
};
const weapons = { knife: "小刀", spear: "槍", staff: "杖" };
const projectIcons: Record<ProjectRecipeId, LucideIcon> = {
  "wood-flower": Feather,
  "kitchen-tools": Utensils,
  "rest-corner": BedDouble,
  "crafting-tools": Hammer,
};
function resourceText(resources: Partial<Resources>): string {
  const labels = {
    food: "食事",
    ingredients: "食材",
    medicine: "手当用品",
    scrap: "資材",
  };
  return Object.entries(resources)
    .map(([key, amount]) => `${labels[key as keyof Resources]}${amount}`)
    .join("・");
}
function dayTime(minutes: number): string {
  return `第${Math.floor(minutes / 1440) + 1}日 ${formatTime(minutes)}`;
}
function describePolicy(resident: Resident): string {
  if (resident.id === "aki")
    return "アキはあなたが直接操作します。方針を変えただけでは動きません。";
  if (resident.policy === "cook")
    return "食事の不足を優先。必要な分を作ったら、次の不足まで待ちます。";
  if (resident.policy === "gather")
    return "食材の不足を優先。必要な分を集めたら、次の不足まで待ちます。";
  if (resident.policy === "rest")
    return "体調を整えます。回復したら同じ休息を繰り返さず、必要になるまで待ちます。";
  const routine = getRoutine(resident);
  const work = {
    cook: "料理を主に担当。食事が足りていれば、他の暮らしを選びます。",
    gather: "採取を主に担当。食材が足りていれば、他の暮らしを選びます。",
    support: "暮らしを手伝う担当。拠点の不足を見て、食事や食材を整えます。",
  }[routine.workRole];
  return `${work}${routine.leisure === "social" ? "余裕があれば、仲間との交流を選びます。" : "仕事の後は、静かな場所で過ごす時間も選びます。"}`;
}
export function ResidentRoutineControls({ resident, onCommand }: {
  resident: Resident;
  onCommand: (cmd: Command) => boolean;
}) {
  const routine = getRoutine(resident);
  const update = (change: Partial<ResidentRoutine>) => onCommand({
    type: "routine", residentId: resident.id, routine: { ...routine, ...change },
  });
  return <details className="resident-routine">
    <summary><span>暮らしの担当</span><ChevronDown size={15} /></summary>
    {resident.id === "aki" ? <p>アキはあなたが直接操作する人です。暮らしの担当による自主行動は行いません。</p> : <>
      <p>ふだんの方針の中で、何を受け持つかを選びます。変更だけでは時計や途中の仕事は動きません。</p>
      <div className="person-controls routine-controls">
        <label>仕事の担当
          <select aria-label={`${resident.name}の仕事の担当`} value={routine.workRole} onChange={e => update({ workRole: e.target.value as ResidentRoutine["workRole"] })}>
            <option value="cook">料理を受け持つ</option><option value="gather">採取を受け持つ</option><option value="support">暮らしを手伝う</option>
          </select>
        </label>
        <label>落ち着く場所
          <select aria-label={`${resident.name}の落ち着く場所`} value={routine.home} onChange={e => update({ home: e.target.value as ResidentRoutine["home"] })}>
            <option value="home">共同の居間</option><option value="kitchen">台所</option><option value="bedroom">寝室</option><option value="garden">菜園</option>
          </select>
        </label>
        <label>余暇の過ごし方
          <select aria-label={`${resident.name}の余暇の過ごし方`} value={routine.leisure} onChange={e => update({ leisure: e.target.value as ResidentRoutine["leisure"] })}>
            <option value="social">仲間と交流</option><option value="quiet">静かに過ごす</option>
          </select>
        </label>
      </div>
    </>}
  </details>;
}
function getResidentActivityText(resident: Resident): string {
  if (resident.hp <= 0)
    return LOCATIONS[resident.location].kind === "base"
      ? "意識なし · 手当が必要"
      : "意識なし · 救助が必要";
  if (resident.action) return resident.action.label;
  if (resident.suspended) return "作業を中断中";
  return "手が空いている";
}
let startupError = "";
function initialGame(): GameState {
  try {
    const raw = localStorage.getItem(AUTO_KEY);
    if (raw) return deserialize(raw);
  } catch {
    startupError =
      "前回の自動保存を読み込めませんでした。保存ファイルを読み込むか、新しい暮らしを始められます。";
  }
  return createGame();
}
function Icon({
  icon: Component,
  size = 18,
  ...props
}: {
  icon: LucideIcon;
  size?: number;
  className?: string;
}) {
  return <Component size={size} strokeWidth={1.6} {...props} />;
}
function Avatar({
  resident,
  small = false,
}: {
  resident: Resident;
  small?: boolean;
}) {
  return (
    <span
      className={`avatar avatar-${resident.id} ${small ? "small" : ""}`}
      aria-hidden="true"
    >
      {resident.name.charAt(0)}
      <span className={resident.hp <= 0 ? "avatar-dot down" : "avatar-dot"} />
    </span>
  );
}
function Meter({
  label,
  value,
  color = "olive",
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="meter">
      <div className="meter-label">
        <span>{label}</span>
        <span>
          {formatVitalValue(value)}
          <small> / 100</small>
        </span>
      </div>
      <div className="meter-track">
        <span
          className={color}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

export default function App() {
  const [game, setGame] = useState<GameState>(initialGame);
  const [view, setView] = useState<View>("life");
  const [selected, setSelected] = useState("aki");
  const [group, setGroup] = useState<string[]>(["aki"]);
  const [managementSession, setManagementSession] = useState(0);
  const [modal, setModal] = useState<Modal>(null);
  const [craftSubjectSelection, setCraftSubjectSelection] = useState<{
    authorId: string;
    eventId: number;
  } | null>(null);
  const [craftConversationId, setCraftConversationId] = useState<number | null>(
    null,
  );
  const [toast, setToast] = useState(startupError);
  const [tradeConfirmation, setTradeConfirmation] =
    useState<TradeConfirmation | null>(null);
  const [tradeFeedback, setTradeFeedback] = useState<{
    offerId: TradeOfferId;
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [journalFilter, setJournalFilter] = useState("all");
  const [tripPlanOpenRequest, setTripPlanOpenRequest] = useState<TripPlanOpenRequest | null>(null);
  const [togetherRouteRequest, setTogetherRouteRequest] = useState<TogetherRouteRequest | null>(null);
  const [savedAt, setSavedAt] = useState(() => {
    try {
      return localStorage.getItem(SAVE_KEY)
        ? "保存データあり"
        : "まだ保存されていません";
    } catch {
      return "保存領域を利用できません";
    }
  });
  const upload = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const names: Record<string, string> = Object.fromEntries([
    [GUARD_AGREEMENT_RULE.counterpartId, GUARD_AGREEMENT_RULE.counterpartName],
    ...REGION_NPCS.map((person) => [person.id, person.name]),
    ...game.residents.map((person) => [person.id, person.name]),
  ]);
  const resident =
    game.residents.find((r) => r.id === selected) ?? game.residents[0];
  const day = Math.floor(game.minutes / 1440) + 1;
  const hour = Math.floor((game.minutes % 1440) / 60);
  const period =
    hour < 5
      ? "夜更け"
      : hour < 10
        ? "朝"
        : hour < 16
          ? "昼"
          : hour < 19
            ? "夕方"
            : "夜";
  const free = accessibleResources(game, resident.id);
  const baseFree = freeBaseResources(game);
  const totalStock = totalResources(game);
  const attention = deriveAttention(game);
  const landscape = describeLandscape(game, resident);
  const sceneRef = useRef<HTMLDivElement>(null);
  const timeControls = getTimeControls(game);
  const shortcutPreview = previewTimeShortcut(game, group);
  const shortcutIsEvening =
    shortcutPreview.shortcut?.kind === "evening" ||
    (!shortcutPreview.shortcut && hour >= 8 && hour < 18);
  const shortcutLabel =
    shortcutPreview.shortcut?.label ??
    (shortcutIsEvening ? "夕方まで" : "翌朝まで");
  const combatResidents = getCombatants(game);
  const combatNames = combatResidents.map((r) => r.name).join("・");
  const combatLocationCount = new Set(combatResidents.map(person => person.location)).size;
  const primaryAttention = combatLocationCount > 1
    ? attention.filter((item, index) => item.kind === "combat" &&
      attention.findIndex(other => other.kind === "combat" && other.location === item.location) === index)
    : attention.slice(0, 1);
  const careAttention = attention.find(
    (item) => item.kind === "hunger" || item.kind === "fatigue",
  );
  const footerAttention =
    attention.find((item) => item.severity === "critical") ?? careAttention;
  const footerCare =
    footerAttention?.kind === "hunger" || footerAttention?.kind === "fatigue"
      ? footerAttention
      : undefined;
  const careResident = footerCare
    ? game.residents.find((r) => r.id === footerCare.residentId)
    : undefined;
  const scene = getLocationScene(game, resident.location);
  const base = LOCATIONS[resident.location].kind === "base";
  const atLodge = resident.location === "lodge";
  const harvestPlace = isHarvestLocation(resident.location)
    ? resident.location : undefined;
  const enemyAt = (location: LocationId) =>
    !!getPresentEncounterAt(game, location);
  const localEncounter = getLocalEncounter(game, resident.location);
  const secondaryHere = localEncounter?.id === SECOND_ENCOUNTER_RULE.id;
  const localAgreement = !!game.guardAgreement && resident.location === GUARD_AGREEMENT_RULE.location;
  const suppliesRecoveredHere =
    (resident.location === "shelter" && !!game.flags.safeSuppliesRecovered) ||
    (resident.location === "ruins" && !!game.flags.suppliesRecovered);
  const selectedResidents = game.residents.filter((r) => group.includes(r.id));
  const togetherTravelScope = getTogetherTravelScope(game, group, managementSession);
  const shownActivityText = (person: Resident) => {
    const together = getTogetherMoveInfo(game, person.id);
    return together ? `${together.peerName}と同行中 · 残り${together.remaining}分` : getResidentActivityText(person);
  };
  const selectedNames = selectedResidents.map((r) => r.name).join("・");
  const selectedHasWork = selectedResidents.some(
    (actor) => actor.action || actor.suspended,
  );
  const mealPreview = assignSelection(game, group, "eat");
  const firstMealLocation = selectedResidents[0]?.location;
  const mealAtOnePlace =
    firstMealLocation !== undefined &&
    selectedResidents.every((actor) => actor.location === firstMealLocation);
  const mealLabel =
    mealPreview.error || selectedResidents.length < 2
      ? "食事をとる"
      : mealAtOnePlace
        ? "一緒に食事"
        : "それぞれ食事";
  const mealDescription =
    mealPreview.error ??
    (mealAtOnePlace && firstMealLocation
      ? `${LOCATIONS[firstMealLocation].name}で食事を始める。`
      : "今いる場所で食事。集まるなら先に移動。");
  const residentLife = getResidentLife(game, resident.id);
  const homeMorningReflection = residentLife.wish.completed
    ? residentLife.reflection
    : undefined;
  const incomingConversation = getIncomingConversation(game, resident.id);
  const incomingSummary = incomingConversation
    ? `${incomingConversation.speakerIds.map((id) => names[id] ?? id).join("・")}が${names[incomingConversation.listenerId] ?? resident.name}に話しかけています`
    : undefined;
  const crafts = game.life?.crafts ?? [];
  const conversationCraft = crafts.find(
    (piece) => piece.id === craftConversationId,
  );
  const conversationAuthor = conversationCraft
    ? game.residents.find((person) => person.id === conversationCraft.authorId)
    : undefined;
  const conversationViewer =
    conversationAuthor &&
    selectedResidents.length === 2 &&
    group.includes(conversationAuthor.id)
      ? selectedResidents.find((person) => person.id !== conversationAuthor.id)
      : undefined;
  const craftConversationPreview = assignCraftConversationSelection(
    game,
    group,
    conversationCraft?.id ?? 0,
  );
  const craftConversationError = craftConversationPreview.error;
  const craftConversationDuration = !craftConversationError
    ? craftConversationPreview.state.residents.find(
        (person) => person.id === conversationAuthor?.id,
      )?.action?.duration
    : undefined;
  const craftConversationChanges = craftConversationError
    ? []
    : game.residents.flatMap((person) => {
        const nextPerson = craftConversationPreview.state.residents.find(
          (next) => next.id === person.id,
        );
        if (!nextPerson) return [];
        if (!group.includes(person.id)) {
          const before = getCraftConversationStatus(game, person.id);
          const after = getCraftConversationStatus(
            craftConversationPreview.state,
            person.id,
          );
          return !before?.waiting && after?.waiting && after.reason
            ? [`予約後の${person.name}：${after.reason}`]
            : [];
        }
        const previous = person.action;
        if (!previous) return [];
        if (nextPerson.suspended?.id === previous.id) {
          const kept = nextPerson.suspended;
          const materials = resourceText(
            Object.fromEntries(
              Object.entries(kept.reserved ?? {}).filter(([, amount]) => amount > 0),
            ),
          );
          return [
            `${person.name}：「${kept.label}」を中断し、進捗${Math.floor(kept.progress)}/${Math.ceil(kept.duration)}分${materials ? `と${materials}の予約` : ""}を保持します。`,
          ];
        }
        if (
          previous.automatic &&
          nextPerson.action?.id !== previous.id &&
          nextPerson.suspended?.id !== previous.id
        ) {
          const released = resourceText(
            Object.fromEntries(
              Object.entries(previous.reserved ?? {}).filter(([, amount]) => amount > 0),
            ),
          );
          return [
            `${person.name}：自主行動「${previous.label}」を取りやめ${released ? `、${released}の予約を解除します。` : "ます。"}`,
          ];
        }
        return [];
      });
  const subjectMaker =
    selectedResidents.length === 1 ? selectedResidents[0] : null;
  const craftSite = subjectMaker?.location ?? resident.location;
  const craftingAtLodge = craftSite === "lodge";
  const projects = getProjectSummary(game, craftSite);
  const localCompleted = projects.filter((project) => project.completed);
  const completedProjects = (game.life?.upgrades ?? []).map(completed => ({
    completed, recipe: getProjectRecipe(completed.recipeId)!,
  }));
  const craftSubjectChoices = subjectMaker
    ? getCraftSubjectChoices(game, subjectMaker.id).slice(0, 3)
    : [];
  const selectedCraftSubject =
    subjectMaker?.id === craftSubjectSelection?.authorId
      ? craftSubjectChoices.find(
          (choice) => choice.eventId === craftSubjectSelection?.eventId,
        )
      : undefined;
  const subjectPreparationError = !subjectMaker
    ? "題材を選んで作る住民を、一覧で一人だけ選んでください。"
    : !craftSubjectChoices.length
      ? "この人が景色を眺めて過ごした記録はまだありません。"
      : !selectedCraftSubject
        ? "題材にする景色を一つ選んでください。"
        : undefined;
  const merchant = getMerchantStatus(game);
  const tradePreviews =
    modal === "trade"
      ? getMerchantOffers(game).map((offer) => ({
          offer,
          preview: previewTrade(game, group, merchant.visitId, offer.id),
        }))
      : [];
  const tradeInventory = tradePreviews[0]?.preview;
  const commonTradeError =
    tradePreviews.length &&
    tradePreviews[0].preview.error &&
    tradePreviews.every(
      ({ preview }) => preview.error === tradePreviews[0].preview.error,
    )
      ? tradePreviews[0].preview.error
      : undefined;
  useEffect(() => {
    setCraftSubjectSelection(null);
  }, [group, modal]);
  useEffect(() => {
    setTogetherRouteRequest(null);
  }, [togetherTravelScope]);
  useEffect(() => {
    setCraftConversationId(null);
  }, [group, view]);
  useEffect(() => {
    setTradeConfirmation((pending) => {
      if (
        !pending ||
        modal !== "trade" ||
        pending.state !== game ||
        pending.selection !== group
      )
        return null;
      const current = previewTrade(
        game,
        group,
        pending.visitId,
        pending.offerId,
      );
      return !current.error &&
        current.warning &&
        current.actorId === pending.actorId &&
        current.confirmationKey === pending.key
        ? pending
        : null;
    });
    if (modal !== "trade") setTradeFeedback(null);
  }, [game, group, modal]);
  useEffect(() => {
    if (modal !== "trade" || !tradeConfirmation) return;
    const frame = requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(
          `[data-offer="${tradeConfirmation.offerId}"] .trade-confirm`,
        )
        ?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [modal, tradeConfirmation]);
  useEffect(() => {
    if (modal !== "trade" || !tradeFeedback) return;
    const frame = requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(
          `[data-offer="${tradeFeedback.offerId}"] .trade-feedback`,
        )
        ?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [modal, tradeFeedback]);
  useEffect(() => {
    if (!modal) return;
    const before = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>("[role=dialog]");
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), summary, select, input, [tabindex=\"0\"]',
        ) ?? [],
      );
    focusable()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModal(null);
      if (e.key === "Tab") {
        const list = focusable();
        const first = list[0],
          last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = old;
      before?.focus();
    };
  }, [modal]);
  const currentLogs = game.logs.filter(
    (l) => journalFilter === "all" || l.type === journalFilter,
  );
  function notify(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4300);
  }
  function clearToast() {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = null;
    setToast("");
  }
  function openCraftPicker() {
    clearToast();
    setCraftSubjectSelection(null);
    setModal("craft");
  }
  function openTrade() {
    clearToast();
    setTradeConfirmation(null);
    setTradeFeedback(null);
    setModal("trade");
  }
  function exchange(offerId: TradeOfferId, confirmLowFood = false) {
    clearToast();
    setTradeFeedback(null);
    const current = getMerchantStatus(game);
    const preview = previewTrade(game, group, current.visitId, offerId);
    if (preview.error || current.visitId === undefined) {
      setTradeConfirmation(null);
      setTradeFeedback({
        offerId,
        kind: "error",
        text: preview.error ?? "行商はまだ到着していません。",
      });
      return;
    }
    if (
      confirmLowFood &&
      (!tradeConfirmation ||
        tradeConfirmation.state !== game ||
        tradeConfirmation.selection !== group ||
        tradeConfirmation.offerId !== offerId ||
        tradeConfirmation.visitId !== current.visitId ||
        tradeConfirmation.actorId !== preview.actorId ||
        tradeConfirmation.key !== preview.confirmationKey ||
        !preview.warning)
    ) {
      setTradeConfirmation(null);
      setTradeFeedback({
        offerId,
        kind: "error",
        text: "交換内容が変わりました。最新の内容を確認し、もう一度選んでください。",
      });
      return;
    }
    if (preview.warning && !confirmLowFood) {
      if (!preview.confirmationKey || !preview.actorId) {
        setTradeFeedback({
          offerId,
          kind: "error",
          text: "確認情報を読み直してください。交換はしていません。",
        });
        return;
      }
      setTradeConfirmation({
        visitId: current.visitId,
        offerId,
        actorId: preview.actorId,
        key: preview.confirmationKey,
        state: game,
        selection: group,
      });
      return;
    }
    const result = tradeSelection(
      game,
      group,
      current.visitId,
      offerId,
      confirmLowFood
        ? { allowLowFood: true, confirmationKey: tradeConfirmation!.key }
        : undefined,
    );
    setTradeConfirmation(null);
    if (result.error) {
      setTradeFeedback({ offerId, kind: "error", text: result.error });
      return;
    }
    commit(result.state);
    const receipt = result.state.trade?.receipts.at(-1);
    setTradeFeedback({
      offerId,
      kind: "success",
      text: receipt
        ? `${names[receipt.actorId]}が${resourceText(receipt.paid)}を渡し、${resourceText(receipt.received)}を受け取りました。${formatTime(receipt.time)}（時間は進んでいません）`
        : "交換しました。時間は進んでいません。",
    });
  }
  function commit(next: GameState) {
    setGame(next);
    try {
      localStorage.setItem(AUTO_KEY, serialize(next));
    } catch {
      notify(
        "自動保存できませんでした。保存画面からファイルを書き出してください。",
      );
    }
  }
  function act(cmd: Command): boolean {
    const result = command(game, cmd);
    if (result.error) {
      notify(result.error);
      return false;
    }
    if (cmd.type === "cancel") clearToast();
    commit(result.state);
    if (cmd.type === "recruit") {
      const joining = result.state.logs.at(-1);
      if (joining?.title === "新しい仲間") notify(joining.text);
    }
    if (cmd.type === "routine")
      notify(`${names[cmd.residentId] ?? "住民"}の暮らしの担当を変えました。時間は進んでいません。`);
    if (cmd.type === "guard-agreement")
      notify(`${names[result.state.guardAgreement!.actorId]}が食事${GUARD_AGREEMENT_RULE.cost.food}を渡し、守り手が立ち去りました。時間は進んでいません。`);
    if (cmd.type === "auto-combat")
      notify(
        cmd.enabled
          ? "自動戦闘をONにしました。攻防を任せ、時間はボタンで進めます。"
          : "自動戦闘をOFFにしました。手動で指示した行動は続けられます。",
      );
    if (cmd.type === "assign") {
      const carrier = cmd.cargo
        ? result.state.residents.find(person => cmd.residentIds.includes(person.id) && person.action?.cargo)
        : undefined;
      const cargo = carrier?.action?.cargo;
      notify(carrier && cargo
        ? `${carrier.name}に${resourceText({ [cargo.resource]: cargo.amount })}の運搬を予約しました。時間を進めて倉庫へ届けます。`
        : `${cmd.residentIds.map((id) => names[id]).join("・")}の行動を予約しました。時間を進めると始まります。`);
    }
    if (cmd.type === "move-together")
      notify(`${cmd.residentIds.map(id => names[id]).join("・")}の同行移動を予約しました。時間ボタンで進めます。`);
    if (cmd.type === "resume") {
      const carrier = game.residents.find(person => person.id === cmd.residentId);
      const cargo = carrier?.suspended?.cargo;
      if (carrier && cargo && isBaseLocation(carrier.location))
        notify(`${carrier.name}が${resourceText({ [cargo.resource]: cargo.amount })}を倉庫へ納めました。時計は進んでいません。`);
    }
    return true;
  }
  function mapHasRisk(place: LocationId) {
    const hazards = getEncounters(game).filter(encounter => encounter.present);
    return selectedResidents.some(person => {
      const route = inspectTravelRoute(game, person.id, place);
      return person.location !== place && hazards.some(encounter => encounter.location === person.location || route?.path.includes(encounter.location));
    });
  }
  function chooseMapPoint(place: LocationId) {
    if (mapHasRisk(place)) {
      const card = document.querySelector<HTMLButtonElement>(`#destination-${place} .destination-direct`);
      card?.focus({ preventScroll: true });
      card?.scrollIntoView({ block: "center" });
      return;
    }
    queue("move", place);
  }
  function queue(kind: ActionKind, target?: string, ids = group) {
    const result = assignSelection(game, ids, kind, target,
      ["attack", "defend"].includes(kind) ? getPresentEncounterAt(game, resident.location)?.id : undefined);
    if (result.error) {
      notify(result.error);
      return;
    }
    commit(result.state);
    const orderedIds =
      kind === "move"
        ? ids.filter(
            (id) =>
              game.residents.find((person) => person.id === id)?.location !==
              target,
          )
        : ids;
    notify(
      `${orderedIds.map((id) => names[id]).join("・")}の行動を予約しました。時間を進めると始まります。`,
    );
  }
  function queueSubjectCraft(design: "bird" | "flower") {
    if (!selectedCraftSubject) {
      notify(subjectPreparationError ?? "題材にする景色を選んでください。");
      return;
    }
    const result = assignSubjectCraftSelection(
      game,
      group,
      design,
      selectedCraftSubject.eventId,
    );
    if (result.error) {
      notify(result.error);
      return;
    }
    commit(result.state);
    setModal(null);
    notify(
      `${selectedNames}の制作を、選んだ景色を題材に予約しました。時間を進めると始まります。`,
    );
  }
  function queueCraftConversation() {
    const result = assignCraftConversationSelection(
      game,
      group,
      conversationCraft?.id ?? 0,
    );
    if (result.error) {
      notify(result.error);
      return;
    }
    commit(result.state);
    setCraftConversationId(null);
    setView("life");
    requestAnimationFrame(() =>
      document.querySelector(".workboard")?.scrollIntoView({
        block: "start",
        behavior: "instant",
      }),
    );
    notify(
      `${conversationAuthor?.name}から${conversationViewer?.name}への作品紹介を予約しました。時間を進めると始まります。`,
    );
  }
  function finishTimeAdvance(next: GameState) {
    clearToast();
    commit(next);
    if (next.pauseReason && deriveAttention(next).length === 0)
      notify(next.pauseReason);
  }
  function tick(minutes: number) {
    finishTimeAdvance(advanceFromControls(game, minutes));
  }
  function tickNext() {
    finishTimeAdvance(advanceToNextBoundaryFromControls(game));
  }
  function choose(id: string) {
    const next = group.includes(id)
      ? group.filter((current) => current !== id)
      : [...group, id];
    setGroup(next);
    setSelected(id);
  }
  function recallSquad(ids: string[]) {
    setGroup(previous => previous.length === ids.length
      && previous.every((id, index) => id === ids[index]) ? previous : [...ids]);
  }
  function openTripPlan(planId: number) {
    setView("world");
    setTripPlanOpenRequest(previous => ({ planId, serial: (previous?.serial ?? 0) + 1 }));
  }
  function focusScene(id: string) {
    setSelected(id);
    setView("life");
    requestAnimationFrame(() => {
      sceneRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
      sceneRef.current?.focus({ preventScroll: true });
    });
  }
  function save() {
    try {
      localStorage.setItem(SAVE_KEY, serialize(game));
      setSavedAt(`${day}日目 ${formatTime(game.minutes)} に保存`);
      notify("この場所から、また続けられます。");
    } catch {
      notify("保存できませんでした。ファイルの書き出しをご利用ください。");
    }
  }
  function syncLoadedSelection(next: GameState) {
    const ids = new Set(next.residents.map(person => person.id));
    setSelected(previous => ids.has(previous) ? previous : "aki");
    setGroup(previous => {
      const valid = previous.filter(id => ids.has(id));
      return previous.length && !valid.length ? ["aki"] : valid;
    });
    setManagementSession(previous => previous + 1);
    setCraftSubjectSelection(null);
    setCraftConversationId(null);
    setTogetherRouteRequest(null);
    setTripPlanOpenRequest(null);
    setTradeConfirmation(null);
    setTradeFeedback(null);
  }
  function switchWorld(next: GameState) {
    try {
      preserveBeforeSwitch(localStorage, serialize(game));
      localStorage.setItem(AUTO_KEY, serialize(next));
    } catch {
      notify("開始前の暮らしを保存できませんでした。保存領域の空きを確かめてください。");
      return false;
    }
    setGame(next);
    syncLoadedSelection(next);
    setSelected("aki");
    setGroup(["aki"]);
    setView("life");
    setModal(null);
    return true;
  }
  function openOpeningPicker() {
    clearToast();
    setModal("reset");
  }
  function startWorld(origin: WorldOrigin) {
    if (switchWorld(createGame(undefined, origin))) notify(`${OPENINGS[origin].name}の朝が始まりました。`);
  }
  function restoreOpening(raw: string) {
    try {
      if (switchWorld(deserialize(raw))) notify("開始前の暮らしを再開しました。");
    } catch (e) {
      notify(e instanceof Error ? e.message : "読み込めませんでした。");
    }
  }
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) {
        notify("保存されたデータがありません。");
        return;
      }
      const next = deserialize(raw);
      commit(next);
      syncLoadedSelection(next);
      setModal(null);
      notify("保存した暮らしを読み込みました。");
    } catch (e) {
      notify(e instanceof Error ? e.message : "読み込めませんでした。");
    }
  }
  function exportSave() {
    const blob = new Blob([serialize(game)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `yohaku-day${day}-${formatTime(game.minutes).replace(":", "")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("保存ファイルを書き出しました。");
  }
  async function importSave(file?: File) {
    if (!file) return;
    try {
      if (file.size > 5000000) throw new Error("保存ファイルが大きすぎます。");
      const next = deserialize(await file.text());
      commit(next);
      syncLoadedSelection(next);
      setModal(null);
      notify("ファイルから暮らしを読み込みました。");
    } catch (e) {
      notify(
        e instanceof Error ? e.message : "ファイルを読み込めませんでした。",
      );
    }
    if (upload.current) upload.current.value = "";
  }
  const nav: {
    id: View;
    label: string;
    shortLabel: string;
    icon: LucideIcon;
  }[] = [
    { id: "life", label: "いまの暮らし", shortLabel: "暮らし", icon: House },
    { id: "residents", label: "住民たち", shortLabel: "住民", icon: Users },
    { id: "base", label: "拠点", shortLabel: "拠点", icon: TentTree },
    { id: "world", label: "周辺を探索", shortLabel: "探索", icon: Compass },
    { id: "journal", label: "日誌", shortLabel: "日誌", icon: BookOpen },
  ];
  const actionItems: {
    kind: ActionKind;
    title: string;
    desc: string;
    icon: LucideIcon;
    target?: string;
    disabled?: boolean;
    localOnly?: boolean;
  }[] = base
    ? [
        {
          kind: "cook",
          title: "食事をつくる",
          desc: "食材 2 → 食事 3",
          icon: Utensils,
        },
        {
          kind: "eat",
          title: mealLabel,
          desc: mealDescription,
          icon: Coffee,
        },
        {
          kind: "socialize",
          title: "仲間と話す",
          desc:
            group.length < 2
              ? "住民一覧で、話す人を2人以上選ぶ。"
              : `${selectedNames}で、何気ない時間を。`,
          icon: HeartHandshake,
        },
        {
          kind: "hobby",
          title: "木彫りをする",
          desc: game.flags.hobbyFinished
            ? "もうひとつ、自分だけの作品を。"
            : "小さな木片を、好きなかたちに。",
          icon: Feather,
        },
        ...(crafts.some((piece) => piece.displayLocation === undefined)
          ? [
              {
                kind: "place-craft" as ActionKind,
                title: "作品を飾る",
                desc: "自分の木彫りを、棚のある場所に。",
                icon: Sparkles,
              },
            ]
          : []),
        {
          kind: "rest",
          title: "ゆっくり休む",
          desc: "何もしない時間も、大切に。",
          icon: BedDouble,
        },
        ...(resident.location === "garden" || !game.life?.shelf
          ? [
              {
                kind: (resident.location === "garden"
                  ? "gather"
                  : "decorate") as ActionKind,
                title:
                  resident.location === "garden"
                    ? "食材を集める"
                    : "自分の場所を整える",
                desc:
                  resident.location === "garden"
                    ? "家の近くで、今日の実りを。"
                    : game.flags.decorated
                      ? "前からある棚を、この場所へ整える。"
                      : "窓辺に小さな棚を。 · 資材 2",
                icon: Sprout,
              },
            ]
          : []),
      ]
    : [
        ...(atLodge ? [
          { kind: "cook" as const, localOnly: true, title: "舟宿で食事をつくる", desc: "手持ちの食材2個を煮て、食事3食を荷物へ。", icon: Utensils },
          { kind: "rest" as const, localOnly: true, title: "舟宿でひと休み", desc: "桟橋から戻って、作業の合間に体を休める。", icon: BedDouble },
          { kind: "hobby" as const, localOnly: true, title: "小鳥の木彫りをする", desc: "作業台で小鳥を彫り、手元に残す。", icon: Feather },
        ] : []),
        {
          kind: "gather",
          localOnly: harvestPlace === "reedbank",
          title: harvestPlace === "reedbank" ? "葦原で採集する" : harvestPlace ? "川辺で採集する" : "物資を回収する",
          desc: harvestPlace
            ? regionHarvestAvailable(game, harvestPlace)
              ? `食材${HARVEST_SITES[harvestPlace].ingredients}と資材${HARVEST_SITES[harvestPlace].scrap}。今日は一度だけ、持てる分を。`
              : "今日は採集済み。また別の日に。"
            : suppliesRecoveredHere ? "この場所の物資は回収済み。"
              : resident.location === "shelter" ? "物陰を探す。戦わずに持ち帰る。"
                : "残された箱を調べる。",
          icon: Backpack,
          disabled: enemyAt(resident.location) || suppliesRecoveredHere ||
            (harvestPlace ? !regionHarvestAvailable(game, harvestPlace) : !["ruins", "shelter"].includes(resident.location)),
        },
        {
          kind: "eat",
          title: mealLabel,
          desc: mealDescription,
          icon: Coffee,
        },
        {
          kind: "sleep",
          title: "旅先で眠る",
          desc: `${selectedResidents.map(person => `${person.name}：${getSleepSite(person.location)?.name ?? "寝場所なし"}`).join("・") || "住民一覧で行動する人を選択"}。最長8時間。時間はボタンで進めます。`,
          icon: Moon,
        },
        {
          kind: "observe",
          title: "景色を眺める",
          desc:
            (suppliesRecoveredHere ? "この場所は回収済み。" : "") +
            (group.length > 1
              ? "各自の場所で景色を眺める時間を。"
              : "いまの場所で景色を眺める時間を。"),
          icon: Leaf,
        },
        {
          kind: "attack",
          title: "攻撃する",
          desc: "近くの相手へ、継続して攻撃する。",
          icon: Swords,
          disabled: !enemyAt(resident.location),
        },
        {
          kind: "defend",
          title: "防御・援護する",
          desc: "身を守り、同じ場所の仲間をかばう。",
          icon: Shield,
          disabled: !enemyAt(resident.location),
        },
        ...(resident.location === "reedbank" ? [
          { kind: "move" as const, localOnly: true, target: "lodge", title: "舟宿へ向かう", desc: "桟橋の先の工房で、荷物を置いて食事や休息を。", icon: Footprints },
          { kind: "move" as const, localOnly: true, target: "village", title: "集落へ下る", desc: "川沿いを下り、集落の店と休み所へ。", icon: Footprints },
        ] : atLodge ? [
          { kind: "move" as const, localOnly: true, target: "reedbank", title: "葦原へ向かう", desc: "浅瀬で採集したり、景色を眺めたり。", icon: Footprints },
        ] : []),
        {
          kind: "move",
          title: "拠点へ帰る",
          desc: enemyAt(resident.location)
            ? "帰れるうちに。今日は引き返そう。"
            : "家へ戻って、次の時間を過ごす。",
          icon: Footprints,
          target: "home",
        },
      ];
  function ActionCard({
    kind,
    title,
    desc,
    icon,
    target,
    disabled = false,
    localOnly = false,
  }: (typeof actionItems)[number]) {
    const actorIds = group;
    const remoteActor = localOnly && selectedResidents.find(person => person.location !== resident.location);
    const preview =
      kind === "eat" ? mealPreview : assignSelection(game, actorIds, kind, target,
        ["attack", "defend"].includes(kind) ? getPresentEncounterAt(game, resident.location)?.id : undefined);
    const selectionError = preview.error ?? (remoteActor
      ? `${remoteActor.name}は${LOCATIONS[remoteActor.location].name}にいます。この指示には${LOCATIONS[resident.location].name}にいる人を選んでください。`
      : undefined);
    const plannedPeople = preview.state.residents.filter((person) =>
      actorIds.includes(person.id) && person.action?.kind === kind &&
      (kind !== "move" || game.residents.find(original => original.id === person.id)?.location !== target),
    );
    const planned = plannedPeople.map(person => person.action!);
    const durations = planned.map((a) => Math.ceil(a.duration));
    const craftingToolsPeople = selectionError ? [] : preview.state.residents
      .filter(person => actorIds.includes(person.id) && person.action?.kind === kind
        && person.action.craftingToolsId !== undefined)
      .map(person => person.name);
    const costs = planned.reduce<Record<string, number>>((total, a) => {
      for (const [key, amount] of Object.entries(a?.reserved ?? {}))
        total[key] = (total[key] ?? 0) + (amount ?? 0);
      return total;
    }, {});
    const costLabel = Object.entries(costs)
      .map(
        ([key, amount]) =>
          `${({ food: "食事", ingredients: "食材", medicine: "手当用品", scrap: "資材" } as Record<string, string>)[key]} ${amount}`,
      )
      .join("・");
    const timeLabel =
      kind === "attack"
        ? "継続"
        : kind === "move"
          ? plannedPeople.map(person => `${person.name} ${Math.ceil(person.action!.duration)}分`).join("・")
          : durations.length
            ? `${Math.min(...durations)}${Math.min(...durations) === Math.max(...durations) ? "" : `〜${Math.max(...durations)}`}分`
            : "";
    return (
      <button
        className="action-card"
        title={selectionError ?? desc}
        disabled={disabled || !!selectionError || game.ended}
        onClick={() => queue(kind, target, actorIds)}
      >
        <span className="action-icon">
          <Icon icon={icon} />
        </span>
        <span>
          <strong>{title}</strong>
          <small>{selectionError ?? desc}</small>
          {!selectionError && timeLabel && (
            <span className="action-time">
              {timeLabel}{kind !== "move" && ` · ${actorIds.map(id => names[id]).join("・")}`}
              {costLabel && ` · 合計 ${costLabel}`}
            </span>
          )}
          {!selectionError && kind === "move" && plannedPeople.length > 1 && (
            <span className="work-reservation">
              各自の歩調で移動します。荷物や負傷によって、到着が分かれることがあります。
            </span>
          )}
          {craftingToolsPeople.length > 0 && <span className="work-reservation crafting-tools-note">
            開始時の手仕事台を反映：{craftingToolsPeople.join("・")}
          </span>}
        </span>
        <Icon icon={Plus} size={16} />
      </button>
    );
  }
  function SuggestedAction({
    suggestion,
  }: {
    suggestion: NonNullable<ReturnType<typeof getWishProgress>["nextAction"]>;
  }) {
    const participants = suggestion.residentIds.map((id) => names[id] ?? id);
    const matchesSelection =
      group.length === suggestion.residentIds.length &&
      suggestion.residentIds.every((id) => group.includes(id));
    const error = matchesSelection
      ? assignSelection(game, group, suggestion.kind, suggestion.target).error
      : `住民一覧で${participants.join("・")}を選んでください。`;
    return (
      <div className="life-suggestion">
        <button
          disabled={!!error || game.ended}
          title={error}
          onClick={() => queue(suggestion.kind, suggestion.target)}
        >
          <Icon icon={HeartHandshake} size={15} />
          {suggestion.label}
          <span>{participants.join("・")}</span>
        </button>
        <small>
          {error ?? "行動を予約します。時間は下のボタンで進めます。"}
        </small>
      </div>
    );
  }
  function MerchantLink() {
    const next =
      merchant.status === "departed"
        ? merchant.nextArrival
        : merchant.arrivesAt;
    const nextDay = Math.floor(next / 1440) - Math.floor(game.minutes / 1440);
    const when = `${nextDay === 0 ? "今日" : nextDay === 1 ? "明日" : `第${Math.floor(next / 1440) + 1}日`}${formatTime(next)}`;
    const summary =
      merchant.status === "open"
        ? `行商来訪中 · ${formatTime(merchant.leavesAt)}まで`
        : merchant.status === "departed"
          ? `次の行商 · ${when}`
          : `行商予定 · ${when}`;
    return (
      <button
        className="trade-link"
        onClick={openTrade}
        aria-label={`${summary}。交換一覧を見る`}
      >
        <Package size={14} />
        <span className="merchant-status-label">{summary}</span>
        <span className="merchant-link-label">
          交換を見る
          <ChevronRight size={13} />
        </span>
      </button>
    );
  }
  function TradeOfferRow({ offer, preview }: (typeof tradePreviews)[number]) {
    const pending =
      tradeConfirmation?.offerId === offer.id &&
      tradeConfirmation.visitId === merchant.visitId &&
      tradeConfirmation.key === preview.confirmationKey &&
      tradeConfirmation.state === game &&
      tradeConfirmation.selection === group &&
      !preview.error &&
      !!preview.warning;
    const feedback =
      tradeFeedback?.offerId === offer.id ? tradeFeedback : undefined;
    const errorId = commonTradeError
      ? "trade-common-error"
      : `trade-error-${offer.id}`;
    return (
      <div className="trade-offer" data-offer={offer.id}>
        <div className="trade-exchange">
          <strong>{resourceText(offer.paid)}</strong>
          <span>を渡して</span>
          <strong>{resourceText(offer.received)}</strong>
        </div>
        {preview.after && (
          <p className="trade-after">
            交換後の利用可能：食事{preview.after.food}食・食材
            {preview.after.ingredients}個
          </p>
        )}
        {preview.error && preview.error !== commonTradeError && (
          <p className="trade-error" id={errorId}>
            {preview.error}
          </p>
        )}
        {pending ? (
          <div className="trade-low-food">
            <p>{preview.warning}</p>
            <div>
              <button
                className="trade-confirm"
                onClick={() => exchange(offer.id, true)}
              >
                食料を減らして交換
              </button>
              <button
                className="trade-cancel"
                onClick={() => {
                  setTradeConfirmation(null);
                  requestAnimationFrame(() =>
                    document
                      .querySelector<HTMLButtonElement>(
                        `[data-offer="${offer.id}"] .trade-button`,
                      )
                      ?.focus(),
                  );
                }}
              >
                やめる
              </button>
            </div>
          </div>
        ) : (
          <>
            {preview.warning && !preview.error && (
              <small className="trade-warning-label">
                食料が少なくなるため、確定前に確認します。
              </small>
            )}
            <button
              className="trade-button"
              disabled={!!preview.error || merchant.visitId === undefined}
              aria-describedby={preview.error ? errorId : undefined}
              aria-label={`${resourceText(offer.paid)}を渡し、${resourceText(offer.received)}を受け取る${preview.warning ? "（確認へ）" : ""}`}
              onClick={() => exchange(offer.id)}
            >
              {preview.warning && !preview.error
                ? "内容を確認して交換"
                : "この交換を確定"}
            </button>
          </>
        )}
        {feedback && (
          <p
            className={`trade-feedback ${feedback.kind}`}
            role="status"
            tabIndex={0}
          >
            {feedback.text}
          </p>
        )}
      </div>
    );
  }
  function ProjectCard({
    project,
  }: {
    project: ReturnType<typeof getProjectSummary>[number];
  }) {
    const { recipe } = project;
    const maker = selectedResidents.length === 1 ? selectedResidents[0] : null;
    const preview = assignSelection(game, group, "project", recipe.id);
    const error = game.ended ? "この試行は終了しています。" : preview.error;
    const candidate = !error && maker
      ? preview.state.residents.find(person => person.id === maker.id)?.action
      : undefined;
    const planned = candidate?.kind === "project" && candidate.target === recipe.id ? candidate : undefined;
    const duration = planned?.duration;
    const estimate = error && maker && (LOCATIONS[maker.location].kind === "base" || (maker.location === "lodge" && (recipe.repeatable || recipe.id === "crafting-tools")))
      ? getProjectDuration(game, maker.id, recipe.id)
      : undefined;
    const shownDuration = duration ?? estimate;
    const cost = Object.entries(recipe.cost)
      .map(
        ([key, amount]) =>
          `${({ food: "食事", ingredients: "食材", medicine: "手当用品", scrap: "資材" } as Record<string, string>)[key]} ${amount}`,
      )
      .join("・");
    return (
      <article className="project-recipe" data-recipe={recipe.id}>
        <div className="project-recipe-heading">
          <Icon
            icon={projectIcons[recipe.id]}
            size={20}
          />
          <h3>{recipe.title}</h3>
          <span>{recipe.repeatable ? "何度でも" : "一つだけ"}</span>
        </div>
        <p>{recipe.description}</p>
        <p className="project-effect">{recipe.effect}</p>
        <dl className="project-facts">
          <div>
            <dt>材料</dt>
            <dd>{cost || "なし"}</dd>
          </div>
          <div>
            <dt>担当</dt>
            <dd>{maker?.name ?? "住民一覧で1人を選択"}</dd>
          </div>
          <div>
            <dt>{duration === undefined && estimate !== undefined ? "新規の目安" : "所要時間"}</dt>
            <dd>
              {shownDuration !== undefined
                ? `${Math.ceil(shownDuration)}分`
                : maker ? "条件を整えると表示" : "担当を選ぶと表示"}
            </dd>
          </div>
          <div>
            <dt>{recipe.repeatable ? "制作場所" : "設置場所"}</dt>
            <dd>
              {maker
                ? LOCATIONS[maker.location].name
                : "担当者がいる拠点の部屋"}
            </dd>
          </div>
        </dl>
        {planned?.craftingToolsId !== undefined && <span className="work-reservation crafting-tools-note">
          開始時の手仕事台を反映
        </span>}
        {project.working && (
          <small className="project-working">
            {names[project.working.residentId]}が
            {project.working.paused ? "制作を中断中" : "制作中"}
          </small>
        )}
        {error && <p className="project-error">{error}</p>}
        <button
          className="project-reserve-button"
          disabled={!!error}
          aria-label={`${recipe.title}：制作を予約する`}
          onClick={() => {
            queue("project", recipe.id);
            setModal(null);
          }}
        >
          この制作を予約する
        </button>
      </article>
    );
  }
  function recentHeardExperience(residentId: string) {
    const life = getResidentLife(game, residentId);
    return life.recentExperiences.find(
      (event) =>
        event.kind === "conversation" &&
        event.report?.listenerId === residentId &&
        (!life.reflection || event.time > life.reflection.time),
    );
  }
  function SubjectCraftReservation({ design }: { design: "bird" | "flower" }) {
    const kind = design === "bird" ? "hobby" : "project";
    const preview = selectedCraftSubject
      ? assignSubjectCraftSelection(
          game,
          group,
          design,
          selectedCraftSubject.eventId,
        )
      : assignSelection(
          game,
          group,
          kind,
          design === "flower" ? "wood-flower" : undefined,
        );
    const error = subjectPreparationError ?? preview.error;
    const planned =
      !preview.error && subjectMaker
        ? preview.state.residents.find((person) => person.id === subjectMaker.id)
            ?.action
        : undefined;
    const duration =
      planned?.kind === kind ? Math.ceil(planned.duration) : undefined;
    const recipe =
      design === "flower" ? getProjectRecipe("wood-flower") : undefined;
    const materials =
      design === "bird"
        ? "なし"
        : recipe
          ? resourceText(recipe.cost)
          : "条件を確認";
    const factsId = `subject-craft-${design}-facts`;
    const errorId = `subject-craft-${design}-error`;
    return (
      <div className="art-subject-recipe">
        <p className="muted" id={factsId}>
          {duration === undefined ? "条件を整えると時間を表示" : `${duration}分`}
          {" · "}材料 {materials}
          {!error && planned?.kind === kind && planned.craftingToolsId !== undefined && <span className="work-reservation crafting-tools-note">
            開始時の手仕事台を反映
          </span>}
        </p>
        {error && error !== subjectPreparationError && (
          <p className="muted" id={errorId}>
            {error}
          </p>
        )}
        <button
          className="project-reserve-button"
          data-subject-design={design}
          disabled={!!error}
          title={error}
          aria-describedby={`${factsId}${error ? ` ${error === subjectPreparationError ? "craft-subject-reason" : errorId}` : ""}`}
          onClick={() => queueSubjectCraft(design)}
        >
          この景色で{design === "bird" ? "小鳥" : "花"}を彫る
        </button>
      </div>
    );
  }
  function CareLocationGuide({ patient }: { patient: Resident }) {
    if (
      patient.hp >= 100 &&
      !Object.values(patient.wounds).some((wound) => wound > 0)
    )
      return null;
    const error = assignSelection(game, group, "heal", patient.id).error;
    if (!error) return null;
    const caregiver =
      selectedResidents.length === 1 ? selectedResidents[0] : null;
    const canApproach =
      caregiver &&
      caregiver.location !== patient.location;
    const moveError = canApproach
      ? assignSelection(game, group, "move", patient.location).error
      : undefined;
    return (
      <div className="person-care-guide">
        <p>{error}</p>
        {canApproach && (
          <>
            <button
              disabled={!!moveError || game.ended}
              onClick={() => queue("move", patient.location)}
            >
              <Footprints size={14} />
              {caregiver.name}を{LOCATIONS[patient.location].name}へ
            </button>
            {moveError && <small>{moveError}</small>}
          </>
        )}
      </div>
    );
  }
  function LogItem({
    log,
    compact = false,
  }: {
    log: GameLog;
    compact?: boolean;
  }) {
    const focusId = getLogFocusResident(game, log);
    return (
      <div className={`log-item ${compact ? "compact" : ""}`}>
        <span className={`log-mark ${log.type}`}>
          <Icon
            icon={
              log.type === "combat"
                ? Swords
                : log.type === "social"
                  ? Heart
                  : log.type === "explore"
                    ? Compass
                    : log.type === "work"
                      ? Wheat
                      : Leaf
            }
            size={14}
          />
        </span>
        <div className="log-body">
          <div>
            <strong>{log.title}</strong>
            <time>
              {Math.floor(log.time / 1440) + 1}日目 · {formatTime(log.time)}
            </time>
          </div>
          <p>{log.text}</p>
          {focusId && ["explore", "combat"].includes(log.type) && (
            <button
              className="log-scene-link"
              onClick={() => focusScene(focusId)}
            >
              現場を見る<span>（現在の場所）</span>
            </button>
          )}
          {!compact && (
            <small className="known-by">
              その場で見聞きした人：
              {log.witnesses.map((id) => names[id] ?? id).join("、") ||
                "全体の記録"}
            </small>
          )}
        </div>
      </div>
    );
  }
  const notices = (
    <>
      {attention.length > 0 && (
        <section className="attention-board" aria-label="対応が必要な出来事">
          <div className="attention-heading">
            <Shield size={16} />
            <h2>気にかけたいこと</h2>
            <span>{attention.length}件</span>
          </div>
          {primaryAttention.map((item) => (
            <div className={`attention-item ${item.severity}`} key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <p>{LOCATIONS[item.location].name}</p>
              </div>
              <button onClick={() => focusScene(item.residentId)}
                aria-label={combatLocationCount > 1 ? `${item.title}の現場を見る` : undefined}>
                現場を見る
              </button>
            </div>
          ))}
          <details>
            <summary>対応の詳細を見る（{attention.length}件）</summary>
            {game.pauseReason && (
              <p className="pause-reason-note">
                進行を止めた理由：{game.pauseReason}
              </p>
            )}
            {attention.map((item) => (
              <div className={`attention-item ${item.severity}`} key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </div>
                <button
                  onClick={() => focusScene(item.residentId)}
                  aria-label={`${item.title}の現場を見る`}
                >
                  現場を見る
                </button>
              </div>
            ))}
          </details>
        </section>
      )}
      {game.pauseReason && attention.length === 0 && (
        <div className="decision-note" role="status">
          <Flag size={16} />
          <p>{game.pauseReason}</p>
          {(() => {
            const log = game.logs.at(-1);
            const actorId = log ? getLogFocusResident(game, log) : null;
            return (
              actorId && (
                <button onClick={() => focusScene(actorId)}>現場を見る</button>
              )
            );
          })()}
        </div>
      )}
      <TravelPlanReminders game={game} onOpen={openTripPlan} />
    </>
  );
  return (
    <div className="app-shell">
      <header className="header">
        <div className="header-inner">
          <button
            className="brand"
            onClick={() => setView("life")}
            aria-label="余白の暮らし ホーム"
          >
            <span className="brand-symbol">
              <Leaf size={24} strokeWidth={1.3} />
            </span>
            <span>
              余白の暮らし<small>A LITTLE LIFE, TOGETHER.</small>
            </span>
          </button>
          <div className="header-center">
            <span className="season">
              <Icon icon={Sprout} size={15} /> 芽吹きの季節
            </span>
            <span className="header-divider" />
            <span>{day}日目</span>
            <span className="time">
              <Icon icon={hour >= 19 || hour < 5 ? Moon : Sun} size={18} />
              {formatTime(game.minutes)}
            </span>
          </div>
          <div className="header-tools">
            <button
              className="text-button help-button"
              aria-label="遊び方を開く"
              title="遊び方を開く"
              onClick={() => setModal("help")}
            >
              <Icon icon={CircleHelp} size={17} />
              <span>遊び方</span>
            </button>
            <button
              className="save-button"
              aria-label="保存を開く"
              onClick={() => setModal("save")}
            >
              <Icon icon={Save} size={16} />
              <span>保存</span>
            </button>
          </div>
        </div>
      </header>
      <main className={`main-layout view-${view}`}>
        <div className="navigation">
          <nav aria-label="メインナビゲーション">
            {nav.map((n) => (
              <button
                key={n.id}
                className={view === n.id ? "active" : ""}
                aria-label={n.label}
                aria-current={view === n.id ? "page" : undefined}
                onClick={() => setView(n.id)}
              >
                <Icon icon={n.icon} size={17} />
                <span className="nav-label-full">{n.label}</span>
                <span className="nav-label-short" aria-hidden="true">
                  {n.shortLabel}
                </span>
                {n.id === "residents" && <span className="nav-count">{game.residents.length}</span>}
              </button>
            ))}
          </nav>
          <div className="nav-note">
            <span /> あなたのペースで、物語を。
          </div>
        </div>
        {view === "life" && (
          <section className="home-overview" aria-label="いま見ている場所">
            <div className="scene-illustration">
              <div className="location-pill">
                <MapPin size={12} />
                {LOCATIONS[resident.location].name}
                <span>·</span>
                {resident.name}の場所 · {landscape.periodLabel}
              </div>
              <Landscape game={game} resident={resident} />
              <span className="scene-weather">{landscape.caption}</span>
            </div>
            <section
              className="home-resource-summary"
              aria-label="ホームの物資の概要"
            >
              <div className="summary-heading">
                <span>いま使える物資</span>
                <button onClick={() => setView("base")}>拠点で詳しく</button>
              </div>
              <div className="summary-resources">
                {(
                  [
                    {
                      key: "food",
                      label: "食事",
                      unit: "食",
                      icon: Utensils,
                    },
                    {
                      key: "ingredients",
                      label: "食材",
                      unit: "個",
                      icon: Wheat,
                    },
                    {
                      key: "medicine",
                      label: "手当用品",
                      unit: "個",
                      icon: Heart,
                    },
                    {
                      key: "scrap",
                      label: "資材",
                      unit: "個",
                      icon: Package,
                    },
                  ] as const
                ).map((item) => (
                  <div key={item.key}>
                    <Icon icon={item.icon} size={16} />
                    <span>{item.label}</span>
                    <strong>
                      {free[item.key]}
                      <small>{item.unit}</small>
                    </strong>
                  </div>
                ))}
              </div>
              <p>
                {resident.name}の手元・同所の仲間の食料と薬{base ? "・拠点倉庫" : ""}から今使える分 · 行動可能{" "}
                {game.residents.filter((r) => r.hp > 0).length} /{" "}
                {game.residents.length}人
              </p>
              <MerchantLink />
            </section>
          </section>
        )}
        <aside className="left-sidebar">
          <SquadPanel key={managementSession} game={game} selectedIds={group} onSelect={recallSquad} onFocus={focusScene} onCommand={act}>
          <div
            className={`residents-list${game.residents.length > 3 ? " residents-list-expanded" : ""}`}
            role="group"
            aria-label="行動する住民を選ぶ"
          >
            {game.residents.map((r) => (
              <button
                key={r.id}
                className={`resident-card ${group.includes(r.id) ? "selected" : ""} ${selected === r.id ? "viewing" : ""}`}
                data-viewing={selected === r.id}
                aria-pressed={group.includes(r.id)}
                aria-describedby={`resident-vitals-${r.id} resident-activity-${r.id}`}
                aria-label={`${r.name}を${group.includes(r.id) ? "選択から外す" : "選択する"}`}
                onClick={() => choose(r.id)}
              >
                <div className="resident-main">
                  <Avatar resident={r} />
                  <div>
                    <span className="resident-name">
                      {r.name}
                      {r.id === "aki" && <small>あなた</small>}
                    </span>
                    <span className="resident-location">
                      <Icon icon={MapPin} size={11} />
                      {LOCATIONS[r.location].name}
                    </span>
                  </div>
                  <span className="resident-checkbox" aria-hidden="true">
                    {group.includes(r.id) && <Check size={13} />}
                  </span>
                </div>
                <div
                  id={`resident-activity-${r.id}`}
                  className={`resident-activity ${r.hp > 0 && !r.action && !r.suspended ? "resident-idle" : ""}`}
                  title={shownActivityText(r)}
                >
                  <span
                    className={`activity-dot ${r.hp <= 0 ? "danger" : ""}`}
                  />
                  {shownActivityText(r)}
                </div>
                <div className="resident-vitals">
                  <span
                    className="visually-hidden"
                    id={`resident-vitals-${r.id}`}
                  >
                    体力 {formatVitalValue(r.hp)} / 100、満腹度{" "}
                    {formatVitalValue(r.hunger)} / 100
                  </span>
                  {[
                    { label: "体力", value: r.hp, kind: "health" },
                    { label: "満腹度", value: r.hunger, kind: "satiety" },
                  ].map((vital) => (
                    <div
                      className={`resident-vital resident-vital-${vital.kind}`}
                      key={vital.kind}
                      aria-hidden="true"
                    >
                      <span className="resident-vital-label">
                        {vital.label}
                      </span>
                      <span className="resident-vital-track">
                        <span
                          style={{
                            width: `${Math.max(0, Math.min(100, vital.value))}%`,
                          }}
                        />
                      </span>
                      <span className="resident-vital-value">
                        {formatVitalValue(vital.value)}
                      </span>
                    </div>
                  ))}
                </div>
                {r.action && (
                  <div className="mini-progress">
                    <span
                      style={{
                        width: `${(r.action.progress / r.action.duration) * 100}%`,
                      }}
                    />
                  </div>
                )}
              </button>
            ))}
          </div>
          </SquadPanel>
          {view === "life" && game.minutes === 480 &&
            <button className="opening-shortcut" onClick={openOpeningPicker}>暮らしの始め方</button>}
          <button
            className="subtle-link all-residents"
            onClick={() => setView("residents")}
          >
            みんなの様子を見る
            <ArrowRight size={14} />
          </button>
          <div className="sidebar-foot">
            <span className="tiny-leaf">✳</span>
            <p>
              特別な一日じゃなくても、
              <br />
              ここに、物語はある。
            </p>
          </div>
        </aside>
        <section className="center-column">
          {view !== "life" && notices}
          {game.ended && (
            <div className="alert-banner danger">
              <Flag />
              <div>
                <strong>住民全員が、行動できなくなりました。</strong>
                <p>
                  今回の経過は日誌に残っています。保存を読むか、同じ朝から再び始められます。
                </p>
                <button onClick={openOpeningPicker}>
                  同じ朝から始める
                </button>
                <button onClick={() => setModal("save")}>保存を開く</button>
              </div>
            </div>
          )}
          {view === "life" && (
            <>
              <div className="scene-focus" ref={sceneRef} tabIndex={-1}>
                <div>
                  <span
                    className={`eyebrow ${incomingSummary ? "incoming-conversation-summary" : ""}`}
                  >
                    {incomingSummary ?? "表示中の場面"}
                  </span>
                  <h1>
                    {resident.name} · {LOCATIONS[resident.location].name}
                    {!group.includes(resident.id) && (
                      <small className="focus-selection-note">
                        表示のみ・指示対象外
                      </small>
                    )}
                  </h1>
                </div>
                <span>{period}のひととき</span>
              </div>
              <RegionPanel key={`life-region-${managementSession}`} game={game} focusedId={selected} selectedIds={group} onCommand={act} />
              <div className="actions-header">
                <h3>
                  <span className="small-rule" />
                  {group.length
                    ? `${selectedNames}は、何をしよう？`
                    : "行動する住民を選んでください"}
                </h3>
                <span className="selected-count">
                  指示対象 {group.length}人
                </span>
              </div>
              <div className="action-grid">
                {actionItems
                  .filter((item) => {
                    if (["attack", "defend"].includes(item.kind))
                      return !base && enemyAt(resident.location);
                    if (item.kind === "observe")
                      return !base && !atLodge && !enemyAt(resident.location);
                    if (
                      item.kind === "gather" &&
                      !base &&
                      !enemyAt(resident.location) &&
                      ((!harvestPlace && !["ruins", "shelter"].includes(resident.location)) || suppliesRecoveredHere)
                    )
                      return false;
                    return true;
                  })
                  .map((item) => (
                    <ActionCard key={`${item.kind}-${item.target ?? ""}`} {...item} />
                  ))}
                {resident.location === "meadow" && (
                  <RouteWorkAction game={game} selectedIds={group} onCommand={act} />
                )}
                {resident.location === GUARD_AGREEMENT_RULE.location && (
                  <GuardAgreementAction game={game} selectedIds={group} onCommand={act} />
                )}
                {resident.location === SECOND_ENCOUNTER_RULE.location && (
                  <RidgeApproachAction game={game} selectedIds={group} onCommand={act} />
                )}
                {base &&
                  game.residents
                    .filter(
                      (r) =>
                        r.id !== selected &&
                        r.location === resident.location &&
                        r.action &&
                        ["cook", "gather", "hobby", "decorate", "project"].includes(
                          r.action.kind,
                        ),
                    )
                    .map((r) => (
                      <ActionCard
                        key={`help-${r.id}`}
                        kind="help"
                        title={`${r.name}の仕事を手伝う`}
                        desc="手を添えて、一緒の時間を。"
                        icon={HeartHandshake}
                        target={r.id}
                      />
                    ))}
                {(base || !enemyAt(resident.location)) &&
                  (resident.hp < 100 ||
                    Object.values(resident.wounds).some((v) => v > 0)) && (
                    <ActionCard
                      kind="heal"
                      title={`${resident.name}を手当する`}
                      desc="包帯を巻き直す。 · 手当用品 1"
                      icon={Heart}
                      target={selected}
                    />
                  )}{" "}
                {!base && resident.hp <= 35 && (
                  <ActionCard
                    kind="rescue"
                    title={`${resident.name}を救助する`}
                    desc="同じ場所の仲間が、拠点へ運びます。"
                    icon={HeartHandshake}
                    target={resident.id}
                  />
                )}
              </div>
              <TravelPanel key={`life-travel-${managementSession}`} game={game} focusedId={selected} selectedIds={group} onCommand={act} />
              {incomingConversation && (
                <p className="incoming-conversation" role="status">
                  <HeartHandshake size={14} />
                  <span>
                    {incomingSummary}。
                    {names[incomingConversation.listenerId] ?? resident.name}
                    の手が空いている間、時間を進めると会話が続きます。
                  </span>
                </p>
              )}
              {(base || atLodge) && (
                <button className="craft-picker-link" onClick={openCraftPicker}>
                  <Feather size={15} />
                  手仕事の選択肢
                  <span>{craftingAtLodge ? "花を彫る・手仕事台を整える" : "作品と暮らしの設備"}</span>
                  <ChevronRight size={14} />
                </button>
              )}
              {!base && (enemyAt(resident.location) || localAgreement || (secondaryHere && localEncounter?.defeated)) && (
                <div className="field-status" data-encounter-id={localEncounter?.id} data-guard-agreement-status={localAgreement ? "completed" : undefined}>
                  <div>
                    <Icon icon={Shield} size={17} />
                    <span>
                      {secondaryHere
                        ? localEncounter?.present ? SECOND_ENCOUNTER_RULE.name : "尾根の見張りは去りました"
                        : localAgreement
                        ? "守り手は食事を受け取り、立ち去りました"
                        : game.enemy.defeated
                        ? "守り手は去りました"
                        : enemyAt(resident.location)
                          ? "物資を守る流れ者"
                          : `${LOCATIONS[game.enemy.location].name}に守り手`}
                      <small>
                        {secondaryHere
                          ? localEncounter?.present
                            ? `相手の体力 ${formatVitalValue(localEncounter.hp)} / ${localEncounter.maxHp} · 防御役が攻撃を引き受けます。`
                            : "尾根の道を通れます。荷物と体調を確かめて、次の行き先を選べます。"
                          : localAgreement
                          ? suppliesRecoveredHere
                            ? "この場所の物資は回収済みです。帰路と体調を確認できます。"
                            : "物資の回収は別に20分かかります。回収するか、帰るかを選べます。"
                          : game.enemy.defeated
                          ? "物資の回収と帰還を選べます。"
                          : `相手の体力 ${formatVitalValue(game.enemy.hp)} / 80 · 防御役が攻撃を引き受けます。`}
                      </small>
                      {localAgreement && game.guardAgreement?.actorId === resident.id && !hasReportedGuardAgreement(game, resident.id) && (
                        <small>{resident.name}は、この道が通れるようになったことを集落の商い手に伝えられます。</small>
                      )}
                    </span>
                  </div>
                  <Meter
                    label={`${resident.name}の身体`}
                    value={resident.hp}
                    color={resident.hp < 40 ? "rust" : "olive"}
                  />
                </div>
              )}
              {notices}
              <section
                className={`workboard ${selectedHasWork ? "" : "workboard-empty"}`}
                aria-label="選んだ住民の進行中と中断中の仕事"
              >
                <div className="section-header">
                  <h3>いまの仕事</h3>
                  <span>
                    {selectedHasWork
                      ? selectedNames
                      : selectedNames
                        ? `指示対象：${selectedNames}`
                        : "指示対象なし"}
                  </span>
                </div>
                {selectedHasWork ? (
                  <p className="workboard-guide">
                    中断は進捗と材料を保持。取消は材料予約を解除します。
                  </p>
                ) : (
                  <p className="muted workboard-empty-message">
                    {selectedResidents.length
                      ? "進行中・中断中の仕事はありません。"
                      : "住民一覧で行動する人を選択。"}
                  </p>
                )}
                {selectedResidents.map((actor) => (
                  <div className="actor-work" key={actor.id}>
                    {actor.action &&
                      (() => {
                        const work = actor.action;
                        const routeWork = work.kind === "repair-route"
                          ? getRouteWorkSummary(game).working : undefined;
                        const sleepWait = work.kind === "sleep"
                          ? inspectSleep(game, actor.id).error : undefined;
                        const approachWait = work.kind === "approach-ridge"
                          ? getRidgeApproachProblem(game, actor.id) : undefined;
                        const subject = getCraftSubject(game, work);
                        const conversationPiece = work.topic
                          ? crafts.find((piece) => piece.id === work.topic!.craftId)
                          : undefined;
                        const conversationStatus = getCraftConversationStatus(
                          game,
                          actor.id,
                        );
                        const reservations = Object.entries(work.reserved ?? {})
                          .map(
                            ([key, amount]) =>
                              `${({ food: "食事", ingredients: "食材", medicine: "手当用品", scrap: "資材" } as Record<string, string>)[key]} ${amount}`,
                          )
                          .join("・");
                        return (
                          <div className="current-action running-work">
                            <div className="work-description">
                              <strong>
                                {actor.name}：{work.label}
                              </strong>
                              {conversationPiece && (
                                <span className="work-reservation">
                                  作品：
                                  {getCraftDisplayTitle(game, conversationPiece)}
                                </span>
                              )}
                              <small>
                                {work.kind === "attack"
                                  ? "継続攻撃 · 時間を進めると実行"
                                  : `${Math.floor(work.progress)} / ${Math.ceil(work.duration)}分 · あと${Math.ceil(Math.max(0, work.duration - work.progress))}分`}
                                {work.automatic
                                  ? ["attack", "defend"].includes(work.kind)
                                    ? " · 自動戦闘"
                                    : " · 方針に沿った行動"
                                  : " · 指示した行動"}
                              </small>
                              <TogetherMoveStatus game={game} residentId={actor.id} />
                              {conversationStatus?.waiting && (
                                <p className="work-autonomy-reason">
                                  待機中：{conversationStatus.reason}
                                </p>
                              )}
                              {sleepWait && (
                                <p className="work-autonomy-reason">
                                  睡眠は安全確認待ちです。進捗は保持しています。{sleepWait}
                                </p>
                              )}
                              {approachWait && (
                                <p className="work-autonomy-reason">
                                  接近は待機中：{approachWait} 進捗と中断中の仕事は保持しています。
                                </p>
                              )}
                              {routeWork?.residentId === actor.id && routeWork.blockedReason && (
                                <p className="work-autonomy-reason">
                                  整備は待機中：{routeWork.blockedReason}
                                </p>
                              )}
                              {getAutonomyReason(work) && (
                                <p className="work-autonomy-reason">
                                  選んだ理由：{getAutonomyReason(work)}
                                </p>
                              )}
                              {work.kind !== "attack" && (
                                <progress
                                  max={work.duration}
                                  value={work.progress}
                                  aria-label={`${actor.name}の${work.label}の進捗`}
                                />
                              )}
                              <span className="work-reservation">
                                {work.cargo ? "運搬用に確保" : "材料予約"}：{reservations || "なし"}
                              </span>
                              {work.cargo && <span className="work-reservation cargo-work-note">
                                本人の荷物 → 拠点倉庫。到着時に指定分を収納して終了します。
                              </span>}
                              {work.craftingToolsId !== undefined && <span className="work-reservation crafting-tools-note">
                                開始時の手仕事台を反映
                              </span>}
                              {subject && (
                                <span className="work-reservation">
                                  題材：{subject.label}
                                </span>
                              )}
                            </div>
                            <div className="work-controls">
                              {work.automatic &&
                              ["attack", "defend"].includes(work.kind) ? (
                                <button
                                  onClick={() =>
                                    act({ type: "auto-combat", enabled: false })
                                  }
                                >
                                  自動戦闘OFF
                                </button>
                              ) : (
                                <>
                                  <button
                                    onClick={() =>
                                      act({
                                        type: "pause",
                                        residentId: actor.id,
                                      })
                                    }
                                    disabled={!!actor.suspended}
                                    title={
                                      actor.suspended
                                        ? "先に中断中の仕事を再開または取り消してください"
                                        : work.together
                                          ? "この住民の移動を中断し、二人の同行を解除します"
                                          : "進捗と材料予約を保持して中断"
                                    }
                                  >
                                    中断
                                  </button>
                                  <button
                                    title={
                                      work.topic
                                        ? "作品紹介の二人分を取り消します。別の仕事は残ります。"
                                        : work.together ? "この住民の移動を取り消し、同行を解除します。相手の仕事は残ります。" : undefined
                                    }
                                    onClick={() =>
                                      act({
                                        type: "cancel",
                                        residentId: actor.id,
                                        actionId: actor.action!.id,
                                      })
                                    }
                                  >
                                    {work.topic ? "2人分を取消" : "取消"}
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    {actor.suspended &&
                      (() => {
                        const work = getInterruptedActionSummary(
                          game,
                          actor.id,
                        )!;
                        const cargoAtBase = !!actor.suspended!.cargo && isBaseLocation(actor.location);
                        const subject = getCraftSubject(game, actor.suspended!);
                        const conversationPiece = actor.suspended!.topic
                          ? crafts.find(
                              (piece) =>
                                piece.id === actor.suspended!.topic!.craftId,
                            )
                          : undefined;
                        return (
                          <div className="current-action suspended-work">
                            <div className="work-description">
                              <strong>
                                {actor.name}：{work.label}（{cargoAtBase ? "納入待ち" : "中断中"}）
                              </strong>
                              {conversationPiece && (
                                <span className="work-reservation">
                                  作品：
                                  {getCraftDisplayTitle(game, conversationPiece)}
                                </span>
                              )}
                              <small>
                                {cargoAtBase
                                  ? "倉庫へ納める操作 · 時計は進みません"
                                  : work.continuous
                                  ? "継続指示を中断中"
                                  : `${Math.floor(work.progress)} / ${Math.ceil(work.duration)}分 · 残り${Math.ceil(work.remaining ?? 0)}分`}
                              </small>
                              {!work.continuous && !cargoAtBase && (
                                <progress
                                  max={work.duration}
                                  value={work.progress}
                                  aria-label={`${actor.name}の中断した${work.label}の進捗`}
                                />
                              )}
                              <span className="work-reservation">
                                {actor.suspended!.cargo ? "運搬用に確保" : "材料予約"}：{work.reservationText}
                              </span>
                              {actor.suspended!.cargo && <span className="work-reservation cargo-work-note">
                                本人の荷物 → 拠点倉庫。{cargoAtBase ? "指定分をこの場所から納めます。" : "到着時に指定分を収納して終了します。"}
                              </span>}
                              {actor.suspended!.craftingToolsId !== undefined && <span className="work-reservation crafting-tools-note">
                                開始時の手仕事台を反映
                              </span>}
                              {subject && (
                                <span className="work-reservation">
                                  題材：{subject.label}
                                </span>
                              )}
                              <p>{cargoAtBase
                                ? work.resumeError ?? "「倉庫へ納めて終了」で、確保した物資を倉庫へ移します。取消で確保だけを解除することもできます。"
                                : work.detail}</p>
                              {getAutonomyReason(actor.suspended) && (
                                <p className="work-autonomy-reason">
                                  開始した理由：
                                  {getAutonomyReason(actor.suspended)}
                                </p>
                              )}
                            </div>
                            <div className="work-controls">
                              <button
                                disabled={!!work.resumeError}
                                title={
                                  work.resumeError ??
                                  (cargoAtBase ? "確保した物資を倉庫へ納めます。時計は進みません" : "保存した進捗から再開します")
                                }
                                onClick={() =>
                                  act({ type: "resume", residentId: actor.id })
                                }
                              >
                                {cargoAtBase ? "倉庫へ納めて終了" : "再開する"}
                              </button>
                              <button
                                title={
                                  actor.suspended!.topic
                                    ? "作品紹介の二人分を取り消します。別の仕事は残ります。"
                                    : undefined
                                }
                                onClick={() =>
                                  act({
                                    type: "cancel",
                                    residentId: actor.id,
                                    actionId: actor.suspended!.id,
                                  })
                                }
                              >
                                {actor.suspended!.topic
                                  ? "2人分を取消"
                                  : "取消"}
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                  </div>
                ))}
              </section>
              <details
                className={`home-life-note ${homeMorningReflection ? "has-morning" : ""}`}
              >
                <summary>
                  {homeMorningReflection ? <Sun size={15} /> : <Sparkles size={15} />}
                  <span>
                    {resident.name}の{homeMorningReflection ? "今朝" : "望み"}
                  </span>
                  <small
                    className={
                      homeMorningReflection
                        ? "home-morning-preview"
                        : residentLife.wish.completed
                          ? "wish-complete"
                          : ""
                    }
                  >
                    {homeMorningReflection?.text ?? residentLife.wish.progress}
                  </small>
                  <ChevronDown size={14} />
                </summary>
                <div className="life-note-content">
                  <p>{residentLife.wish.title}</p>
                  {homeMorningReflection && (
                    <small className="wish-complete">
                      {residentLife.wish.progress}
                    </small>
                  )}
                  {residentLife.wish.reason && (
                    <small>{residentLife.wish.reason}</small>
                  )}
                  {residentLife.wish.nextAction && (
                    <SuggestedAction
                      suggestion={residentLife.wish.nextAction}
                    />
                  )}
                  {residentLife.reflection && (
                    <div className="morning-note">
                      <strong>
                        <Sun size={14} />第{residentLife.reflection.day}日の朝に
                      </strong>
                      <p>{residentLife.reflection.text}</p>
                    </div>
                  )}
                  {residentLife.suggestion && (
                    <SuggestedAction suggestion={residentLife.suggestion} />
                  )}
                  <button
                    className="subtle-link"
                    onClick={() => setView("residents")}
                  >
                    人物と経験を詳しく見る
                  </button>
                </div>
              </details>
              <button className="explore-link" onClick={() => setView("world")}>
                <span>
                  <Icon icon={Compass} size={18} />
                  {base ? "少し、外へ出てみる" : "周囲と帰り道を確かめる"}
                </span>
                <ArrowRight size={16} />
              </button>
              <article className="scene-card scene-story">
                <div className="scene-copy">
                  <span className="eyebrow">{scene.eyebrow}</span>
                  <h2>{scene.title}</h2>
                  <p>{scene.paragraphs[0]}</p>
                  <details className="scene-reading">
                    <summary>この場所の様子を読む</summary>
                    {scene.paragraphs.slice(1).map((p, i) => (
                      <p key={i}>{p}</p>
                    ))}
                    <div className="scene-observation">
                      <span />
                      <p>
                        {game.life?.shelf?.location === resident.location
                          ? `${names[game.life.shelf.creatorId] ?? "住民"}が整えた小さな棚。ここで暮らす時間を、少しずつ置いていける。`
                          : game.flags.decorated && !game.life?.shelf && base
                            ? "窓辺に、小さな棚がある。少しだけ、自分たちの家らしくなった。"
                            : scene.detail}
                      </p>
                    </div>
                  </details>
                </div>
                <div className="scene-presence">
                  <div className="stacked-avatars">
                    {game.residents
                      .filter((r) => r.location === resident.location)
                      .map((r) => (
                        <Avatar key={r.id} resident={r} small />
                      ))}
                  </div>
                  <span>
                    {game.residents
                      .filter((r) => r.location === resident.location)
                      .map((r) =>
                        r.id === selected
                          ? `${r.name}${r.id === "aki" ? "（あなた）" : ""}`
                          : r.name,
                      )
                      .join("、")}
                    がここにいます
                  </span>
                  <span className="safe-tag">
                    <span />
                    {enemyAt(resident.location)
                      ? "危険な場所"
                      : base
                        ? "安全な場所"
                        : "帰路を確認"}
                  </span>
                </div>
              </article>
              <div className="recent-header">
                <h3>暮らしの足あと</h3>
                <button
                  className="subtle-link"
                  onClick={() => setView("journal")}
                >
                  日誌をひらく
                  <ArrowRight size={14} />
                </button>
              </div>
              <div className="recent-logs home-history-items">
                {getHomeHistoryItems(game.logs).map((item) =>
                  item.kind === "log" ? (
                    <LogItem key={item.key} log={item.log} compact />
                  ) : (
                    <details
                      className="home-movement-group"
                      key={item.key}
                      data-source-count={item.sourceLogs.length}
                      data-source-log-ids={item.sourceLogs
                        .map((log) => log.id)
                        .join(",")}
                    >
                      <summary className="home-movement-summary">
                        <span className="log-mark explore">
                          <Footprints size={14} />
                        </span>
                        <span className="home-history-summary-body">
                          <span className="home-history-title">
                            <strong>
                              {item.actorIds.length}人が移動を終えた
                            </strong>
                            <time>
                              {Math.floor(item.time / 1440) + 1}日目 ·{" "}
                              {formatTime(item.time)}
                            </time>
                          </span>
                          <span className="home-history-names">
                            {item.actorIds
                              .map(
                                (id) =>
                                  game.residents.find(
                                    (person) => person.id === id,
                                  )?.name ??
                                  names[id] ??
                                  "記録に残る人",
                              )
                              .join("、")}
                          </span>
                          <small>{item.sourceLogs.length}件の内訳</small>
                        </span>
                        <ChevronDown size={14} />
                      </summary>
                      <div className="home-history-details">
                        {item.sourceLogs.map((log) => (
                          <LogItem key={log.id} log={log} />
                        ))}
                      </div>
                    </details>
                  ),
                )}
              </div>
            </>
          )}
          {view === "residents" && (
            <>
              <PageHeading
                eyebrow="PEOPLE, NOT JUST NUMBERS"
                title="一緒に、暮らす人たち。"
                subtitle="それぞれの得意なことと、したいこと。"
              />
              <div className="detail-residents">
                {game.residents.map((r) => (
                  <article
                    className={`detail-card ${selected === r.id ? "chosen" : ""}`}
                    key={r.id}
                  >
                    <div className="detail-person-head">
                      <Avatar resident={r} />
                      <div>
                        <h2>
                          {r.name}
                          {r.id === "aki" && <small>あなた</small>}
                        </h2>
                        <p>
                          {r.role} · {r.traits.join(" / ")}
                        </p>
                      </div>
                    </div>
                    <div className="person-wish">
                      <Sparkles size={14} />
                      <div>
                        <span>{getWishProgress(game, r.id).title}</span>
                        <small
                          className={
                            getWishProgress(game, r.id).completed
                              ? "wish-complete"
                              : ""
                          }
                        >
                          {getWishProgress(game, r.id).completed && (
                            <CheckCheck size={13} />
                          )}
                          {getWishProgress(game, r.id).progress}
                        </small>
                      </div>
                    </div>
                    <div className="meters-grid">
                      <Meter
                        label={r.hp <= 0 ? "身体 · 意識なし" : "身体"}
                        value={r.hp}
                        color={r.hp < 40 ? "rust" : "olive"}
                      />
                      <Meter label="おなか" value={r.hunger} />
                      <Meter label="元気" value={r.energy} color="gold" />
                      <Meter label="気分" value={r.mood} color="sage" />
                    </div>
                    <div className="person-info">
                      <span>
                        <MapPin size={13} />
                        {LOCATIONS[r.location].name}
                      </span>
                      <span>
                        {r.action?.label ??
                          (r.suspended ? "作業を中断中" : "指示を待っています")}
                      </span>
                    </div>
                    <CarryLine game={game} resident={r} />
                    {(() => {
                      const work = r.action?.topic
                        ? r.action
                        : r.suspended?.topic
                          ? r.suspended
                          : undefined;
                      const piece = work?.topic
                        ? crafts.find((item) => item.id === work.topic!.craftId)
                        : undefined;
                      const status = getCraftConversationStatus(game, r.id);
                      return piece ? (
                        <div className="craft-conversation-current">
                          <span className="work-reservation">
                            作品{work === r.suspended ? "（中断中）" : ""}：
                            {getCraftDisplayTitle(game, piece)}
                          </span>
                          {status?.waiting && (
                            <span className="work-reservation">
                              待機中：{status.reason}
                            </span>
                          )}
                        </div>
                      ) : null;
                    })()}
                    {Object.values(r.wounds).some((v) => v > 0) && (
                      <p className="wound-note">
                        負傷：{r.wounds.arm > 0 ? `腕 ${r.wounds.arm} ` : ""}
                        {r.wounds.leg > 0 ? `脚 ${r.wounds.leg} ` : ""}
                        {r.wounds.body > 0 ? `体幹 ${r.wounds.body}` : ""} —
                        作業や歩行の負担が残ります
                      </p>
                    )}
                    <div className="skill-row">
                      <span>
                        料理 <b>{r.skills.cooking.toFixed(1)}</b>
                      </span>
                      <span>
                        手仕事 <b>{r.skills.craft.toFixed(1)}</b>
                      </span>
                      <span>
                        戦闘 <b>{r.skills.combat.toFixed(1)}</b>
                      </span>
                    </div>
                    <div className="person-controls">
                      <label>
                        ふだんの方針
                        <select
                          value={r.policy}
                          onChange={(e) =>
                            act({
                              type: "policy",
                              residentId: r.id,
                              policy: e.target.value as Resident["policy"],
                            })
                          }
                        >
                          {Object.entries(policyNames).map(([k, v]) => (
                            <option value={k} key={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                        <small className="policy-help">
                          {describePolicy(r)}
                        </small>
                      </label>
                      <label>
                        手に持つもの
                        <select
                          value={r.weapon}
                          onChange={(e) =>
                            act({
                              type: "equip",
                              residentId: r.id,
                              weapon: e.target.value as Resident["weapon"],
                            })
                          }
                        >
                          {Object.entries(weapons).map(([k, v]) => (
                            <option value={k} key={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={r.armor}
                          onChange={(e) =>
                            act({
                              type: "equip",
                              residentId: r.id,
                              armor: e.target.checked,
                            })
                          }
                        />
                        防具を着る
                      </label>
                    </div>
                    <ResidentRoutineControls resident={r} onCommand={act} />
                    <div className="person-actions">
                      <button
                        disabled={
                          !!assignSelection(game, group, "heal", r.id).error
                        }
                        title={assignSelection(game, group, "heal", r.id).error}
                        onClick={() => queue("heal", r.id)}
                      >
                        <Heart size={14} />
                        手当を頼む
                      </button>
                      <button
                        disabled={
                          !!assignSelection(game, group, "rescue", r.id).error
                        }
                        title={
                          assignSelection(game, group, "rescue", r.id).error
                        }
                        onClick={() => queue("rescue", r.id)}
                      >
                        <HeartHandshake size={14} />
                        救助する
                      </button>
                      {r.action && (
                        <button
                          onClick={() =>
                            act({ type: "pause", residentId: r.id })
                          }
                        >
                          中断
                        </button>
                      )}
                      {r.suspended && !r.action && (
                        <button
                          onClick={() =>
                            act({ type: "resume", residentId: r.id })
                          }
                        >
                          再開
                        </button>
                      )}
                      {(r.action || r.suspended) && (
                        <button
                          title={
                            (r.action ?? r.suspended)?.topic
                              ? "作品紹介の二人分を取り消します。別の仕事は残ります。"
                              : undefined
                          }
                          onClick={() =>
                            act({ type: "cancel", residentId: r.id })
                          }
                        >
                          {(r.action ?? r.suspended)?.topic
                            ? "2人分を取消"
                            : "取消"}
                        </button>
                      )}
                    </div>
                    <CareLocationGuide patient={r} />
                    {recentHeardExperience(r.id) ? (
                      <div className="memory morning-memory reported-memory">
                        <BookOpen size={15} />
                        <div>
                          <small>
                            あとで聞いたこと ·{" "}
                            {dayTime(recentHeardExperience(r.id)!.time)}
                          </small>
                          <p>{recentHeardExperience(r.id)!.text}</p>
                        </div>
                      </div>
                    ) : getResidentLife(game, r.id).reflection ? (
                      <div className="memory morning-memory">
                        <Sun size={15} />
                        <div>
                          <small>
                            第{getResidentLife(game, r.id).reflection!.day}
                            日の朝
                          </small>
                          <p>{getResidentLife(game, r.id).reflection!.text}</p>
                          {getResidentLife(game, r.id).suggestion && (
                            <SuggestedAction
                              suggestion={
                                getResidentLife(game, r.id).suggestion!
                              }
                            />
                          )}
                        </div>
                      </div>
                    ) : (
                      r.memories.length > 0 && (
                        <div className="memory">
                          <BookOpen size={13} />
                          <p>{r.memories[r.memories.length - 1]}</p>
                        </div>
                      )
                    )}
                    {getResidentLife(game, r.id).crafts.length > 0 && (
                      <details className="person-crafts">
                        <summary>
                          <Feather size={14} />
                          {r.name}の作品 ·{" "}
                          {getResidentLife(game, r.id).crafts.length}点
                        </summary>
                        <ul>
                          {getResidentLife(game, r.id).crafts.map((piece) => (
                            <li key={piece.id}>
                              <strong>{getCraftTitle(piece)}</strong>
                              {getCraftSubjectText(game, piece) && (
                                <small>{getCraftSubjectText(game, piece)}</small>
                              )}
                              <span>
                                第{Math.floor(piece.createdAt / 1440) + 1}日{" "}
                                {formatTime(piece.createdAt)}に制作
                              </span>
                              <small>
                                {piece.displayLocation
                                  ? `${LOCATIONS[piece.displayLocation].name}に飾っている`
                                  : "まだ飾っていません"}
                              </small>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <div className="relations">
                      {Object.entries(r.relations).map(([id, rel]) => (
                        <span key={id}>
                          {names[id]}への親しさ{" "}
                          <strong>{Math.round(rel.closeness)}</strong>
                          <small>信頼 {Math.round(rel.trust)}</small>
                        </span>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
              <div className="panel">
                <h3>
                  {group.length
                    ? `選んだ ${selectedNames}へ`
                    : "住民一覧で行動する人を選択"}
                </h3>
                <p className="muted" id="meal-selection-note">
                  食事：{mealDescription}
                </p>
                <div className="batch-buttons">
                  <button
                    disabled={!!mealPreview.error}
                    title={mealDescription}
                    aria-describedby="meal-selection-note"
                    onClick={() => queue("eat")}
                  >
                    <Utensils size={16} />
                    {mealLabel}
                  </button>
                  <button
                    disabled={!!assignSelection(game, group, "rest").error}
                    title={assignSelection(game, group, "rest").error}
                    onClick={() => queue("rest")}
                  >
                    <BedDouble size={16} />
                    休息
                  </button>
                  <button
                    disabled={
                      !!assignSelection(game, group, "move", "home").error
                    }
                    title={assignSelection(game, group, "move", "home").error}
                    onClick={() => queue("move", "home")}
                  >
                    <House size={16} />
                    帰還
                  </button>
                  <button
                    disabled={!!assignSelection(game, group, "defend", undefined, getPresentEncounterAt(game, resident.location)?.id).error}
                    title={assignSelection(game, group, "defend", undefined, getPresentEncounterAt(game, resident.location)?.id).error}
                    onClick={() => queue("defend")}
                  >
                    <Shield size={16} />
                    防御・援護
                  </button>
                  <button
                    disabled={!!assignSelection(game, group, "attack", undefined, getPresentEncounterAt(game, resident.location)?.id).error}
                    title={assignSelection(game, group, "attack", undefined, getPresentEncounterAt(game, resident.location)?.id).error}
                    onClick={() => queue("attack")}
                  >
                    <Swords size={16} />
                    攻撃
                  </button>
                </div>
                <p className="muted">
                  直接の指示が優先です。主担当が外出・療養・指示された作業で対応できない時は、空いている仲間が代わります。
                  外出中の住民を、方針で勝手に帰還させることはありません。
                </p>
              </div>
            </>
          )}
          {view === "base" && (
            <>
              <PageHeading
                eyebrow="SOMEWHERE TO COME BACK TO"
                title="小さな家を、居場所に。"
                subtitle="遠くへ行く日も、ここで過ごす日も。"
              />
              <div className="base-hero">
                <Landscape game={game} resident={resident} location="home" />
                <div>
                  <h2>丘のふもとの共同拠点</h2>
                  <p>{game.origin ? "旅から帰って荷を下ろせる、古い道の休憩所。" : "三人で住み直した、古い道の休憩所。"}</p>
                </div>
              </div>
              <div className="room-grid">
                {(["home", "kitchen", "bedroom", "garden"] as LocationId[]).map(
                  (id, i) => (
                    <button
                      className="room-card"
                      key={id}
                      onClick={() => {
                        queue("move", id);
                        setView("life");
                      }}
                    >
                      <span className="room-icon">
                        <Icon
                          icon={[House, Utensils, BedDouble, Sprout][i]}
                          size={24}
                        />
                      </span>
                      <h3>{LOCATIONS[id].name}</h3>
                      <p>{LOCATIONS[id].description}</p>
                      <div>
                        {game.residents
                          .filter((r) => r.location === id)
                          .map((r) => (
                            <span key={r.id}>{r.name}</span>
                          ))}
                        <ArrowRight size={14} />
                      </div>
                    </button>
                  ),
                )}
              </div>
              <div className="panel">
                <div className="section-header">
                  <h3>物資の見通し</h3>
                  <span className="muted">拠点倉庫</span>
                </div>
                <div className="stock-table">
                  <div>
                    <span>持ちもの</span>
                    <span>利用可能</span>
                    <span>予約中</span>
                    <span>合計</span>
                  </div>
                  {(
                    [
                      { key: "food", name: "食事" },
                      { key: "ingredients", name: "食材" },
                      { key: "medicine", name: "手当用品" },
                      { key: "scrap", name: "資材" },
                    ] as const
                  ).map((item) => (
                    <div key={item.key}>
                      <strong>{item.name}</strong>
                      <span>{baseFree[item.key]}</span>
                      <span>{game.resources[item.key] - baseFree[item.key]}</span>
                      <span>{game.resources[item.key]}</span>
                    </div>
                  ))}
                </div>
                <p className="muted">
                  この表は拠点倉庫の物資です。個人の所持品は「荷物と旅支度」で確認できます。予約分は完成時に一度だけ消費され、中断中も確保されます。
                </p>
                <p className="muted">全所在の合計（予約分を含む）：食事{totalStock.food}・食材{totalStock.ingredients}・手当用品{totalStock.medicine}・資材{totalStock.scrap}</p>
                <FoodProductionPanel key={managementSession} game={game} onCommand={act} />
                <MerchantLink />
                <TradeHistory game={game} />
              </div>
              <div className="panel cozy-panel">
                <Sprout size={28} />
                <div>
                  <h3>
                    {game.flags.decorated
                      ? "ここに、私たちらしさが。"
                      : "まだ、余白のある場所。"}
                  </h3>
                  <p>
                    {game.life?.shelf
                      ? `${names[game.life.shelf.creatorId] ?? "住民"}が${LOCATIONS[game.life.shelf.location].name}に整えた棚。自分で作ったものを、ここへ飾れます。`
                      : game.flags.decorated
                        ? "前からある小さな棚。暮らしの行動で場所を整え直すと、作品を飾れます。"
                        : "窓辺に棚を作る、小さな私物を置く。そんなことから始めてもいい。"}
                  </p>
                  <button
                    className="subtle-link base-project-link"
                    onClick={openCraftPicker}
                  >
                    <Feather size={15} />
                    手仕事の選択肢を見る
                  </button>
                </div>
              </div>
              {(crafts.length > 0 || completedProjects.length > 0) && (
                <details
                  className="panel craft-collection"
                  onToggle={(event) => {
                    if (!event.currentTarget.open) setCraftConversationId(null);
                  }}
                >
                  <summary>
                    <Feather size={17} />
                    <strong>暮らしに残るもの</strong>
                    <span>
                      作品{crafts.length}点 · 設備{completedProjects.length}件
                    </span>
                    <ChevronDown size={15} />
                  </summary>
                  {crafts.length > 0 && (
                    <details
                      className="project-completed craft-conversation-options"
                      onToggle={(event) => {
                        if (!event.currentTarget.open)
                          setCraftConversationId(null);
                      }}
                    >
                      <summary>
                        <HeartHandshake size={15} />
                        <span>作品を紹介する（任意）</span>
                        <ChevronDown size={14} />
                      </summary>
                      <div>
                        <div className="project-selection">
                          <div>
                            <span>いま選んでいる人</span>
                            <strong>
                              {selectedResidents
                                .map(
                                  (person) =>
                                    `${person.name}（${LOCATIONS[person.location].name}）`,
                                )
                                .join("・") || "選択していません"}
                            </strong>
                          </div>
                          <button
                            onClick={() => {
                              setView("life");
                              requestAnimationFrame(() =>
                                document
                                  .querySelector(".residents-list")
                                  ?.scrollIntoView({
                                    block: "center",
                                    behavior: "instant",
                                  }),
                              );
                            }}
                          >
                            住民一覧へ戻る
                          </button>
                          <small>
                            作品の作者と、紹介する相手を二人だけ選びます。
                          </small>
                        </div>
                        <label htmlFor="craft-conversation-work">
                          紹介する作品
                        </label>
                        <select
                          id="craft-conversation-work"
                          value={conversationCraft?.id ?? ""}
                          onChange={(event) =>
                            setCraftConversationId(
                              event.target.value
                                ? Number(event.target.value)
                                : null,
                            )
                          }
                          aria-describedby="craft-conversation-facts"
                        >
                          <option value="">作品を選ぶ</option>
                          {crafts
                            .slice()
                            .reverse()
                            .map((piece) => (
                              <option key={piece.id} value={piece.id}>
                                {names[piece.authorId] ?? "住民"}の
                                {getCraftTitle(piece)} · {dayTime(piece.createdAt)}
                              </option>
                            ))}
                        </select>
                        <div id="craft-conversation-facts">
                          {conversationCraft && (
                            <>
                              <strong>
                                {getCraftDisplayTitle(game, conversationCraft)}
                              </strong>
                              <p>
                                作者：{conversationAuthor?.name ?? "住民"} ·{" "}
                                {dayTime(conversationCraft.createdAt)}制作
                              </p>
                              {getCraftSubjectText(game, conversationCraft) && (
                                <p>
                                  {getCraftSubjectText(game, conversationCraft)}
                                </p>
                              )}
                              <p>
                                作品の場所：
                                {conversationCraft.displayLocation
                                  ? `${LOCATIONS[conversationCraft.displayLocation].name}に展示`
                                  : `${conversationAuthor?.name ?? "作者"}の手元${conversationAuthor ? `（${LOCATIONS[conversationAuthor.location].name}）` : ""}`}
                              </p>
                              {conversationViewer && (
                                <p>
                                  紹介する相手：{conversationViewer.name} ·{" "}
                                  {knowsCraft(
                                    game,
                                    conversationViewer.id,
                                    conversationCraft.id,
                                  )
                                    ? "この作品を知っている"
                                    : "この作品はまだ知らない"}
                                </p>
                              )}
                            </>
                          )}
                          <p>
                            {Math.ceil(craftConversationDuration ?? 20)}分 ·
                            時間はボタンで進めます。
                          </p>
                          {craftConversationChanges.length > 0 && (
                            <div className="craft-conversation-effects">
                              {craftConversationChanges.map((change) => (
                                <p key={change}>{change}</p>
                              ))}
                            </div>
                          )}
                        </div>
                        {craftConversationError && (
                          <p
                            className="project-error"
                            id="craft-conversation-error"
                          >
                            {craftConversationError}
                          </p>
                        )}
                        <button
                          className="project-reserve-button"
                          disabled={!!craftConversationError}
                          aria-describedby={`craft-conversation-facts${craftConversationError ? " craft-conversation-error" : ""}`}
                          onClick={queueCraftConversation}
                        >
                          この作品の紹介を予約する
                        </button>
                      </div>
                    </details>
                  )}
                  <ul aria-label="暮らしに残る作品">
                    {crafts
                      .slice()
                      .reverse()
                      .map((piece) => (
                        <li key={piece.id}>
                          <span className="craft-piece-icon">
                            <Feather size={20} />
                          </span>
                          <div>
                            <strong>
                              {names[piece.authorId] ?? "住民"}の
                              {getCraftTitle(piece)}
                            </strong>
                            {getCraftSubjectText(game, piece) && (
                              <small>{getCraftSubjectText(game, piece)}</small>
                            )}
                            <span>
                              第{Math.floor(piece.createdAt / 1440) + 1}日{" "}
                              {formatTime(piece.createdAt)} ·{" "}
                              {LOCATIONS[piece.createdLocation].name}で制作
                            </span>
                            <small>
                              {piece.displayLocation
                                ? `${LOCATIONS[piece.displayLocation].name}に飾っている`
                                : "作者の手元に · まだ飾っていません"}
                            </small>
                          </div>
                          {piece.displayLocation && (
                            <Check size={16} aria-label="設置済み" />
                          )}
                        </li>
                      ))}
                  </ul>
                  {completedProjects.length > 0 && (
                    <ul
                      className="completed-projects"
                      aria-label="完成した暮らしの設備"
                    >
                      {completedProjects.map(({ recipe, completed }) => (
                        <li key={completed!.id}>
                          <span className="craft-piece-icon">
                            <Icon
                              icon={projectIcons[recipe.id]}
                              size={20}
                            />
                          </span>
                          <div>
                            <strong>{recipe.title}</strong>
                            <span>
                              {names[completed!.creatorId]}が
                              {LOCATIONS[completed!.location].name}に制作
                            </span>
                            <small>{recipe.effect}</small>
                          </div>
                          <Check size={16} aria-label="完成済み" />
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              )}
            </>
          )}
          {view === "world" && (
            <>
              <PageHeading
                eyebrow="A LITTLE FURTHER FROM HOME"
                title="見慣れた道の、もう少し先。"
                subtitle="進むことも、引き返すことも、あなたの選択。"
              />
              <TogetherTravelPanel key={togetherTravelScope} game={game} selectedIds={group} scope={togetherTravelScope}
                openRequest={togetherRouteRequest} onOpenHandled={() => setTogetherRouteRequest(null)} onCommand={act} />
              <AwayPanel game={game} onFocus={focusScene} />
              <TripPlanPanel game={game} selectedIds={group} onCommand={act} openRequest={tripPlanOpenRequest} onOpenHandled={() => setTripPlanOpenRequest(null)} />
              <TravelPanel key={`world-travel-${managementSession}`} game={game} focusedId={selected} selectedIds={group} onCommand={act} />
              <DayTripRoutes game={game} selectedIds={group} onCommand={act}
                onTogetherRoute={(target, via) => setTogetherRouteRequest({ scope: togetherTravelScope, target, via: [...via] })} />
              <RegionPanel key={`world-region-${managementSession}`} game={game} focusedId={selected} selectedIds={group} onCommand={act} />
              <div className="map-panel">
                <span className="map-caption">丘のふもとから、上流の水郷へ</span>
                <svg
                  viewBox="0 0 640 525"
                  className="world-map"
                  aria-label="丘のふもとの家から集落、上流の葦原、舟宿の工房へ続く地図"
                >
                  <defs>
                    <pattern
                      id="map-grid"
                      width="24"
                      height="24"
                      patternUnits="userSpaceOnUse"
                    >
                      <circle cx="1" cy="1" r=".6" fill="#c6c9b8" />
                    </pattern>
                  </defs>
                  <rect width="640" height="525" fill="url(#map-grid)" />
                  <path
                    d="M70 145L235 175L390 85L505 100L565 270L365 350L235 175M235 175L350 270L390 85 M565 270Q595 385 420 441L235 441"
                    stroke="#b5baa6"
                    strokeDasharray="5 5"
                    strokeWidth="2"
                    fill="none"
                  />
                  <path
                    d="M250 56L284 17L317 56M265 60L299 21L331 60M377 290L405 257L431 290"
                    stroke="#d8dccd"
                    strokeWidth="1.3"
                    fill="none"
                  />
                  {[
                    {
                      id: "home",
                      x: 70,
                      y: 145,
                      label: "共同拠点",
                      icon: "⌂",
                    },
                    {
                      id: "road",
                      x: 235,
                      y: 175,
                      label: "草の道",
                      icon: "⌁",
                    },
                    {
                      id: "ruins",
                      x: 390,
                      y: 85,
                      label: "旧い資材置き場",
                      icon: "♜",
                    },
                    {
                      id: "shelter",
                      x: 350,
                      y: 270,
                      label: "木陰の迂回路",
                      icon: "⌑",
                    },
                    { id: "meadow", x: 365, y: 350, label: "川沿いの採集地", icon: "♧" },
                    { id: "ridge", x: 505, y: 100, label: "尾根の近道", icon: "⌁" },
                    { id: "village", x: 565, y: 270, label: "近隣の集落", icon: "⌂" },
                    { id: "reedbank", x: 420, y: 441, label: "上流の葦原", icon: "♧" },
                    { id: "lodge", x: 235, y: 441, label: "舟宿の工房", icon: "⌂" },
                  ].map((point) => (
                    <g
                      key={point.id}
                      className="map-node"
                      role="button"
                      tabIndex={0}
                      aria-label={`${point.label}${mapHasRisk(point.id as LocationId) ? "への道中の危険を確認" : "へ移動を予約"}`}
                      onClick={() => chooseMapPoint(point.id as LocationId)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          chooseMapPoint(point.id as LocationId);
                        }
                      }}
                    >
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r="24"
                        fill={
                          (base ? "home" : resident.location) === point.id ? "#667451" : "#faf9f3"
                        }
                        stroke={
                          enemyAt(point.id as LocationId)
                            ? "#ac8066"
                            : "#b2b9a3"
                        }
                        strokeWidth="1.2"
                      />
                      <text
                        x={point.x}
                        y={point.y + 8}
                        textAnchor="middle"
                        fontSize="28"
                        fill={
                          (base ? "home" : resident.location) === point.id ? "#fff" : "#6c7959"
                        }
                      >
                        {point.icon}
                      </text>
                      <text
                        x={point.x}
                        y={point.y + 43}
                        textAnchor="middle"
                        fontSize="12"
                        fill="#595d4d"
                      >
                        {point.label}
                      </text>
                      {game.residents
                        .filter(
                          (r) =>
                            (LOCATIONS[r.location].kind === "base"
                              ? "home"
                              : r.location) === point.id,
                        )
                        .map((r, i) => (
                          <g key={r.id}>
                            <circle
                              cx={point.x - 12 + i * 15}
                              cy={point.y - 20}
                              r="9"
                              fill={
                                r.id === "aki"
                                  ? "#70805b"
                                  : r.id === "mio"
                                    ? "#b28a69"
                                    : "#7b8c91"
                              }
                            />
                            <text
                              x={point.x - 12 + i * 15}
                              y={point.y - 17}
                              textAnchor="middle"
                              fontSize="9"
                              fill="white"
                            >
                              {r.name[0]}
                            </text>
                          </g>
                        ))}
                    </g>
                  ))}
                  <text x="41" y="395" fontSize="11" fill="#8e9482">
                    N ↑
                  </text>
                </svg>
                <div className="map-legend">
                  <span>
                    <i className="olive-dot" />
                    現在地
                  </span>
                  <span>
                    <i className={game.guardAgreement ? "olive-dot" : "rust-dot"} />
                    {game.guardAgreement
                      ? "守り手は食事を受け取り立ち去った"
                      : game.enemy.defeated
                      ? "守り手は去った"
                      : `${LOCATIONS[game.enemy.location].name}に守り手`}
                  </span>
                  {getEncounters(game).filter(encounter => encounter.id === SECOND_ENCOUNTER_RULE.id).map(encounter => (
                    <span key={encounter.id} data-map-encounter={encounter.id}>
                      <i className={encounter.present ? "rust-dot" : "olive-dot"} />
                      {encounter.present ? `${LOCATIONS[encounter.location].name}に${encounter.name}` : "尾根の見張りは去った"}
                    </span>
                  ))}
                  <span>点を押すと移動を予約。危険がある道は下の行き先で確認</span>
                </div>
              </div>
              <div className="section-header destinations-title">
                <h3>{group.map((id) => names[id]).join("・")}の行き先</h3>
                <button
                  className="subtle-link"
                  onClick={() => setView("residents")}
                >
                  編成を変える
                  <Users size={14} />
                </button>
              </div>
              <Destinations game={game} selectedIds={group} onMove={id => queue("move", id)} onCommand={act} />
            </>
          )}
          {view === "journal" && (
            <>
              <PageHeading
                eyebrow="THE THINGS WE KEEP"
                title="暮らしの足あと。"
                subtitle="持ち帰ったものは、物資だけじゃない。"
              />
              <div className="day-summary">
                <BookOpen size={24} />
                <div>
                  <span>
                    第 {day} 日 · {formatTime(game.minutes)}
                  </span>
                  <h3>今日も、ここで暮らしている。</h3>
                  <p>
                    食事 {totalStock.food} 食（全所在の合計） ·{" "}
                    {game.residents.filter((r) => r.hp > 0).length} 人が活動可能
                    ·{" "}
                    {game.flags.hobbyFinished
                      ? "木彫りの作品が完成"
                      : "木彫りはまだ、これから"}
                    {game.flags.decorated ? " · 窓辺を飾った" : ""}
                  </p>
                </div>
              </div>
              <div className="journal-filters">
                {[
                  { key: "all", label: "すべて" },
                  { key: "life", label: "暮らし" },
                  { key: "social", label: "交流" },
                  { key: "work", label: "仕事" },
                  { key: "explore", label: "探索" },
                  { key: "combat", label: "戦闘" },
                ].map((f) => (
                  <button
                    className={journalFilter === f.key ? "selected" : ""}
                    key={f.key}
                    onClick={() => setJournalFilter(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="full-journal">
                {currentLogs.length ? (
                  currentLogs
                    .slice()
                    .reverse()
                    .map((log) => <LogItem key={log.id} log={log} />)
                ) : (
                  <p className="empty-state">
                    まだ、この種類の足あとはありません。
                    <br />
                    これからの時間が、ここに残っていきます。
                  </p>
                )}
              </div>
            </>
          )}
        </section>
        <aside className="right-sidebar">
          <div className="today-heading">
            <Sun size={19} />
            <h3>今日の、小さなこと</h3>
          </div>
          <p className="sidebar-subtitle">急がなくていい。ひとつずつ。</p>
          <div className="wish-card">
            <div className="wish-top">
              <span className="small-avatar">{resident.name[0]}</span>
              <span>{resident.name}の小さな望み</span>
              <Sparkles size={14} />
            </div>
            <p>{residentLife.wish.title}</p>
            <small
              className={`wish-progress ${residentLife.wish.completed ? "wish-complete" : ""}`}
            >
              {residentLife.wish.completed && <CheckCheck size={13} />}
              {residentLife.wish.progress}
            </small>
            <button onClick={() => setView("life")}>暮らしの行動を見る</button>
          </div>
          <div className="daily-goals">
            {game.residents.map((r) => (
              <Goal
                key={r.id}
                complete={getWishProgress(game, r.id).completed}
                title={`${r.name}の望み`}
                desc={getWishProgress(game, r.id).progress}
              />
            ))}
          </div>
          <div className="right-divider" />
          <div className="section-label">
            <span>いまの、{resident.name}</span>
            <Heart size={14} />
          </div>
          <div className="quick-meters">
            <Meter
              label="身体"
              value={resident.hp}
              color={resident.hp < 40 ? "rust" : "olive"}
            />
            <Meter label="おなか" value={resident.hunger} />
            <Meter label="元気" value={resident.energy} color="gold" />
            <Meter label="気分" value={resident.mood} color="sage" />
          </div>
          <button
            className="subtle-link status-link"
            onClick={() => setView("residents")}
          >
            身体と関係をくわしく
            <ArrowRight size={13} />
          </button>
          <div className="notebook-tip">
            <span className="tip-icon">
              <BookOpen size={19} />
            </span>
            <h4>暮らしの手引き</h4>
            <p>
              あなたが読んでいる間、
              <br />
              この世界の時間は止まります。
              <br />
              行動を選んだら、下のボタンで
              <br />
              時間を進めてみましょう。
            </p>
            <button onClick={() => setModal("help")}>
              もう少し、くわしく
              <ArrowRight size={13} />
            </button>
          </div>
        </aside>
      </main>
      <footer className={`time-bar ${timeControls.combat ? "is-combat" : ""}`}>
        <div className="time-bar-inner">
          <div className="time-state" role="status" aria-live="polite">
            <span className="time-state-icon">
              <Icon
                icon={
                  timeControls.combat
                    ? Swords
                    : footerCare?.kind === "hunger"
                      ? Utensils
                      : footerCare?.kind === "fatigue"
                        ? BedDouble
                        : Clock3
                }
                size={16}
              />
            </span>
            <div>
              <strong>
                {timeControls.combat
                  ? `${combatNames}が交戦中${combatLocationCount > 1 ? `（${combatLocationCount}地点）` : ""}`
                  : footerCare
                    ? footerCare.kind === "hunger"
                      ? careResident?.action?.kind === "eat"
                        ? `${names[footerCare.residentId]}が食事中`
                        : `${names[footerCare.residentId]}に食事が必要`
                      : `${names[footerCare.residentId]}に休息が必要`
                    : "時間を進める"}
              </strong>
              <small>
                {timeControls.combat
                  ? "どの住民・画面でも、1・5・10分刻みです。"
                  : footerCare
                    ? "本人の場面で、体調と今の仕事を確認できます。"
                    : "行動を予約したら、進める時間を選びましょう。"}
              </small>
              {(combatResidents.length > 0 || footerAttention) && (
                <button
                  className="time-scene-jump"
                  aria-label={
                    footerCare && !combatResidents.length
                      ? `${names[footerCare.residentId]}の${footerCare.kind === "hunger" ? "食事" : "休息"}を確認する（${formatTime(game.minutes)}）`
                      : undefined
                  }
                  onClick={() =>
                    focusScene(
                      combatResidents[0]?.id ?? footerAttention!.residentId,
                    )
                  }
                >
                  {combatResidents.length
                    ? `戦闘の現場を見る · 対応${attention.length}件`
                    : footerCare
                      ? `${formatTime(game.minutes)} · ${footerCare.kind === "hunger" ? "食事を確認" : "休息を確認"}`
                      : `現場を見る · 対応${attention.length}件`}
                </button>
              )}
            </div>
          </div>
          <div
            className="advance-controls"
            aria-label={
              timeControls.combat ? "戦闘中の時間操作" : "通常の時間操作"
            }
          >
            {timeControls.minuteSteps.map((minutes) => (
              <button
                key={minutes}
                disabled={game.ended}
                onClick={() => tick(minutes)}
              >
                {minutes === 60 ? "1時間" : `${minutes}分`}
              </button>
            ))}
            {!timeControls.combat && (
              <button
                className="next-button"
                title="選択外の住民も含む、最初の行動の区切りへ進みます。危険などがあれば途中で止まります。"
                disabled={game.ended}
                onClick={tickNext}
              >
                <Play size={13} fill="currentColor" />
                誰かの区切りへ
                <ChevronRight size={15} />
              </button>
            )}
          </div>
          <div className="time-options">
            <button
              className={`auto-combat-toggle ${game.autoCombat ? "enabled" : ""}`}
              aria-pressed={!!game.autoCombat}
              aria-label={`自動戦闘を${game.autoCombat ? "オフ" : "オン"}にする`}
              disabled={game.ended}
              title="攻防を任せます。時間はボタンで進め、手動の指示を優先します。"
              onClick={() =>
                act({ type: "auto-combat", enabled: !game.autoCombat })
              }
            >
              <Swords size={15} />
              <span>
                自動戦闘 <strong>{game.autoCombat ? "ON" : "OFF"}</strong>
              </span>
            </button>
            <button
              className="night-button"
              disabled={game.ended || timeControls.combat}
              aria-label={
                timeControls.combat
                  ? `${shortcutLabel}（交戦中は利用できません）`
                  : shortcutIsEvening
                    ? "夕方まで（睡眠せず18時まで時間を進める）"
                    : `翌朝まで（${selectedNames || "選んだ住民"}に睡眠を指示して朝へ進める）`
              }
              onClick={() => {
                const result = advanceTimeShortcutFromControls(game, group);
                if (result.error) {
                  notify(result.error);
                  return;
                }
                clearToast();
                commit(result.state);
                if (
                  result.state.pauseReason &&
                  deriveAttention(result.state).length === 0
                )
                  notify(result.state.pauseReason);
              }}
              title={
                shortcutPreview.error ??
                (shortcutIsEvening
                  ? "睡眠を予約せず18時まで進めます。仕事は続き、危険や強い空腹で停止します。"
                  : "選んだ住民に睡眠を指示し、朝8時まで進めます。危険や強い空腹で停止します。")
              }
            >
              {shortcutIsEvening ? <Sun size={16} /> : <Moon size={16} />}
              <span>
                {shortcutLabel}
                <small className="shortcut-context">
                  {timeControls.combat
                    ? "交戦中"
                    : shortcutIsEvening
                      ? "睡眠なし"
                      : shortcutPreview.error
                        ? selectedResidents.some((r) => r.hunger < 35)
                          ? "先に食事"
                          : "要確認"
                        : "睡眠指示"}
                </small>
              </span>
            </button>
          </div>
        </div>
      </footer>
      {toast && (
        <div className="toast" role="status">
          <CheckCheck size={17} />
          <span>{toast}</span>
          <button onClick={() => setToast("")} aria-label="通知を閉じる">
            <X size={15} />
          </button>
        </div>
      )}
      <input
        ref={upload}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => importSave(e.target.files?.[0])}
      />
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            className={`modal ${modal === "help" ? "guide-modal" : modal === "craft" ? "craft-modal" : modal === "trade" ? "craft-modal trade-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            {modal !== "craft" && modal !== "trade" && (
              <button
                className="modal-close"
                onClick={() => setModal(null)}
                aria-label="閉じる"
              >
                <X size={20} />
              </button>
            )}
            {modal === "trade" ? (
              <>
                <header className="craft-modal-heading trade-modal-heading">
                  <div>
                    <h2 id="modal-title">昼の小さな行商</h2>
                    <span className="trade-hours">
                      {merchant.status === "open"
                        ? `共同の居間 · ${formatTime(merchant.leavesAt)}まで`
                        : merchant.status === "departed"
                          ? `今日は出発しました · 次は${dayTime(merchant.nextArrival)}`
                          : `${dayTime(merchant.arrivesAt)}に共同の居間へ`}
                    </span>
                  </div>
                  <button
                    className="modal-close"
                    onClick={() => setModal(null)}
                    aria-label="閉じる"
                  >
                    <X size={20} />
                  </button>
                </header>
                <p className="trade-clock-note">
                  閲覧と交換では時間は進みません。予約中の食料は渡せません。
                </p>
                <div className="project-selection trade-participant">
                  <div>
                    <span>交換する人</span>
                    <strong className="trade-actor-name">
                      {selectedNames || "選択していません"}
                    </strong>
                    {selectedResidents.length === 1 && (
                      <small>
                        現在地：{LOCATIONS[selectedResidents[0].location].name}
                      </small>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setModal(null);
                      setView("life");
                      requestAnimationFrame(() =>
                        document
                          .querySelector(".residents-list")
                          ?.scrollIntoView({
                            block: "center",
                            behavior: "instant",
                          }),
                      );
                    }}
                  >
                    住民一覧へ戻る
                  </button>
                  <small>
                    住民一覧で選んだ1人が、共同の居間に来て交換します。
                  </small>
                  {selectedResidents.length === 1 &&
                    selectedResidents[0].location !== "home" && (
                      <div className="trade-approach">
                        <button
                          disabled={
                            game.ended ||
                            !!assignSelection(game, group, "move", "home").error
                          }
                          onClick={() => {
                            queue("move", "home");
                            setModal(null);
                            setView("life");
                          }}
                        >
                          <Footprints size={14} />
                          {selectedResidents[0].name}を共同の居間へ
                        </button>
                        <small>
                          {assignSelection(game, group, "move", "home").error ??
                            "移動の予約だけを行います。到着後に、もう一度交換を選べます。"}
                        </small>
                      </div>
                    )}
                </div>
                {commonTradeError && (
                  <p className="trade-common-error" id="trade-common-error">
                    {commonTradeError}
                  </p>
                )}
                {tradeInventory && (
                  <dl className="trade-inventory">
                    <div>
                      <dt>食事</dt>
                      <dd>
                        利用可能 <strong>{tradeInventory.before.food}食</strong>
                        <span>予約中 {tradeInventory.reserved.food}食</span>
                      </dd>
                    </div>
                    <div>
                      <dt>食材</dt>
                      <dd>
                        利用可能{" "}
                        <strong>{tradeInventory.before.ingredients}個</strong>
                        <span>
                          予約中 {tradeInventory.reserved.ingredients}個
                        </span>
                      </dd>
                    </div>
                  </dl>
                )}
                <div className="trade-groups">
                  {(["scrap", "medicine"] as const).map((stockKey) => (
                    <section
                      className="trade-group"
                      key={stockKey}
                      data-stock={stockKey}
                    >
                      <div className="trade-group-heading">
                        <Icon
                          icon={stockKey === "scrap" ? Package : Heart}
                          size={18}
                        />
                        <h3>
                          {stockKey === "scrap"
                            ? "資材を受け取る"
                            : "手当用品を受け取る"}
                        </h3>
                        <span>
                          {merchant.status === "open" && merchant.stock
                            ? merchant.stock[stockKey] === 0
                              ? "本日は売切れ"
                              : `残り${merchant.stock[stockKey]}`
                            : merchant.status === "departed"
                              ? "本日は終了"
                              : "到着後に在庫を表示"}
                        </span>
                      </div>
                      {tradePreviews
                        .filter(({ offer }) => offer.stockKey === stockKey)
                        .map(({ offer, preview }) => (
                          <TradeOfferRow
                            key={offer.id}
                            offer={offer}
                            preview={preview}
                          />
                        ))}
                    </section>
                  ))}
                </div>
                {game.trade?.receipts.at(-1) &&
                  !tradeFeedback &&
                  (() => {
                    const last = game.trade.receipts.at(-1)!;
                    return (
                      <p className="trade-last-receipt">
                        最近の交換：{dayTime(last.time)}、{names[last.actorId]}
                        が{resourceText(last.paid)}を渡し、
                        {resourceText(last.received)}を受け取りました。
                      </p>
                    );
                  })()}
                <TradeHistory game={game} scope="merchant" />
                {(combatResidents.length > 0 || footerAttention) && (
                  <button
                    className="subtle-link trade-care-link"
                    onClick={() => {
                      setModal(null);
                      focusScene(
                        combatResidents[0]?.id ?? footerAttention!.residentId,
                      );
                    }}
                  >
                    <Heart size={14} />
                    {
                      names[
                        combatResidents[0]?.id ?? footerAttention!.residentId
                      ]
                    }
                    の{combatResidents.length ? "現場" : "体調"}を確認する
                  </button>
                )}
              </>
            ) : modal === "craft" ? (
              <>
                <header className="craft-modal-heading">
                  <div>
                    <span className="eyebrow">MADE FOR OUR LITTLE LIFE</span>
                    <h2 id="modal-title">手仕事の選択肢</h2>
                  </div>
                  <button
                    className="modal-close"
                    onClick={() => setModal(null)}
                    aria-label="閉じる"
                  >
                    <X size={20} />
                  </button>
                </header>
                <p className="modal-description">
                  {craftingAtLodge ? "舟宿で木を彫ったり、この場所の手仕事台を整えたりできます。" : "小さな作品も、毎日を楽にする道具も。"}
                </p>
                <div className="project-selection">
                  <div>
                    <span>いま選んでいる人</span>
                    <strong>{selectedNames || "選択していません"}</strong>
                  </div>
                  <button
                    onClick={() => {
                      setModal(null);
                      setView("life");
                      requestAnimationFrame(() =>
                        document
                          .querySelector(".residents-list")
                          ?.scrollIntoView({
                            block: "center",
                            behavior: "instant",
                          }),
                      );
                    }}
                  >
                    住民一覧へ戻る
                  </button>
                  <small>
                    制作は1人ずつ。ここを見たり、予約するだけでは時間は進みません。
                  </small>
                </div>
                <div className="project-stock">
                  <Package size={17} />
                  <strong>{subjectMaker ? `${subjectMaker.name}が使える資材 ${subjectMaker.location === "lodge" ? ownFreeResources(game, subjectMaker.id).scrap : accessibleResources(game, subjectMaker.id).scrap}` : "制作する人を一人だけ選択"}</strong>
                  {craftingAtLodge ? <span>物置の資材は、先に荷物へ取り出します。</span> : <span>
                    倉庫内の予約 {game.resources.scrap - baseFree.scrap} · 倉庫の合計{" "}
                    {game.resources.scrap}
                  </span>}
                </div>
                <div className="project-recipes">
                  {projects
                    .filter(
                      ({ recipe, completed }) =>
                        recipe.repeatable || (!completed && (!craftingAtLodge || recipe.id === "crafting-tools")),
                    )
                    .map((project) => (
                      <ProjectCard key={project.recipe.id} project={project} />
                    ))}
                </div>
                <details className="project-completed art-subject-options">
                  <summary>
                    <Feather size={15} />
                    <span>景色を題材にする（任意）</span>
                    <ChevronDown size={14} />
                  </summary>
                  <div>
                    <p>眺めて過ごした景色を、小鳥や花の題材に。</p>
                    {subjectMaker && (
                      <p>
                        題材を残す人：{subjectMaker.name} · 現在地：
                        {LOCATIONS[subjectMaker.location].name}
                      </p>
                    )}
                    {craftSubjectChoices.length > 0 && (
                      <fieldset className="art-subject-choices">
                        <legend>{subjectMaker?.name}の題材候補</legend>
                        {craftSubjectChoices.map((choice) => (
                          <label
                            className="art-subject-choice"
                            key={choice.eventId}
                          >
                            <input
                              type="radio"
                              name="craft-subject-event"
                              value={choice.eventId}
                              checked={
                                selectedCraftSubject?.eventId === choice.eventId
                              }
                              onChange={() => {
                                if (subjectMaker)
                                  setCraftSubjectSelection({
                                    authorId: subjectMaker.id,
                                    eventId: choice.eventId,
                                  });
                              }}
                            />
                            <span>{choice.label}</span>
                          </label>
                        ))}
                      </fieldset>
                    )}
                    {subjectPreparationError && (
                      <p className="muted" id="craft-subject-reason">
                        {subjectPreparationError}
                      </p>
                    )}
                    <div className="project-recipes">
                      <SubjectCraftReservation design="bird" />
                      <SubjectCraftReservation design="flower" />
                    </div>
                  </div>
                </details>
                <div className="project-material-note">
                  <p>
                    {craftingAtLodge ? "葦原では食材と資材を採集できます。" : "資材は木陰や旧い資材置き場で回収でき、昼の行商でも食事・食材と交換できます。予約中の資材は、ほかの制作には使えません。"}
                  </p>
                  <button
                    className="subtle-link"
                    onClick={() => {
                      setModal(null);
                      setView("world");
                    }}
                  >
                    <Compass size={14} />
                    回収場所を見る
                  </button>
                  {!craftingAtLodge && <button className="subtle-link" onClick={openTrade}>
                    <Package size={14} />
                    昼の行商を見る
                  </button>}
                </div>
                {localCompleted.length > 0 && (
                  <details className="project-completed">
                    <summary>
                      <CheckCheck size={15} />
                      完成した設備 · {localCompleted.length}件
                    </summary>
                    {localCompleted.map(({ recipe, completed }) => (
                      <div key={completed!.id}>
                        <strong>{recipe.title}</strong>
                        <p>
                          {names[completed!.creatorId]}が
                          {LOCATIONS[completed!.location].name}に制作。
                          {recipe.effect}
                        </p>
                      </div>
                    ))}
                  </details>
                )}
              </>
            ) : modal === "save" ? (
              <>
                <span className="eyebrow">UNTIL WE MEET AGAIN</span>
                <h2 id="modal-title">続きは、またここから。</h2>
                <p className="modal-description">
                  {game.residents.length}人の状態も、途中の仕事も、そのままに。
                </p>
                <div className="save-slot">
                  <span className="save-slot-icon">
                    <Save size={24} />
                  </span>
                  <div>
                    <strong>このブラウザの保存</strong>
                    <small>{savedAt}</small>
                  </div>
                  <button className="secondary-button" onClick={load}>
                    読み込む
                  </button>
                </div>
                <button className="primary-button full-width" onClick={save}>
                  <Save size={17} />
                  いまの暮らしを保存する
                </button>
                <PreviousOpenings onLoad={restoreOpening} />
                <div className="save-files">
                  <button onClick={exportSave}>
                    <ArrowDownToLine size={17} />
                    ファイルに書き出す
                  </button>
                  <button onClick={() => upload.current?.click()}>
                    <Upload size={17} />
                    ファイルを読み込む
                  </button>
                </div>
                <p className="save-note">
                  行動・材料の予約・乱数を含めて保存します。操作ごとの自動保存とは別に、上の保存を残せます。大切な記録はファイルでも保管してください。
                </p>
                <button
                  className="reset-link"
                  onClick={openOpeningPicker}
                >
                  <RotateCcw size={13} />
                  同じ朝から、はじめなおす
                </button>
              </>
            ) : modal === "reset" ? (
              <OpeningPicker current={game.origin ?? "household"} onStart={startWorld} onCancel={() => setModal(null)} />
            ) : (
              <>
                <span className="eyebrow">A SMALL GUIDE TO LIVING</span>
                <h2 id="modal-title">この暮らしの、歩き方。</h2>
                <p className="modal-description">
                  決まった正解も、急ぐべき終わりもありません。
                </p>
                <div className="guide-steps">
                  {GUIDE_STEPS.map((step, i) => (
                    <div key={step.title}>
                      <span>{String(i + 1).padStart(2, "0")}</span>
                      <div>
                        <h3>{step.title}</h3>
                        <p>{step.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <details className="guide-time-note">
                  <summary>時間・食事・休養について</summary>
                  <p>
                    日中の「夕方まで」は、眠らず18時まで時間を進めます。
                    予約した仕事や仲間の自主行動は続き、危険や強い空腹があれば途中で止まります。
                    夜の「翌朝まで」は、選んだ住民に睡眠を指示して朝へ進めます。
                    睡眠は最長8時間です。朝8時を迎えた場合も睡眠を終えます。先に起きた後も、共通の時計と他の住民の暮らしは続きます。
                  </p>
                  <p>
                    集落の休み所と木陰の雨よけでは、拠点よりゆっくり体力と元気が戻ります。傷の手当には手当用品を使います。
                    上流の舟宿には寝床があり、4時間以上続けて眠ると傷も休まります。寝る前の食事は自分で指示します。
                    「旅先で眠る」は睡眠の予約です。行動や画面を選んだだけでは時計は進みません。
                  </p>
                  <p>
                    「ゆっくり休む」は短い休憩です。睡眠や休息では満腹度は戻らないので、
                    寝る前に食事をとりましょう。傷が残っている人は、手当用品での手当や、拠点での休養を選べます。
                    読んでいる間や、行動を予約しただけでは時間は進みません。
                  </p>
                </details>
                <h3 className="guide-routes-title">
                  {game.origin ? "旅先から広がる暮らし" : "同じ朝から、四つの過ごし方"}
                </h3>
                <div className="guide-routes">
                  {(game.origin ? SOLO_ROUTES : PLAY_ROUTES).map((route) => (
                    <details key={route.id}>
                      <summary>
                        <span>
                          {route.title}
                          <small>{route.subtitle}</small>
                        </span>
                        <ChevronDown size={16} />
                      </summary>
                      <ol>
                        {route.steps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                    </details>
                  ))}
                </div>
                <button
                  className="primary-button full-width"
                  onClick={() => setModal(null)}
                >
                  わたしの一日を、はじめる
                  <ArrowRight size={16} />
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function PageHeading({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="page-intro other-intro">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}
function Goal({
  complete,
  title,
  desc,
}: {
  complete: boolean;
  title: string;
  desc: string;
}) {
  return (
    <div className={`daily-goal ${complete ? "complete" : ""}`}>
      <span>{complete ? <Check size={13} /> : <span />}</span>
      <div>
        <strong>{title}</strong>
        <p>{complete ? "今日の暮らしに、残りました。" : desc}</p>
      </div>
    </div>
  );
}
