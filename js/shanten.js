'use strict';
/**
 * 向聴数・待ち・受け入れ・面子分解
 * すべて 34 要素の枚数配列 (counts) を入力とする。
 * fixedMelds = 既に確定している面子数（暗槓の数）
 */
const Shanten = (() => {
  /** 一般形（4面子1雀頭）の向聴数。和了形は -1 */
  function regular(counts, fixedMelds) {
    const c = counts.slice();
    let best = 8;
    let total = 0;
    for (const n of c) total += n;

    /** 残り r 枚で到達し得る最良（楽観的）向聴数。best 以上なら枝刈り */
    function bound(m, t, p, r) {
      const mm = Math.min(4 - m, Math.floor(r / 3));
      let r2 = r - 3 * mm;
      const pg = !p && r2 >= 2 ? 1 : 0;
      r2 -= 2 * pg;
      const tt = Math.min(4 - m - mm, t + Math.floor(r2 / 2));
      return 8 - 2 * (m + mm) - tt - (p ? 1 : 0) - pg;
    }

    function rec(i, m, t, p, r) {
      while (i < 34 && c[i] === 0) i++;
      if (i >= 34) {
        let tt = t;
        if (m + tt > 4) tt = 4 - m;
        const s = 8 - 2 * m - tt - (p ? 1 : 0);
        if (s < best) best = s;
        return;
      }
      if (bound(m, t, p, r) >= best) return;
      const seq = i < 27 && i % 9 <= 6;
      const pen = i < 27 && i % 9 <= 7;
      // 刻子
      if (c[i] >= 3) { c[i] -= 3; rec(i, m + 1, t, p, r - 3); c[i] += 3; }
      // 順子
      if (seq && c[i + 1] > 0 && c[i + 2] > 0) {
        c[i]--; c[i + 1]--; c[i + 2]--; rec(i, m + 1, t, p, r - 3); c[i]++; c[i + 1]++; c[i + 2]++;
      }
      if (m + t < 4) {
        // 対子（塔子として）
        if (c[i] >= 2) { c[i] -= 2; rec(i, m, t + 1, p, r - 2); c[i] += 2; }
        // 両面・辺張
        if (pen && c[i + 1] > 0) { c[i]--; c[i + 1]--; rec(i, m, t + 1, p, r - 2); c[i]++; c[i + 1]++; }
        // 嵌張
        if (seq && c[i + 2] > 0) { c[i]--; c[i + 2]--; rec(i, m, t + 1, p, r - 2); c[i]++; c[i + 2]++; }
      }
      // 雀頭
      if (!p && c[i] >= 2) { c[i] -= 2; rec(i, m, t, true, r - 2); c[i] += 2; }
      // 孤立牌として捨てる
      c[i]--; rec(i, m, t, p, r - 1); c[i]++;
    }

    rec(0, fixedMelds, 0, false, total);
    return best;
  }

  /** 七対子の向聴数 */
  function chiitoi(c) {
    let pairs = 0, kinds = 0;
    for (const n of c) { if (n >= 2) pairs++; if (n >= 1) kinds++; }
    return 6 - pairs + Math.max(0, 7 - kinds);
  }

  /** 国士無双の向聴数 */
  function kokushi(c) {
    let kinds = 0, pair = false;
    for (const k of Tiles.YAOCHU) { if (c[k] >= 1) kinds++; if (c[k] >= 2) pair = true; }
    return 13 - kinds - (pair ? 1 : 0);
  }

  /** 総合向聴数（-1 = 和了形, 0 = 聴牌） */
  function calc(c, fixedMelds = 0) {
    let s = regular(c, fixedMelds);
    if (fixedMelds === 0) s = Math.min(s, chiitoi(c), kokushi(c));
    return s;
  }

  /** 13枚（-3×槓子）の手牌の待ち牌種一覧 */
  function waits(c13, fixedMelds = 0) {
    const res = [];
    const c = c13.slice();
    for (let k = 0; k < 34; k++) {
      if (c[k] >= 4) continue;
      c[k]++;
      if (calc(c, fixedMelds) === -1) res.push(k);
      c[k]--;
    }
    return res;
  }

  /**
   * 14枚（-3×槓子）の手牌に対する打牌ごとの解析。
   * unseen: 各牌種の未見枚数（受け入れ枚数の計算に使う）
   * 戻り値: [{ kind, shanten, accepts: [{kind, n}], total }] 向聴昇順・枚数降順
   */
  function analyzeDiscards(c14, fixedMelds, unseen) {
    const c = c14.slice();
    const rows = [];
    for (let d = 0; d < 34; d++) {
      if (c[d] === 0) continue;
      c[d]--;
      rows.push({ kind: d, shanten: calc(c, fixedMelds), accepts: [], total: 0 });
      c[d]++;
    }
    const minS = Math.min(...rows.map((r) => r.shanten));
    for (const r of rows) {
      if (r.shanten !== minS) continue;
      c[r.kind]--;
      for (let k = 0; k < 34; k++) {
        if (c[k] >= 4) continue;
        c[k]++;
        if (calc(c, fixedMelds) < r.shanten) {
          const n = Math.max(0, unseen ? unseen[k] : 4 - c14[k]);
          // 残り枚数 0（山に無い・全て見えている）の牌は受け入れに数えない
          if (n > 0) { r.accepts.push({ kind: k, n }); r.total += n; }
        }
        c[k]--;
      }
      c[r.kind]++;
    }
    rows.sort((a, b) => a.shanten - b.shanten || b.total - a.total || a.kind - b.kind);
    return rows;
  }

  /**
   * 和了形の面子分解（一般形のみ）。
   * 戻り値: [{ pair: kind, melds: [{type:'pon'|'chi', t: kind}] }]
   */
  function decompose(c14) {
    const c = c14.slice();
    const results = [];
    function rec(i, melds, pair) {
      while (i < 34 && c[i] === 0) i++;
      if (i >= 34) { results.push({ pair, melds: melds.slice() }); return; }
      if (c[i] >= 3) {
        c[i] -= 3; melds.push({ type: 'pon', t: i }); rec(i, melds, pair); melds.pop(); c[i] += 3;
      }
      if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
        c[i]--; c[i + 1]--; c[i + 2]--;
        melds.push({ type: 'chi', t: i }); rec(i, melds, pair); melds.pop();
        c[i]++; c[i + 1]++; c[i + 2]++;
      }
    }
    for (let p = 0; p < 34; p++) {
      if (c[p] < 2) continue;
      c[p] -= 2; rec(0, [], p); c[p] += 2;
    }
    return results;
  }

  return { regular, chiitoi, kokushi, calc, waits, analyzeDiscards, decompose };
})();
