export { constructionTitle } from "./constructionTypes";
import { isStockQuantity, type Game } from "../sim";
import { sameSpatialPoint } from "../spatial/route";
import { locateSpatial } from "../spatial/actions";
export { constructionTaskMinutes } from "./constructionProgress";
import { inspectConstructionCompletion } from "./runtime";
import {
  constructionExitText,
  constructionPlan,
  sourceReturnMaterial,
} from "./constructionTopology";
import { housingPointLabel, housingStatus } from "./presentation";
import type { HousingStatus } from "./types";
import { constructionWorkMinutes } from "./constructionTypes";

export function constructionStatus(
  g: Game,
  planId: string,
  workerStatus?: HousingStatus,
): {
  phase: string;
  detail: string;
  material: string;
  worker: string | null;
  workedMinutes: number;
  remainingMinutes: number;
} {
  const h = g.housing,
    plan = constructionPlan(h, planId);
  const empty = {
    phase: "計画なし",
    detail: "工事計画を選んでください。",
    material: "未調達",
    worker: null,
    workedMinutes: 0,
    remainingMinutes: constructionWorkMinutes,
  };
  if (!plan || !h) return empty;
  const wood = "木材" + plan.requiredWood;
  const work = plan.kind === "insulation" ? "寒さ対策" : "増築";
  const assignment = plan.assignment;
  const worker = assignment
    ? g.actors.find((a) => a.person.id === assignment.actorId)!.person.name
    : null;
  let phase = "計画中",
    detail = wood + "を取り置いてください。",
    material = "未調達";
  if (plan.status === "cancelled") {
    phase = "取消済み";
    detail = "工事を取り消しました。";
  }
  if (plan.status === "completed") {
    phase = "完成";
    detail =
      plan.kind === "insulation"
        ? "この部屋の寒さ対策が完成しました。"
        : "「" + plan.name + "」が完成しました。部屋に移動して家具を置けます。";
    material = wood + "・" + work + "に使用済み";
  }
  if (plan.material?.state === "returned")
    material = wood + "・共同備蓄へ返却済み";
  if (plan.material?.state === "present") {
    const pos = h.state.items[plan.material.itemId].position;
    const where = locateSpatial(h.state, {
      kind: "item",
      id: plan.material.itemId,
    });
    const location =
      where.kind === "transit"
        ? housingPointLabel(g, where.step.from) +
          " → " +
          housingPointLabel(g, where.step.to)
        : where.kind === "at"
          ? housingPointLabel(g, where.point)
          : "";
    material =
      wood +
      "・" +
      location +
      (pos.kind === "carried" ? "（" + worker + "が運搬中）" : "");
    if (assignment) {
      const order = h.state.actors[assignment.actorId].order!;
      if (order.phase === "exiting-after-cancel") {
        phase = "担当解除中";
        detail = constructionExitText(h, plan);
      } else if (order.phase === "waiting") {
        phase = "通行待ち";
        detail = (workerStatus ?? housingStatus(g, assignment.actorId)).detail;
      } else if (assignment.kind === "build") {
        phase = order.phase === "use" ? "施工中" : "施工場所へ移動中";
        detail =
          order.phase === "use"
            ? "仮置き場で" + work + "の施工をしています。"
            : "担当者が仮置き場へ向かっています。";
      } else {
        phase = assignment.kind === "deliver" ? "搬入中" : "回収中";
        detail =
          pos.kind === "at"
            ? "担当者が木材を拾いに向かっています。"
            : "担当者が木材を届け先へ運んでいます。";
      }
    } else if (sourceReturnMaterial(h, plan)) {
      phase = "備蓄への返却待ち";
      detail = isStockQuantity(g.wood + plan.material.quantity)
        ? "供給口の木材を備蓄に戻せます。"
        : "供給口に" +
          wood +
          "が残っています。備蓄に空きができたら「供給口の木材を備蓄に戻す」を選んでください。";
    } else if (plan.status === "cancelled") {
      phase = "回収待ち";
      detail = "回収担当を選び、木材を居間の供給口へ戻してください。";
    } else if (plan.workedMinutes === plan.workMinutes) {
      phase = "完成反映待ち";
      detail =
        inspectConstructionCompletion(g, planId).disabled ??
        "「完成を反映する」で工事を完了できます。";
    } else if (pos.kind === "at" && sameSpatialPoint(pos.point, plan.staging)) {
      phase = "仮置き済み";
      detail = plan.workedMinutes
        ? "施工担当を選び直すと、残りの工事を再開できます。"
        : "木材が届きました。施工担当を選べます。";
    } else {
      phase = "搬入待ち";
      detail = "運搬担当を選び、木材を仮置き場へ届けてください。";
    }
  }
  return {
    phase,
    detail,
    material,
    worker,
    workedMinutes: plan.workedMinutes,
    remainingMinutes: plan.workMinutes - plan.workedMinutes,
  };
}
