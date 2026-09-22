'use strict';
/**
 * 条件付き自動ツモ切り（欲しい牌が来るまで、欲しくない牌を切る）
 *
 * ルール: {
 *   suits:  ['m'|'p'|'s'|'wind'|'dragon']   種類
 *   nums:   ['yaochu'|'simple'|'1'..'9']    数字（么九は字牌を含む。1〜9 は数牌のみ）
 *   dora:   ['dora'|'red']                  表ドラ（カンドラ含む）／赤ドラ
 *   yakuhai: boolean                        役牌（三元牌・場風・自風）
 *   kinds:  [0..33]                         特定の牌
 *   count:  N                               目標枚数
 *   countMode: 'draw' | 'hold'              ツモ累計／手牌の保持数
 *   enabled: boolean
 * }
 * ルール内の属性は AND、各属性の選択肢は OR。空の属性は条件にしない。
 * ctx: { doraKinds, roundWind, seatWind }
 */
const AutoDiscard = (() => {
  const ATTRS = ['suits', 'nums', 'dora', 'kinds'];

  function newRule() {
    return { suits: [], nums: [], dora: [], yakuhai: false, kinds: [], count: 1, countMode: 'draw', enabled: true };
  }

  /** 条件が1つ以上ある有効なルールか */
  function isActive(rule) {
    return !!rule && rule.enabled !== false && (rule.yakuhai || ATTRS.some((a) => (rule[a] || []).length > 0));
  }
  const activeRules = (rules) => (rules || []).filter(isActive);

  function suitKey(kind) {
    if (kind < 27) return 'mps'[Math.floor(kind / 9)];
    return kind <= 30 ? 'wind' : 'dragon';
  }
  function matchNum(kind, n) {
    if (n === 'yaochu') return Tiles.isYaochu(kind);
    if (n === 'simple') return Tiles.isSimple(kind);
    return kind < 27 && Tiles.numOf(kind) === +n;
  }
  function isYakuhai(kind, ctx) {
    return Tiles.isDragon(kind) || kind === ctx.roundWind || kind === ctx.seatWind;
  }

  /** 牌 tile がルールの条件に合うか */
  function matches(tile, rule, ctx) {
    const k = tile.kind;
    if (rule.suits.length && !rule.suits.includes(suitKey(k))) return false;
    if (rule.nums.length && !rule.nums.some((n) => matchNum(k, n))) return false;
    if (rule.dora.length && !rule.dora.some((d) => (d === 'red' ? tile.red : ctx.doraKinds.includes(k)))) return false;
    if (rule.yakuhai && !isYakuhai(k, ctx)) return false;
    if (rule.kinds.length && !rule.kinds.includes(k)) return false;
    return true;
  }

  /** 欲しい牌か（いずれかの有効ルールに合う） */
  const isWanted = (tile, rules, ctx) => activeRules(rules).some((r) => matches(tile, r, ctx));

  /**
   * 各有効ルールの進捗 [{ rule, have, need, done }]
   * drawCounts: ルール（有効ルールの並び順）ごとのツモ累計、held: 手牌＋カンの牌
   */
  function progress(rules, drawCounts, held, ctx) {
    return activeRules(rules).map((rule, i) => {
      const have = rule.countMode === 'hold'
        ? held.filter((t) => matches(t, rule, ctx)).length
        : drawCounts[i] || 0;
      const need = Math.max(1, +rule.count || 1);
      return { rule, have, need, done: have >= need };
    });
  }

  /** 目標達成か。combine: 'or'（どれか1つ）| 'and'（すべて） */
  function goalReached(prog, combine) {
    if (prog.length === 0) return false;
    return combine === 'and' ? prog.every((p) => p.done) : prog.some((p) => p.done);
  }

  /**
   * 手出しする牌を選ぶ。欲しくない牌のうち牌効率で最も不要な牌（同点はランダム）。
   * tiles: 14枚、analysis: Shanten.analyzeDiscards の結果。候補が無ければ null。
   */
  function pickDiscard(tiles, rules, ctx, analysis, rand = Math.random) {
    const cands = tiles.filter((t) => !isWanted(t, rules, ctx));
    if (cands.length === 0) return null;
    const rank = new Map((analysis || []).map((r, i) => [r.kind, r]));
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

  /** ルールの短い説明（例: 索子・中張 保持6） */
  function describe(rule) {
    const SUIT = { m: '萬', p: '筒', s: '索', wind: '風', dragon: '三元' };
    const NUM = { yaochu: '么九', simple: '中張' };
    const parts = [];
    if (rule.suits.length) parts.push(rule.suits.map((x) => SUIT[x]).join('/'));
    if (rule.nums.length) parts.push(rule.nums.map((x) => NUM[x] || x).join('/'));
    if (rule.dora.length) parts.push(rule.dora.map((x) => (x === 'red' ? '赤' : 'ドラ')).join('/'));
    if (rule.yakuhai) parts.push('役牌');
    if (rule.kinds.length) parts.push(rule.kinds.map((k) => Tiles.info(k).code).join('/'));
    return parts.join('・') || '（条件なし）';
  }

  return { newRule, isActive, activeRules, matches, isWanted, progress, goalReached, pickDiscard, describe };
})();
