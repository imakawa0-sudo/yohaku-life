import { isGuardPresentAt } from "./guard-agreement";
import { getLocalEncounter, getPresentEncounterAt, SECOND_ENCOUNTER_RULE } from "./encounters";
import type { GameState, LocationId } from "./types";
import { LOCATIONS } from "./engine";
import { regionNPCsAt, regionHarvestAvailable } from "./region";

/** Short, state-neutral descriptions. Outcomes and memories are supplied by the engine. */
export type LocationScene = {
  eyebrow: string;
  title: string;
  paragraphs: string[];
  quote?: { speaker: string; text: string };
  detail: string;
};

export const LOCATION_SCENES: Record<string, LocationScene> = {
  home: {
    eyebrow: "OUR LITTLE WAYSTATION",
    title: "ただいま、と言える場所。",
    paragraphs: [
      "丘のふもとに、小さな家が一軒。使われなくなった道の休憩所を、三人で少しずつ住まいに変えてきた。継ぎはぎの屋根も、軋む床板も、今では見慣れた景色だ。",
      "窓辺には空の花瓶。食卓には三つの椅子。急ぐ理由がなければ、今日はここで過ごしてもいい。道の向こうを確かめに行くのも、もちろんいい。",
    ],
    detail: "暮らしも、外の世界も。今日の過ごし方は、あなたが決める。",
  },
  kitchen: {
    eyebrow: "AROUND THE TABLE",
    title: "三人分の、湯気の向こう。",
    paragraphs: [
      "窓際の小さな炊事台には、使い込んだ鍋がひとつ。食材の袋と器を並べるだけで、この部屋は少し賑やかになる。",
      "料理をする人、食べに来る人、話を聞く人。同じ食卓のまわりで、それぞれの時間が重なっていく。",
    ],
    detail: "調理台は共用。途中の料理は、中断しても続きから再開できる。",
  },
  bedroom: {
    eyebrow: "A PLACE OF YOUR OWN",
    title: "何もしない時間も、暮らし。",
    paragraphs: [
      "薄い仕切りの向こうに、三人の寝床が並ぶ。畳んだ毛布、小さな棚、旅の途中から持っている私物。多くはないけれど、落ち着ける場所だ。",
      "外で疲れた日には、ここで休もう。道具を持たずにできることもある。窓の外を眺めたり、小さな作品に手をかけたり。",
    ],
    detail: "休息と睡眠で体調を整える。傷があるときは、手当も忘れずに。",
  },
  garden: {
    eyebrow: "JUST OUTSIDE THE DOOR",
    title: "足元にも、小さな実り。",
    paragraphs: [
      "家の裏手には、草のあいだに細い踏み跡が続いている。遠くへ行かなくても、食べられるものを探す余地はある。",
      "土に近い仕事をしながら、ときどき顔を上げる。窓も煙突もここから見える。その近さが、今日はありがたい。",
    ],
    detail:
      "拠点のそばで食材を集められる。外出する仲間がいても、留守の仕事は続く。",
  },
  road: {
    eyebrow: "BEYOND THE FAMILIAR",
    title: "家を背に、道の先へ。",
    paragraphs: [
      "靴底の下で、小石が短く鳴る。家のそばの踏み跡は、やがて古い荷車道に合流する。先には、物資が残るという廃屋がある。",
      "廃屋に居ついた相手は、近づく者を歓迎しない。正面へ進むか、物陰をたどるか。帰り道が見えているうちに、引き返すこともできる。",
    ],
    detail: "この先には危険がある。仲間の体調と装備、帰る経路を確かめよう。",
  },
  ruins: {
    eyebrow: "SOMETHING WORTH BRINGING HOME",
    title: "残されたもの、守られたもの。",
    paragraphs: [
      "崩れた壁の向こうに、古い箱が見える。使えそうな資材と、まだ持ち帰れる物資。その前には、ここを守る相手が立っている。",
      "数歩の距離も、誰が前に立つかで意味が変わる。攻める人、仲間を守る人、帰路を確かめる人。すべてを持ち帰れなくても、人は連れて帰りたい。",
    ],
    detail: "攻撃は継続する。防御・援護、離脱、救助で状況を変えられる。",
  },
  shelter: {
    eyebrow: "THE QUIETER WAY",
    title: "遠回りにも、持ち帰るもの。",
    paragraphs: [
      "低い石垣に沿って歩くと、廃屋の正面からは見えない物陰に出た。置き去りの小さな荷物が、壁の際に残っている。",
      "正面にある物資ほど多くはない。それでも、傷を負わずに帰れれば、その後の時間は自分たちのものだ。",
    ],
    detail: "危険を避ける経路。少量の物資を回収して、無傷で戻る選択もできる。",
  },
  village: {
    eyebrow: "NEIGHBOURS ALONG THE RIVER",
    title: "道の先にも、暮らしがある。",
    paragraphs: [
      "川沿いの道が、小さな家々のあいだへ続いている。軒下の品物台と、道を確かめるための標。今日は何を持って帰ろうか。",
      "物を交換することも、道の話を聞くこともできる。用事を急がず、この場所の景色を眺めてから帰ってもいい。",
    ],
    detail: "取引と道の話は08:00〜18:00。同じ場所に着いた一人を選んで話しかける。",
  },
  meadow: {
    eyebrow: "WHERE THE RIVER TURNS",
    title: "流れる水のそばで、立ち止まる。",
    paragraphs: [
      "浅い川の曲がり角に、草の低い場所が広がる。足元の土はやわらかく、岸に沿って細い道が続いている。",
      "食べられるものと使えそうな素材を少しずつ探す。持ち物の余裕と、帰り道に残す時間を確かめよう。",
    ],
    detail: "採集はこの場所で一日一回。持ち帰れる重さと、帰り道を確かめよう。",
  },
  reedbank: {
    eyebrow: "UP THE RIVER",
    title: "葦の穂が、水面にふれる。",
    paragraphs: [
      "集落の上流で、葦が流れを二つに分けている。浅瀬には流木が引っかかり、岸のくぼみに食べられる草が茂る。",
      "水際の足跡は舟宿まで続いている。ここで少し眺めていくか、拾ったものを宿まで運ぼうか。",
    ],
    detail: "一日一回の採集で食材4と資材2。舟宿に物置と寝床がある。",
  },
  lodge: {
    eyebrow: "THE BOATHOUSE WORKSHOP",
    title: "舟板の床に、荷を下ろす。",
    paragraphs: [
      "桟橋から舟宿の戸を押すと、削り跡のついた作業台がある。窓辺には鍋、奥には畳んだ毛布。",
      "壁沿いの物置には、次に来る人のための食料や、持ち帰るには重い材料を置いていける。",
    ],
    detail: "物置の品は「荷物と旅支度」で取り出せる。鍋と作業台では持ち込んだ材料を使う。",
  },
  ridge: {
    eyebrow: "THE RIDGE ABOVE THE ROAD",
    title: "尾根を越えて、道をつなぐ。",
    paragraphs: [
      "低い尾根の上を、細い踏み跡が越えていく。川沿いとは違う角度から、家々と道の分かれ目が見える。",
      "資材置き場を通る道は短いが、その場所の相手も確かめたい。近い道を選ぶか、川沿いを回るか。帰りにも選び直せる。",
    ],
    detail: "集落と資材置き場をつなぐ近道。短さだけでなく、経路上の危険も確かめよう。",
  },
};

/** Compact destination copy; reading a card never changes the world or its history. */
export function getLocationSummary(
  state: GameState,
  location: LocationId,
): string {
  const enemyAt = (place: LocationId) =>
    !!getPresentEncounterAt(state, place);
  if (location === "village") {
    if (enemyAt(location)) return "川沿いの集落。この場所に流れ者がいる。";
    return regionNPCsAt(state, location).length
      ? "川沿いの集落。取引や道の話ができる。"
      : "川沿いの集落。窓口は08:00〜18:00。";
  }
  if (location === "meadow") {
    if (enemyAt(location)) return "川沿いの草地。この場所に流れ者がいる。";
    return regionHarvestAvailable(state)
      ? "川沿いの草地。今日の分を採集できる。"
      : "川沿いの草地。今日の採集はひと区切り。";
  }
  if (location === "reedbank") {
    if (enemyAt(location)) return "上流の葦原。この場所に流れ者がいる。";
    return regionHarvestAvailable(state, "reedbank")
      ? "上流の浅瀬。今日の食材と流木を採集できる。"
      : "上流の浅瀬。今日の採集は終了。";
  }
  if (location === "lodge") return enemyAt(location)
    ? "舟宿の工房。この場所に流れ者がいる。"
    : "鍋、作業台、寝床と物置がある。持ち込んだ物資で過ごせる。";
  if (location === "ridge") {
    const local = getLocalEncounter(state, location);
    if (local?.id === SECOND_ENCOUNTER_RULE.id)
      return local.present
        ? "尾根を越える近道。尾根の見張りが道に立っている。"
        : "尾根の見張りは退いた。集落と置き場をつなぐ道。";
    return enemyAt(location)
      ? "尾根を越える近道。この場所に流れ者がいる。"
      : "集落と資材置き場をつなぐ近道。経路を選べる。";
  }
  if (location === "ruins") {
    const supplies = state.flags.suppliesRecovered
      ? "置き場の物資は回収済み。"
      : "崩れた壁の奥に物資が残る。";
    return (
      supplies +
      (enemyAt(location)
        ? "流れ者が入口を見張っている。"
        : state.guardAgreement
          ? "守り手は食事を受け取り、置き場を譲って立ち去った。"
          : "入口に見張りの姿はない。")
    );
  }
  if (location === "shelter") {
    const supplies = state.flags.safeSuppliesRecovered
      ? "木陰の物資は回収済み。"
      : "石垣のそばに少量の物資が残る。";
    return enemyAt(location)
      ? supplies + "脇道に流れ者がいる。"
      : "低い石垣に沿う脇道。" +
          (state.flags.safeSuppliesRecovered
            ? "物資は回収済み。"
            : "少量の物資を回収できる。");
  }
  if (location === "road") {
    const detail = enemyAt(location)
      ? "流れ者が道に立っている。"
      : enemyAt("ruins")
        ? "置き場の入口に流れ者がいる。"
        : enemyAt("shelter")
          ? "木陰の迂回路に流れ者がいる。"
          : state.flags.suppliesRecovered && state.flags.safeSuppliesRecovered
            ? "置き場と木陰の物資は回収済み。"
            : state.flags.suppliesRecovered
              ? "木陰の迂回路には物資が残る。"
              : state.flags.safeSuppliesRecovered
                ? "置き場の物資は残り、木陰は回収済み。"
                : "置き場と木陰の迂回路へ続いている。";
    return "古い轍の続く道。" + detail;
  }
  const description = LOCATIONS[location].description;
  return enemyAt(location)
    ? description.split("。")[0] + "。この場所に流れ者がいる。"
    : description;
}

/** Read the current place without adding an event or a resident's knowledge. */
export function getLocationScene(
  state: GameState,
  location: LocationId,
): LocationScene {
  const original = LOCATION_SCENES[location];
  const scene = { ...original, paragraphs: [...original.paragraphs] };
  if (state.origin) {
    if (location === "home") scene.paragraphs = [
      "丘のふもとの古い休憩所。窓を開けると、道まで伸びる草が風に揺れている。",
      "食卓に荷物を置く。今日はここで手を動かしても、旅支度をして別の道へ出てもいい。",
    ];
    if (location === "kitchen") scene.title = "小鍋から上がる湯気。";
    if (location === "bedroom") scene.paragraphs[0] = "仕切りの奥に寝床がある。毛布を広げて荷を下ろせば、ここで体を休められる。";
  }
  const ruinsGuarded =
    isGuardPresentAt(state, "ruins");
  const ruinsRecovered = state.flags.suppliesRecovered;
  const shelterRecovered = !!state.flags.safeSuppliesRecovered;

  if (["village", "meadow", "ridge", "reedbank", "lodge"].includes(location)) {
    const encounter = getPresentEncounterAt(state, location);
    const guarded = !!encounter;
    if (location === "village") {
      const people = regionNPCsAt(state, location);
      scene.detail = people.length
        ? `${people.map((person) => person.name).join("・")}が話に応じる。同じ場所に着いた一人を選ぼう。`
        : "窓口は08:00〜18:00。今は店じまいの時間。道と持ち物を確かめて帰ることもできる。";
      if (!people.length)
        scene.paragraphs[1] = "窓口は閉じている。今は取引や道の話をせず、景色を眺めたり、帰りの道を確かめたりして過ごせる。";
    }
    if (location === "meadow" && !regionHarvestAvailable(state)) {
      scene.paragraphs[1] = "今日の採集は、もうひと区切り。この場所に立ち止まるだけの日があってもいい。川沿いを集落へ進むか、家へ帰るかを選べる。";
      scene.detail = "今日の採集は終了。翌日の分を待つか、景色や別の行き先を選べる。";
    }
    if (location === "reedbank" && !regionHarvestAvailable(state, "reedbank")) {
      scene.paragraphs[1] = "今日採れる分は採り終えた。岸に腰を下ろすと、向こうの舟宿の桟橋まで水面が続いている。";
      scene.detail = "今日の採集は終了。明日また採集できる。";
    }
    if (location === "ridge" && !ruinsGuarded)
      scene.paragraphs[1] = state.guardAgreement
        ? "資材置き場の守り手は、食事を受け取って立ち去った。川沿いを回るか、この尾根を通るか。持ち物と体調に合わせて道を選べる。"
        : "資材置き場の入口に、見張りの姿はない。川沿いを回るか、この尾根を通るか。持ち物と体調に合わせて道を選べる。";
    if (guarded) {
      scene.paragraphs[1] = encounter.id === SECOND_ENCOUNTER_RULE.id
        ? "尾根の見張りが踏み跡に立っている。攻防を指示するか、引き返すか。ここを通る仲間の予定と、帰りの道も確かめよう。"
        : "この場所に流れ者がいる。落ち着いて過ごす前に、相手との距離と引き返す経路を確かめよう。";
      scene.detail = "ここに相手がいる。仲間の体調と退路を確認し、戦闘か離脱を選ぼう。";
    } else if (location === "ridge") {
      const local = getLocalEncounter(state, location);
      if (local?.id === SECOND_ENCOUNTER_RULE.id) {
        scene.paragraphs[1] = "尾根の見張りは踏み跡を離れた。この道を通るか、川沿いを回るか。体調と仲間の行き先を確かめて選べる。";
        scene.detail = "尾根の相手は退いています。体調と帰り道を確かめて、次の行き先を選べます。";
      }
    }
    return scene;
  }

  if (location === "road") {
    const guardOnRoad =
      !!getPresentEncounterAt(state, "road");
    scene.paragraphs[0] = ruinsRecovered
      ? "靴底の下で、小石が短く鳴る。古い荷車道の先には、物資を回収した廃屋がある。"
      : original.paragraphs[0];
    scene.paragraphs[1] = guardOnRoad
      ? "道の先に、物資を守る相手の姿がある。距離を確かめて、進むか戻るかを選ぼう。"
      : ruinsGuarded
        ? original.paragraphs[1]
        : state.guardAgreement
          ? "廃屋の守り手は、食事を受け取って立ち去った。木陰を通るか、家へ戻るか。歩く先を落ち着いて選べる。"
          : "廃屋の入口に、見張りの人影はない。木陰を通るか、家へ戻るか。歩く先を落ち着いて選べる。";
    scene.detail = guardOnRoad
      ? "この道に相手がいる。仲間の体調と、引き返す経路を確かめよう。"
      : ruinsGuarded
        ? shelterRecovered
          ? "木陰の物資は回収済み。廃屋へ進むなら、相手と帰り道を確かめよう。"
          : original.detail
        : ruinsRecovered && shelterRecovered
          ? "廃屋と木陰の物資は回収済み。急ぐ用事がなければ、家へ戻ってもいい。"
          : "道は廃屋と木陰へ続いている。残る物資を探すか、家へ戻るかを選べる。";
  }
  if (location === "ruins") {
    if (ruinsGuarded && !ruinsRecovered) return scene;
    scene.title = ruinsRecovered
      ? "回収を終えた、廃屋。"
      : "帰り道に、持ち帰るもの。";
    scene.paragraphs = [
      ruinsGuarded
        ? "物資を回収した箱が、崩れた壁の奥に残る。入口には、ここを守る相手が立っている。"
        : state.guardAgreement
          ? "守り手は食事を受け取り、置き場を譲って立ち去った。崩れた壁の向こうに、古い箱が見える。"
          : state.enemy.defeated
            ? "見張っていた相手は、もういない。崩れた壁の向こうに、古い箱が見える。"
            : "入口に、見張りの姿はない。崩れた壁の向こうに、古い箱が見える。",
      ruinsRecovered
        ? "この場所の物資は、すでに回収してある。今日は何も持ち出さず、暮らしの続きへ戻ってもいい。"
        : "資材も、食材も、暮らしに役立つものばかり。持ち帰ったあと、どう使おうか。そんなことを考える余裕がある。",
    ];
    scene.detail = ruinsRecovered
      ? "物資は回収済み。帰り道と仲間の体調を確かめよう。"
      : "残る物資を回収するか、そのまま帰るかを選べる。体調と帰り道も確かめよう。";
  }
  if (location === "shelter") {
    if (shelterRecovered) {
      scene.title = "静かな道に、戻ってくる。";
      scene.paragraphs = [
        "低い石垣のそばに、荷物が置かれていた跡が残る。廃屋の正面から少し離れ、風の音がよく聞こえる。",
        ruinsRecovered
          ? "廃屋も、この脇道も、回収はひと区切り。手ぶらで帰る日があってもいい。"
          : ruinsGuarded
            ? "正面の物資はまだ残る。そこへ進むか、今日は家へ戻るか。無理に行き先を増やさなくてもいい。"
            : "廃屋には、まだ回収できる物資がある。ここで道を確かめて、進むか戻るかを選べる。",
      ];
      scene.detail = "この脇道の物資は回収済み。道や家へ戻る経路を選べる。";
    } else if (ruinsRecovered) {
      scene.paragraphs[1] =
        "廃屋の回収はひと区切り。この脇道には少量の物資が残る。急がず、持ち帰るものを選んでもいい。";
    }
  }
  return scene;
}

export const GUIDE_STEPS = [
  {
    title: "まずは、今日したいことを。",
    text: "アキはあなた自身。食事や休息だけでなく、趣味や交流、自分の居場所を整える時間も選べます。勝利を急ぐ必要はありません。",
  },
  {
    title: "行動する人を選んで、時間を進める。",
    text: "ホームの住民一覧で行動する人を選び、複数選べば一緒に行動できます。予約や画面切替では時間は進まず、進めると全員が同じ時計で動きます。「誰かの区切りへ」は選択外の人の行動終了でも戻ります。一定の時間なら分数のボタンを選びます。危険や強い空腹では途中で止まります。",
  },
  {
    title: "任せながら、自分も暮らす。",
    text: "仲間には仕事の方針を任せられます。直接の指示を優先し、終わったら方針に戻ります。困ったときは、今の行動や中断理由を確認しましょう。",
  },
  {
    title: "帰るところまでが、外出。",
    text: "外では、戦うほかに回避や撤退も選べます。誰かが倒れても、動ける仲間を操作して救助できます。傷や疲れは帰宅後にも残ります。",
  },
  {
    title: "続きは、またここから。",
    text: "途中の行動や予約した材料も保存できます。保存ファイルを書き出しておけば、同じ状態を読み戻せます。同じ朝から別の過ごし方を試せます。",
  },
];

export const PLAY_ROUTES = [
  {
    id: "peaceful",
    title: "家で過ごす一日",
    subtitle: "食卓と、小さな楽しみ",
    steps: [
      "ミオに調理、レンに食材集めを頼み、アキは趣味を始める。",
      "時間を進め、用意できた食事を一緒に楽しむ。休憩や交流も挟んでみる。",
      "私物で居場所を整え、休息や睡眠を選ぶ。翌朝、作品や関係の変化を確かめる。",
    ],
  },
  {
    id: "expedition",
    title: "準備して、外へ",
    subtitle: "役割を分けて持ち帰る",
    steps: [
      "食事と休息を済ませ、外出する仲間の装備を確認する。拠点に残る人には仕事を任せる。",
      "仲間と道へ出る。廃屋では攻撃と防御・援護を分担し、必要なら引き返す。",
      "安全を確保できたら物資を回収して帰宅する。残っていた仕事と、外出組の疲れを見比べる。",
    ],
  },
  {
    id: "retreat",
    title: "戦わない、という選択",
    subtitle: "守れた体力と時間",
    steps: [
      "道まで出て、廃屋の危険を確認する。正面へ進む前に、物陰への経路を見る。",
      "物陰で少量の物資を回収するか、そのまま引き返す。",
      "帰宅後は食事や趣味へ。無傷で帰ったからこそ残った時間を使う。",
    ],
  },
  {
    id: "rescue",
    title: "一緒に、帰る",
    subtitle: "救助から翌朝の分担へ",
    steps: [
      "試す前に保存する。危険な場所では、一人の負傷で試行全体が終わるわけではない。",
      "誰かが倒れたら動ける仲間を選ぶ。同じ場所まで移動して救助し、安全な拠点へ運ぶ。",
      "手当と休養を行い、元の担当の仕事を別の仲間へ。翌朝にも傷や経験が残ることを確かめる。",
    ],
  },
];


export const SOLO_ROUTES = [
  { id: "provisions", title: "旅支度と採集", subtitle: "食事を持って川辺を歩く", steps: [
    "今いる場所と、自分の荷物にある食事を確認する。",
    "川沿いの採集地に出て、今日の分を採る。採った品は本人の荷物に入る。",
    "集落で道を聞くか、丘のふもとの家へ向かい、食事や手仕事を始める。",
  ] },
  { id: "trading", title: "自分で商う", subtitle: "物々交換と銀貨", steps: [
    "開店中の近隣の集落で、商い手に声を掛ける。",
    "手持ちの資材を食事に交換するか、売って銀貨を受け取る。",
    "食事を持って別の場所へ旅を続ける。道案内の住民に話を聞き、食事を三つ届けて仲間に誘うこともできる。",
  ] },
];
