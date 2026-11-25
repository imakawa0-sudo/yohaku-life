/**
 * Research only: resume the already-recorded 21:33 public-preset save.
 * Prepared without execution. Run only after the parent confirms core review.
 * No product edits, UI operations, git operations, or external writes.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { advance, inspectOrder, order, isGame, type Game } from '@reform/sim';
import { importSlot, exportSlot, branchSlot, type Slot } from '@reform/library';
import { furnishings } from '@reform/house';
import { housingSlotId } from '@reform/housing/topology';
import { getPreferredBed, setPreferredBed } from '@reform/housing/bedPreference';

const EXPECTED = {
  start: '9baf1239b4a921ad35d2ccd3879c32f8f1f8ec18876f56b39da6a2e9caf33819',
  origin: '6fe6b179c23ad2a78bc1787517614df73e2004f9d0120599097fc7137f21d491',
  morning: 'b23af85ab72300b0424bf6bc5d557a5330b9dfc8eda6167c7c7ea5a63ee01bff',
  startTime: 1293,
  endTime: 1920,
};

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  assert.ok(index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--'), `Required argument: ${name}`);
  return resolve(process.argv[index + 1]);
}
const inputPath = argument('--input');
const outputDir = argument('--out');
const repoPath = argument('--repo');
mkdirSync(outputDir, { recursive: true });

const stable = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clock = (time: number) => `D${Math.floor(time / 1440) + 1} ${String(Math.floor(time / 60) % 24).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}`;
const actor = (game: Game, id: string) => { const a = game.actors.find(a => a.person.id === id); assert.ok(a, id); return a; };
const stocks = (game: Game) => ({ wood: game.wood, food: game.food, ingredients: game.ingredients, coins: game.coins });
const position = (game: Game, id: string) => stable(game.housing!.state.actors[id]?.position ?? game.housing!.unlocated[id]);
const isRest = (task: any) => task?.kind === 'need' && task?.target === 'energy';
const restKey = (task: any) => isRest(task) ? task.spatial?.orderId ?? `${task.kind}:${task.target}:${task.total}` : null;

function bedFixtures(game: Game) {
  return game.house.rooms.flatMap(room => room.fixtures
    .filter(f => f.kind === 'mat' || f.kind === 'bed')
    .map(f => ({ fixtureId: f.id, roomId: room.id, fixtureCell: f.cell, kind: f.kind })));
}
function fixtureForTask(game: Game, task: any): string | null {
  for (const room of game.house.rooms) for (const fixture of room.fixtures) {
    for (let seat = 0; seat < furnishings[fixture.kind].seats; seat++) {
      if (housingSlotId(room.id, fixture.id, seat) === task?.station) return fixture.id;
    }
  }
  return null;
}
function bookingOwners(game: Game, fixtureId: string): string[] {
  const fixture = bedFixtures(game).find(f => f.fixtureId === fixtureId);
  if (!fixture) return [];
  const station = housingSlotId(fixture.roomId, fixtureId, 0);
  return Object.values(game.housing!.state.reservations)
    .filter(r => r.kind === 'slot' && r.targetId === station).map(r => r.actorId);
}
function inspect(game: Game, id: string, kind: string, target?: string) {
  const before = hash(game);
  const result = inspectOrder(game, id, kind, target);
  assert.equal(hash(game), before, 'Inspection mutated its input');
  return result;
}
function withoutPreferences(game: Game): Game {
  return game.actors.reduce((copy, a) => setPreferredBed(copy, a.person.id, null), structuredClone(game));
}
function assertOnlyPreferencesChanged(before: Game, after: Game) {
  assert.deepEqual(stable(withoutPreferences(after)), stable(withoutPreferences(before)));
  assert.deepEqual(after.actors, before.actors);
  assert.equal(after.time, before.time);
  assert.equal(after.rng, before.rng);
  assert.deepEqual(stocks(after), stocks(before));
  assert.deepEqual(after.housing!.state, before.housing!.state);
  assert.ok(isGame(after));
}
function runMinutes(game: Game, minutes: number): Game {
  const result = advance(game, minutes);
  assert.equal(result.time, game.time + minutes);
  assert.ok(isGame(result));
  return result;
}
function snapshot(game: Game) {
  return {
    time: game.time, clock: clock(game.time), stock: stocks(game), rng: game.rng,
    actors: game.actors.map(a => ({
      id: a.person.id, name: a.person.name, preferredBed: getPreferredBed(game, a.person.id) ?? null,
      position: position(game, a.person.id), task: stable(a.task), needs: stable(a.needs),
      metrics: stable(a.metrics), reason: a.reason, memories: stable(a.memories),
    })),
    reservations: stable(game.housing!.state.reservations),
  };
}
function savedRoundTrip(slot: Slot, game: Game) {
  const loaded = importSlot(exportSlot({ ...slot, game }));
  assert.deepEqual(stable(loaded.game), stable(game));
  assert.deepEqual(stable(loaded.origin), stable(slot.origin));
  assert.equal(hash(loaded.origin), EXPECTED.origin);
  return { time: game.time, gameHash: hash(game), originHash: hash(loaded.origin), gameEqual: true, originEqual: true };
}

/** Records only rest episodes and controls, without duplicating the original daily schedule. */
class RestTrace {
  game: Game;
  slot: Slot;
  rests: any[] = [];
  orders: any[] = [];
  events: any[] = [];
  active = new Map<string, any>();
  constructor(slot: Slot) { this.slot = slot; this.game = slot.game; }

  start(id: string, before: Game, after: Game, source: string) {
    const actualTask = actor(after, id).task!;
    const preferred = getPreferredBed(before, id);
    const selected = fixtureForTask(after, actualTask);
    assert.ok(selected, 'Rest did not bind to a known fixture');
    const candidates = bedFixtures(before).map(f => ({
      ...f, previewAtMinuteStart: inspect(before, id, 'home-use', f.fixtureId),
      reservationOwnersAtMinuteStart: bookingOwners(before, f.fixtureId),
      reservationOwnersAfterSelection: bookingOwners(after, f.fixtureId),
    }));
    const preferredCandidate = candidates.find(f => f.fixtureId === preferred);
    const reservedByOther = preferredCandidate?.reservationOwnersAfterSelection.filter(owner => owner !== id) ?? [];
    let selectionReason: any;
    if (!preferred) selectionReason = { kind: 'automatic-shortest-available', evidence: 'No preferred bed is set; actual selected fixture and all explicit candidate previews are recorded.' };
    else if (selected === preferred) selectionReason = { kind: 'preferred-selected', evidence: 'The actual task station is the configured preferred fixture.' };
    else if (preferredCandidate?.previewAtMinuteStart.disabled) selectionReason = { kind: 'preferred-unavailable', evidence: preferredCandidate.previewAtMinuteStart.disabled };
    else if (reservedByOther.length) selectionReason = { kind: 'reserved-within-the-same-minute', evidence: 'Another resident owns the preferred slot after selection; the minute-start preview alone is insufficient.', actorIds: reservedByOther };
    else selectionReason = { kind: 'unresolved', evidence: 'The trace does not establish why an available preference was not chosen; inspect this episode.' };
    const episode = {
      actorId: id, actorName: actor(before, id).person.name, source,
      start: before.time, startClock: clock(before.time), preferredBed: preferred ?? null,
      selectedFixture: selected, task: stable(actualTask), orderId: restKey(actualTask),
      startPosition: position(before, id), startNeeds: stable(actor(before, id).needs),
      ordinaryRestPreviewAtMinuteStart: inspect(before, id, 'need', 'energy'),
      candidates, selectionReason, metrics: { free: 0, work: 0, care: 0, travel: 0, waiting: 0 },
      segments: [] as any[], end: null, endKind: null,
    };
    this.rests.push(episode); this.active.set(id, episode);
    return episode;
  }

  end(id: string, kind: string, state = this.game) {
    const episode = this.active.get(id);
    if (!episode) return;
    Object.assign(episode, {
      end: state.time, endClock: clock(state.time), endKind: kind,
      elapsed: state.time - episode.start, endPosition: position(state, id),
      endNeeds: stable(actor(state, id).needs), endTask: stable(actor(state, id).task),
    });
    this.active.delete(id);
  }

  tick() {
    const before = this.game;
    this.game = runMinutes(before, 1);
    for (const a of before.actors) {
      const id = a.person.id, after = actor(this.game, id);
      if (!isRest(a.task) && isRest(after.task)) this.start(id, before, this.game, 'autonomous');
      const episode = this.active.get(id);
      if (episode) {
        const differences = Object.fromEntries(Object.keys(a.metrics).map(k => [k, (after.metrics as any)[k] - (a.metrics as any)[k]]));
        assert.equal(Object.values(differences).reduce((sum, v) => sum + v, 0), 1);
        const metric = Object.keys(differences).find(k => differences[k] === 1)!;
        for (const key of Object.keys(differences)) episode.metrics[key] += differences[key];
        const last = episode.segments.at(-1);
        if (last?.metric === metric) {
          last.to = this.game.time; last.minutes++; last.endPosition = position(this.game, id);
        } else episode.segments.push({ metric, from: before.time, to: this.game.time, minutes: 1, startPosition: position(before, id), endPosition: position(this.game, id) });
        if (isRest(a.task) && restKey(after.task) !== episode.orderId) this.end(id, after.task ? 'replaced' : 'completed');
      }
      if (a.task && !after.task && !isRest(a.task)) this.events.push({
        kind: 'other-task-completed', time: this.game.time, clock: clock(this.game.time), actorId: id,
        task: stable(a.task), reason: after.reason,
      });
    }
  }

  until(condition: () => boolean, maxMinutes = 1000) {
    let count = 0;
    while (!condition()) { assert.ok(count++ < maxMinutes, 'Bounded scenario did not finish'); this.tick(); }
  }

  issue(id: string, kind: string, target: string | undefined, label: string, expected: 'accept' | 'reject' = 'accept') {
    const before = this.game, preview = inspect(before, id, kind, target);
    assert.equal(!preview.disabled, expected === 'accept', `${label}: ${preview.disabled ?? 'unexpected acceptance'}`);
    const after = order(before, id, kind, target);
    assert.equal(after.time, before.time); assert.ok(isGame(after));
    if (preview.disabled) {
      const old = structuredClone(before), current = structuredClone(after);
      old.log = []; current.log = [];
      assert.deepEqual(stable(old), stable(current));
    } else if (this.active.has(id)) this.end(id, 'directly-cancelled-or-replaced', before);
    this.game = after;
    if (!preview.disabled && isRest(actor(after, id).task)) this.start(id, before, after, 'ordinary-rest-directive');
    this.orders.push({ time: before.time, clock: clock(before.time), actorId: id, kind, target: target ?? null, label, accepted: !preview.disabled, preview, before: snapshot(before), after: snapshot(after) });
  }
}

const partial: any = { schema: 'preferred-bed-comparison-1', status: 'running', inputPath, repoPath, expected: EXPECTED, branches: {} };
function writeJson(name: string, value: unknown) { writeFileSync(join(outputDir, name), JSON.stringify(value, null, 2) + '\n'); }

try {
  const input = importSlot(readFileSync(inputPath, 'utf8'));
  assert.equal(input.game.time, EXPECTED.startTime);
  assert.equal(hash(input.game), EXPECTED.start, 'The input is not the recorded public-preset 21:33 Game');
  assert.equal(hash(input.origin), EXPECTED.origin);
  const originalInputHash = hash(input.game);
  const kaya = input.game.actors.find(a => a.person.name === 'カヤ')!.person.id;
  const sui = input.game.actors.find(a => a.person.name === 'スイ')!.person.id;
  assert.equal(input.game.actors.length, 2);
  const beds = bedFixtures(input.game);
  assert.equal(beds.length, 2);
  assert.ok(beds.some(b => b.fixtureId === 'mat-1'));
  const addedMat = beds.find(b => b.fixtureId !== 'mat-1')!.fixtureId;
  assert.ok(beds.every(b => b.kind === 'mat'));
  for (const a of input.game.actors) assert.equal(getPreferredBed(input.game, a.person.id), undefined);
  const existingSuiTask = stable(actor(input.game, sui).task);
  assert.equal(existingSuiTask?.kind, 'leisure');
  assert.equal(existingSuiTask?.metric, 'free');
  assert.equal(existingSuiTask?.remaining, 46);
  partial.input = { start: snapshot(input.game), originHash: hash(input.origin), publicPresetGameHash: originalInputHash, beds };

  function configure(slot: Slot, preferences: Array<[string, string]>) {
    const before = slot.game, beforeHash = hash(before);
    let configured = before;
    for (const [id, fixture] of preferences) configured = setPreferredBed(configured, id, fixture);
    assertOnlyPreferencesChanged(before, configured);
    assert.equal(hash(before), beforeHash, 'Setter mutated the original Game');
    assert.deepEqual(stable(actor(configured, sui).task), existingSuiTask);
    for (const [id, fixture] of preferences) assert.equal(getPreferredBed(configured, id), fixture);
    assert.equal(hash(slot.origin), EXPECTED.origin);
    slot.game = configured;
    return { onlyPreferencesChanged: true, originalGameUnchanged: true, existingSuiFreeTaskRetained: true, startGameHash: hash(configured), savedRoundTrip: savedRoundTrip(slot, configured) };
  }

  for (const name of ['none', 'preferred'] as const) {
    const slot = branchSlot(input, false, `優先寝床比較 ${name}`);
    const configuration = configure(slot, name === 'preferred' ? [[kaya, 'mat-1'], [sui, addedMat]] : []);
    const start = structuredClone(slot.game), trace = new RestTrace(slot);
    trace.until(() => trace.game.time === EXPECTED.endTime, 627);
    assert.equal(trace.game.time - start.time, 627);
    for (const a of trace.game.actors) {
      const before = actor(start, a.person.id);
      const elapsedMetrics = Object.keys(a.metrics).reduce((sum, key) => sum + (a.metrics as any)[key] - (before.metrics as any)[key], 0);
      assert.equal(elapsedMetrics, 627);
    }
    assert.deepEqual(stable(trace.game), stable(runMinutes(start, 627)), 'Minute steps differ from one batch');
    const reloaded = importSlot(exportSlot({ ...slot, game: start }));
    assert.deepEqual(stable(runMinutes(reloaded.game, 627)), stable(trace.game));
    assert.equal(hash(slot.origin), EXPECTED.origin);
    const result = {
      name, configuration, start: snapshot(start), rests: trace.rests, events: trace.events,
      end: snapshot(trace.game), gameHash: hash(trace.game), originHash: hash(slot.origin),
      singleMinuteEqualsBatch: true, reloadedContinuationEquals: true,
      control: 'No orders are issued after the 21:33 fork. All 627 minutes are autonomous.',
    };
    partial.branches[name] = result;
    writeJson(`preferred-beds-${name}.json`, result);
    writeFileSync(join(outputDir, `preferred-beds-${name}-morning-slot.json`), exportSlot({ ...slot, game: trace.game }) + '\n');
    if (name === 'none') assert.equal(result.gameHash, EXPECTED.morning, 'Unset branch differs from the full baseline morning Game');
  }

  // Separate controlled probe. It replaces Sui's free task deliberately; the main comparison does not.
  const sharedSlot = branchSlot(input, false, '同じ優先先・予約解除後の次回復帰');
  const sharedConfiguration = configure(sharedSlot, [[kaya, 'mat-1'], [sui, 'mat-1']]);
  const shared = new RestTrace(sharedSlot);
  shared.issue(kaya, 'need', 'energy', 'カヤが通常の休息で共通の優先寝床を予約');
  assert.equal(fixtureForTask(shared.game, actor(shared.game, kaya).task), 'mat-1');
  shared.issue(sui, 'need', 'energy', 'スイの通常休息は予約中の優先寝床から別のむしろへ代替');
  assert.equal(fixtureForTask(shared.game, actor(shared.game, sui).task), addedMat);
  shared.issue(sui, 'home-use', 'mat-1', '一回の明示指定は、優先設定があっても予約中なら厳密に拒否', 'reject');
  shared.tick();
  const fallbackTask = stable(actor(shared.game, sui).task)!;
  const fallbackOrderId = fallbackTask.spatial!.orderId;
  const fallbackStation = fallbackTask.station;
  shared.issue(kaya, 'cancel', undefined, '優先設定は残したまま、カヤの利用予約を取り消して解放');
  assert.equal(getPreferredBed(shared.game, kaya), 'mat-1');
  assert.equal(getPreferredBed(shared.game, sui), 'mat-1');
  assert.deepEqual(stable(actor(shared.game, sui).task), fallbackTask, 'Another resident cancelling interrupted Sui');
  assert.deepEqual(bookingOwners(shared.game, 'mat-1'), []);
  const afterRelease = snapshot(shared.game);
  shared.until(() => {
    const continuing = actor(shared.game, sui).task;
    if (!continuing) return true;
    assert.equal(continuing.spatial?.orderId, fallbackOrderId, 'Fallback order was restarted or replaced before completion');
    assert.equal(continuing.station, fallbackStation, 'Fallback station changed before completion');
    return false;
  }, 200);
  // The binding was inspected before every minute: a return may begin only after completion.
  const fallbackEpisode = shared.rests.find(e => e.actorId === sui && e.orderId === fallbackOrderId)!;
  assert.equal(fallbackEpisode.endKind, 'completed');
  assert.equal(fallbackEpisode.selectedFixture, addedMat);
  assert.equal(fallbackEpisode.metrics.care, 85);
  assert.equal(fallbackEpisode.task.station, fallbackStation);
  assert.equal(getPreferredBed(shared.game, sui), 'mat-1');
  const beforeReturn = snapshot(shared.game);
  assert.deepEqual(bookingOwners(shared.game, 'mat-1'), [], 'The autonomous first resident rebooked the bed; this controlled return condition no longer holds');
  const returnPreview = inspect(shared.game, sui, 'need', 'energy');
  assert.equal(returnPreview.facility?.fixtureId, 'mat-1');
  shared.issue(sui, 'need', 'energy', '予約が解放された後、次の通常休息指示で優先寝床に復帰');
  assert.equal(fixtureForTask(shared.game, actor(shared.game, sui).task), 'mat-1');
  const returningOrder = actor(shared.game, sui).task!.spatial!.orderId;
  shared.until(() => !actor(shared.game, sui).task, 200);
  const returnEpisode = shared.rests.find(e => e.actorId === sui && e.orderId === returningOrder)!;
  assert.equal(returnEpisode.endKind, 'completed');
  assert.equal(returnEpisode.metrics.care, 85);
  partial.sharedPreference = {
    configuration: sharedConfiguration, orders: shared.orders, rests: shared.rests,
    afterReservationRelease: afterRelease, beforeNextRest: beforeReturn, nextRestPreview: returnPreview,
    reservationReleasePreservedPreferences: true, runningFallbackCompletedBeforeReturn: true,
    end: snapshot(shared.game), savedRoundTrip: savedRoundTrip(sharedSlot, shared.game),
    control: 'Both residents prefer mat-1. Public ordinary-rest orders demonstrate fallback; Kaya cancels a booking. Sui completes the existing fallback, then a new ordinary-rest directive returns to the preference. This return is not labelled autonomous.',
  };
  assert.equal(hash(input.game), originalInputHash);
  assert.equal(hash(input.origin), EXPECTED.origin);
  partial.status = 'passed';
  partial.checks = { unsetBaselineHashMatches: true, onlyPreferencesDifferAtStart: true, existingSuiTaskRetained: true, originalInputUnchanged: true, originUnchanged: true, personalSaveUsed: false, productEdited: false, uiOperated: false };
  writeJson('compare-preferred-beds.json', partial);
  const rows = Object.values(partial.branches).flatMap((branch: any) => branch.rests.map((rest: any) =>
    `| ${branch.name} | ${rest.actorName} | ${rest.startClock} | ${rest.preferredBed ?? 'なし'} | ${rest.selectedFixture} | ${rest.metrics.travel} | ${rest.metrics.care} | ${rest.endClock ?? '未完了'} | ${rest.selectionReason.kind} |`));
  const stockRows = Object.values(partial.branches).map((b: any) => `| ${b.name} | ${b.end.stock.wood} | ${b.end.stock.food} | ${b.end.stock.ingredients} | ${b.end.stock.coins} |`);
  const pendingRows = Object.values(partial.branches).flatMap((b: any) => b.end.actors.map((a: any) => `| ${b.name} | ${a.name} | ${a.task?.label ?? '予定なし'} | ${a.task?.remaining ?? '—'} |`));
  writeFileSync(join(outputDir, 'compare-preferred-beds.md'), `# 優先寝床：21:33からの対照実験\n\n公開プリセットから生成済みの同じGameとoriginを使い、無設定／カヤmat-1・スイ${addedMat}優先の二枝を627分自主進行した。設定以外の開始Gameは一致し、スイの自由時間・残46分、時計、備蓄、乱数、予約、位置を保持した。ブラウザ操作は行っていない。\n\n## 自主休息の実測\n\n| 枝 | 人物 | 開始 | 優先 | 実際の寝床 | 移動 | 実利用 | 完了 | 選択理由の分類 |\n| --- | --- | --- | --- | --- | ---: | ---: | --- | --- |\n${rows.join('\n')}\n\n理由の根拠はJSONの各episode.candidatesに、1分の処理前の個別予告と、処理後の予約所有者を分けて記録した。同じ分で先の住人が予約する場合や、移動開始後の拒否を混同しない。\n\n## 翌08:00の備蓄と途中予定\n\n| 枝 | 木材 | 食事 | 食材 | 銀貨 |\n| --- | ---: | ---: | ---: | ---: |\n${stockRows.join('\n')}\n\n| 枝 | 人物 | 続けている予定 | 残り分 |\n| --- | --- | --- | ---: |\n${pendingRows.join('\n')}\n\n無設定枝の全Game SHA-256は ${partial.branches.none.gameHash} で、元の一日比較の翌朝と一致。設定枝は ${partial.branches.preferred.gameHash}。originは両枝とも ${EXPECTED.origin}。\n\n## 共通の優先寝床を設定した補助枝\n\n同じmat-1を二人が優先できること、予約中の通常休息は代替へ進むこと、一回のhome-useは予約理由で拒否されることを確認。カヤの予約取消後も優先設定とスイの途中利用を保持し、代替寝床の85分利用を終えてから、次の通常休息指示でmat-1へ戻った。補助枝ではスイの元の自由時間を直接休息で置換した。予約の解除であって優先設定の解除ではなく、復帰も自主開始として数えていない。\n\n設定あり枝の結果を速さや生産性の改善とはあらかじめ定義しない。表の実測と途中予定から差を読む。全ての原観測、設定保持のassert、保存読戻し・一括／1分進行の一致は compare-preferred-beds.json を参照。\n`);
  console.log(JSON.stringify({ status: 'passed', output: join(outputDir, 'compare-preferred-beds.json'), report: join(outputDir, 'compare-preferred-beds.md'), baselineGameHash: partial.branches.none.gameHash }, null, 2));
} catch (error) {
  partial.status = 'failed';
  partial.error = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error);
  writeJson('compare-preferred-beds-failure.json', partial);
  throw error;
}
