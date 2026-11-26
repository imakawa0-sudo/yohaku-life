import { bedChoiceLabel, facilityLabel } from "./facilityLabel";
import {
  furnishings,
  isBasicWoodwork,
  needLabels,
  needs,
  type Need,
} from "./house";
import { foodBundleStatus } from "./housing/foodPresentation";
import { bedProtectionPreview } from "./housing/coldProtection";
import { getPreferredBed } from "./housing/bedPreference";
import {
  inspectOrder,
  order,
  type ActionOption,
  type Actor,
  type Game,
} from "./sim";

export type FacilityChoiceKey =
  Need | "cook" | "cook:hard" | "cook:master" | "wood" | "recover";

export function facilityChoiceKey(
  command: ActionOption,
): FacilityChoiceKey | undefined {
  if (command.kind === "recover") return "recover";
  if (command.kind === "need")
    return needs.find((need) => need === command.target);
  if (command.kind === "work" && isBasicWoodwork(command.target)) return "wood";
  if (
    command.kind === "work" &&
    (command.target === "cook" ||
      command.target === "cook:hard" ||
      command.target === "cook:master")
  )
    return command.target;
}

const missingFacility = "選んだ設備がありません";

export function FacilityAction({
  game,
  actor,
  command,
  selectedId,
  selectedBundleId = "",
  onSelectBundle,
  onSelect,
  onGame,
}: {
  game: Game;
  actor: Actor;
  command: ActionOption;
  selectedId: string;
  selectedBundleId?: string;
  onSelectBundle?: (id: string) => void;
  onSelect: (id: string) => void;
  onGame: (game: Game) => void;
}) {
  const recovery = command.kind === "recover";
  const isWork = command.kind === "work";
  const woodworking = isWork && isBasicWoodwork(command.target);
  const cooking = isWork && !woodworking;
  const basicCooking =
    cooking && ["cook", "cook:easy"].includes(command.target!);
  const bundle = basicCooking ? foodBundleStatus(game) : null;
  const selectedBundle = basicCooking ? selectedBundleId : "";
  const currentBundle = bundle?.state === "present" ? bundle : null;
  const staleBundle =
    !!selectedBundle && selectedBundle !== currentBundle?.bundleId;
  const need = recovery ? "energy" : (command.target as Need);
  const { rooms } = game.house;
  const fixtures = rooms.flatMap((room) =>
    room.fixtures
      .filter((fixture) =>
        cooking
          ? fixture.kind === "hearth" || fixture.kind === "kitchen"
          : woodworking
            ? fixture.kind === "workbench"
            : furnishings[fixture.kind].need === need,
      )
      .map((fixture) => ({ room, fixture })),
  );
  const missing =
    selectedId !== "" &&
    !fixtures.some(({ fixture }) => fixture.id === selectedId);
  const explicitNeed = selectedId && command.kind === "need";
  const kind = explicitNeed ? "home-use" : command.kind;
  const target = explicitNeed ? selectedId : command.target;
  const selection =
    (isWork || recovery) && selectedId
      ? {
          fixtureId: selectedId,
          ...(selectedBundle && { bundleId: selectedBundle }),
        }
      : undefined;
  const preview = staleBundle
    ? { disabled: "選んだ食材の一束がありません。" }
    : selectedBundle && !selectedId
      ? { disabled: "料理に使う設備を指定してください。" }
      : missing
        ? { disabled: missingFacility }
        : selectedId
          ? inspectOrder(game, actor.person.id, kind, target, selection)
          : command;
  const { disabled, facility, reserved, foodBundle } = preview;
  const destinationRoom =
    facility && rooms.find((room) => room.id === facility.roomId);
  const bedPreference = selectedId ? undefined : facility?.bedPreference;
  const fallback =
    bedPreference?.outcome === "fallback" ? bedPreference : undefined;
  const preferredBed =
    fallback &&
    fixtures.find(({ fixture }) => fixture.id === fallback.fixtureId);
  const automaticLabel =
    need === "energy" && getPreferredBed(game, actor.person.id)
      ? "自動（優先する寝床を考慮）"
      : "自動（移動と利用が短い設備）";
  const fixedActivity = recovery ? "療養" : woodworking ? "木工" : undefined;
  const inPlace =
    fixedActivity && !selectedId && !disabled && preview.minutes !== undefined;
  const food = reserved?.food ?? 0;
  const ingredients = reserved?.ingredients ?? 0;
  const hintId =
    "lf-order-" + command.kind + (command.target ? "-" + command.target : "");
  const selectId = hintId + "-facility";

  return (
    <div className="lf-command lf-facility-command">
      {basicCooking && (
        <fieldset className="lf-material-choice">
          <legend>材料を選ぶ</legend>
          <label>
            <input
              type="radio"
              name={hintId + "-material"}
              value=""
              checked={!selectedBundle}
              onChange={() => onSelectBundle?.("")}
            />
            共同備蓄（食材{game.ingredients}）
          </label>
          {currentBundle && (
            <label>
              <input
                type="radio"
                name={hintId + "-material"}
                value={currentBundle.bundleId}
                checked={selectedBundle === currentBundle.bundleId}
                onChange={() => onSelectBundle?.(currentBundle.bundleId)}
              />
              野菜の一束（食材2） · {currentBundle.location} ·{" "}
              {currentBundle.phase}
            </label>
          )}
          {staleBundle && (
            <label>
              <input
                type="radio"
                name={hintId + "-material"}
                value={selectedBundle}
                checked={true}
                onChange={() => onSelectBundle?.(selectedBundle)}
              />
              選んだ食材の一束がありません
            </label>
          )}
          {!currentBundle && !staleBundle && (
            <span>現物の一束はありません。「住まい」で取り分けられます。</span>
          )}
        </fieldset>
      )}
      <label htmlFor={selectId}>
        {recovery
          ? "傷を休める場所"
          : woodworking
            ? "木材を整える場所"
            : (cooking ? command.label + "ため" : needLabels[need]) +
              "に使う設備"}
      </label>
      <select
        id={selectId}
        value={selectedId}
        onChange={(event) => onSelect(event.target.value)}
      >
        <option value="">
          {recovery
            ? "今いる場所で休む"
            : woodworking
              ? "今いる場所で作業する"
              : selectedBundle
                ? "設備を選ぶ"
                : automaticLabel}
        </option>
        {missing && <option value={selectedId}>{missingFacility}</option>}
        {fixtures.map(({ room, fixture }) => (
          <option key={fixture.id} value={fixture.id}>
            {need === "energy"
              ? bedChoiceLabel(game, room, fixture)
              : facilityLabel(rooms, room, fixture.kind, fixture.cell)}
          </option>
        ))}
      </select>
      <button
        type="button"
        data-kind={command.kind}
        data-target={command.target}
        disabled={!!disabled}
        aria-describedby={
          disabled || destinationRoom || inPlace ? hintId : undefined
        }
        onClick={() =>
          onGame(order(game, actor.person.id, kind, target, selection))
        }
      >
        {command.label}
      </button>
      {disabled && (
        <small id={hintId} role="status">
          {disabled}
        </small>
      )}
      {inPlace && (
        <small id={hintId}>
          移動なし · {fixedActivity}
          {preview.minutes}分
        </small>
      )}
      {facility && destinationRoom && (
        <small id={hintId}>
          {facilityLabel(
            rooms,
            destinationRoom,
            facility.fixtureKind,
            facility.fixtureCell,
          )}
          <br />
          {foodBundle ? (
            <>
              食材の所在　{foodBundle.location}
              <br />
              {foodBundle.transportMinutes > 0
                ? `食材を拾い、運ぶ見込み${foodBundle.transportMinutes}分 ＋ 料理${facility.useMinutes}分（合計${preview.minutes}分）`
                : `食材は設備の使用床にあります（運搬不要）。本人の移動${facility.moveMinutes}分 ＋ 料理${facility.useMinutes}分（合計${preview.minutes}分）`}
            </>
          ) : fixedActivity ? (
            `移動${facility.moveMinutes}分 ＋ ${fixedActivity}${facility.useMinutes}分（合計${preview.minutes}分）`
          ) : (
            `現在の見込み　移動${facility.moveMinutes}分 ＋ 利用${facility.useMinutes}分（合計${preview.minutes}分）`
          )}
          {need === "energy" && !recovery && (
            <>
              <br />
              {bedProtectionPreview(game, destinationRoom.id)}
            </>
          )}
          {bedPreference?.outcome === "preferred" && (
            <>
              <br />
              優先する寝床を使う見込みです。
            </>
          )}
          {fallback && preferredBed && (
            <>
              <br />
              優先する寝床　
              {facilityLabel(
                rooms,
                preferredBed.room,
                preferredBed.fixture.kind,
                preferredBed.fixture.cell,
              )}
              <br />
              {fallback.reason}
              <br />
              別の寝床を使う見込みです。
            </>
          )}
          {ingredients > 0 && (
            <>
              <br />
              取り置き 食材{ingredients}
            </>
          )}
          {food > 0 && (
            <>
              <br />
              取り置き 食事{food}
            </>
          )}
        </small>
      )}
    </div>
  );
}
