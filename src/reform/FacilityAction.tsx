import { facilityLabel } from "./facilityLabel";
import { furnishings, needLabels, needs, type Need } from "./house";
import { getPreferredBed } from "./housing/bedPreference";
import {
  inspectOrder,
  order,
  type ActionOption,
  type Actor,
  type Game,
} from "./sim";

export type FacilityChoiceKey = Need | "cook" | "cook:hard" | "cook:master";

export function facilityChoiceKey(
  command: ActionOption,
): FacilityChoiceKey | undefined {
  if (command.kind === "need")
    return needs.find((need) => need === command.target);
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
  onSelect,
  onGame,
}: {
  game: Game;
  actor: Actor;
  command: ActionOption;
  selectedId: string;
  onSelect: (id: string) => void;
  onGame: (game: Game) => void;
}) {
  const cooking = command.kind === "work";
  const need = command.target as Need;
  const { rooms } = game.house;
  const fixtures = rooms.flatMap((room) =>
    room.fixtures
      .filter((fixture) =>
        cooking
          ? fixture.kind === "hearth" || fixture.kind === "kitchen"
          : furnishings[fixture.kind].need === need,
      )
      .map((fixture) => ({ room, fixture })),
  );
  const missing =
    selectedId !== "" &&
    !fixtures.some(({ fixture }) => fixture.id === selectedId);
  const explicitNeed = selectedId && !cooking;
  const kind = explicitNeed ? "home-use" : command.kind;
  const target = explicitNeed ? selectedId : command.target;
  const selection =
    cooking && selectedId ? { fixtureId: selectedId } : undefined;
  const preview = missing
    ? { disabled: missingFacility }
    : selectedId
      ? inspectOrder(game, actor.person.id, kind, target, selection)
      : command;
  const { disabled, facility, reserved } = preview;
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
  const food = reserved?.food ?? 0;
  const ingredients = reserved?.ingredients ?? 0;
  const hintId = "lf-order-" + command.kind + "-" + command.target;
  const selectId = hintId + "-facility";

  return (
    <div className="lf-command lf-facility-command">
      <label htmlFor={selectId}>
        {cooking ? command.label + "ため" : needLabels[need]}に使う設備
      </label>
      <select
        id={selectId}
        value={selectedId}
        onChange={(event) => onSelect(event.target.value)}
      >
        <option value="">{automaticLabel}</option>
        {missing && <option value={selectedId}>{missingFacility}</option>}
        {fixtures.map(({ room, fixture }) => (
          <option key={fixture.id} value={fixture.id}>
            {facilityLabel(rooms, room, fixture.kind, fixture.cell)}
          </option>
        ))}
      </select>
      <button
        type="button"
        data-kind={command.kind}
        data-target={command.target}
        disabled={!!disabled}
        aria-describedby={disabled || destinationRoom ? hintId : undefined}
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
      {facility && destinationRoom && (
        <small id={hintId}>
          {facilityLabel(
            rooms,
            destinationRoom,
            facility.fixtureKind,
            facility.fixtureCell,
          )}
          <br />
          {`現在の見込み　移動${facility.moveMinutes}分 ＋ 利用${facility.useMinutes}分（合計${preview.minutes}分）`}
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
