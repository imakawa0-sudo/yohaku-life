import {
  cellName,
  furnishings,
  needLabels,
  type FixtureKind,
  type Need,
  type Room,
} from "./house";
import {
  inspectOrder,
  order,
  type ActionOption,
  type Actor,
  type Game,
} from "./sim";

const missingFacility = "選んだ設備がありません";

function facilityLabel(
  rooms: Room[],
  room: Room,
  kind: FixtureKind,
  cell: number,
) {
  const sameName = rooms.filter((other) => other.name === room.name);
  const ordinal =
    sameName.length > 1 ? `、同名の${sameName.indexOf(room) + 1}室目` : "";
  return `${room.name}・${furnishings[kind].name}（${cellName(room, cell)}${ordinal}）`;
}

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
        <option value="">自動（移動と利用が短い設備）</option>
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
