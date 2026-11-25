import { facilityLabel } from "./facilityLabel";
import { furnishings, needLabels, type Need } from "./house";
import { getPreferredBed } from "./housing/bedPreference";
import {
  inspectOrder,
  order,
  type ActionOption,
  type Actor,
  type Game,
} from "./sim";

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
  const need = command.target as Need;
  const { rooms } = game.house;
  const fixtures = rooms.flatMap((room) =>
    room.fixtures
      .filter((fixture) => furnishings[fixture.kind].need === need)
      .map((fixture) => ({ room, fixture })),
  );
  const missing =
    selectedId !== "" &&
    !fixtures.some(({ fixture }) => fixture.id === selectedId);
  const kind = selectedId ? "home-use" : command.kind;
  const target = selectedId || command.target;
  const preview = missing
    ? { disabled: missingFacility }
    : selectedId
      ? inspectOrder(game, actor.person.id, kind, target)
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
  const hintId = "lf-order-need-" + need;
  const selectId = hintId + "-facility";

  return (
    <div className="lf-command lf-facility-command">
      <label htmlFor={selectId}>{needLabels[need]}に使う設備</label>
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
        onClick={() => onGame(order(game, actor.person.id, kind, target))}
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
