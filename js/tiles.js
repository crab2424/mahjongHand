'use strict';
/**
 * 牌の定義・山の生成・ユーティリティ
 *
 * 牌種 (kind) は 0..33 の整数:
 *   0- 8: 萬子 1m..9m   9-17: 筒子 1p..9p   18-26: 索子 1s..9s
 *  27-30: 東南西北      31: 白  32: 發  33: 中
 * 牌オブジェクト: { id: 0..135 (一意), kind, red: 赤ドラか }
 */
const Tiles = (() => {
  const SUITS = ['m', 'p', 's'];
  const SUIT_KANJI = { m: '萬', p: '筒', s: '索' };
  const GLYPH_BASE = { m: 0x1f007, p: 0x1f019, s: 0x1f010 };
  const HONOR_GLYPHS = [0x1f000, 0x1f001, 0x1f002, 0x1f003, 0x1f006, 0x1f005, 0x1f004];
  const HONOR_KANJI = ['東', '南', '西', '北', '白', '發', '中'];
  const KANJI_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const WINDS = { 27: '東', 28: '南', 29: '西', 30: '北' };

  const KINDS = [];
  for (let k = 0; k < 34; k++) {
    if (k < 27) {
      const suit = SUITS[Math.floor(k / 9)];
      const num = (k % 9) + 1;
      KINDS.push({
        kind: k,
        suit,
        num,
        glyph: String.fromCodePoint(GLYPH_BASE[suit] + num - 1) + '︎',
        code: `${num}${suit}`,
        label: `${num}${SUIT_KANJI[suit]}`,
        kanji: SUIT_KANJI[suit],
      });
    } else {
      const i = k - 27;
      KINDS.push({
        kind: k,
        suit: 'z',
        num: i + 1,
        glyph: String.fromCodePoint(HONOR_GLYPHS[i]) + '︎',
        code: `${i + 1}z`,
        label: HONOR_KANJI[i],
        kanji: HONOR_KANJI[i],
      });
    }
  }

  const info = (kind) => KINDS[kind];
  const suitOf = (kind) => (kind < 27 ? Math.floor(kind / 9) : 3);
  const numOf = (kind) => (kind < 27 ? (kind % 9) + 1 : 0);
  const isHonor = (kind) => kind >= 27;
  const isWind = (kind) => kind >= 27 && kind <= 30;
  const isDragon = (kind) => kind >= 31;
  const isTerminal = (kind) => kind < 27 && (kind % 9 === 0 || kind % 9 === 8);
  const isYaochu = (kind) => isHonor(kind) || isTerminal(kind);
  const isSimple = (kind) => !isYaochu(kind);
  const YAOCHU = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

  /** 同じ系列内で次の牌種（ドラ順送り） */
  function nextInCycle(kind) {
    if (kind < 27) {
      const base = Math.floor(kind / 9) * 9;
      return base + ((kind - base + 1) % 9);
    }
    if (kind <= 30) return 27 + ((kind - 27 + 1) % 4);
    return 31 + ((kind - 31 + 1) % 3);
  }

  /**
   * ドラ表示牌 → ドラ
   * avail: 山に含まれる牌種の枚数配列（省略時は全種あり）。
   * 抜いてある牌種は飛ばす（三麻の 1m 表示 → 9m など）。
   */
  function nextDora(kind, avail) {
    let k = nextInCycle(kind);
    if (!avail) return k;
    for (let i = 0; i < 9 && avail[k] === 0; i++) k = nextInCycle(k);
    return k;
  }

  /** 牌種グループ（山に入れる牌の選択用） */
  const TILE_GROUPS = [
    { key: 'tileM19', label: '萬子 一九', kinds: [0, 8] },
    { key: 'tileM28', label: '萬子 二〜八', kinds: [1, 2, 3, 4, 5, 6, 7] },
    { key: 'tileP19', label: '筒子 一九', kinds: [9, 17] },
    { key: 'tileP28', label: '筒子 二〜八', kinds: [10, 11, 12, 13, 14, 15, 16] },
    { key: 'tileS19', label: '索子 一九', kinds: [18, 26] },
    { key: 'tileS28', label: '索子 二〜八', kinds: [19, 20, 21, 22, 23, 24, 25] },
    { key: 'tileZ', label: '字牌', kinds: [27, 28, 29, 30, 31, 32, 33] },
  ];

  /** 設定から山に入れる牌種の集合を返す（未指定のグループは含める） */
  function kindsFromSettings(settings) {
    const set = new Set();
    for (const g of TILE_GROUPS) {
      if (!settings || settings[g.key] !== false) for (const k of g.kinds) set.add(k);
    }
    return set;
  }

  /** 山を生成（未シャッフル）。kinds: 含める牌種の Set（省略時は34種すべて） */
  function makeWall(useRed, kinds) {
    const tiles = [];
    let id = 0;
    for (let k = 0; k < 34; k++) {
      if (kinds && !kinds.has(k)) continue;
      for (let c = 0; c < 4; c++) {
        const red = !!useRed && k < 27 && numOf(k) === 5 && c === 0;
        tiles.push({ id: id++, kind: k, red });
      }
    }
    return tiles;
  }

  function shuffle(arr) {
    const rnd = new Uint32Array(arr.length);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(rnd);
    else for (let i = 0; i < rnd.length; i++) rnd[i] = Math.floor(Math.random() * 0x100000000);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = rnd[i] % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** 牌種順に並べ替え（赤は同種の先頭へ） */
  function sortTiles(tiles) {
    return tiles.slice().sort((a, b) => {
      if (a.kind !== b.kind) return a.kind - b.kind;
      if (a.red !== b.red) return a.red ? -1 : 1;
      return a.id - b.id;
    });
  }

  /** 牌配列 → 34要素の枚数配列 */
  function counts(tiles) {
    const c = new Array(34).fill(0);
    for (const t of tiles) c[t.kind]++;
    return c;
  }

  function shantenLabel(s) {
    if (s < 0) return '和了形';
    if (s === 0) return '聴牌';
    return `${KANJI_NUM[s - 1] || s}向聴`;
  }

  /** "123m45p7z" 形式の文字列 → 牌配列（テスト・デバッグ用） */
  function parse(str) {
    const tiles = [];
    let id = 1000;
    for (const m of str.matchAll(/([0-9]+)([mpsz])/g)) {
      const suit = m[2];
      for (const ch of m[1]) {
        let num = +ch;
        let red = false;
        if (num === 0) { num = 5; red = true; }
        const kind = suit === 'z' ? 26 + num : SUITS.indexOf(suit) * 9 + num - 1;
        tiles.push({ id: id++, kind, red });
      }
    }
    return tiles;
  }

  return {
    KINDS, WINDS, YAOCHU, KANJI_NUM, TILE_GROUPS,
    info, suitOf, numOf, isHonor, isWind, isDragon, isTerminal, isYaochu, isSimple,
    nextDora, makeWall, kindsFromSettings, shuffle, sortTiles, counts, shantenLabel, parse,
  };
})();
