'use strict';
/**
 * ゲーム進行（状態機械）
 * phase: 'draw'（ツモ待ち） | 'discard'（打牌待ち・14枚） | 'exhausted'（山切れ） | 'end'（終局）
 *
 * 山: wall（末尾から pop でツモ）、王牌: deadWall 14枚
 *   deadWall[0..3]  嶺上牌、[4..8] ドラ表示牌、[9..13] 裏ドラ表示牌
 *
 * 配牌時に最初のツモまで行い、14枚の状態（phase='discard', turn=1）で開始する。
 */
class Game {
  constructor(settings) {
    this.settings = settings;
    this.newGame();
  }

  newGame() {
    const s = this.settings;
    // 配牌時の設定を固定する（局の途中で設定が変わっても影響しない）
    this.opts = {
      redDora: !!s.redDora,
      simulateOthers: !!s.simulateOthers,
      maxDraws: Math.max(0, +s.maxDraws || 0),
      kinds: Tiles.kindsFromSettings(s),
    };
    const all = Tiles.makeWall(this.opts.redDora, this.opts.kinds);
    this.initialCounts = Tiles.counts(all);
    const tiles = Tiles.shuffle(all);
    this.deadWall = tiles.slice(0, 14);
    this.wall = tiles.slice(14);
    this.hand = Tiles.sortTiles(this.wall.splice(this.wall.length - 13, 13));
    this.drawn = null;
    this.discards = [];   // [{ tile, tsumogiri, riichi }]
    this.kans = [];       // [{ kind, tiles }]
    this.doraCount = 1;
    this.riichi = false;
    this.doubleRiichi = false;
    this.ippatsu = false;
    this.riichiIndex = -1;
    this.turn = 0;
    this.rinshan = false;
    this.result = null;
    this.phase = 'draw';
    this.draw(); // 配牌直後に第一ツモ（14枚で開始）
  }

  // ---------- 参照 ----------
  /** 山の残り枚数 */
  get remaining() { return this.wall.length; }
  /** 自分があと何回ツモれるか（他家模擬・ツモ回数上限を考慮） */
  get drawsLeft() {
    let n = this.wall.length;
    if (this.opts.simulateOthers) n = Math.ceil(n / 4);
    if (this.opts.maxDraws > 0) n = Math.min(n, this.opts.maxDraws - this.turn);
    return Math.max(0, n);
  }
  get doraIndicators() { return this.deadWall.slice(4, 4 + this.doraCount); }
  get uraIndicators() { return this.deadWall.slice(9, 9 + this.doraCount); }
  get doraKinds() { return this.doraIndicators.map((t) => Tiles.nextDora(t.kind, this.initialCounts)); }
  get uraKinds() { return this.uraIndicators.map((t) => Tiles.nextDora(t.kind, this.initialCounts)); }
  get seatWind() { return this.settings.seatWind; }
  get roundWind() { return this.settings.roundWind; }
  get isDealer() { return this.seatWind === 27; }

  /** 手牌 + ツモ牌 */
  fullTiles() { return this.drawn ? this.hand.concat([this.drawn]) : this.hand.slice(); }

  /** 自分から見えていない牌の枚数（牌種ごと）。山に入れていない牌種は 0 */
  unseenCounts() {
    const u = this.initialCounts.slice();
    for (const t of this.fullTiles()) u[t.kind]--;
    for (const d of this.discards) u[d.tile.kind]--;
    for (const t of this.doraIndicators) u[t.kind]--;
    for (const k of this.kans) u[k.kind] -= 4;
    return u;
  }

  // ---------- ツモ ----------
  draw() {
    if (this.phase !== 'draw' || this.drawsLeft === 0) return null;
    this.drawn = this.wall.pop();
    this.turn++;
    this.rinshan = false;
    this.phase = 'discard';
    return this.drawn;
  }

  // ---------- 和了 ----------
  isComplete() {
    return !!this.drawn && Shanten.calc(Tiles.counts(this.fullTiles()), this.kans.length) === -1;
  }

  winContext() {
    return {
      closed: this.hand,
      winTile: this.drawn,
      kans: this.kans,
      riichi: this.riichi,
      doubleRiichi: this.doubleRiichi,
      ippatsu: this.ippatsu,
      haitei: this.drawsLeft === 0 && !this.rinshan,
      rinshan: this.rinshan,
      tenhou: this.turn === 1 && this.discards.length === 0 && this.kans.length === 0,
      roundWind: this.roundWind,
      seatWind: this.seatWind,
      doraKinds: this.doraKinds,
      uraKinds: this.uraKinds,
      isDealer: this.isDealer,
    };
  }

  /** ツモ和了できるなら役情報、できなければ null */
  canTsumo() {
    if (this.phase !== 'discard' || !this.isComplete()) return null;
    return Yaku.evaluate(this.winContext());
  }

  tsumo() {
    const r = this.canTsumo();
    if (!r) return null;
    this.result = Object.assign({ type: 'win', ctx: this.winContext() }, r);
    this.phase = 'end';
    return this.result;
  }

  // ---------- リーチ ----------
  /** リーチ宣言牌として切れる牌 id 一覧（切っても聴牌を維持できる牌） */
  riichiCandidates() {
    if (this.riichi || this.phase !== 'discard' || this.drawsLeft < 1) return [];
    const tiles = this.fullTiles();
    const c = Tiles.counts(tiles);
    const okKinds = new Set();
    for (let k = 0; k < 34; k++) {
      if (c[k] === 0) continue;
      c[k]--;
      if (Shanten.calc(c, this.kans.length) === 0) okKinds.add(k);
      c[k]++;
    }
    return tiles.filter((t) => okKinds.has(t.kind)).map((t) => t.id);
  }

  // ---------- カン（暗槓） ----------
  kanOptions() {
    if (this.phase !== 'discard' || this.kans.length >= 4 || this.wall.length === 0) return [];
    const c = Tiles.counts(this.fullTiles());
    let kinds = [];
    for (let k = 0; k < 34; k++) if (c[k] === 4) kinds.push(k);
    if (this.riichi) {
      // リーチ後はツモ牌での暗槓のみ、かつ待ちが変わらないこと
      kinds = kinds.filter((k) => k === this.drawn.kind && this.kanKeepsWaits(k));
    }
    return kinds;
  }

  kanKeepsWaits(kind) {
    const c = Tiles.counts(this.hand);
    const before = Shanten.waits(c, this.kans.length);
    c[kind] -= 3;
    const after = Shanten.waits(c, this.kans.length + 1);
    return before.join(',') === after.join(',');
  }

  kan(kind) {
    if (!this.kanOptions().includes(kind)) return null;
    const tiles = this.fullTiles().filter((t) => t.kind === kind);
    this.hand = this.hand.filter((t) => t.kind !== kind);
    if (this.drawn && this.drawn.kind !== kind) this.hand.push(this.drawn);
    this.hand = Tiles.sortTiles(this.hand);
    this.kans.push({ kind, tiles });
    this.wall.shift();                         // 海底牌が王牌へ移る
    this.drawn = this.deadWall[this.kans.length - 1]; // 嶺上牌
    this.doraCount++;                          // 暗槓は即めくり
    this.ippatsu = false;
    this.rinshan = true;
    this.phase = 'discard';
    return { kind, tiles, drawn: this.drawn };
  }

  // ---------- 打牌 ----------
  discard(tileId, declareRiichi = false) {
    if (this.phase !== 'discard' || !this.drawn) return null;
    let tile, tsumogiri = false;
    if (this.drawn.id === tileId) {
      tile = this.drawn;
      tsumogiri = true;
    } else {
      const i = this.hand.findIndex((t) => t.id === tileId);
      if (i < 0) return null;
      tile = this.hand.splice(i, 1)[0];
      this.hand.push(this.drawn);
      this.hand = Tiles.sortTiles(this.hand);
    }
    this.drawn = null;

    if (declareRiichi) {
      this.doubleRiichi = this.discards.length === 0 && this.kans.length === 0;
      this.riichi = true;
      this.riichiIndex = this.discards.length;
      this.ippatsu = true;
    } else {
      this.ippatsu = false;
    }
    this.discards.push({ tile, tsumogiri, riichi: declareRiichi });

    if (this.opts.simulateOthers) {
      // 他家3人のツモ分を山から減らす
      this.wall.splice(0, Math.min(3, this.wall.length));
    }
    this.phase = this.drawsLeft > 0 ? 'draw' : 'exhausted';
    return { tile, tsumogiri, riichi: declareRiichi };
  }

  // ---------- 流局 ----------
  exhaust() {
    const info = this.handInfo();
    this.result = { type: 'draw', tenpai: info.shanten === 0, shanten: info.shanten, waits: info.waits };
    this.phase = 'end';
    return this.result;
  }

  // ---------- 解析 ----------
  /** 13枚（ツモ牌を除いた手牌）の状態: 向聴数と待ち（山に無い牌種は除く） */
  handInfo() {
    const c = Tiles.counts(this.hand);
    const s = Shanten.calc(c, this.kans.length);
    const unseen = this.unseenCounts();
    const waits = s === 0
      ? Shanten.waits(c, this.kans.length)
        .filter((k) => this.initialCounts[k] > 0)
        .map((k) => ({ kind: k, left: Math.max(0, unseen[k]) }))
      : [];
    return { shanten: s, waits };
  }

  /** 14枚（ツモ後）の状態: 現在の向聴数 */
  currentShanten() {
    return Shanten.calc(Tiles.counts(this.fullTiles()), this.kans.length);
  }

  /** 14枚の打牌解析（牌効率） */
  analysis() {
    if (!this.drawn) return null;
    return Shanten.analyzeDiscards(Tiles.counts(this.fullTiles()), this.kans.length, this.unseenCounts());
  }
}
