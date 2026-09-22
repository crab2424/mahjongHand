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
  const LABELS = Object.fromEntries(GROUPS.flatMap((g) => g.items.map(([key, short]) => [key, short])));

  function defaults() {
    return { items: [], combine: 'or', total: 1, countMode: 'draw' };
  }

  const clampCount = (n) => Math.min(14, Math.max(1, Math.round(+n) || 1));

  /** 保存値を正規化（旧形式 rules からの移行も含む） */
  function normalize(src) {
    const cfg = defaults();
    if (!src || typeof src !== 'object') return cfg;
    if (['or', 'and', 'sum'].includes(src.combine)) cfg.combine = src.combine;
    cfg.total = clampCount(src.total);
    cfg.countMode = src.countMode === 'hold' ? 'hold' : 'draw';
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
   * 手出しする牌を選ぶ。欲しくない牌のうち牌効率で最も不要な牌（同点はランダム）。
   * tiles: 14枚、analysis: Shanten.analyzeDiscards の結果。候補が無ければ null。
   */
  function pickDiscard(tiles, cfg, ctx, analysis, rand = Math.random) {
    const cands = tiles.filter((t) => !isWanted(t, cfg, ctx));
    if (cands.length === 0) return null;
    const rank = new Map((analysis || []).map((r) => [r.kind, r]));
    const score = (t) => {
      const r = rank.get(t.kind);
      return r ? [r.shanten, -r.total] : [99, 0];
    };
    const cmp = (a, b) => {
      const sa = score(a), sb = score(b);
      return sa[0] - sb[0] || sa[1] - sb[1];
    };
    cands.sort(cmp);
    const best = cands.filter((t) => cmp(t, cands[0]) === 0);
    // 同じ牌種が複数あれば赤でない方を優先して切る
    const kinds = [...new Set(best.map((t) => t.kind))];
    const kind = kinds[Math.floor(rand() * kinds.length) % kinds.length];
    const same = best.filter((t) => t.kind === kind);
    return same.find((t) => !t.red) || same[0];
  }

  return {
    GROUPS, defaults, normalize, clampCount, shortLabel,
    matches, isActive, isWanted, countDraw, progress, goalReached, pickDiscard,
  };
})();
