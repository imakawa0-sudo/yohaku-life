// Run with verify-reform.mjs --room-lodging on an isolated distributed HTML.
import assert from "node:assert/strict";
import { expect } from "@playwright/test";

export async function verifyRoomLodging(
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
  const read = () => currentGame(page);
  const actions = page.getByRole("region", { name: "行動の指示" });
  const house = page.getByRole("region", { name: "家の中の移動と設定" });
  const lodging = house
    .locator("details")
    .filter({ has: page.locator('summary[aria-label="一室の間借り"]') });
  async function choose(who) {
    await tab(page, "暮らし");
    await button(
      page.getByRole("group", { name: "住民を選ぶ" }),
      who.name,
    ).click();
    await showSection(house, "一室の間借り");
  }
  async function advanceUntil(reached, label) {
    for (let i = 0; i < 30; i++) {
      const state = await read();
      if (reached(state)) return state;
      await button(page, "次の行動完了まで進める").click();
    }
    throw new Error(label + "が制限回数内に完了しませんでした。");
  }
  async function reload(expected) {
    await page.reload();
    assert.deepEqual(await read(), expected);
  }
  async function snapshot(name, game, origin) {
    await tab(page, "手帳");
    await page.getByLabel("新版の保存ファイル").setInputFiles({
      name: name + ".json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          type: "yohaku-reform-save",
          version: 2,
          slot: { id: name, name, game, origin },
        }),
      ),
    });
    await expect(actions).toBeVisible();
    assert.deepEqual(await read(), game);
  }
  try {
    await makeStart(page, "木工の二人");
    await tab(page, "人物");
    await button(page, "住人を追加").click();
    await page.getByRole("textbox", { name: "名前", exact: true }).fill("ミナ");
    await enter(page);
    const origin = await read();
    const [owner, resident, other] = origin.actors.map((a) => a.person);
    assert.equal(origin.actors.length, 3);
    await tab(page, "住まい");
    const editor = page.getByRole("region", { name: "住まいの間取り" });
    await button(editor, "寝室").click();
    await showSection(editor, "室内のマスを編集");
    await editor
      .getByLabel("新しく置く設備", { exact: true })
      .selectOption("table");
    await button(editor, "2列2行　床").click();
    await editor
      .getByRole("combobox", { name: /2列2行の編集/ })
      .selectOption("furniture");
    await button(editor, "選んだマスに適用").click();
    const room = (await read()).house.rooms.find((r) => r.id === "bedroom");
    const table = room.fixtures.find((f) => f.kind === "table");
    assert.equal(table.cell, 5);
    await choose(owner);
    await showSection(house, "部屋を利用できる住民");
    const bedroom = house.getByRole("group", { name: "寝室", exact: true });
    for (const who of [resident, other]) {
      await bedroom
        .getByRole("checkbox", { name: who.name, exact: true })
        .uncheck();
    }
    await showSection(page, "暮らしと備蓄の方針");
    await showSection(page, "寝床を使える住人");
    await page
      .getByRole("combobox", { name: "設定する寝床", exact: true })
      .selectOption("mat-1");
    await page
      .getByRole("combobox", { name: "利用できる住人", exact: true })
      .selectOption(owner.id);
    await button(page, "利用設定を保存").click();
    const policy = (await read()).housing.controls.roomAccess;
    assert.deepEqual(policy.bedroom, [owner.id]);
    async function offer() {
      await choose(owner);
      await lodging
        .getByLabel("提供する部屋", { exact: true })
        .selectOption("bedroom");
      await lodging
        .getByLabel("入居を申し出る相手", { exact: true })
        .selectOption(resident.id);
      await button(lodging, "入居を申し出る").click();
      assert.equal((await read()).housing.lodging.phase, "offered");
    }
    await offer();
    await expect(button(lodging, "受けて入居する")).toHaveCount(0);
    await choose(other);
    await expect(button(lodging, "受けて入居する")).toHaveCount(0);
    await expect(button(lodging, "申し出を取り下げる")).toHaveCount(0);
    await choose(owner);
    await button(lodging, "申し出を取り下げる").click();
    assert.equal((await read()).housing.lodging, undefined);
    await offer();
    const offered = await read();
    await choose(resident);
    await button(lodging, "入居を見送る").click();
    assert.equal((await read()).housing.lodging, undefined);

    // Position the recipient at the living-room window to get a real in-transit save.
    await button(actions, "生活").click();
    const windowOrder = actions.locator(
      'button[data-kind="need"][data-target="fun"]',
    );
    await windowOrder
      .locator("..")
      .getByRole("combobox")
      .selectOption("window-1");
    await windowOrder.click();
    await offer();
    await choose(resident);
    await expect(button(lodging, "受けて入居する")).toBeDisabled();
    await expect(button(lodging, "受けて入居する")).toHaveAccessibleDescription(
      /予定を終え/,
    );
    await button(page, "15分進める").click();
    await actions.locator('button[data-kind="cancel"]').click();
    const beforeAccept = await read();
    assert.equal(beforeAccept.actors[1].task, null);
    await choose(other);
    await button(actions, "仕事").click();
    await actions
      .locator('button[data-kind="work"][data-target="wood"]')
      .click();
    await choose(resident);
    const accept = button(lodging, "受けて入居する");
    await expect(accept).toHaveAccessibleDescription(/入口まで\d+分歩きます/);
    await accept.click();
    const ordered = await read();
    assert.equal(ordered.housing.lodging.phase, "arriving");
    assert.equal(ordered.actors[1].task.kind, "home-move");
    await button(page, "5分進める").click();
    const walking = await read();
    assert.equal(walking.housing.lodging.phase, "arriving");
    assert.equal(
      walking.housing.state.actors[resident.id].position.kind,
      "transit",
    );
    await reload(walking);
    const occupied = await advanceUntil(
      (g) => g.housing.lodging?.phase === "occupied",
      "入居",
    );
    assert.equal(occupied.actors[1].room, "bedroom");
    assert.deepEqual(occupied.housing.controls.roomAccess, policy);
    assert.equal(occupied.housing.lodging.returnTo, "entrance");
    await choose(resident);
    const preference = lodging.getByRole("combobox", {
      name: "帰宅後の行き先",
      exact: true,
    });
    await preference.selectOption("room");
    assert.equal((await read()).housing.lodging.returnTo, "entrance");
    await button(lodging, "帰宅先を保存").click();
    const chosen = await read();
    assert.equal(chosen.housing.lodging.returnTo, "room");
    await reload(chosen);
    await choose(resident);
    await lodging.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await screenshot(page, "lodging-occupied-" + width);
    await button(actions, "生活").click();
    const rest = actions.locator(
      'button[data-kind="need"][data-target="energy"]',
    );
    await rest.locator("..").getByRole("combobox").selectOption("mat-1");
    await expect(rest).toBeDisabled();
    await expect(rest.locator("..").locator("small")).toContainText("専用");
    await choose(other);
    const otherTask = (await read()).actors[2].task;
    if (otherTask) await actions.locator('button[data-kind="cancel"]').click();
    assert.equal((await read()).actors[2].task, null);
    await choose(resident);
    const group = page.getByRole("region", { name: "一緒に過ごす" });
    await button(
      group.getByRole("group", { name: "集まりの種類" }),
      "会話",
    ).click();
    await group
      .getByLabel("会場", { exact: true })
      .selectOption(JSON.stringify(["slot", "bedroom", table.id, 0]));
    await group
      .getByRole("checkbox", { name: other.name, exact: true })
      .check();
    const invite = group.getByLabel("この集まりだけの招待", { exact: true });
    await invite.selectOption(JSON.stringify([resident.id, other.id]));
    await button(group, "集まりを指示する").click();
    const talking = await read();
    const gathering = Object.values(talking.housing.gatherings)[0];
    assert.deepEqual(gathering.invitation, {
      hostId: resident.id,
      guestId: other.id,
    });
    await expect(button(lodging, "退居する")).toBeDisabled();
    const talked = await advanceUntil(
      (g) => !g.housing.gatherings?.[gathering.id],
      "居室での会話",
    );
    assert.ok(
      talked.actors[1].memories.some(
        (m) => m.gathering?.peerId === other.id && m.gathering.kind === "talk",
      ),
    );

    async function packAndVisitLanding(resource) {
      await choose(resident);
      await button(actions, "野外").click();
      await actions
        .locator('button[data-kind="pack"][data-target="' + resource + '"]')
        .click();
      const packed = await advanceUntil(
        (g) => g.actors[1].task?.kind !== "pack",
        "旅の荷物を積む",
      );
      assert.equal(packed.actors[1].cargo[resource], 4);
      await tab(page, "地域");
      await page.getByLabel(/行動する人/).selectOption(resident.id);
      await button(page, "柳の渡し").click();
      await page.getByRole("button", { name: /柳の渡しへ移動する/ }).click();
      await choose(resident);
      return advanceUntil(
        (g) => g.actors[1].location === "landing" && !g.actors[1].task,
        "柳の渡しまでの旅",
      );
    }
    const away = await packAndVisitLanding("coins");
    await reload(away);
    async function returnHome() {
      await choose(resident);
      await button(actions, "野外").click();
      await actions.locator('button[data-kind="return"]').click();
      assert.equal((await read()).actors[1].task.kind, "return");
      let prior = await read();
      for (let i = 0; i < 30; i++) {
        await button(page, "次の行動完了まで進める").click();
        const next = await read();
        if (
          next.actors[1].location === next.home &&
          next.actors[1].task?.kind !== "return"
        ) {
          assert.equal(prior.actors[1].cargo.coins, 4);
          assert.equal(next.actors[1].cargo.coins, 0);
          assert.equal(next.coins, prior.coins + 4);
          return next;
        }
        prior = next;
      }
      throw new Error("地域から帰宅できませんでした。");
    }
    const entrance = await returnHome();
    assert.equal(entrance.actors[1].room, "living");
    assert.equal(entrance.actors[1].task.kind, "home-move");
    assert.equal(entrance.actors[1].task.mode, "auto");
    await reload(entrance);
    await choose(resident);
    await expect(lodging).toContainText("帰宅後に居室へ移動中");
    await lodging.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await screenshot(page, "lodging-homecoming-" + width);
    const inside = await advanceUntil(
      (g) => g.actors[1].room === "bedroom" && !g.actors[1].task,
      "帰宅後の自室への移動",
    );
    assert.equal(inside.time - entrance.time, 3);
    assert.equal(inside.coins, entrance.coins);
    assert.equal(inside.actors[1].cargo.coins, 0);
    await button(lodging, "退居する").click();
    const departing = await read();
    assert.equal(departing.housing.lodging.phase, "leaving");
    const gone = await advanceUntil(
      (g) => !g.housing.lodging,
      "共用玄関への退居",
    );
    assert.equal(gone.actors[1].room, "living");
    assert.equal(gone.time - departing.time, 3);
    assert.deepEqual(gone.housing.controls.roomAccess, policy);
    await expect(button(house, "寝室の入口へ移動")).toBeDisabled();
    await reload(gone);

    if (width === 1280) {
      // Replay the unmodified trip through a door closed by its provider before arrival.
      await snapshot("閉じた帰宅路", away, origin);
      await choose(owner);
      await showSection(house, "通路と扉");
      await house
        .getByRole("button", {
          name: /居間と寝室の通路を閉める|寝室と居間の通路を閉める/,
        })
        .click();
      const blocked = await returnHome();
      assert.equal(blocked.actors[1].room, "living");
      assert.equal(blocked.actors[1].task, null);
      assert.equal(blocked.housing.lodging.phase, "occupied");
      await reload(blocked);
      // Reuse actual resident, luggage, regional journey and approach; vary only the shared stock on arrival.
      await snapshot("木材を積む前の入居者", talked, origin);
      await packAndVisitLanding("wood");
      await choose(resident);
      await button(actions, "野外").click();
      await actions.locator('button[data-kind="return"]').click();
      let approach = await read();
      while (
        approach.actors[1].task?.kind === "return" &&
        approach.actors[1].task.remaining > 5
      ) {
        await button(page, "5分進める").click();
        approach = await read();
      }
      assert.equal(approach.actors[1].task.kind, "return");
      assert.equal(approach.actors[1].cargo.wood, 4);
      const limit = 1_000_000_000;
      const nearlyFull = structuredClone(approach);
      nearlyFull.wood = limit - 2;
      await snapshot("共有木材に二つだけ空きがある帰路", nearlyFull, origin);
      const partlyUnloaded = await advanceUntil(
        (g) =>
          g.actors[1].task?.kind === "home-move" &&
          g.actors[1].room === "living",
        "木材を積んだ入居者の帰宅",
      );
      assert.equal(partlyUnloaded.wood, limit);
      assert.equal(partlyUnloaded.actors[1].cargo.wood, 2);
      await reload(partlyUnloaded);
      const atRoom = await advanceUntil(
        (g) => !g.actors[1].task && g.actors[1].room === "bedroom",
        "残荷を持ったまま自室へ移動",
      );
      assert.equal(atRoom.wood, limit);
      assert.equal(atRoom.actors[1].cargo.wood, 2);
      await reload(atRoom);
      await choose(resident);
      await button(actions, "野外").click();
      const unload = actions.locator(
        'button[data-kind="unpack"][data-target="wood"]',
      );
      await expect(unload).toBeDisabled();
      await expect(unload).toHaveAccessibleDescription(/空き/);
      await tab(page, "住まい");
      await button(editor, "居間").click();
      await editor
        .getByLabel("新しく置く設備", { exact: true })
        .selectOption("bath");
      await button(editor, "この部屋に置く").click();
      const space = await read();
      assert.equal(space.wood, limit - 8);
      assert.equal(space.actors[1].cargo.wood, 2);
      await choose(resident);
      await button(actions, "野外").click();
      await unload.click();
      const stowed = await advanceUntil(
        (g) => g.actors[1].task?.kind !== "unpack",
        "残荷二つの手動荷下ろし",
      );
      assert.equal(stowed.wood, space.wood + 2);
      assert.equal(stowed.actors[1].cargo.wood, 0);
      await reload(stowed);
      report.checks.push(
        "通常の地域帰宅の直前に共有木材だけを上限−2へ変更し、実際に運んだ木材4のうち2だけを荷下ろし。居室で残荷2を保持し、再読込・満杯拒否を経て、浴槽に木材8を用いてから残り2だけを手で納めた。",
      );

      const cargoNearlyFull = structuredClone(chosen);
      cargoNearlyFull.actors[1].cargo.wood = limit - 2;
      await snapshot(
        "携行木材に二つだけ空きがある入居者",
        cargoNearlyFull,
        origin,
      );
      await choose(resident);
      await button(actions, "野外").click();
      const packing = actions.locator(
        'button[data-kind="pack"][data-target="wood"]',
      );
      await expect(packing).toBeDisabled();
      await expect(packing).toHaveAccessibleDescription(/空き/);
      assert.deepEqual(await read(), cargoNearlyFull);
      report.checks.push(
        "木材4を積む前に携行分に2だけ空きがある条件も、共同備蓄を予約する前に理由を表示した。",
      );

      const hurt = structuredClone(offered);
      hurt.actors[1].injury = 75;
      await snapshot("重傷で承諾ができないとき", hurt, origin);
      await choose(resident);
      await expect(button(lodging, "受けて入居する")).toBeDisabled();
      assert.deepEqual(await read(), hurt);
      const old = structuredClone(origin);
      delete old.housing;
      await snapshot("住居の移動以前の暮らし", old, old);
      await expect(
        page.locator('summary[aria-label="一室の間借り"]'),
      ).toHaveCount(0);
      await reload(old);
      report.checks.push(
        "再現用の保存で、帰宅路閉鎖時は銀貨を一度下ろして玄関で停止、重傷75時は承諾不可、空間住居以前の世帯は入居情報なしで読み込めた。",
      );
    }
    await checkLegacy(page);
    report.outcomes.push({
      width,
      offeredAt: offered.time,
      acceptedAt: ordered.time,
      occupiedAt: occupied.time,
      guestHostedByTenant: true,
      regionalArrivalAt: entrance.time,
      roomArrivalAt: inside.time,
      departureCompletedAt: gone.time,
      coinsReturned: 4,
      returnWalkMinutes: inside.time - entrance.time,
      policyKept: true,
    });
  } finally {
    await page.context().close();
  }
}
