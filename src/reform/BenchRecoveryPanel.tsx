import { useState } from "react";
import { Hammer } from "lucide-react";
import { ConstructionAction } from "./ConstructionPanel";
import { residentLabel } from "./displayNames";
import { facilityLabel } from "./facilityLabel";
import {
  benchBoardId,
  benchRecoveryMinutes,
  cancelBenchRecovery,
  inspectBenchRecovery,
  inspectBenchReturn,
  reclaimBenchBoard,
  returnBenchBoard,
  startBenchRecovery,
} from "./housing/benchRecovery";
import { housingPointLabel, housingStatus } from "./housing/presentation";
import { housingPoint } from "./housing/topology";
import { sameSpatialPoint } from "./spatial/route";
import { isStockQuantity, type Game } from "./sim";

export function BenchRecoveryPanel({
  game,
  onGame,
}: {
  game: Game;
  onGame: (game: Game) => Promise<boolean> | void;
}) {
  const [fixtureId, setFixture] = useState("");
  const [actorId, setActor] = useState("");
  const [error, setError] = useState("");
  const h = game.housing;
  if (!h) return null;

  const { rooms } = game.house;
  const benches = rooms.flatMap((room) =>
    room.fixtures
      .filter((f) => f.kind === "workbench")
      .map((fixture) => ({ room, fixture })),
  );
  const recovery = h.benchRecovery;
  const room = rooms.find((room) => room.id === recovery?.roomId);
  const selected = benches.find(({ fixture }) => fixture.id === fixtureId);
  const returning = recovery?.phase === "board";
  const board = recovery && h.state.items[benchBoardId(recovery.fixtureId)];
  const atSupply =
    board?.position.kind === "at" &&
    sameSpatialPoint(board.position.point, housingPoint("living", 0));
  const worker = game.actors.find(
    (actor) => actor.person.id === recovery?.assignment?.actorId,
  );
  const status = worker && housingStatus(game, worker.person.id);
  const chooseWorker =
    !worker && !atSupply && (returning || (!recovery && benches.length > 0));
  const preview =
    chooseWorker && actorId
      ? returning
        ? inspectBenchReturn(game, recovery.fixtureId, actorId)
        : selected && inspectBenchRecovery(game, selected.fixture.id, actorId)
      : undefined;
  const disabled =
    !returning && !selected
      ? "木工台を選んでください。"
      : !actorId
        ? "担当する住人を選んでください。"
        : preview?.disabled;

  async function apply(result: ReturnType<typeof startBenchRecovery>) {
    setError(result.error ?? "");
    if (result.error) return;
    if ((await onGame(result.game)) !== false) {
      setActor("");
      setFixture("");
    }
  }

  return (
    <details className="yh-house-edit">
      <summary>
        <Hammer size={16} aria-hidden="true" />
        木工台の解体と回収
      </summary>
      <p>
        木工台まで移動し、{benchRecoveryMinutes}
        分かけて解体します。解体した台はなくなり、設置場所に木材1が残ります。居間の入口へ運び戻すと共同備蓄に加わります。
      </p>
      <p>
        共同備蓄の木材 <strong>{game.wood}</strong>
      </p>
      {error && (
        <p role="alert" className="yh-house-error">
          {error}
        </p>
      )}
      {recovery && room && (
        <>
          <p>
            {facilityLabel(rooms, room, "workbench", recovery.cell)} ·{" "}
            {returning ? "解体済み" : "解体の作業中"}
          </p>
          {board && (
            <p>
              {"回収材の所在　"}
              {board.position.kind === "at"
                ? housingPointLabel(game, board.position.point)
                : worker && status
                  ? residentLabel(game, worker) +
                    "の手元（" +
                    status.location +
                    "）"
                  : "運搬中"}
            </p>
          )}
        </>
      )}
      {!recovery && !benches.length && <p>設置済みの木工台はありません。</p>}
      {chooseWorker && (
        <div className="yh-house-controls">
          {!recovery && (
            <label>
              解体する木工台
              <select
                value={selected?.fixture.id ?? ""}
                onChange={(e) => {
                  setFixture(e.target.value);
                  setError("");
                }}
              >
                <option value="">木工台を選ぶ</option>
                {benches.map(({ room, fixture }) => (
                  <option key={fixture.id} value={fixture.id}>
                    {facilityLabel(rooms, room, fixture.kind, fixture.cell)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            {returning ? "回収担当" : "解体担当"}
            <select
              value={actorId}
              onChange={(e) => {
                setActor(e.target.value);
                setError("");
              }}
            >
              <option value="">担当者を選ぶ</option>
              {game.actors.map((actor) => (
                <option key={actor.person.id} value={actor.person.id}>
                  {residentLabel(game, actor)}
                </option>
              ))}
            </select>
          </label>
          <ConstructionAction
            label={
              returning ? "回収材を供給口へ運ぶ" : "この木工台の解体を始める"
            }
            disabled={disabled}
            hint={
              !preview
                ? undefined
                : preview.minutes === null
                  ? "現在の通行条件では完了までの時間を見積もれません。"
                  : returning
                    ? `回収材を拾い、居間の入口まで運ぶ見込み　${preview.minutes}分`
                    : `移動${preview.minutes - benchRecoveryMinutes}分 ＋ 解体${benchRecoveryMinutes}分（合計${preview.minutes}分）`
            }
            onClick={() => {
              if (disabled) return;
              if (returning)
                void apply(returnBenchBoard(game, recovery.fixtureId, actorId));
              else if (selected)
                void apply(
                  startBenchRecovery(game, selected.fixture.id, actorId),
                );
            }}
          />
        </div>
      )}
      {recovery && worker && status && (
        <>
          <p>
            {residentLabel(game, worker)} · {status.location} · {status.detail}
          </p>
          {status.minutes !== null && (
            <p>
              {status.phase === "cancelling"
                ? "区間を出るまで"
                : "完了までの目安"}{" "}
              {status.minutes}分
            </p>
          )}
          <ConstructionAction
            label={returning ? "運搬を中止する" : "解体を中止する"}
            disabled={
              status.phase === "cancelling"
                ? "移動中の区間を出てから担当を外れます。"
                : undefined
            }
            hint={
              returning
                ? "回収材は床に残り、あとで運び直せます。"
                : "木工台は残ります。再開時は最初から解体します。"
            }
            onClick={() =>
              void apply(cancelBenchRecovery(game, recovery.fixtureId))
            }
          />
        </>
      )}
      {recovery && !worker && atSupply && (
        <ConstructionAction
          label="供給口の回収材を備蓄へ戻す"
          disabled={
            isStockQuantity(game.wood + 1)
              ? undefined
              : "備蓄に空きがありません。木材を1以上使うと、供給口の木材を戻せます。"
          }
          onClick={() =>
            void apply(reclaimBenchBoard(game, recovery.fixtureId))
          }
        />
      )}
    </details>
  );
}
