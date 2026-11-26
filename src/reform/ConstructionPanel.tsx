import { useId, useState } from "react";
import { Hammer } from "lucide-react";
import { cellName } from "./house";
import {
  assignConstructionBuild,
  assignConstructionHaul,
  cancelRoomConstruction,
  completeRoomConstruction,
  createRoomConstruction,
  inspectConstructionBuild,
  inspectConstructionCompletion,
  inspectConstructionHaul,
  reclaimConstructionMaterial,
  releaseConstructionWorker,
  reserveConstructionMaterial,
} from "./housing/construction";
import {
  constructionStatus,
  constructionTitle,
} from "./housing/constructionPresentation";
import {
  constructionFloor,
  sourceReturnMaterial,
  unresolvedConstruction,
} from "./housing/constructionTopology";
import {
  constructionWood,
  constructionWorkMinutes,
  type ConstructionResult,
  type RoomConstruction,
} from "./housing/constructionTypes";
import { housingPointLabel, housingStatus } from "./housing/presentation";
import { housingPoint } from "./housing/topology";
import { isStockQuantity, type Game } from "./sim";
import { sameSpatialPoint } from "./spatial/route";

export type RunConstruction = (result: ConstructionResult) => Promise<boolean>;

export function ConstructionAction({
  label,
  disabled,
  hint,
  onClick,
}: {
  label: string;
  disabled?: string;
  hint?: string;
  onClick?: () => void;
}) {
  const id = useId();
  const description = disabled ?? hint;
  return (
    <div className="lf-command">
      <button
        type={onClick ? "button" : "submit"}
        disabled={!!disabled}
        aria-describedby={description ? id : undefined}
        onClick={onClick}
      >
        {label}
      </button>
      {description && <small id={id}>{description}</small>}
    </div>
  );
}

function ConstructionAssignment({
  game,
  plan,
  kind,
  run,
}: {
  game: Game;
  plan: RoomConstruction;
  kind: "build" | "deliver" | "return";
  run: RunConstruction;
}) {
  const [actorId, setActorId] = useState("");
  const choices = game.actors.map((actor) => {
    const { id, name } = actor.person;
    const preview =
      kind === "build"
        ? inspectConstructionBuild(game, plan.id, id)
        : inspectConstructionHaul(game, plan.id, id, kind);
    const reason = preview.ok
      ? undefined
      : actor.task
        ? "進行中の予定があります"
        : actor.location !== game.home
          ? "自宅にいません"
          : preview.disabled;
    return { id, name, preview, reason };
  });
  const chosen = choices.find((c) => c.id === actorId && c.preview.ok);
  const preview = chosen?.preview;
  return (
    <>
      <label>
        {kind === "build"
          ? "施工担当"
          : kind === "deliver"
            ? "搬入担当"
            : "回収担当"}
        <select
          value={chosen?.id ?? ""}
          onChange={(e) => setActorId(e.target.value)}
        >
          <option value="">担当者を選ぶ</option>
          {choices.map(({ id, name, preview, reason }) => (
            <option key={id} value={id} disabled={!preview.ok}>
              {name}
              {reason && "・" + reason}
            </option>
          ))}
        </select>
      </label>
      <ConstructionAction
        label={
          kind === "build"
            ? "施工する"
            : kind === "deliver"
              ? "仮置き場へ運ぶ"
              : "備蓄へ運び戻す"
        }
        disabled={
          chosen
            ? undefined
            : choices.some((c) => c.preview.ok)
              ? "担当者を選んでください。"
              : "担当できる住人がいません。候補欄で理由を確認できます。"
        }
        hint={
          preview
            ? preview.minutes === null
              ? "今の条件では完了までの時間を見積もれません。"
              : "完了までの目安 " + preview.minutes + "分"
            : undefined
        }
        onClick={() => {
          if (!chosen) return;
          void run(
            kind === "build"
              ? assignConstructionBuild(game, plan.id, chosen.id)
              : assignConstructionHaul(game, plan.id, chosen.id, kind),
          );
        }}
      />
    </>
  );
}

export function ConstructionCard({
  game,
  plan,
  run,
}: {
  game: Game;
  plan: RoomConstruction;
  run: RunConstruction;
}) {
  const h = game.housing!;
  const title =
    plan.kind === "insulation" ? constructionTitle(plan) : plan.name;
  const work = plan.assignment && housingStatus(game, plan.assignment.actorId);
  const status = constructionStatus(game, plan.id, work);

  if (!unresolvedConstruction(plan)) {
    return (
      <details className="lf-construction-history">
        <summary>
          {title}・{status.phase}
        </summary>
        <p>{status.detail}</p>
        {plan.material && <p>{status.material}</p>}
      </details>
    );
  }

  const position =
    plan.material && h.state.items[plan.material.itemId]?.position;
  const staging =
    position?.kind === "at" && sameSpatialPoint(position.point, plan.staging);
  const assignmentKind =
    plan.status === "cancelled" ? "return" : staging ? "build" : "deliver";
  const returnAtSource = sourceReturnMaterial(h, plan);
  const completion =
    plan.status === "planned" && status.remainingMinutes === 0
      ? inspectConstructionCompletion(game, plan.id)
      : null;
  return (
    <article className="lf-construction-card" aria-label={title}>
      <h3>{title}</h3>
      <p className="lf-construction-stage">{status.phase}</p>
      <p>{status.detail}</p>
      <dl className="lf-housing-status">
        <div>
          <dt>仮置き場</dt>
          <dd>{housingPointLabel(game, plan.staging)}</dd>
        </div>
        <div>
          <dt>工事用木材</dt>
          <dd>{status.material}</dd>
        </div>
        <div>
          <dt>
            {plan.assignment?.kind === "build"
              ? "施工担当"
              : plan.assignment?.kind === "deliver"
                ? "搬入担当"
                : plan.assignment?.kind === "return"
                  ? "回収担当"
                  : "担当"}
          </dt>
          <dd>{status.worker ?? "未割当"}</dd>
        </div>
        <div>
          <dt>施工済み</dt>
          <dd>{status.workedMinutes}分</dd>
        </div>
        <div>
          <dt>施工の残り</dt>
          <dd>{status.remainingMinutes}分</dd>
        </div>
        {work && (
          <div>
            <dt>
              {work.phase === "cancelling"
                ? "区間を出るまで"
                : "完了までの目安"}
            </dt>
            <dd>
              {work.minutes === null ? "見積もれません" : work.minutes + "分"}
            </dd>
          </div>
        )}
      </dl>
      <div className="lf-construction-actions">
        {work ? (
          <ConstructionAction
            label="担当を外す"
            disabled={
              work.phase === "cancelling"
                ? "区間の終点で担当を外れます。"
                : undefined
            }
            onClick={() => void run(releaseConstructionWorker(game, plan.id))}
          />
        ) : !plan.material ? (
          <ConstructionAction
            label={`木材${plan.requiredWood}を取り置く`}
            disabled={
              game.wood < plan.requiredWood
                ? `共同備蓄に木材${plan.requiredWood}が必要です。`
                : undefined
            }
            onClick={() => void run(reserveConstructionMaterial(game, plan.id))}
          />
        ) : returnAtSource ? (
          <ConstructionAction
            label="供給口の木材を備蓄に戻す"
            disabled={
              isStockQuantity(game.wood + returnAtSource.quantity)
                ? undefined
                : "備蓄に空きがありません。自由備蓄の木材を使ってから、もう一度戻してください。"
            }
            onClick={() => void run(reclaimConstructionMaterial(game, plan.id))}
          />
        ) : completion ? (
          <ConstructionAction
            label="完成を反映する"
            disabled={completion.disabled}
            onClick={() => void run(completeRoomConstruction(game, plan.id))}
          />
        ) : (
          <ConstructionAssignment
            key={assignmentKind}
            game={game}
            plan={plan}
            kind={assignmentKind}
            run={run}
          />
        )}
        {plan.status === "planned" && (
          <ConstructionAction
            label="この工事を取り消す"
            hint={
              plan.material?.state === "present"
                ? "持ち出した木材は、取り消したあとで供給口へ運び戻せます。"
                : undefined
            }
            onClick={() => void run(cancelRoomConstruction(game, plan.id))}
          />
        )}
      </div>
    </article>
  );
}

export function ConstructionPanel({
  game,
  onGame,
}: {
  game: Game;
  onGame: (game: Game) => Promise<boolean> | void;
}) {
  const [name, setName] = useState("");
  const [neighborId, setNeighbor] = useState("");
  const [stagingCell, setStaging] = useState("");
  const [error, setError] = useState("");

  const h = game.housing;
  const neighbor = game.house.rooms.find((room) => room.id === neighborId);
  const cells =
    h && neighbor
      ? Array.from(
          { length: neighbor.width * neighbor.height },
          (_, cell) => cell,
        ).filter((cell) => {
          const point = housingPoint(neighbor.id, cell);
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
    : !name.trim()
      ? "部屋の名前を入力してください。"
      : !neighbor
        ? "接続先を選んでください。"
        : selectedCell === undefined
          ? "供給口と異なる、歩ける仮置き床を選んでください。"
          : undefined;

  const run: RunConstruction = async (result) => {
    setError(result.error ?? "");
    if (result.error) return false;
    return (await onGame(result.game)) !== false;
  };

  return (
    <section
      id="construction-panel"
      className="lf-panel lf-construction"
      aria-label="一室を増築する"
    >
      <div className="lf-section-title">
        <Hammer size={19} aria-hidden="true" />
        <h2>一室を増築する</h2>
      </div>
      <p>
        4 × 3マスの部屋・木材{constructionWood}・施工{constructionWorkMinutes}分
      </p>
      <p>
        自由備蓄の木材 <strong>{game.wood}</strong>
      </p>
      {!h ? (
        <p>
          手帳で「住居の移動を使う暮らしに分岐」を選ぶと、増築を計画できます。
        </p>
      ) : (
        <>
          {error && (
            <p role="alert" className="lf-construction-error">
              {error}
            </p>
          )}
          {active && active.kind !== "insulation" && (
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
              if (disabled || !neighbor || selectedCell === undefined) return;
              if (
                await run(
                  createRoomConstruction(game, {
                    name,
                    neighborId: neighbor.id,
                    stagingCell: selectedCell,
                  }),
                )
              ) {
                setName("");
                setNeighbor("");
                setStaging("");
              }
            }}
          >
            {!active && (
              <>
                <label>
                  増築する部屋の名前
                  <input
                    maxLength={24}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label>
                  接続先
                  <select
                    value={neighbor?.id ?? ""}
                    onChange={(e) => {
                      setNeighbor(e.target.value);
                      setStaging("");
                    }}
                  >
                    <option value="">部屋を選ぶ</option>
                    {game.house.rooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name}
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
                      {neighbor ? "床を選ぶ" : "先に接続先を選ぶ"}
                    </option>
                    {neighbor &&
                      cells.map((cell) => (
                        <option key={cell} value={cell}>
                          {cell === 0 ? "入口" : cellName(neighbor, cell)}
                        </option>
                      ))}
                  </select>
                </label>
              </>
            )}
            <ConstructionAction label="計画する" disabled={disabled} />
          </form>
          {plans
            .reverse()
            .filter(
              (plan) =>
                plan.kind !== "insulation" && !unresolvedConstruction(plan),
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
