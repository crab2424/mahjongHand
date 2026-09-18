'use strict';
/**
 * 役判定・符計算・点数計算
 *
 * evaluate(ctx) の ctx:
 *   closed:   和了牌を除く門前手牌（牌オブジェクト配列, 13 - 3×槓子 枚）
 *   winTile:  和了牌（ツモ牌）
 *   kans:     [{ kind, tiles }] 暗槓
 *   riichi, doubleRiichi, ippatsu, haitei, rinshan, tenhou: 状況役フラグ
 *   roundWind, seatWind: 場風・自風 (27..30)
 *   doraKinds, uraKinds: ドラ牌種配列
 *   isDealer: 親か
 * 戻り値: { yaku:[{name, han}], han, fu, yakumanCount, points:{total, detail}, limit } または null（役なし）
 */
const Yaku = (() => {
  const T = Tiles;
  const DRAGON_NAMES = { 31: '白', 32: '發', 33: '中' };
  const GREEN = new Set([19, 20, 21, 23, 25, 32]); // 2s3s4s6s8s發

  function evaluate(ctx) {
    const kans = ctx.kans || [];
    const closed = ctx.closed.concat([ctx.winTile]);
    const c = T.counts(closed);
    const allTiles = closed.concat(...kans.map((k) => k.tiles));
    const allKinds = allTiles.map((t) => t.kind);
    const winKind = ctx.winTile.kind;
    const cands = [];

    if (kans.length === 0) {
      if (isKokushi(c)) cands.push(scoreKokushi(c, winKind, ctx, allTiles));
      if (isChiitoi(c)) cands.push(scoreChiitoi(ctx, allTiles, allKinds));
    }
    for (const d of Shanten.decompose(c)) {
      const melds = d.melds.concat(kans.map((k) => ({ type: 'kan', t: k.kind })));
      for (const form of waitForms(d, winKind)) {
        cands.push(scoreRegular(melds, d.pair, form, ctx, allTiles, allKinds));
      }
    }
    const valid = cands.filter(Boolean);
    if (!valid.length) return null;
    valid.sort(compare);
    return valid[0];
  }

  function compare(a, b) {
    return (b.yakumanCount - a.yakumanCount) || (b.points.total - a.points.total) || (b.han - a.han) || (b.fu - a.fu);
  }

  // ---------- 特殊形 ----------
  function isKokushi(c) {
    let sum = 0;
    for (const k of T.YAOCHU) { if (c[k] === 0) return false; sum += c[k]; }
    return sum === 14;
  }
  function isChiitoi(c) {
    let pairs = 0;
    for (const n of c) { if (n === 2) pairs++; else if (n !== 0) return false; }
    return pairs === 7;
  }

  function scoreKokushi(c, winKind, ctx, allTiles) {
    const yakuman = [];
    if (ctx.tenhou) yakuman.push({ name: '天和', v: 1 });
    // 和了牌が雀頭になった = 和了前は13種1枚ずつ = 十三面待ち
    yakuman.push(c[winKind] === 2 ? { name: '国士無双十三面', v: 2 } : { name: '国士無双', v: 1 });
    return finalize([], yakuman, 0, ctx, allTiles);
  }

  function scoreChiitoi(ctx, allTiles, allKinds) {
    const yakuman = [];
    if (ctx.tenhou) yakuman.push({ name: '天和', v: 1 });
    if (allKinds.every(T.isHonor)) yakuman.push({ name: '字一色', v: 1 });
    if (yakuman.length) return finalize([], yakuman, 25, ctx, allTiles);

    const yaku = [];
    pushSituational(yaku, ctx);
    yaku.push({ name: '七対子', han: 2 });
    if (allKinds.every(T.isSimple)) yaku.push({ name: '断幺九', han: 1 });
    if (allKinds.every(T.isYaochu)) yaku.push({ name: '混老頭', han: 2 });
    pushFlush(yaku, allKinds);
    return finalize(yaku, [], 25, ctx, allTiles);
  }

  // ---------- 一般形 ----------
  /** 和了牌がどの部分を完成させたかの候補（待ちの形） */
  function waitForms(d, winKind) {
    const forms = [];
    if (d.pair === winKind) forms.push({ type: 'tanki' });
    d.melds.forEach((m, idx) => {
      if (m.type === 'pon') {
        if (m.t === winKind) forms.push({ type: 'shanpon', idx });
      } else {
        const t = m.t;
        if (winKind === t) forms.push({ type: t % 9 === 6 ? 'penchan' : 'ryanmen', idx });
        if (winKind === t + 1) forms.push({ type: 'kanchan', idx });
        if (winKind === t + 2) forms.push({ type: t % 9 === 0 ? 'penchan' : 'ryanmen', idx });
      }
    });
    return forms;
  }

  function scoreRegular(melds, pair, form, ctx, allTiles, allKinds) {
    const pons = melds.filter((m) => m.type !== 'chi');
    const chis = melds.filter((m) => m.type === 'chi');
    const kansN = melds.filter((m) => m.type === 'kan').length;
    const meldKinds = (m) => (m.type === 'chi' ? [m.t, m.t + 1, m.t + 2] : [m.t]);

    // ---- 役満 ----
    const yakuman = [];
    if (ctx.tenhou) yakuman.push({ name: '天和', v: 1 });
    if (pons.length === 4) {
      yakuman.push(form.type === 'tanki' ? { name: '四暗刻単騎', v: 2 } : { name: '四暗刻', v: 1 });
    }
    const dragonPons = pons.filter((m) => T.isDragon(m.t)).length;
    if (dragonPons === 3) yakuman.push({ name: '大三元', v: 1 });
    const windPons = pons.filter((m) => T.isWind(m.t)).length;
    if (windPons === 4) yakuman.push({ name: '大四喜', v: 2 });
    else if (windPons === 3 && T.isWind(pair)) yakuman.push({ name: '小四喜', v: 1 });
    if (allKinds.every(T.isHonor)) yakuman.push({ name: '字一色', v: 1 });
    if (allKinds.every(T.isTerminal)) yakuman.push({ name: '清老頭', v: 1 });
    if (allKinds.every((k) => GREEN.has(k))) yakuman.push({ name: '緑一色', v: 1 });
    if (kansN === 4) yakuman.push({ name: '四槓子', v: 1 });
    const chuuren = checkChuuren(allKinds, ctx.winTile.kind, kansN);
    if (chuuren) yakuman.push(chuuren);
    if (yakuman.length) return finalize([], yakuman, 0, ctx, allTiles);

    // ---- 通常役 ----
    const yaku = [];
    pushSituational(yaku, ctx);

    if (allKinds.every(T.isSimple)) yaku.push({ name: '断幺九', han: 1 });

    const pairIsYakuhai = T.isDragon(pair) || pair === ctx.roundWind || pair === ctx.seatWind;
    const pinfu = kansN === 0 && chis.length === 4 && form.type === 'ryanmen' && !pairIsYakuhai;
    if (pinfu) yaku.push({ name: '平和', han: 1 });

    const chiCount = {};
    for (const m of chis) chiCount[m.t] = (chiCount[m.t] || 0) + 1;
    const peikou = Object.values(chiCount).reduce((a, n) => a + Math.floor(n / 2), 0);
    if (peikou === 2) yaku.push({ name: '二盃口', han: 3 });
    else if (peikou === 1) yaku.push({ name: '一盃口', han: 1 });

    for (const m of pons) {
      if (T.isDragon(m.t)) yaku.push({ name: `役牌 ${DRAGON_NAMES[m.t]}`, han: 1 });
      if (m.t === ctx.roundWind) yaku.push({ name: `場風 ${T.WINDS[m.t]}`, han: 1 });
      if (m.t === ctx.seatWind) yaku.push({ name: `自風 ${T.WINDS[m.t]}`, han: 1 });
    }

    for (let n = 0; n <= 6; n++) {
      if (chiCount[n] && chiCount[n + 9] && chiCount[n + 18]) { yaku.push({ name: '三色同順', han: 2 }); break; }
    }
    for (let s = 0; s < 3; s++) {
      if (chiCount[s * 9] && chiCount[s * 9 + 3] && chiCount[s * 9 + 6]) { yaku.push({ name: '一気通貫', han: 2 }); break; }
    }
    if (pons.length === 3) yaku.push({ name: '三暗刻', han: 2 });
    const ponSet = new Set(pons.map((m) => m.t));
    for (let n = 0; n < 9; n++) {
      if (ponSet.has(n) && ponSet.has(n + 9) && ponSet.has(n + 18)) { yaku.push({ name: '三色同刻', han: 2 }); break; }
    }
    if (kansN === 3) yaku.push({ name: '三槓子', han: 2 });

    if (allKinds.every(T.isYaochu)) {
      yaku.push({ name: '混老頭', han: 2 });
    } else if (melds.every((m) => meldKinds(m).some(T.isYaochu)) && T.isYaochu(pair)) {
      if (allKinds.some(T.isHonor)) yaku.push({ name: '混全帯幺九', han: 2 });
      else yaku.push({ name: '純全帯幺九', han: 3 });
    }
    if (dragonPons === 2 && T.isDragon(pair)) yaku.push({ name: '小三元', han: 2 });
    pushFlush(yaku, allKinds);

    // ---- 符 ----
    let fu;
    if (pinfu) {
      fu = 20;
    } else {
      fu = 20 + 2; // 副底 + 門前ツモ
      for (const m of melds) {
        if (m.type === 'pon') fu += T.isYaochu(m.t) ? 8 : 4;
        else if (m.type === 'kan') fu += T.isYaochu(m.t) ? 32 : 16;
      }
      if (T.isDragon(pair)) fu += 2;
      if (pair === ctx.roundWind) fu += 2;
      if (pair === ctx.seatWind) fu += 2;
      if (form.type === 'tanki' || form.type === 'kanchan' || form.type === 'penchan') fu += 2;
      fu = Math.ceil(fu / 10) * 10;
    }
    return finalize(yaku, [], fu, ctx, allTiles);
  }

  function checkChuuren(allKinds, winKind, kansN) {
    if (kansN > 0 || allKinds.some(T.isHonor)) return null;
    const suit = T.suitOf(allKinds[0]);
    if (!allKinds.every((k) => T.suitOf(k) === suit)) return null;
    const cnt = new Array(9).fill(0);
    for (const k of allKinds) cnt[k % 9]++;
    const base = [3, 1, 1, 1, 1, 1, 1, 1, 3];
    let extra = -1;
    for (let i = 0; i < 9; i++) {
      const d = cnt[i] - base[i];
      if (d < 0 || d > 1) return null;
      if (d === 1) { if (extra >= 0) return null; extra = i; }
    }
    if (extra < 0) return null;
    return extra === winKind % 9 ? { name: '純正九蓮宝燈', v: 2 } : { name: '九蓮宝燈', v: 1 };
  }

  function pushSituational(yaku, ctx) {
    if (ctx.riichi) yaku.push(ctx.doubleRiichi ? { name: 'ダブル立直', han: 2 } : { name: '立直', han: 1 });
    if (ctx.ippatsu) yaku.push({ name: '一発', han: 1 });
    yaku.push({ name: '門前清自摸和', han: 1 });
    if (ctx.haitei) yaku.push({ name: '海底摸月', han: 1 });
    if (ctx.rinshan) yaku.push({ name: '嶺上開花', han: 1 });
  }

  function pushFlush(yaku, allKinds) {
    const suits = new Set(allKinds.filter((k) => k < 27).map((k) => Math.floor(k / 9)));
    if (suits.size !== 1) return;
    if (allKinds.some(T.isHonor)) yaku.push({ name: '混一色', han: 3 });
    else yaku.push({ name: '清一色', han: 6 });
  }

  function countDora(tiles, doraKinds) {
    let n = 0;
    for (const t of tiles) for (const d of doraKinds) if (t.kind === d) n++;
    return n;
  }

  // ---------- 集計・点数 ----------
  function finalize(yaku, yakuman, fu, ctx, allTiles) {
    let list, han = 0, yakumanCount = 0;
    if (yakuman.length) {
      yakumanCount = yakuman.reduce((a, y) => a + y.v, 0);
      list = yakuman.map((y) => ({ name: y.name, han: y.v === 2 ? 'ダブル役満' : '役満', yakuman: true }));
      han = 13 * yakumanCount;
    } else {
      if (!yaku.length) return null;
      list = yaku.slice();
      const dora = countDora(allTiles, ctx.doraKinds || []);
      const aka = allTiles.filter((t) => t.red).length;
      const ura = ctx.riichi ? countDora(allTiles, ctx.uraKinds || []) : 0;
      if (dora) list.push({ name: 'ドラ', han: dora });
      if (aka) list.push({ name: '赤ドラ', han: aka });
      if (ura) list.push({ name: '裏ドラ', han: ura });
      han = list.reduce((a, y) => a + y.han, 0);
    }
    const points = calcPoints(han, fu, yakumanCount, !!ctx.isDealer);
    return { yaku: list, han, fu, yakumanCount, points, limit: limitName(han, fu, yakumanCount) };
  }

  function basePoints(han, fu, yakumanCount) {
    if (yakumanCount) return 8000 * yakumanCount;
    if (han >= 13) return 8000;
    if (han >= 11) return 6000;
    if (han >= 8) return 4000;
    if (han >= 6) return 3000;
    if (han >= 5) return 2000;
    return Math.min(2000, fu * Math.pow(2, han + 2));
  }

  function limitName(han, fu, yakumanCount) {
    if (yakumanCount >= 2) return `${yakumanCount}倍役満`;
    if (yakumanCount === 1) return '役満';
    if (han >= 13) return '数え役満';
    if (han >= 11) return '三倍満';
    if (han >= 8) return '倍満';
    if (han >= 6) return '跳満';
    if (basePoints(han, fu, 0) >= 2000) return '満貫';
    return '';
  }

  /** ツモ和了の点数（親: ◯オール、子: 子-親） */
  function calcPoints(han, fu, yakumanCount, isDealer) {
    const base = basePoints(han, fu, yakumanCount);
    const ceil100 = (x) => Math.ceil(x / 100) * 100;
    if (isDealer) {
      const each = ceil100(base * 2);
      return { base, total: each * 3, detail: `${each}オール` };
    }
    const ko = ceil100(base);
    const oya = ceil100(base * 2);
    return { base, total: ko * 2 + oya, detail: `${ko}-${oya}` };
  }

  return { evaluate, calcPoints, basePoints, limitName };
})();
