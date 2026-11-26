// Run through verify-reform.mjs --guest-gathering to share the isolated browser and report.
import assert from "node:assert/strict";
import { expect } from "@playwright/test";

export async function verifyGuestGathering(
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
    await tab(page, "人物");
    await button(page, "住人を追加").click();
    await page.getByRole("textbox", { name: "名前", exact: true }).fill("ミナ");
    await enter(page);
    const origin = await currentGame(page);
    assert.equal(origin.actors.length, 3);
    const [host, guest, other] = origin.actors.map((actor) => actor.person);
    const choose = async (resident) => {
      await tab(page, "暮らし");
      await button(
        page.getByRole("group", { name: "住民を選ぶ" }),
        resident.name,
      ).click();
    };
    await tab(page, "住まい");
    const editor = page.getByRole("region", { name: "住まいの間取り" });
    await button(editor, "寝室").click();
    await showSection(editor, "室内のマスを編集");
    async function place(kind, coordinates) {
      await editor
        .getByLabel("新しく置く設備", { exact: true })
        .selectOption(kind);
      await button(editor, coordinates + "　床").click();
      await editor
        .getByRole("combobox", { name: new RegExp(coordinates + "の編集") })
        .selectOption("furniture");
      await button(editor, "選んだマスに適用").click();
    }
    await place("table", "2列2行");
    await place("shelf", "4列2行");
    const furnished = await currentGame(page);
    const room = furnished.house.rooms.find((r) => r.id === "bedroom");
    const table = room.fixtures.find((f) => f.kind === "table");
    const shelf = room.fixtures.find((f) => f.kind === "shelf");
    assert.equal(table.cell, 5);
    assert.equal(shelf.cell, 7);
    assert.equal(furnished.time, origin.time);
    await choose(host);
    await showSection(page, "部屋を利用できる住民");
    const access = page.getByRole("group", { name: "寝室", exact: true });
    await access
      .getByRole("checkbox", { name: guest.name, exact: true })
      .uncheck();
    await access
      .getByRole("checkbox", { name: other.name, exact: true })
      .uncheck();
    const baseline = await currentGame(page);
    const policy = baseline.housing.controls.roomAccess;
    assert.deepEqual(policy.bedroom, [host.id]);
    const meeting = page.getByRole("region", { name: "一緒に過ごす" });
    const invitation = meeting.getByRole("combobox", {
      name: "この集まりだけの招待",
      exact: true,
    });
    const start = button(meeting, "集まりを指示する");
    const household = page.getByRole("region", { name: "家の中の移動と設定" });
    const cancel = page
      .getByRole("region", { name: "行動の指示" })
      .getByRole("button", { name: "現在の予定を取り消す", exact: true });
    const withdraw = button(meeting, "この集まりから離れる");
    async function withdrawalHints(text, heldMeals) {
      for (const control of [withdraw, cancel]) {
        await expect(control).toHaveAccessibleDescription(text);
        if (heldMeals) {
          await expect(control).toHaveAccessibleDescription(
            new RegExp("取り置き" + heldMeals + "食"),
          );
        } else {
          await expect(control).not.toHaveAccessibleDescription(
            /取り置き|物が戻ります/,
          );
        }
      }
    }
    const groupOf = (game) => Object.values(game.housing.gatherings ?? {})[0];
    const seats = (game) =>
      Object.values(game.housing.state.reservations).filter(
        (r) =>
          r.kind === "slot" &&
          [0, 1, 2].some(
            (seat) =>
              r.targetId ===
              JSON.stringify(["slot", "bedroom", table.id, seat]),
          ),
      );
    async function prepareMeal() {
      await choose(host);
      await button(
        meeting.getByRole("group", { name: "集まりの種類" }),
        "食事",
      ).click();
      await meeting
        .getByLabel("会場", { exact: true })
        .selectOption(JSON.stringify(["slot", "bedroom", table.id, 0]));
      await meeting
        .getByRole("checkbox", { name: guest.name, exact: true })
        .check();
      await expect(start).toBeDisabled();
      await expect(invitation).toHaveValue("");
      const before = await currentGame(page);
      await invitation.selectOption(JSON.stringify([host.id, guest.id]));
      await expect(start).toBeEnabled();
      assert.deepEqual(await currentGame(page), before);
    }
    async function fixturesDenied() {
      await choose(guest);
      const actions = page.getByRole("region", { name: "行動の指示" });
      await button(actions, "生活").click();
      for (const [need, fixtureId] of [
        ["fun", shelf.id],
        ["energy", "mat-1"],
      ]) {
        const command = actions.locator(
          'button[data-kind="need"][data-target="' + need + '"]',
        );
        const row = command.locator("..");
        await row.getByRole("combobox").selectOption(fixtureId);
        await expect(command).toBeDisabled();
        await expect(row.locator("small")).toContainText("許可");
      }
    }
    await fixturesDenied();
    await prepareMeal();
    const extra = meeting.getByRole("checkbox", {
      name: other.name,
      exact: true,
    });
    await extra.check();
    await expect(start).toBeDisabled();
    await expect(invitation).toHaveCount(0);
    await extra.uncheck();
    if ((await invitation.inputValue()) === "") {
      await invitation.selectOption(JSON.stringify([host.id, guest.id]));
    }
    await expect(start).toBeEnabled();

    // Cancel both ways before the first clock step, so neither meal has been opened.
    for (const departing of [host, guest]) {
      await start.click();
      await choose(other);
      await expect(button(household, "寝室の入口へ移動")).toBeDisabled();
      await choose(departing);
      const isHost = departing.id === host.id;
      await withdrawalHints(
        isHost
          ? new RegExp(guest.name + "もこの集まりから離れます")
          : /招待はここで終わります/,
        isHost ? 2 : 1,
      );
      const aftermath = isHost
        ? /この食事は終了します/
        : new RegExp(host.name + "の食事予定は続きます");
      for (const control of [withdraw, cancel]) {
        await expect(control).toHaveAccessibleDescription(aftermath);
      }
      await (isHost ? withdraw : cancel).click();
      if (departing.id === guest.id) {
        const alone = await currentGame(page);
        assert.equal(alone.food, baseline.food - 1);
        assert.equal(seats(alone).length, 1);
        assert.equal(alone.actors[1].task, null);
        assert.ok(alone.actors[0].task);
        await choose(host);
        await button(meeting, "この集まりから離れる").click();
      }
      const stopped = await currentGame(page);
      assert.equal(groupOf(stopped), undefined);
      assert.equal(seats(stopped).length, 0);
      assert.equal(stopped.food, baseline.food);
      assert.equal(stopped.time, baseline.time);
      assert.deepEqual(stopped.housing.controls.roomAccess, policy);
      await choose(other);
      await prepareMeal();
    }

    // Give the third household member ordinary access; keep the guest excluded throughout the meal.
    await showSection(page, "部屋を利用できる住民");
    await access
      .getByRole("checkbox", { name: other.name, exact: true })
      .check();
    const mealPolicy = (await currentGame(page)).housing.controls.roomAccess;
    assert.deepEqual(new Set(mealPolicy.bedroom), new Set([host.id, other.id]));
    await extra.check();
    await invitation.selectOption(JSON.stringify([host.id, guest.id]));
    await expect(start).toBeEnabled();
    await invitation.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await screenshot(page, "guest-invitation-" + width);
    await start.click();
    const issued = await currentGame(page);
    assert.equal(issued.time, baseline.time);
    assert.equal(issued.food, baseline.food - 3);
    assert.deepEqual(issued.housing.controls.roomAccess, mealPolicy);
    assert.equal(seats(issued).length, 3);
    assert.equal(new Set(groupOf(issued).members.map((m) => m.slotId)).size, 3);
    const guestSeat = groupOf(issued).members.find(
      (m) => m.actorId === guest.id,
    ).slotId;
    const guestSlots = Object.values(issued.housing.state.slots)
      .filter(
        (slot) =>
          JSON.parse(slot.id)[1] === "bedroom" &&
          slot.allowedActorIds?.includes(guest.id),
      )
      .map((slot) => slot.id);
    assert.deepEqual(guestSlots, [guestSeat]);
    await expect(meeting).toContainText("この集まりの招待");
    await expect(meeting).toContainText(host.name);
    await expect(meeting).toContainText(guest.name);
    await page.reload();
    assert.deepEqual(await currentGame(page), issued);
    await button(page, "15分進める").click();
    const shared = await currentGame(page);
    const inProgress = groupOf(shared);
    const members = inProgress.members;
    assert.ok(members.every((m) => m.usedMinutes > 0 && m.usedMinutes < 20));
    assert.ok(members.every((m) => m.togetherMinutes === m.usedMinutes));
    assert.ok(
      members.every(
        (m) =>
          shared.actors.find((a) => a.person.id === m.actorId).room ===
          "bedroom",
      ),
    );
    assert.ok(shared.actors.every((a) => !a.task.reserved.food));
    assert.deepEqual(shared.housing.controls.roomAccess, mealPolicy);
    await page.reload();
    assert.deepEqual(await currentGame(page), shared);
    await choose(guest);
    await expect(meeting).toContainText("利用開始済み");
    await withdrawalHints(/招待はここで終わります/, 0);
    await choose(host);
    await withdrawalHints(
      new RegExp(guest.name + "もこの集まりから離れます"),
      0,
    );
    for (const control of [withdraw, cancel]) {
      await expect(control).toHaveAccessibleDescription(
        new RegExp(other.name + "の食事予定は続きます"),
      );
    }
    await choose(guest);
    await meeting.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await screenshot(page, "guest-meal-" + width);
    for (let i = 0; i < 8 && groupOf(await currentGame(page)); i++) {
      await button(page, "次の行動完了まで進める").click();
    }
    const completed = await currentGame(page);
    assert.equal(groupOf(completed), undefined);
    assert.equal(completed.time - inProgress.startedAt, 20);
    assert.equal(completed.food, issued.food);
    assert.equal(seats(completed).length, 0);
    assert.deepEqual(completed.housing.controls.roomAccess, mealPolicy);
    for (const [resident, peer] of [
      [host, guest],
      [guest, host],
      [host, other],
      [other, host],
      [guest, other],
      [other, guest],
    ]) {
      const memories = completed.actors.find(
        (a) => a.person.id === resident.id,
      ).memories;
      assert.ok(
        memories.some(
          (memory) =>
            memory.gathering?.kind === "meal" &&
            memory.gathering.peerId === peer.id,
        ),
      );
    }
    await fixturesDenied();
    const leave = button(household, "居間の入口へ移動");
    await expect(leave).toBeEnabled();
    await leave.click();
    for (let n = 0; n < 8 && (await currentGame(page)).actors[1].task; n++) {
      await button(page, "次の行動完了まで進める").click();
    }
    const outside = await currentGame(page);
    assert.equal(outside.actors[1].room, "living");
    assert.deepEqual(outside.housing.controls.roomAccess, mealPolicy);
    await expect(button(household, "寝室の入口へ移動")).toBeDisabled();
    await checkLegacy(page);
    report.outcomes.push({
      width,
      initialFood: baseline.food,
      foodReserved: 3,
      foodAfterMeal: completed.food,
      seats: 3,
      mealMinutes: 20,
      issuedAt: issued.time,
      seatedAt: inProgress.startedAt,
      checkedDuringMealAt: shared.time,
      completedAt: completed.time,
      exitedAt: outside.time,
      mealMemoriesAcrossOrderedPairs: 6,
      guestExited: true,
      roomPolicyUnchanged: true,
    });
  } finally {
    await page.context().close();
  }
}
