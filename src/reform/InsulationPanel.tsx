import { useState } from "react";
import { Snowflake } from "lucide-react";
import { cellName } from "./house";
import {
  ConstructionAction,
  ConstructionCard,
  type RunConstruction,
} from "./ConstructionPanel";
import {
  createRoomInsulation,
  isIndoorHousingRoom,
  isRoomInsulated,
} from "./housing/insulation";
import {
  constructionFloor,
  unresolvedConstruction,
} from "./housing/constructionTopology";
import { housingPoint } from "./housing/topology";
import { sameSpatialPoint } from "./spatial/route";
import type { Game } from "./sim";

export function InsulationPanel({
  game,
  onGame,
}: {
  game: Game;
  onGame: (game: Game) => Promise<boolean> | void;
}) {
  const [roomId, setRoom] = useState("");
  const [stagingCell, setStaging] = useState("");
  const [error, setError] = useState("");
  const h = game.housing;
  const rooms = game.house.rooms.filter((room) =>
    isIndoorHousingRoom(game, room.id),
  );
  const room = rooms.find(
    (room) => room.id === roomId && !isRoomInsulated(game, room.id),
  );
  const cells =
    h && room
      ? Array.from(
          { length: room.width * room.height },
          (_, cell) => cell,
        ).filter((cell) => {
          const point = housingPoint(room.id, cell);
          return (
            constructionFloor(h, point) &&
            !sameSpatialPoint(point, housingPoint("living", 0))
          );
        })
      : [];
  const selectedCell = cells.find((cell) => String(cell) === stagingCell);
  const plans = Object.values(h?.construction?.plans ?? {});
  const active = plans.find(unresolvedConstruction);
  const disabled = active
    ? "先の工事を終えるか、取り消した工事の木材を回収してください。"
    : game.insulated
      ? "家全体の寒さ対策が済んでいます。"
      : !room
        ? "未対策の部屋を選んでください。"
        : selectedCell === undefined
          ? "供給口と異なる、歩ける仮置き床を選んでください。"
          : undefined;
  const run: RunConstruction = async (result) => {
    setError(result.error ?? "");
    if (result.error) return false;
    return (await onGame(result.game)) !== false;
  };
  return (
    <section className="lf-panel lf-construction" aria-label="一室の寒さ対策">
      <div className="lf-section-title">
        <Snowflake size={19} aria-hidden="true" />
        <h2>一室の寒さ対策</h2>
      </div>
      <p>木材1・施工30分（移動・搬入は別）。計画は無料です。</p>
      <p>
        初霜以降、実際に対策済みの部屋にいる住人は、寒さによる休息の追加消耗を防げます。裏庭は対象外です。外出中など、その部屋にいない間は効果がありません。
      </p>
      <p>
        自由備蓄の木材 <strong>{game.wood}</strong>
      </p>
      <dl className="lf-housing-status" aria-label="部屋の寒さ対策状況">
        {rooms.map((room) => (
          <div key={room.id}>
            <dt>{room.name}</dt>
            <dd>
              {game.insulated
                ? "家全体で対策済み"
                : isRoomInsulated(game, room.id)
                  ? "対策済み"
                  : "未対策"}
            </dd>
          </div>
        ))}
      </dl>
      {!h ? (
        <p>
          手帳で「住居の移動を使う暮らしに分岐」を選ぶと、寒さ対策を計画できます。
        </p>
      ) : (
        <>
          {error && (
            <p role="alert" className="lf-construction-error">
              {error}
            </p>
          )}
          {active?.kind === "insulation" && (
            <ConstructionCard
              key={active.id}
              game={game}
              plan={active}
              run={run}
            />
          )}
          <form
            className="lf-construction-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (disabled || !room || selectedCell === undefined) return;
              if (
                await run(
                  createRoomInsulation(game, {
                    roomId: room.id,
                    stagingCell: selectedCell,
                  }),
                )
              ) {
                setRoom("");
                setStaging("");
              }
            }}
          >
            {!active && !game.insulated && (
              <>
                <label>
                  対策する部屋
                  <select
                    value={room?.id ?? ""}
                    onChange={(e) => {
                      setRoom(e.target.value);
                      setStaging("");
                    }}
                  >
                    <option value="">部屋を選ぶ</option>
                    {rooms.map((room) => (
                      <option
                        key={room.id}
                        value={room.id}
                        disabled={isRoomInsulated(game, room.id)}
                      >
                        {room.name}
                        {isRoomInsulated(game, room.id) && "・対策済み"}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  仮置き床
                  <select
                    disabled={!cells.length}
                    value={selectedCell ?? ""}
                    onChange={(e) => setStaging(e.target.value)}
                  >
                    <option value="">
                      {room ? "床を選ぶ" : "先に部屋を選ぶ"}
                    </option>
                    {room &&
                      cells.map((cell) => (
                        <option key={cell} value={cell}>
                          {cell === 0 ? "入口" : cellName(room, cell)}
                        </option>
                      ))}
                  </select>
                </label>
              </>
            )}
            <ConstructionAction
              label="寒さ対策を計画する"
              disabled={disabled}
              hint="木材は取り置き時に使います。"
            />
          </form>
          {plans
            .reverse()
            .filter(
              (plan) =>
                plan.kind === "insulation" && !unresolvedConstruction(plan),
            )
            .map((plan) => (
              <ConstructionCard
                key={plan.id}
                game={game}
                plan={plan}
                run={run}
              />
            ))}
        </>
      )}
    </section>
  );
}
