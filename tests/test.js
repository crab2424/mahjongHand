'use strict';
// node tests/test.js  — ブラウザ用スクリプトをそのまま読み込んでロジックを検証する
const fs = require('fs');
const path = require('path');
const vm = require('vm');

for (const f of ['tiles.js', 'shanten.js', 'yaku.js', 'game.js', 'autodiscard.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
}

let pass = 0, fail = 0;
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ok   ${msg}`); }
  else { fail++; console.log(`  FAIL ${msg}\n       expected ${e}\n       actual   ${a}`); }
}
const P = (s) => Tiles.parse(s);
const C = (s) => Tiles.counts(P(s));
const names = (r) => r.yaku.map((y) => y.name);
const baseCtx = { kans: [], roundWind: 27, seatWind: 27, doraKinds: [], uraKinds: [], isDealer: true };
function win(closed, winTile, extra = {}) {
  return Yaku.evaluate(Object.assign({}, baseCtx, { closed: P(closed), winTile: P(winTile)[0] }, extra));
}

console.log('向聴数');
eq(Shanten.calc(C('123m456p789s11z222z')), -1, '和了形は -1');
eq(Shanten.calc(C('123m456p789s11z22z')), 0, '13枚聴牌は 0');
eq(Shanten.calc(C('123m456p789s1z22z5s')), 1, '一向聴');
eq(Shanten.calc(C('19m19p19s1234567z')), 0, '国士十三面聴牌');
eq(Shanten.calc(C('1133m5577p99s11z2z')), 0, '七対子聴牌');
eq(Shanten.chiitoi(C('1111p22p33p55p77s9s')), 2, '七対子で4枚使いは対子1つ扱い');
eq(Shanten.calc(C('1111p22p33p55p77s9s')), 1, '一般形なら 111p+123p+23p で一向聴');
{
  // 枝刈りなしの素朴な実装と照合
  function naive(counts, fixed) {
    const c = counts.slice(); let best = 8;
    (function rec(i, m, t, p) {
      while (i < 34 && c[i] === 0) i++;
      if (i >= 34) { let tt = t; if (m + tt > 4) tt = 4 - m; best = Math.min(best, 8 - 2 * m - tt - (p ? 1 : 0)); return; }
      const seq = i < 27 && i % 9 <= 6, pen = i < 27 && i % 9 <= 7;
      if (c[i] >= 3) { c[i] -= 3; rec(i, m + 1, t, p); c[i] += 3; }
      if (seq && c[i + 1] > 0 && c[i + 2] > 0) { c[i]--; c[i + 1]--; c[i + 2]--; rec(i, m + 1, t, p); c[i]++; c[i + 1]++; c[i + 2]++; }
      if (m + t < 4) {
        if (c[i] >= 2) { c[i] -= 2; rec(i, m, t + 1, p); c[i] += 2; }
        if (pen && c[i + 1] > 0) { c[i]--; c[i + 1]--; rec(i, m, t + 1, p); c[i]++; c[i + 1]++; }
        if (seq && c[i + 2] > 0) { c[i]--; c[i + 2]--; rec(i, m, t + 1, p); c[i]++; c[i + 2]++; }
      }
      if (!p && c[i] >= 2) { c[i] -= 2; rec(i, m, t, true); c[i] += 2; }
      c[i]--; rec(i, m, t, p); c[i]++;
    })(0, fixed, 0, false);
    return best;
  }
  let mismatch = 0;
  for (let n = 0; n < 400; n++) {
    const wall = Tiles.shuffle(Tiles.makeWall(false));
    // 偏った手も作る（1色に寄せる）
    const pool = n % 2 ? wall.filter((t) => t.kind < 9 || t.kind >= 27).slice(0, 40) : wall;
    for (const size of [13, 14, 10, 11]) {
      const c = Tiles.counts(pool.slice(0, size));
      const fixed = size <= 11 ? 1 : 0;
      if (Shanten.regular(c, fixed) !== naive(c, fixed)) mismatch++;
    }
  }
  eq(mismatch, 0, '枝刈りあり/なしで向聴数が一致（ランダム1600手）');
}
eq(Shanten.calc(C('147m258p369s1234z')), 6, 'バラバラ手');
eq(Shanten.calc(C('123m456p11z22z'), 1), 0, '暗槓1つ + 10枚の聴牌');
eq(Shanten.calc(C('123m456p11z2z'), 1), 1, '暗槓1つ + 10枚の一向聴');

console.log('待ち');
eq(Shanten.waits(C('123m456p789s11z22z')), [27, 28], 'シャンポン待ち');
eq(Shanten.waits(C('23m456p789s111z22z')), [0, 3], '両面待ち');
eq(Shanten.waits(C('19m19p19s1234567z')).length, 13, '国士十三面');
eq(Shanten.waits(C('1112345678999m')).length, 9, '純正九蓮 9面');

console.log('受け入れ解析');
{
  const rows = Shanten.analyzeDiscards(C('123m456p789s11z2z57s'), 0, new Array(34).fill(4));
  eq(rows[0].shanten, 0, '最良打牌で聴牌');
  const best = rows.filter((r) => r.shanten === 0).map((r) => Tiles.info(r.kind).code).sort();
  eq(best, ['2z'], '聴牌に取れる打牌候補は 2z のみ');
  eq(rows[0].accepts.map((a) => Tiles.info(a.kind).code), ['6s'], '打2z の受け入れは 6s（嵌張）');
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) Shanten.analyzeDiscards(C('1112233445566m78m'), 0, new Array(34).fill(4));
  const ms = (Date.now() - t0) / 20;
  console.log(`       清一色手の解析 1回あたり ${ms.toFixed(1)} ms`);
  eq(ms < 300, true, '解析時間が実用範囲');
}

console.log('役・点数');
{
  const r = win('234m567m45p678s99s', '3p');
  eq(names(r), ['門前清自摸和', '平和'], '平和ツモ');
  eq([r.fu, r.han, r.points.total, r.points.detail], [20, 2, 2100, '700オール'], '20符2飜 親ツモ');
}
{
  const r = win('234m567m45p678s99s', '3p', { isDealer: false });
  eq([r.points.total, r.points.detail], [1500, '400-700'], '20符2飜 子ツモ');
}
{
  const r = win('234m567m35p678s99s', '4p');
  eq(names(r), ['門前清自摸和'], '嵌張は平和にならない');
  eq(r.fu, 30, '22+2嵌張=24→30符');
}
{
  const r = win('234m567m45p678s99s', '3p', { riichi: true, ippatsu: true, doraKinds: [26], uraKinds: [3] });
  eq(names(r), ['立直', '一発', '門前清自摸和', '平和', 'ドラ', '裏ドラ'], 'リーチ一発ツモ平和ドラ裏');
  eq([r.han, r.limit, r.points.total], [7, '跳満', 18000], '7飜 跳満 親');
}
{
  const r = win('1133m5577p99s11z2z', '2z');
  eq(names(r), ['門前清自摸和', '七対子'], '七対子');
  eq([r.fu, r.points.total], [25, 4800], '25符3飜 = 1600オール');
}
{
  const r = win('19m19p19s1234567z', '1m');
  eq([names(r), r.limit, r.points.total], [['国士無双十三面'], '2倍役満', 96000], '国士十三面ダブル');
}
{
  const r = win('1112345678999m', '5m');
  eq([names(r), r.limit], [['純正九蓮宝燈'], '2倍役満'], '純正九蓮');
}
{
  const r = win('1112345678899m', '9m');
  eq([names(r), r.limit], [['九蓮宝燈'], '役満'], '九蓮（非純正）');
}
{
  const r = win('111m222p333s444z5z', '5z');
  eq([names(r), r.limit], [['四暗刻単騎'], '2倍役満'], '四暗刻単騎');
}
{
  const r = win('111m222p333s44z55z', '5z');
  eq([names(r), r.limit], [['四暗刻'], '役満'], '四暗刻シャンポン');
}
{
  const r = win('234m234p234s55p67s', '8s');
  eq(names(r), ['門前清自摸和', '断幺九', '平和', '三色同順'], '三色同順・断幺九・平和');
}
{
  const r = win('123m456m789m44p67p', '5p');
  eq(names(r), ['門前清自摸和', '平和', '一気通貫'], '一気通貫 + 平和');
}
{
  const r = win('123m123m789p999s1z', '1z');
  eq(names(r).sort(), ['一盃口', '混全帯幺九', '門前清自摸和'].sort(), '一盃口・チャンタ');
  eq(r.fu, 40, '22 + 999s 8 + 連風雀頭 4 + 単騎 2 = 36 → 40符');
}
{
  const kans = [{ kind: 32, tiles: P('6666z').map((t, i) => ({ ...t, id: 900 + i })) }];
  const r = win('111m999m11p55z', '1p', { kans });
  eq(names(r), ['四暗刻'], '暗槓込みの四暗刻');
  const r2 = win('111m999m11p56z', '5z', { kans });
  eq(r2, null, '暗槓込みでも和了形でなければ null');
  const r3 = win('123m999m11p55z', '1p', { kans, doraKinds: [] });
  eq(names(r3).sort(), ['三暗刻', '役牌 發', '混全帯幺九', '門前清自摸和'].sort(), '暗槓(發)＋暗刻2 = 三暗刻・役牌・チャンタ');
  eq(r3.fu, 80, '22 + 999m 8 + 111p 8 + 發槓 32 + 白雀頭 2 = 72 → 80符');
}
{
  const r = win('111m456p789s33z44z', '4z', { doraKinds: [0] });
  eq(names(r), ['門前清自摸和', 'ドラ'], '1mドラ3枚（北は役牌でない）');
  eq(r.han, 4, '1 + ドラ3 = 4飜');
}
{
  const r = win('234m567m45p678s99s', '3p', { tenhou: true });
  eq([names(r), r.points.total], [['天和'], 48000], '天和');
}
{
  const r = win('222m222p222s567s1z', '1z');
  eq(names(r).sort(), ['三暗刻', '三色同刻', '門前清自摸和'].sort(), '三暗刻・三色同刻');
  eq(r.fu, 40, '22 + 4×3 + 連風雀頭 4 + 単騎 2 = 40符');
}
{
  const r = win('2233444566788m', '5m');
  eq(names(r).sort(), ['一盃口', '平和', '断幺九', '清一色', '門前清自摸和'].sort(), '清一色・一盃口・平和・断幺九');
  eq([r.han, r.limit], [10, '倍満'], '10飜 倍満');
}

console.log('ゲーム進行');
const S = (o = {}) => Object.assign({ redDora: true, simulateOthers: false, maxDraws: 0, seatWind: 27, roundWind: 27 }, o);
{
  const g = new Game(S());
  eq([g.hand.length, g.fullTiles().length, g.turn, g.phase], [13, 14, 1, 'discard'], '配牌直後に第一ツモ済み（14枚）');
  eq(g.remaining, 108, '残り山 136-14-13-1');
  eq(g.drawsLeft, 108, '残りツモ回数 = 山の枚数');
  eq(g.doraIndicators.length, 1, 'ドラ表示1枚');
  const a = g.analysis();
  eq(a.length > 0, true, '解析結果あり');
  g.discard(g.drawn.id);
  eq([g.hand.length, g.discards.length, g.phase], [13, 1, 'draw'], 'ツモ切り');
  let n = 0;
  while (g.phase === 'draw') { g.draw(); g.discard(g.hand[0].id); n++; }
  eq([g.phase, g.remaining, g.turn], ['exhausted', 0, 109], '山が尽きるまで打牌（109巡）');
  const r = g.exhaust();
  eq(r.type, 'draw', '流局');
}
{
  const g = new Game(S({ redDora: false, simulateOthers: true, seatWind: 28 }));
  eq(g.drawsLeft, 27, '他家模擬: 残りツモ = ceil(108/4)');
  let n = 1;
  while (g.phase !== 'exhausted') { g.discard(g.drawn.id); if (g.phase === 'draw') { g.draw(); n++; } }
  eq(n, 28, '他家模擬で 28巡 (109 → 1 + 3 ずつ)');
  eq(g.isDealer, false, '南家は子');
}
{
  const g = new Game(S({ maxDraws: 18 }));
  eq(g.drawsLeft, 17, 'ツモ上限18: 配牌ツモ後の残りは17');
  let n = 1;
  while (g.phase !== 'exhausted') { g.discard(g.drawn.id); if (g.phase === 'draw') { g.draw(); n++; } }
  eq([n, g.turn, g.remaining > 0], [18, 18, true], 'ツモ上限18で流局（山は残っている）');
  const h = new Game(S({ maxDraws: 2 }));
  eq(h.winContext().haitei, false, '1巡目は海底ではない');
  h.discard(h.drawn.id); h.draw();
  eq([h.turn, h.drawsLeft, h.winContext().haitei], [2, 0, true], '上限最後のツモは海底扱い');
}
{
  // 三麻（萬子は一九のみ）
  const g = new Game(S({ tileM28: false }));
  eq(g.initialCounts.slice(0, 9), [4, 0, 0, 0, 0, 0, 0, 0, 4], '萬子 2〜8 が山に無い');
  eq(g.remaining, 108 - 28, '三麻の山は 28 枚少ない');
  eq(g.unseenCounts()[4], 0, '5m の未見枚数は 0');
  eq(Tiles.nextDora(0, g.initialCounts), 8, '三麻: 1m 表示のドラは 9m');
  eq(Tiles.nextDora(8, g.initialCounts), 0, '三麻: 9m 表示のドラは 1m');
  eq(Tiles.nextDora(0), 1, '四麻: 1m 表示のドラは 2m');
  const all = new Set(g.fullTiles().map((t) => t.kind).filter((k) => k >= 1 && k <= 7));
  eq(all.size, 0, '手牌に 2〜8m が無い');
  // 受け入れ・待ちから山に無い牌種が除かれる
  g.hand = Tiles.sortTiles(P('99m123p456p789s11z'));
  g.drawn = { id: 999, kind: 30, red: false };
  const rows = g.analysis();
  const drop9m = rows.find((r) => r.kind === 8);
  eq(drop9m.accepts.some((a) => a.kind >= 1 && a.kind <= 7), false, '受け入れに 2〜8m を含めない');
  g.hand = Tiles.sortTiles(P('99m123p456p789s11z')); // 9m / 1z シャンポン待ち
  const w = g.handInfo();
  eq(w.shanten, 0, '聴牌');
  eq(w.waits.map((x) => x.kind), [8, 27], '待ちは 9m と 東');
  eq(w.waits.every((x) => g.initialCounts[x.kind] > 0), true, '待ちは山にある牌種のみ');
}
{
  // どの牌種の組み合わせでも、山にある牌種はすべてドラになりうる
  let bad = 0, combos = 0;
  for (let mask = 1; mask < 1 << Tiles.TILE_GROUPS.length; mask++) {
    const s = {};
    Tiles.TILE_GROUPS.forEach((grp, i) => { s[grp.key] = !!(mask >> i & 1); });
    const kinds = Tiles.kindsFromSettings(s);
    const avail = Tiles.counts(Tiles.makeWall(false, kinds));
    const doras = new Set([...kinds].map((k) => Tiles.nextDora(k, avail)));
    for (const k of kinds) if (!doras.has(k) || !kinds.has(Tiles.nextDora(k, avail))) bad++;
    combos++;
  }
  eq([combos, bad], [127, 0], '全127通りの牌種構成で全牌種がドラになりうる');
  const only = (keys) => Tiles.counts(Tiles.makeWall(false, Tiles.kindsFromSettings(
    Object.fromEntries(Tiles.TILE_GROUPS.map((grp) => [grp.key, keys.includes(grp.key)])))));
  eq(Tiles.nextDora(16, only(['tileP28'])), 10, '筒子28のみ: 8p 表示のドラは 2p');
  eq(Tiles.nextDora(0, only(['tileM19'])), 8, '萬子19のみ: 1m 表示のドラは 9m');
}
{
  eq(Tiles.makeWall(false).length, 136, '全種で 136 枚');
  eq(Tiles.makeWall(false, Tiles.kindsFromSettings({ tileZ: false })).length, 108, '字牌抜きで 108 枚');
  eq(Tiles.makeWall(true, Tiles.kindsFromSettings({ tileM28: false })).filter((t) => t.red).length, 2, '三麻では赤は 2 枚');
}
{
  // カンのテスト: 手牌を差し替える
  const g = new Game(S({ redDora: false }));
  g.hand = Tiles.sortTiles(P('1111m234p567s99s1z'));
  eq(g.kanOptions(), [0], '1m 暗槓可');
  const before = g.remaining;
  g.kan(0);
  eq([g.kans.length, g.hand.length, g.doraCount, g.remaining, g.rinshan], [1, 10, 2, before - 1, true], '暗槓後: 手牌10枚, ドラ2, 山-1, 嶺上');
  eq(g.fullTiles().length, 11, '嶺上牌をツモ');
}
{
  // リーチ → 一発ツモ
  const g = new Game(S({ redDora: false }));
  g.hand = Tiles.sortTiles(P('234m567m45p678s99s'));
  const drawn = g.drawn;
  eq(g.riichiCandidates().includes(drawn.id) || g.riichiCandidates().length > 0, true, 'リーチ可能');
  g.discard(drawn.id, true);
  eq([g.riichi, g.doubleRiichi, g.ippatsu], [true, true, true], '第一打牌リーチはダブリー');
  g.phase = 'draw';
  g.wall.push({ id: 999, kind: 11, red: false }); // 3p を仕込む
  g.draw();
  const r = g.canTsumo();
  eq(names(r).slice(0, 3), ['ダブル立直', '一発', '門前清自摸和'], 'ダブリー一発ツモ');
  // 天和判定: 配牌直後に和了形
  const t = new Game(S({ redDora: false }));
  t.hand = Tiles.sortTiles(P('123m456p789s11z22z'));
  t.drawn = { id: 998, kind: 28, red: false };
  eq(names(t.canTsumo()), ['天和'], '配牌14枚で和了形なら天和');
}

console.log('条件付き自動ツモ切り');
{
  const A = AutoDiscard;
  const ctx = { doraKinds: [4], roundWind: 27, seatWind: 28 };
  const T = (s) => P(s)[0];
  const cfg = (o) => A.normalize(o);
  const m = (tile, key) => A.matches(T(tile), key, ctx);
  eq([m('5s', 'suit:s'), m('5m', 'suit:s'), m('1z', 'suit:wind'), m('7z', 'suit:dragon')], [true, false, true, true], '種類');
  eq([m('1m', 'num:yaochu'), m('7z', 'num:yaochu'), m('2p', 'num:yaochu'), m('5p', 'num:simple'), m('3s', 'num:3'), m('3z', 'num:3')],
    [true, true, false, true, true, false], '数字（么九は字牌を含む。1〜9 は数牌のみ）');
  eq([m('5m', 'dora:dora'), m('0p', 'dora:red'), m('5p', 'dora:red')], [true, true, false], '表ドラ・赤ドラ');
  eq([1, 2, 3, 4, 5, 7].map((n) => m(`${n}z`, 'yakuhai')), [true, true, false, false, true, true], '役牌（場風東・自風南・三元）');
  eq(m('7z', 'kind:33'), true, '特定の牌');

  const old = A.normalize({ combine: 'and', rules: [{ suits: ['m', 'p'], nums: [], dora: ['red'], yakuhai: false, kinds: [33], count: 3, countMode: 'hold', enabled: true }] });
  eq([old.combine, old.countMode, old.items], ['and', 'hold', [{ key: 'suit:m', count: 3 }, { key: 'suit:p', count: 3 }, { key: 'dora:red', count: 3 }, { key: 'kind:33', count: 3 }]], '旧形式のルールを項目に移行');
  eq(A.normalize({ items: [{ key: 'bogus', count: 2 }, { key: 'kind:40', count: 1 }] }).items, [], '不正な項目は捨てる');

  // 項目ごとの目標枚数（萬子5枚・筒子3枚）
  const two = cfg({ items: [{ key: 'suit:m', count: 5 }, { key: 'suit:p', count: 3 }], countMode: 'draw' });
  const draws = {};
  for (const t of P('1m2m3p4p')) A.countDraw(draws, t, two, ctx);
  let prog = A.progress(two, draws, [], ctx);
  eq(prog.map((x) => [x.have, x.need]), [[2, 5], [2, 3]], 'ツモ累計は項目ごとに数える');
  eq(A.goalReached(prog, two), false, '複数種でも1枚では止まらない');
  A.countDraw(draws, T('5p'), two, ctx);
  prog = A.progress(two, draws, [], ctx);
  eq([A.goalReached(prog, two), A.goalReached(prog, Object.assign({}, two, { combine: 'and' }))], [true, false], 'OR は1項目達成、AND は全項目');
  const sum = Object.assign({}, two, { combine: 'sum', total: 5 });
  eq(A.goalReached(A.progress(sum, draws, [], ctx), sum), true, '合計5枚（萬2＋筒3）で達成');
  const hold = cfg({ items: [{ key: 'kind:33', count: 2 }], countMode: 'hold' });
  eq(A.progress(hold, {}, P('77z123m'), ctx)[0].done, true, '保持数');

  // 手出し: 欲しくない牌のうち牌効率で最も不要な牌
  const want = cfg({ items: [{ key: 'suit:s', count: 9 }], countMode: 'hold' });
  const tiles = P('123s456s789s1m5p9p11z');
  const rows = Shanten.analyzeDiscards(Tiles.counts(tiles), 0);
  const pick = A.pickDiscard(tiles, want, ctx, rows, { rand: () => 0 });
  eq([0, 13, 17].includes(pick.kind), true, '索子と対子を残して孤立牌を切る');
  eq(A.pickDiscard(P('0p5p'), cfg({ items: [{ key: 'kind:33', count: 1 }] }), ctx, [], { rand: () => 0 }).red, false, '同種なら赤でない方を切る');
  const drawnP = T('9p');
  drawnP.id = 500;
  eq(A.pickDiscard(P('123s456s789s1m5p11z').concat([drawnP]), want, ctx, rows, { drawnId: 500 }).id, 500,
    '欲しくない牌を引いたらツモ切り');

  // 目標を超えた牌は切れる（純正九蓮: 1萬×3・2〜8萬×1・9萬×3、AND・保持数）
  const chuuren = cfg({ combine: 'and', countMode: 'hold', items: [{ key: 'kind:0', count: 3 },
    ...[1, 2, 3, 4, 5, 6, 7].map((k) => ({ key: `kind:${k}`, count: 1 })), { key: 'kind:8', count: 3 }] });
  const ch = P('2234056778899m');
  const drawn8 = ch.find((t) => t.kind === 7);
  const chPick = A.pickDiscard(ch, chuuren, ctx, Shanten.analyzeDiscards(Tiles.counts(ch), 0), { drawnId: drawn8.id });
  eq(chPick.id, drawn8.id, '全部欲しい牌でも目標を超えた牌（3枚目の8萬）を切る');
  const chRows = Shanten.analyzeDiscards(Tiles.counts(ch), 0);
  for (let i = 0; i < 20; i++) {
    const t = A.pickDiscard(ch, chuuren, ctx, chRows, { rand: Math.random });
    if (![1, 4, 6, 7].includes(t.kind) || t.red) { eq(t, 'surplus', '余っている牌（2・5・7・8萬）だけを切る'); break; }
    if (i === 19) eq(true, true, '余っている牌（2・5・7・8萬、赤5は残す）だけを切る');
  }
  eq(A.pickDiscard(P('1m2m2m1p'), chuuren, ctx, [], { rand: () => 0 }).kind, 9, '欲しくない牌が先、余りは後');
  eq(A.pickDiscard(P('1m2m2m'), chuuren, ctx, [], { rand: () => 0 }).kind, 1, '欲しくない牌が無ければ余りを切る');

  // どの牌も目標に足りなくても、損の最も小さい牌を切って続ける（萬子×10 AND 中張×10）
  const mixed = cfg({ combine: 'and', countMode: 'hold', items: [{ key: 'suit:m', count: 10 }, { key: 'num:simple', count: 10 }] });
  const stuck = P('1111999m234567p2m');
  const stuckPick = A.pickDiscard(stuck, mixed, ctx, [], { rand: () => 0 });
  eq(stuckPick.kind !== 1, true, '萬子の中張（2項目に合う）は残す');

  // 手出しの選び方
  const pickTiles = P('123m456p789s11z2z3z5z');
  const pickRows = Shanten.analyzeDiscards(Tiles.counts(pickTiles), 0);
  const none = cfg({ items: [{ key: 'kind:33', count: 1 }] });
  const picks = (method) => {
    const set = new Set();
    for (let i = 0; i < 200; i++) set.add(A.pickDiscard(pickTiles, Object.assign({}, none, { pick: method }), ctx, pickRows).kind);
    return [...set].sort((x, y) => x - y);
  };
  eq(picks('keep'), [28, 29, 31], '向聴を保ってランダム: 向聴が変わらない孤立字牌から選ぶ');
  eq(picks('random').length > 3, true, '完全ランダム: 面子の牌も切りうる');
  eq(A.normalize({ pick: 'keep' }).pick, 'keep', '選び方を保存');
  eq(A.normalize({ pick: 'bogus' }).pick, 'efficiency', '不正な選び方は牌効率');

  // 達成できるか
  const wall = Tiles.makeWall(true);
  const nodora = { doraKinds: null, roundWind: 27, seatWind: 28 };
  const ok = (o) => A.feasibility(cfg(Object.assign({ combine: 'and', countMode: 'hold' }, o)), wall, nodora);
  eq(ok({ items: [{ key: 'suit:m', count: 9 }, { key: 'num:simple', count: 9 }] }).ok, true, '重なる項目は合計18でも達成可能');
  eq(ok({ items: [{ key: 'kind:0', count: 5 }] }).messages, ['1萬は山に4枚までです'], '1種は4枚まで');
  eq(ok({ items: [{ key: 'dora:red', count: 4 }] }).ok, false, '赤ドラは3枚まで');
  eq(ok({ items: [{ key: 'kind:0', count: 4 }, { key: 'kind:8', count: 4 }, { key: 'kind:4', count: 4 }, { key: 'kind:27', count: 3 }] }).ok,
    false, '重ならない15枚は揃わない');
  eq(ok(chuuren).ok, true, '純正九蓮は達成可能');
  eq(ok({ items: [{ key: 'kind:0', count: 4 }, { key: 'kind:8', count: 4 }, { key: 'kind:4', count: 4 }, { key: 'kind:27', count: 3 }], countMode: 'draw' }).ok,
    true, 'ツモ累計は14枚の制限なし');
  eq(ok({ combine: 'or', items: [{ key: 'kind:0', count: 5 }, { key: 'kind:1', count: 2 }] }).ok, true, 'OR はどれか1つ達成できればよい');
  eq(ok({ combine: 'sum', total: 9, items: [{ key: 'kind:0', count: 1 }, { key: 'kind:1', count: 1 }] }).messages,
    ['合計9枚は揃いません（最大8枚）'], '合計は該当する牌の枚数まで');
  eq(A.feasibility(cfg({ combine: 'and', countMode: 'hold', items: [{ key: 'dora:dora', count: 4 }, { key: 'suit:p', count: 11 }] }),
    wall, Object.assign({}, nodora, { doraKinds: [0] })).ok, false, '実際のドラ（1萬）では筒子と重ならず15枚');
  eq(A.feasibility(cfg({ combine: 'and', countMode: 'hold', items: [{ key: 'dora:dora', count: 4 }, { key: 'suit:p', count: 11 }] }),
    wall, Object.assign({}, nodora, { doraKinds: [9] })).ok, true, '実際のドラ（1筒）なら重なって達成可能');
  eq(A.feasibility(cfg({ combine: 'and', countMode: 'hold', items: [{ key: 'kind:0', count: 4 }, { key: 'kind:8', count: 4 }, { key: 'kind:4', count: 4 }, { key: 'kind:27', count: 3 }] }),
    wall, nodora, 15).ok, true, 'カン1回で15枚まで持てる');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
