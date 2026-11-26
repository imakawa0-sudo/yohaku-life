// Run with node scripts/verify-reform.mjs --lodging-maintenance.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { expect } from "@playwright/test";

export async function verifyLodgingMaintenance(
  width,
  {
    fresh,
    makeStart,
    enter,
    currentGame,
    tab,
    button,
    showSection,
    screenshot,
    checkLegacy,
    report,
  },
) {
  const page = await fresh(width);
  try {
    await makeStart(page, "木工の二人");
    await enter(page);
    const origin = await currentGame(page);
    const [provider, tenant] = origin.actors.map((a) => a.person);
    const game = () => currentGame(page);
    const life = page.getByRole("region", { name: "行動の指示" });
    const house = page.getByRole("region", { name: "一室の寒さ対策" });
    const frontDesk = page.getByRole("region", { name: "居室の工事依頼" });
    const room = page.getByRole("group", { name: "寝室", exact: true });
    const card = house.getByRole("article", { name: "「寝室」の寒さ対策" });
    const next = button(page, "次の行動完了まで進める");
    const choose = async (who) => {
      await tab(page, "暮らし");
      await button(
        page.getByRole("group", { name: "住民を選ぶ" }),
        who.name,
      ).click();
    };
    const showDesk = async (who) => {
      await choose(who);
      await showSection(page, "一室の間借り");
    };
    const showPlan = () => tab(page, "住まい");
    const snap = async (locator, name) => {
      await locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await screenshot(page, "lodging-maintenance-" + name + "-" + width);
    };
    const save = async () => {
      await tab(page, "手帳");
      const promise = page.waitForEvent("download");
      await button(page, "保存を書き出す").click();
      return readFile(await (await promise).path());
    };
    const restore = async (buffer) => {
      await tab(page, "手帳");
      await page.getByLabel("新版の保存ファイル").setInputFiles({
        name: "寒さ対策の途中.json",
        mimeType: "application/json",
        buffer,
      });
      await expect(life).toBeVisible();
      assert.deepEqual(await game(), JSON.parse(buffer).slot.game);
    };
    const sleepDenied = async () => {
      await choose(provider);
      await button(life, "生活").click();
      const energy = life.locator(
        'button[data-kind="need"][data-target="energy"]',
      );
      await energy.locator("..").getByRole("combobox").selectOption("mat-1");
      await expect(energy).toBeDisabled();
      await expect(energy.locator("..")).toContainText(/許可|専用/);
    };
    const job = (g) =>
      Object.values(g.housing.construction.plans).find(
        (p) => p.kind === "insulation",
      );
    const board = (g) =>
      g.housing.state.items[job(g).material.itemId]?.position;
    const assignment = (g) => job(g).assignment;
    const displayedTime = (panel, label) =>
      panel.getByText(label, { exact: true }).locator("..").locator("dd");
    const reservations = (g) =>
      Object.values(g.housing.state.reservations).filter(
        (r) =>
          r.actorId === provider.id && r.orderId === assignment(g)?.orderId,
      );
    const ordinaryRights = (g) => {
      assert.deepEqual(g.housing.controls.roomAccess.bedroom, []);
      const bed = Object.values(g.housing.state.slots).find((s) =>
        JSON.parse(s.id).includes("mat-1"),
      );
      assert.ok(bed && !bed.allowedActorIds.includes(provider.id));
    };
    const goTime = async () => {
      await tab(page, "暮らし");
      await expect(next).toBeEnabled();
      await next.click();
      return game();
    };
    // Keep the provider at the shared entrance while the tenant actually moves in.
    await choose(provider);
    await button(life, "仕事").click();
    await life.locator('button[data-kind="work"][data-target="care"]').click();
    await showDesk(provider);
    await page.getByLabel("提供する部屋").selectOption("bedroom");
    await page.getByLabel("入居を申し出る相手").selectOption(tenant.id);
    await button(page, "入居を申し出る").click();
    await showDesk(tenant);
    await button(page, "受けて入居する").click();
    const occupied = await goTime();
    assert.equal(occupied.housing.lodging.phase, "occupied");
    assert.equal(occupied.time - origin.time, 3);
    await choose(provider);
    await button(life, "現在の予定を取り消す").click();
    await showSection(page, "部屋を利用できる住民");
    for (const person of [provider, tenant])
      await room
        .getByRole("checkbox", { name: person.name, exact: true })
        .uncheck();
    ordinaryRights(await game());
    await showSection(page, "暮らしと備蓄の方針");
    await showSection(page, "寝床を使える住人");
    await page
      .getByRole("combobox", { name: "設定する寝床", exact: true })
      .selectOption("mat-1");
    await page
      .getByRole("combobox", { name: "利用できる住人", exact: true })
      .selectOption(tenant.id);
    await button(page, "利用設定を保存").click();
    assert.equal((await game()).housing.bedSleepers["mat-1"], tenant.id);
    await sleepDenied();

    // Use the tenant's link, plan the real floor and send the request in the house view.
    await showDesk(tenant);
    await button(frontDesk, "住まいの寒さ対策を開く").click();
    await house.getByLabel("対策する部屋").selectOption("bedroom");
    await house.getByLabel("仮置き床").selectOption("2");
    await button(house, "寒さ対策を計画する").click();
    const planned = await game();
    assert.equal(planned.wood, origin.wood);
    await button(frontDesk, "提供者に工事を依頼する").click();
    await expect(frontDesk).toContainText("返答待ち");
    await snap(frontDesk, "request");
    await button(frontDesk, provider.name + "に切り替える").click();
    await button(frontDesk, "依頼を引き受ける").click();
    const consent = await game();
    assert.equal(consent.housing.lodging.maintenance.phase, "accepted");
    assert.equal(consent.wood, planned.wood);
    assert.equal(consent.time, planned.time);
    await expect(frontDesk).toContainText("工程");
    await button(card, "木材1を取り置く").click();
    const stocked = await game();
    assert.equal(stocked.wood, planned.wood - 1);
    assert.equal(board(stocked).kind, "at");
    // A simultaneous three-minute loading job gives the clock a real completion inside the doorway.
    await choose(tenant);
    await button(life, "野外").click();
    await life.locator('button[data-kind="pack"][data-target="food"]').click();
    await showPlan();
    await card.getByLabel("搬入担当").selectOption(provider.id);
    const deliver = button(card, "仮置き場へ運ぶ");
    await expect(deliver).toHaveAccessibleDescription(/6分/);
    await deliver.click();
    const booked = await game();
    assert.equal(assignment(booked).lodgingMaintenance, true);
    assert.equal(reservations(booked).length, 1);
    ordinaryRights(booked);
    await snap(card, "delivery");
    const crossing = await goTime();
    assert.equal(crossing.time - booked.time, 3);
    assert.equal(
      crossing.housing.state.actors[provider.id].position.kind,
      "transit",
    );
    assert.deepEqual(board(crossing), {
      kind: "carried",
      carrierId: provider.id,
    });
    const crossingSave = await save();
    await restore(crossingSave);
    // The tenant's real resting floor provides an ordinary movement target deeper inside the room.
    await choose(tenant);
    await button(life, "生活").click();
    const rest = life.locator('button[data-kind="need"][data-target="energy"]');
    await rest.locator("..").getByRole("combobox").selectOption("mat-1");
    await rest.click();
    const staged = await goTime();
    assert.equal(staged.time - booked.time, 6);
    assert.deepEqual(board(staged), { kind: "at", point: job(staged).staging });
    assert.equal(staged.wood, stocked.wood);
    await showPlan();
    await card.getByLabel("施工担当").selectOption(provider.id);
    const build = button(card, "施工する");
    await expect(build).toHaveAccessibleDescription(/30分/);
    await build.click();
    const building = await game();
    assert.equal(reservations(building).length, 1);
    ordinaryRights(building);
    await tab(page, "暮らし");
    await button(page, "5分進める").click();
    const five = await game();
    assert.equal(job(five).workedMinutes, 5);
    await showDesk(tenant);
    await expect(
      button(frontDesk, "依頼を取り下げる"),
    ).toHaveAccessibleDescription(/5分から再開/);
    await snap(frontDesk, "life");
    await button(frontDesk, "依頼を取り下げる").click();
    const stopped = await game();
    assert.equal(assignment(stopped), undefined);
    assert.equal(stopped.wood, stocked.wood);
    assert.deepEqual(board(stopped), board(staged));
    assert.equal(job(stopped).workedMinutes, 5);
    assert.equal(stopped.housing.lodging.maintenance, undefined);
    await page.reload();
    assert.deepEqual(await game(), stopped);
    await showPlan();
    const uncommissioned = card
      .getByLabel("施工担当")
      .getByRole("option", { name: new RegExp(provider.name) });
    await expect(uncommissioned).toBeDisabled();
    await expect(uncommissioned).toContainText("許可");
    await sleepDenied();
    const stoppedSave = await save();
    await choose(provider);
    const interior = stopped.housing.state.actors[tenant.id].position;
    assert.deepEqual(interior, {
      kind: "at",
      point:
        stopped.housing.state.slots[
          JSON.stringify(["slot", "bedroom", "mat-1", 0])
        ].point,
    });
    assert.notDeepEqual(interior.point, job(stopped).staging);
    assert.notEqual(interior.point.cell, 0);
    const houseMoves = page.getByRole("region", { name: "家の中の移動と設定" });
    await showSection(houseMoves, "住民の近くへ移動");
    const deeper = button(houseMoves, tenant.name + "の近くへ移動");
    await expect(deeper).toBeDisabled();
    await expect(deeper).toHaveAccessibleDescription(/入口か室外/);
    await snap(deeper, "restricted-floor");
    const leave = button(houseMoves, "居間の入口へ移動");
    await expect(leave).toBeEnabled();
    await leave.click();
    const outside = await goTime();
    const exitMinutes = outside.time - stopped.time;
    assert.equal(exitMinutes, 5);
    assert.deepEqual(outside.housing.state.actors[provider.id].position, {
      kind: "at",
      point: { domainId: JSON.stringify(["room", "living"]), cell: 0 },
    });
    ordinaryRights(outside);
    await expect(button(houseMoves, "寝室の入口へ移動")).toBeDisabled();
    await expect(deeper).toBeDisabled();
    await sleepDenied();
    await restore(stoppedSave);
    await showDesk(tenant);
    await button(frontDesk, "提供者に工事を依頼する").click();
    await button(frontDesk, provider.name + "に切り替える").click();
    await button(frontDesk, "依頼を引き受ける").click();
    await button(frontDesk, "住まいの寒さ対策を開く").click();
    await card.getByLabel("施工担当").selectOption(provider.id);
    await expect(build).toHaveAccessibleDescription(/25分/);
    await build.click();
    await expect(displayedTime(card, "施工の残り")).toHaveText("25分");
    await expect(displayedTime(card, "完了までの目安")).toHaveText("25分");
    await snap(card, "resume");
    await choose(provider);
    const movement = page.getByRole("region", { name: "家の中の移動と設定" });
    await expect(displayedTime(movement, "施工の残り").first()).toHaveText(
      "25分",
    );
    const eta = displayedTime(movement, "完了までの目安").first();
    await expect(eta).toHaveText("25分");
    await snap(eta, "time");
    // Remove the other actor's unrelated task. The finish button must still see private construction.
    await choose(tenant);
    await button(life, "現在の予定を取り消す").click();
    await expect(next).toBeEnabled();
    const finished = await goTime();
    assert.equal(job(finished).status, "completed");
    assert.equal(job(finished).workedMinutes, 30);
    assert.equal(finished.time - building.time, 30);
    assert.equal(job(finished).material.state, "consumed");
    assert.equal(board(finished), undefined);
    assert.equal(finished.housing.lodging.maintenance, undefined);
    ordinaryRights(finished);
    await sleepDenied();

    await restore(crossingSave);
    await showDesk(tenant);
    const revoke = button(frontDesk, "依頼を取り下げる");
    await expect(revoke).toHaveAccessibleDescription(/区間の終点.*木材を床/);
    await revoke.click();
    const cancelling = await game();
    assert.equal(cancelling.time, crossing.time);
    assert.equal(
      cancelling.housing.state.actors[provider.id].order.phase,
      "exiting-after-cancel",
    );
    assert.equal(cancelling.housing.lodging.maintenance, undefined);
    assert.deepEqual(board(cancelling), board(crossing));
    await showPlan();
    await expect(card).toContainText("区間を出るまで");
    await snap(card, "safe-exit");
    await page.reload();
    assert.deepEqual(await game(), cancelling);
    const dropped = await goTime();
    assert.equal(dropped.time - cancelling.time, 1);
    assert.equal(assignment(dropped), undefined);
    assert.deepEqual(board(dropped), {
      kind: "at",
      point: { domainId: JSON.stringify(["room", "bedroom"]), cell: 0 },
    });
    assert.equal(dropped.wood, stocked.wood);
    await showPlan();
    await button(card, "この工事を取り消す").click();
    const cancelled = await game();
    assert.equal(job(cancelled).status, "cancelled");
    assert.equal(cancelled.wood, stocked.wood);
    assert.deepEqual(board(cancelled), board(dropped));
    await choose(tenant);
    if ((await game()).actors.find((a) => a.person.id === tenant.id).task)
      await button(life, "現在の予定を取り消す").click();
    await showPlan();
    await card.getByLabel("回収担当").selectOption(tenant.id);
    await button(card, "備蓄へ運び戻す").click();
    let returned = await game();
    for (let i = 0; assignment(returned) && i < 8; i++)
      returned = await goTime();
    assert.equal(job(returned).material.state, "returned");
    assert.equal(returned.wood, planned.wood);
    assert.equal(job(returned).workedMinutes, 0);
    await page.reload();
    assert.deepEqual(await game(), returned);
    await checkLegacy(page);
    report.outcomes.push({
      scenario: "lodging-maintenance",
      width,
      haulMinutes: 6,
      workMinutes: 30,
      stoppedAt: 5,
      resumedMinutes: 25,
      safeExitMinutes: 1,
      privateRoomExitMinutes: exitMinutes,
      privateFloorDenied: true,
      woodReturned: returned.wood - stocked.wood,
      ordinaryRoomUsers: returned.housing.controls.roomAccess.bedroom,
      saveReloaded: true,
    });
  } finally {
    await page.context().close();
  }
}
