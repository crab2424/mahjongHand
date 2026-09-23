'use strict';
/**
 * 条件付き自動ツモ切り（欲しい牌が来るまで、欲しくない牌を切る）
 *
 * 設定: {
 *   items: [{ key, count }]   欲しい牌の条件（項目ごとに目標枚数）
 *   combine: 'or' | 'and' | 'sum'
 *     or:  どれか1項目が目標枚数に達したら停止
 *     and: すべての項目が目標枚数に達したら停止
 *     sum: いずれかの項目に合う牌が合計 total 枚に達したら停止
 *   total: N                  sum のときの目標枚数
 *   countMode: 'draw' | 'hold' ツモ累計／手牌（カン含む）の保持数
 *   pick: 'efficiency' | 'keep' | 'random'  手出しの選び方（牌効率／向聴を保ってランダム／完全ランダム）
 * }
 * 項目 key: 'suit:m|p|s|wind|dragon' 'num:yaochu|simple|1..9' 'dora:dora|red' 'yakuhai' 'kind:0..33'
 * ctx: { doraKinds, roundWind, seatWind }
 */
const AutoDiscard = (() => {
  // [key, ボタンの表示, 説明]
  const GROUPS = [
    { label: '種類', items: [['suit:m', '萬子', '萬子'], ['suit:p', '筒子', '筒子'], ['suit:s', '索子', '索子'],
      ['suit:wind', '風牌', '風牌（東南西北）'], ['suit:dragon', '三元牌', '三元牌（白發中）']] },
    { label: '数字', items: [['num:yaochu', '么九', '么九牌（1・9・字牌）'], ['num:simple', '中張', '中張牌（2〜8）'],
      ...'123456789'.split('').map((n) => [`num:${n}`, n, `数牌の${n}（萬子・筒子・索子）`])] },
    { label: 'ドラ・役牌', items: [['dora:dora', 'ドラ', 'ドラ（カンドラ含む）'], ['dora:red', '赤ドラ', '赤ドラ（赤5）'],
      ['yakuhai', '役牌', '役牌（三元牌・場風・自風）']] },
  ];
  const PICKS = ['efficiency', 'keep', 'random'];
  const LABELS = Object.fromEntries(GROUPS.flatMap((g) => g.items.map(([key, short]) => [key, short])));

  function defaults() {
    return { items: [], combine: 'or', total: 1, countMode: 'draw', pick: 'efficiency' };
  }

  const clampCount = (n) => Math.min(14, Math.max(1, Math.round(+n) || 1));

  /** 保存値を正規化（旧形式 rules からの移行も含む） */
  function normalize(src) {
    const cfg = defaults();
    if (!src || typeof src !== 'object') return cfg;
    if (['or', 'and', 'sum'].includes(src.combine)) cfg.combine = src.combine;
    cfg.total = clampCount(src.total);
    cfg.countMode = src.countMode === 'hold' ? 'hold' : 'draw';
    if (PICKS.includes(src.pick)) cfg.pick = src.pick;
    const items = new Map();
    const add = (key, count) => { if (isKey(key) && !items.has(key)) items.set(key, clampCount(count)); };
    if (Array.isArray(src.items)) for (const it of src.items) if (it) add(it.key, it.count);
    if (Array.isArray(src.rules)) {
      // 旧形式: ルール内の各属性を個別の項目に展開する
      for (const r of src.rules) {
        if (!r || r.enabled === false) continue;
        if (r.countMode === 'hold') cfg.countMode = 'hold';
        for (const v of r.suits || []) add(`suit:${v}`, r.count);
        for (const v of r.nums || []) add(`num:${v}`, r.count);
        for (const v of r.dora || []) add(`dora:${v}`, r.count);
        if (r.yakuhai) add('yakuhai', r.count);
        for (const v of r.kinds || []) add(`kind:${v}`, r.count);
      }
    }
    cfg.items = [...items].map(([key, count]) => ({ key, count }));
    return cfg;
  }

  function isKey(key) {
    if (typeof key !== 'string') return false;
    if (key in LABELS) return true;
    const m = /^kind:(\d+)$/.exec(key);
    return !!m && +m[1] >= 0 && +m[1] < 34;
  }

  /** 進捗・一覧表示用の短い名前 */
  function shortLabel(key) {
    if (key.startsWith('kind:')) return Tiles.info(+key.slice(5)).label;
    if (/^num:\d$/.test(key)) return `数牌${key.slice(4)}`;
    return LABELS[key] || key;
  }

  /** 牌 tile が項目 key に合うか */
  function matches(tile, key, ctx) {
    const k = tile.kind;
    const [type, val] = key.split(':');
    switch (type) {
      case 'suit':
        if (k < 27) return 'mps'[Math.floor(k / 9)] === val;
        return val === (k <= 30 ? 'wind' : 'dragon');
      case 'num':
        if (val === 'yaochu') return Tiles.isYaochu(k);
        if (val === 'simple') return Tiles.isSimple(k);
        return k < 27 && Tiles.numOf(k) === +val;
      case 'dora':
        return val === 'red' ? !!tile.red : ctx.doraKinds.includes(k);
      case 'yakuhai':
        return Tiles.isDragon(k) || k === ctx.roundWind || k === ctx.seatWind;
      case 'kind':
        return k === +val;
      default:
        return false;
    }
  }

  const isActive = (cfg) => !!cfg && cfg.items.length > 0;
  /** 欲しい牌か（いずれかの項目に合う） */
  const isWanted = (tile, cfg, ctx) => cfg.items.some((it) => matches(tile, it.key, ctx));

  /**
   * 1枚ツモったときのツモ累計を更新する。draws: { [key]: n, '*': 欲しい牌の合計 }
   */
  function countDraw(draws, tile, cfg, ctx) {
    let any = false;
    for (const it of cfg.items) {
      if (!matches(tile, it.key, ctx)) continue;
      draws[it.key] = (draws[it.key] || 0) + 1;
      any = true;
    }
    if (any) draws['*'] = (draws['*'] || 0) + 1;
    return draws;
  }

  /**
   * 進捗 [{ key, label, have, need, done }]。sum のときは合計1行（key '*'）。
   * held: 手牌＋カンの牌
   */
  function progress(cfg, draws, held, ctx) {
    const hold = cfg.countMode === 'hold';
    if (cfg.combine === 'sum') {
      const have = hold ? held.filter((t) => isWanted(t, cfg, ctx)).length : draws['*'] || 0;
      const need = clampCount(cfg.total);
      return [{ key: '*', label: '合計', have, need, done: have >= need }];
    }
    return cfg.items.map((it) => {
      const have = hold ? held.filter((t) => matches(t, it.key, ctx)).length : draws[it.key] || 0;
      const need = clampCount(it.count);
      return { key: it.key, label: shortLabel(it.key), have, need, done: have >= need };
    });
  }

  /** 目標達成か */
  function goalReached(prog, cfg) {
    if (prog.length === 0) return false;
    return cfg.combine === 'and' ? prog.every((p) => p.done) : prog.some((p) => p.done);
  }

  /**
   * 切る牌を選ぶ（ツモ牌を含む14枚から）。
   * 1. 切ったときに「不足」（Σ max(0, 目標 − 手牌＋カンの枚数)）が最も増えない牌
   * 2. その中で合う項目が少ない牌（欲しくない牌 → 目標を超えている牌の順）
   * 3. ツモ牌が 1・2 で最善ならツモ切り。そうでなければ cfg.pick の方式で手出し
   * opts: { drawnId, kanTiles, rand }。tiles が空なら null
   */
  function pickDiscard(tiles, cfg, ctx, analysis, opts = {}) {
    if (tiles.length === 0) return null;
    const rand = opts.rand || Math.random;
    const held = tiles.concat(opts.kanTiles || []);
    // 評価の単位: sum のときは「欲しい牌」1項目、それ以外は各項目
    const units = cfg.combine === 'sum'
      ? [{ need: clampCount(cfg.total), test: (t) => isWanted(t, cfg, ctx) }]
      : cfg.items.map((it) => ({ need: clampCount(it.count), test: (t) => matches(t, it.key, ctx) }));
    for (const u of units) u.have = held.filter(u.test).length;
    const cost = (t) => {
      let loss = 0, hits = 0;
      for (const u of units) {
        if (!u.test(t)) continue;
        hits++;
        if (u.have <= u.need) loss++;
      }
      return [loss, hits];
    };
    const costs = new Map(tiles.map((t) => [t.id, cost(t)]));
    const cmpCost = (a, b) => {
      const ca = costs.get(a.id), cb = costs.get(b.id);
      return ca[0] - cb[0] || ca[1] - cb[1];
    };
    const sorted = tiles.slice().sort(cmpCost);
    const tier = sorted.filter((t) => cmpCost(t, sorted[0]) === 0);
    const drawn = opts.drawnId == null ? null : tier.find((t) => t.id === opts.drawnId);
    if (drawn) return drawn;
    return pickByMethod(tier, cfg.pick, analysis, rand);
  }

  /** 候補から方式に従って1枚選ぶ。牌種を選んでから、同種なら赤でない方を切る */
  function pickByMethod(cands, method, analysis, rand) {
    const rank = new Map((analysis || []).map((r) => [r.kind, r]));
    const shanten = (k) => (rank.has(k) ? rank.get(k).shanten : 99);
    let kinds = [...new Set(cands.map((t) => t.kind))];
    if (method !== 'random') {
      const minS = Math.min(...kinds.map(shanten));
      kinds = kinds.filter((k) => shanten(k) === minS);
    }
    if (method === 'efficiency' || !PICKS.includes(method)) {
      const total = (k) => (rank.has(k) ? rank.get(k).total : 0);
      const maxT = Math.max(...kinds.map(total));
      kinds = kinds.filter((k) => total(k) === maxT);
    }
    const kind = kinds[Math.floor(rand() * kinds.length) % kinds.length];
    const same = cands.filter((t) => t.kind === kind);
    return same.find((t) => !t.red) || same[0];
  }

  // ---------- 達成できるかの判定 ----------
  /**
   * 項目ごとに山にある該当枚数。wall: 山の全牌（Tiles.makeWall）、ctx.doraKinds が null ならドラは4枚とみなす
   */
  function available(key, wall, ctx) {
    if (key === 'dora:dora' && !ctx.doraKinds) return 4;
    return wall.filter((t) => matches(t, key, ctx)).length;
  }

  /**
   * 条件が達成できるか。{ ok, messages: [理由] }
   * 保持数は手牌 cap 枚（14＋カン数）以内、ツモ累計は項目ごとの山の枚数だけを見る。
   * ctx.doraKinds が null（設定画面）のときドラは「他の項目と重ならない4枚」とみなす。
   */
  function feasibility(cfg, wall, ctx, cap = 14) {
    const hold = cfg.countMode === 'hold';
    const messages = [];
    if (!isActive(cfg)) return { ok: true, messages };
    const avail = new Map(cfg.items.map((it) => [it.key, available(it.key, wall, ctx)]));
    const limit = (key) => (hold ? Math.min(cap, avail.get(key)) : avail.get(key));

    if (cfg.combine === 'sum') {
      const unknownDora = !ctx.doraKinds && cfg.items.some((it) => it.key === 'dora:dora');
      const n = wall.filter((t) => isWanted(t, cfg, ctx)).length + (unknownDora ? 4 : 0);
      const max = hold ? Math.min(cap, n) : n;
      const need = clampCount(cfg.total);
      if (need > max) messages.push(`合計${need}枚は揃いません（最大${max}枚）`);
      return { ok: messages.length === 0, messages };
    }

    const bad = cfg.items.filter((it) => clampCount(it.count) > limit(it.key));
    for (const it of bad) {
      const a = avail.get(it.key);
      messages.push(a === 0 ? `${shortLabel(it.key)}は山にありません`
        : a < clampCount(it.count) ? `${shortLabel(it.key)}は山に${a}枚までです`
        : `${shortLabel(it.key)}は手牌に${cap}枚までです`);
    }
    if (cfg.combine === 'or') return { ok: bad.length < cfg.items.length, messages };
    if (bad.length > 0 || !hold) return { ok: bad.length === 0, messages };

    const min = minTiles(cfg, wall, ctx, cap);
    if (min === null) messages.push('達成できるか判定できません（条件が複雑すぎます）');
    else if (min > cap) messages.push(`すべての項目を${cap}枚では揃えられません`);
    return { ok: min !== null && min <= cap, messages };
  }

  /**
   * AND の全項目を満たす最少枚数（cap を超えるなら Infinity、見つかる前に探索を打ち切ったら null）。
   * 牌を「どの項目に合うか」でクラス分けし、足りない項目を1つ選んで合う牌を1枚ずつ足す深さ優先探索。
   */
  function minTiles(cfg, wall, ctx, cap) {
    const items = cfg.items;
    const need0 = items.map((it) => clampCount(it.count));
    const classes = new Map(); // 署名 → { sig: [項目 index], n }
    for (const t of wall) {
      const sig = items.map((it, i) => (matches(t, it.key, ctx) ? i : -1)).filter((i) => i >= 0);
      if (sig.length === 0) continue;
      const k = sig.join(',');
      if (!classes.has(k)) classes.set(k, { sig, n: 0 });
      classes.get(k).n++;
    }
    if (!ctx.doraKinds) {
      const d = items.findIndex((it) => it.key === 'dora:dora');
      if (d >= 0) classes.set('dora', { sig: [d], n: 4 });
    }
    const cls = [...classes.values()].sort((a, b) => b.sig.length - a.sig.length);
    // 同じ牌で数えられない（合う牌が重ならない）項目の組は、足りない枚数の合計が下限になる
    const overlap = items.map((_, i) => items.map((__, j) => cls.some((c) => c.sig.includes(i) && c.sig.includes(j))));
    const lower = () => {
      const order = need.map((n, i) => i).filter((i) => need[i] > 0).sort((a, b) => need[b] - need[a]);
      let best1 = 0;
      for (const first of order) {
        const picked = [first];
        for (const i of order) if (!picked.some((p) => p === i || overlap[p][i])) picked.push(i);
        best1 = Math.max(best1, picked.reduce((s, i) => s + need[i], 0));
      }
      return best1;
    };
    let best = cap + 1;
    let nodes = 0;
    const seen = new Set();
    const need = need0.slice();
    const left = cls.map((c) => c.n);
    const dfs = (used) => {
      if (++nodes > 200000) return false;
      if (need.every((n) => n <= 0)) { best = Math.min(best, used); return true; }
      const lb = lower();
      if (used + lb >= best) return true;
      const key = need.join(',') + '|' + left.join(',');
      if (seen.has(key)) return true;
      seen.add(key);
      // 候補が最も少ない、足りない項目を選ぶ
      let j = -1, opts = Infinity;
      for (let i = 0; i < need.length; i++) {
        if (need[i] <= 0) continue;
        const o = cls.reduce((s, c, ci) => s + (left[ci] > 0 && c.sig.includes(i) ? 1 : 0), 0);
        if (o < opts) { opts = o; j = i; }
      }
      for (let ci = 0; ci < cls.length; ci++) {
        if (left[ci] === 0 || !cls[ci].sig.includes(j)) continue;
        left[ci]--;
        for (const i of cls[ci].sig) need[i]--;
        const ok = dfs(used + 1);
        for (const i of cls[ci].sig) need[i]++;
        left[ci]++;
        if (!ok) return false;
      }
      return true;
    };
    if (!dfs(0)) return best <= cap ? best : null;
    return best <= cap ? best : Infinity;
  }

  return {
    GROUPS, defaults, normalize, clampCount, shortLabel,
    matches, isActive, isWanted, countDraw, progress, goalReached, pickDiscard, available, feasibility,
  };
})();
