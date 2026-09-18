'use strict';
/**
 * 描画・アニメーション・操作
 */
const UI = (() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const STORAGE_KEY = 'soloMahjong.settings.v1';
  const DEFAULTS = {
    display: 'glyph',
    redDora: true,
    autoDraw: true,
    autoTsumogiri: true,
    twoClick: false,
    hints: true,
    simulateOthers: false,
    maxDraws: 0,
    roundWind: 27,
    seatWind: 27,
    instantReset: false,
    autoReset: false,
    autoResetInterval: 1000,
    autoResetShanten: 0,
    tileM19: true, tileM28: true, tileP19: true, tileP28: true, tileS19: true, tileS28: true, tileZ: true,
  };
  const SETTING_KEYS = [
    'display', 'roundWind', 'seatWind', 'autoDraw', 'autoTsumogiri', 'twoClick',
    'instantReset', 'autoReset', 'autoResetInterval', 'autoResetShanten',
    'redDora', 'tileM19', 'tileM28', 'tileP19', 'tileP28', 'tileS19', 'tileS28', 'tileZ',
    'maxDraws', 'simulateOthers',
  ];
  const TILE_KEYS = Tiles.TILE_GROUPS.map((g) => g.key);
  const MIN_WALL_TILES = 40;   // 王牌14 + 配牌13 + 最低限のツモ
  const FAST_AUTO_MS = 500;    // これ未満の間隔は「高速」扱い（アニメーション省略・表示間引き）

  let settings;
  let game;
  let busy = false;          // アニメーション中は操作を受け付けない
  let gen = 0;               // 局の世代（リセット時に進行中の非同期処理を無効化する）
  let mode = 'normal';       // normal | riichi | kan
  let selectedId = null;     // 2クリック打牌の選択中の牌
  let analysis = null;       // 牌効率解析（14枚時のみ）
  let shownDora = 0;         // 表示済みドラ表示牌の数（めくりアニメ用）
  let waitsKey = '';         // 待ち表示の内容キー（変化時のみ再描画）
  const auto = { running: false, timer: null, count: 0, lastRender: 0 };
  const els = {};

  // =====================================================
  // 初期化
  // =====================================================
  function init() {
    settings = loadSettings();
    const ids = [
      'round-info', 'dora', 'remaining', 'wall-count', 'turn', 'shanten', 'waits', 'waits-box', 'waits-title', 'waits-list',
      'river', 'riichi-stick', 'toast-layer', 'hint', 'log', 'hand', 'kans',
      'btn-draw', 'btn-tsumo', 'btn-riichi', 'btn-kan', 'btn-tsumogiri', 'btn-cancel', 'mode-msg',
      'btn-reset', 'btn-auto', 'auto-status', 'btn-settings', 'chk-hints', 'result-dialog', 'settings-dialog',
      'result-body', 'btn-result-next', 'btn-result-close', 'table', 'tileset-note',
    ];
    for (const id of ids) els[camel(id)] = document.getElementById(id);
    document.body.dataset.display = settings.display;
    bindEvents();
    syncSettingsForm();
    syncAutoUI();
    newGame();
  }

  const camel = (s) => s.replace(/-(\w)/g, (_, c) => c.toUpperCase());

  function loadSettings() {
    let s;
    try {
      s = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
    } catch (e) {
      s = Object.assign({}, DEFAULTS);
    }
    s.autoReset = false; // 自動リセットは起動時には常に停止状態
    if (countTiles(s) < MIN_WALL_TILES) for (const k of TILE_KEYS) s[k] = true;
    return s;
  }
  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }
  /** 設定で山に入る牌の枚数 */
  function countTiles(s) {
    let n = 0;
    for (const g of Tiles.TILE_GROUPS) if (s[g.key] !== false) n += g.kinds.length * 4;
    return n;
  }

  function bindEvents() {
    els.btnReset.addEventListener('click', () => { stopAuto(); resetGame(); });
    els.btnAuto.addEventListener('click', () => toggleAuto());
    els.btnSettings.addEventListener('click', () => els.settingsDialog.showModal());
    els.btnDraw.addEventListener('click', () => doDraw());
    els.btnTsumo.addEventListener('click', () => doTsumo());
    els.btnRiichi.addEventListener('click', () => enterMode('riichi'));
    els.btnKan.addEventListener('click', () => onKanButton());
    els.btnTsumogiri.addEventListener('click', () => { if (game.drawn) doDiscard(game.drawn.id); });
    els.btnCancel.addEventListener('click', () => exitMode());
    els.chkHints.addEventListener('change', () => {
      settings.hints = els.chkHints.checked;
      saveSettings();
      refreshHints();
      applyHandState();
    });
    els.btnResultNext.addEventListener('click', () => { els.resultDialog.close(); resetGame(); });
    els.btnResultClose.addEventListener('click', () => els.resultDialog.close());

    for (const key of SETTING_KEYS) {
      const el = document.getElementById(`set-${key}`);
      el.addEventListener('change', () => {
        const value = el.type === 'checkbox' ? el.checked : (isNaN(+el.value) ? el.value : +el.value);
        if (TILE_KEYS.includes(key)) {
          const trial = Object.assign({}, settings, { [key]: value });
          if (countTiles(trial) < MIN_WALL_TILES) {
            el.checked = settings[key]; // 少なすぎる場合は元に戻す
            updateTilesetNote(`牌が少なすぎます（最低 ${MIN_WALL_TILES} 枚必要）`);
            return;
          }
        }
        settings[key] = value;
        saveSettings();
        applySettings(key);
      });
    }

    document.addEventListener('keydown', (e) => {
      if (els.settingsDialog.open) return;
      if (e.key === 'Escape') {
        if (auto.running) { stopAuto(); return; }
        if (mode !== 'normal') exitMode();
        if (selectedId !== null) { selectedId = null; applyHandState(); }
      }
      else if (e.key === 'n' || e.key === 'N') { stopAuto(); resetGame(); }
      else if (e.key === 'a' || e.key === 'A') toggleAuto();
      else if (e.key === 't' || e.key === 'T') { if (!els.btnTsumo.classList.contains('hidden')) doTsumo(); }
      else if (e.key === ' ' || e.key === 'Enter') { if (!els.btnDraw.classList.contains('hidden')) { e.preventDefault(); doDraw(); } }
    });
    // 入場アニメーションのクラスは終了後に外す（hover 等の transform を有効にするため）
    document.addEventListener('animationend', (e) => {
      const el = e.target;
      if (el.classList) el.classList.remove('enter-deal', 'enter-draw', 'flip-in', 'enter-kan', 'landed');
      if (el.style) el.style.animationDelay = '';
    });
  }

  function syncSettingsForm() {
    for (const key of SETTING_KEYS) {
      const el = document.getElementById(`set-${key}`);
      if (el.type === 'checkbox') el.checked = !!settings[key];
      else el.value = String(settings[key]);
    }
    els.chkHints.checked = !!settings.hints;
    updateTilesetNote();
  }
  function updateTilesetNote(warn) {
    const n = countTiles(settings);
    els.tilesetNote.textContent = warn ? `${warn} ／ 現在 ${n} 枚` : `合計 ${n} 枚（山 ${n - 14 - 13} 枚）`;
    els.tilesetNote.classList.toggle('warn', !!warn);
  }

  function applySettings(key) {
    if (key === 'display') {
      document.body.dataset.display = settings.display;
      renderAll(false);
    } else if (key === 'roundWind' || key === 'seatWind') {
      renderHeader();
      renderActions();
    } else if (key === 'autoDraw') {
      renderActions();
      if (settings.autoDraw && game.phase === 'draw' && !busy) doDraw();
    } else if (key === 'autoReset') {
      if (settings.autoReset) startAuto(); else stopAuto();
    } else if (key === 'autoResetShanten' || key === 'autoResetInterval') {
      syncAutoUI();
    } else if (TILE_KEYS.includes(key)) {
      updateTilesetNote();
    }
  }

  // =====================================================
  // 局の開始・リセット
  // =====================================================
  /** 新しい局を開始する。animate=true なら配牌アニメーション */
  async function newGame(animate = !settings.instantReset) {
    stopAuto();
    gen++;
    const g = gen;
    game = new Game(settings);
    await presentGame(animate);
    if (g !== gen) return;
    afterDraw(g, game.drawn);
  }

  /** 現在の game を画面に反映する（局開始時）。animate=true なら配牌アニメーション */
  async function presentGame(animate) {
    const g = gen;
    mode = 'normal';
    selectedId = null;
    analysis = game.analysis();
    shownDora = 0;
    waitsKey = '';
    els.riichiStick.classList.add('hidden');
    els.log.innerHTML = '';
    log('配牌', `自風 ${Tiles.WINDS[settings.seatWind]}${game.isDealer ? '（親）' : ''}`);
    renderAll(false);
    if (!animate) return;
    const tiles = els.hand.querySelectorAll('.tile');
    tiles.forEach((el, i) => { el.classList.add('enter-deal'); el.style.animationDelay = `${i * 45}ms`; });
    busy = true;
    await sleep(tiles.length * 45 + 380);
    if (g !== gen) return;
    busy = false;
  }

  async function resetGame() {
    if (els.resultDialog.open) els.resultDialog.close();
    gen++; // 進行中の処理を無効化
    if (settings.instantReset) {
      busy = false;
      newGame(false);
      return;
    }
    busy = true;
    els.hand.classList.add('leaving');
    els.river.classList.add('leaving');
    await sleep(280);
    els.hand.classList.remove('leaving');
    els.river.classList.remove('leaving');
    busy = false;
    newGame(true);
  }

  // ---------- 自動リセット ----------
  function toggleAuto() {
    if (auto.running) stopAuto(); else startAuto();
  }

  function startAuto() {
    if (auto.running) return;
    if (els.resultDialog.open) els.resultDialog.close();
    auto.running = true;
    auto.count = 0;
    auto.lastRender = 0;
    settings.autoReset = true;
    syncAutoUI();
    gen++;            // 進行中のアニメーションを無効化
    busy = true;      // 周回中は操作を受け付けない
    mode = 'normal';
    selectedId = null;
    autoTick();
  }

  /** 自動リセットを止める。matched=true なら条件達成による停止 */
  function stopAuto(matched = false) {
    if (!auto.running) return;
    clearTimeout(auto.timer);
    auto.timer = null;
    auto.running = false;
    settings.autoReset = false;
    saveSettings();
    syncAutoUI(auto.count, matched);
    busy = false;
    if (!matched) {
      // 途中停止: 最後に生成した配牌をそのまま見せる
      gen++;
      presentGame(false);
    }
  }

  function autoTick() {
    if (!auto.running) return;
    const interval = Math.max(1, +settings.autoResetInterval || 1000);
    const fast = interval < FAST_AUTO_MS;
    const tickMs = Math.max(interval, 20);
    const iters = fast ? Math.max(1, Math.round(tickMs / interval)) : 1;
    const threshold = +settings.autoResetShanten;
    let matched = false;
    for (let i = 0; i < iters; i++) {
      auto.count++;
      game = new Game(settings);
      if (game.currentShanten() <= threshold) { matched = true; break; }
    }
    if (matched) {
      const n = auto.count;
      stopAuto(true);
      onAutoMatched(n, fast);
      return;
    }
    const now = performance.now();
    if (!fast || now - auto.lastRender > 120) {
      // 低速時は毎回、高速時は約8fpsで表示を更新（アニメーションなし）
      gen++;
      presentGame(false);
      auto.lastRender = now;
    }
    syncAutoUI();
    auto.timer = setTimeout(autoTick, tickMs);
  }

  async function onAutoMatched(count, fast) {
    gen++;
    const g = gen;
    const animate = !settings.instantReset && !fast;
    await presentGame(animate);
    if (g !== gen) return;
    showToast(`条件達成（${count.toLocaleString()}回目）`, true);
    log('自動', `${count.toLocaleString()}回目で ${Tiles.shantenLabel(game.currentShanten())}`);
    afterDraw(g, game.drawn);
  }

  function syncAutoUI(finishedCount = 0, matched = false) {
    const running = auto.running;
    els.btnAuto.textContent = running ? '■ 自動リセット停止' : '▶ 自動リセット';
    els.btnAuto.classList.toggle('running', running);
    const cond = `${Tiles.shantenLabel(+settings.autoResetShanten)}以下`;
    if (running) {
      els.autoStatus.textContent = `${auto.count.toLocaleString()} 回目 ・ 条件: ${cond}`;
      show(els.autoStatus, true);
    } else if (finishedCount) {
      els.autoStatus.textContent = matched
        ? `${finishedCount.toLocaleString()} 回目で達成（${cond}）`
        : `${finishedCount.toLocaleString()} 回で停止`;
      show(els.autoStatus, true);
    } else {
      show(els.autoStatus, false);
    }
    const chk = document.getElementById('set-autoReset');
    if (chk) chk.checked = running;
  }

  // =====================================================
  // 進行
  // =====================================================
  async function doDraw() {
    if (busy || game.phase !== 'draw') return;
    const g = gen;
    busy = true;
    const tile = game.draw();
    analysis = game.analysis();
    renderHand(true);
    const drawnEl = els.hand.querySelector('.tile.drawn');
    if (drawnEl) drawnEl.classList.add('enter-draw');
    renderHeader();
    renderStatus();
    refreshHints();
    renderActions();
    await sleep(320);
    if (g !== gen) return;
    busy = false;
    await afterDraw(g, tile);
  }

  /** ツモ後の自動処理（リーチ中のツモ切りなど） */
  async function afterDraw(g, tile) {
    if (!tile || game.phase !== 'discard') return;
    if (game.riichi && settings.autoTsumogiri && !game.canTsumo() && game.kanOptions().length === 0) {
      await sleep(550);
      if (g !== gen || busy || game.phase !== 'discard') return;
      doDiscard(tile.id);
    }
  }

  async function doDiscard(tileId, declareRiichi = false) {
    if (busy || game.phase !== 'discard') return;
    const fromEl = els.hand.querySelector(`.tile[data-id="${tileId}"]`);
    if (!fromEl) return;
    const g = gen;
    busy = true;
    mode = 'normal';
    selectedId = null;
    analysis = null;

    const res = game.discard(tileId, declareRiichi);
    if (declareRiichi) {
      showToast(game.doubleRiichi ? 'ダブルリーチ！' : 'リーチ！');
      els.riichiStick.classList.remove('hidden');
      log(`${game.turn}巡目`, `${game.doubleRiichi ? 'ダブル' : ''}リーチ 宣言牌`, res.tile);
    }

    const fly = flyToRiver(fromEl, res);
    renderHand(true);
    renderHeader();
    renderStatus();
    refreshHints();
    renderActions();
    await fly;
    if (g !== gen) return;
    busy = false;

    if (game.phase === 'exhausted') {
      const r = game.exhaust();
      log('流局', r.tenpai ? '聴牌' : 'ノーテン');
      renderActions();
      await sleep(300);
      if (g !== gen) return;
      showResult(r);
      return;
    }
    if (settings.autoDraw) {
      await sleep(230);
      if (g !== gen || busy) return;
      doDraw();
    }
  }

  async function doTsumo() {
    if (busy || mode !== 'normal') return;
    const r = game.tsumo();
    if (!r) return;
    const g = gen;
    busy = true;
    showToast('ツモ！');
    log(`${game.turn}巡目`, `ツモ和了 ${r.limit || `${r.fu}符${r.han}飜`} ${r.points.total}点`);
    renderStatus();
    renderActions();
    applyHandState();
    await sleep(950);
    if (g !== gen) return;
    busy = false;
    showResult(r);
  }

  function onKanButton() {
    if (busy || mode !== 'normal') return;
    const opts = game.kanOptions();
    if (opts.length === 0) return;
    if (opts.length === 1) doKan(opts[0]);
    else enterMode('kan');
  }

  async function doKan(kind) {
    if (busy || game.phase !== 'discard') return;
    const g = gen;
    busy = true;
    mode = 'normal';
    selectedId = null;
    showToast('カン！');
    const res = game.kan(kind);
    if (!res) { busy = false; return; }
    log(`${game.turn}巡目`, '暗槓', res.tiles[0]);

    analysis = null;
    renderHand(true);
    const grp = els.kans.lastElementChild;
    if (grp) grp.classList.add('enter-kan');
    renderActions();
    await sleep(380);
    if (g !== gen) return;

    // 嶺上牌ツモ・新ドラめくり
    const drawnEl = els.hand.querySelector('.tile.drawn');
    if (drawnEl) drawnEl.classList.add('enter-draw');
    renderHeader();
    log('', 'ドラ追加', game.doraIndicators[game.doraIndicators.length - 1]);
    analysis = game.analysis();
    renderStatus();
    refreshHints();
    renderActions();
    applyHandState();
    await sleep(320);
    if (g !== gen) return;
    busy = false;
    await afterDraw(g, game.drawn);
  }

  // ---------- モード（リーチ宣言牌選択 / カン牌選択） ----------
  function enterMode(m) {
    if (busy || game.phase !== 'discard') return;
    mode = m;
    selectedId = null;
    applyHandState();
    renderActions();
  }
  function exitMode() {
    mode = 'normal';
    selectedId = null;
    applyHandState();
    renderActions();
  }

  function onTileClick(tileId, kind) {
    if (busy || game.phase !== 'discard') return;
    if (mode === 'riichi') {
      if (game.riichiCandidates().includes(tileId)) doDiscard(tileId, true);
      return;
    }
    if (mode === 'kan') {
      if (game.kanOptions().includes(kind)) doKan(kind);
      return;
    }
    if (game.riichi && (!game.drawn || game.drawn.id !== tileId)) return;
    if (settings.twoClick && selectedId !== tileId) {
      selectedId = tileId;
      applyHandState();
      return;
    }
    doDiscard(tileId);
  }

  // =====================================================
  // 描画
  // =====================================================
  function renderAll(animate) {
    renderHeader();
    renderRiver();
    renderHand(animate);
    renderStatus();
    refreshHints();
    renderActions();
  }

  /** 牌要素を生成 */
  function tileEl(tile, opts = {}) {
    const el = document.createElement(opts.button ? 'button' : 'div');
    if (opts.button) el.type = 'button';
    el.className = `tile tile-${opts.size || 'md'}`;
    if (opts.faceDown) { el.classList.add('back'); return el; }
    const info = Tiles.info(tile.kind);
    el.classList.add(`suit-${info.suit}`);
    if (tile.red) el.classList.add('red');
    el.dataset.id = tile.id;
    el.dataset.kind = tile.kind;
    el.title = info.label + (tile.red ? '（赤）' : '');
    el.setAttribute('aria-label', el.title);
    if (settings.display === 'glyph') {
      el.innerHTML = `<span class="face glyph">${info.glyph}</span>`;
    } else if (info.suit === 'z') {
      el.innerHTML = `<span class="face honor">${info.kanji}</span>`;
    } else {
      el.innerHTML = `<span class="face num">${info.num}</span><span class="face suit">${info.kanji}</span>`;
    }
    return el;
  }
  const kindEl = (kind, size) => tileEl({ id: -1, kind, red: false }, { size });

  function renderHeader() {
    const rw = Tiles.WINDS[settings.roundWind];
    const sw = Tiles.WINDS[settings.seatWind];
    els.roundInfo.textContent = `${rw}場 ・ 自風 ${sw}${settings.seatWind === 27 ? '（親）' : ''}`;
    els.dora.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const t = game.deadWall[4 + i];
      const shown = i < game.doraCount;
      const el = tileEl(t, { size: 'sm', faceDown: !shown });
      if (shown && i >= shownDora) el.classList.add('flip-in');
      els.dora.appendChild(el);
    }
    shownDora = game.doraCount;
    els.remaining.textContent = game.drawsLeft;
    els.wallCount.textContent = `（山 ${game.remaining} 枚）`;
    els.turn.textContent = game.turn;
  }

  function renderRiver() {
    els.river.innerHTML = '';
    for (const d of game.discards) els.river.appendChild(riverTileEl(d));
  }
  function riverTileEl(d) {
    const el = tileEl(d.tile, { size: 'md' });
    el.classList.add('river-tile');
    if (d.tsumogiri) el.classList.add('tsumogiri');
    if (d.riichi) el.classList.add('riichi-tile');
    return el;
  }

  /**
   * 手牌を再構築。animate=true なら FLIP で位置の移動をアニメーション。
   * ツモ牌が無いときも同じ幅の空き枠を置き、13枚のときに手牌が動かないようにする。
   */
  function renderHand(animate) {
    const before = new Map();
    if (animate) {
      els.hand.querySelectorAll('.tile[data-id]').forEach((el) => before.set(el.dataset.id, el.getBoundingClientRect()));
    }
    els.hand.innerHTML = '';
    for (const t of game.hand) els.hand.appendChild(handTileEl(t));
    const gap = document.createElement('div');
    gap.className = 'hand-gap';
    els.hand.appendChild(gap);
    if (game.drawn) {
      const el = handTileEl(game.drawn);
      el.classList.add('drawn');
      els.hand.appendChild(el);
    } else {
      const slot = document.createElement('div');
      slot.className = 'tile tile-lg slot';
      els.hand.appendChild(slot);
    }
    els.kans.innerHTML = '';
    for (const k of game.kans) {
      const grp = document.createElement('div');
      grp.className = 'kan-group';
      k.tiles.forEach((t, i) => grp.appendChild(tileEl(t, { size: 'md', faceDown: i === 0 || i === 3 })));
      els.kans.appendChild(grp);
    }
    if (animate) {
      els.hand.querySelectorAll('.tile[data-id]').forEach((el) => {
        const b = before.get(el.dataset.id);
        if (!b) return;
        const a = el.getBoundingClientRect();
        const dx = b.left - a.left, dy = b.top - a.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          el.style.transition = '';
          el.style.transform = '';
        }));
      });
    }
    applyHandState();
  }

  function handTileEl(t) {
    const el = tileEl(t, { button: true, size: 'lg' });
    el.addEventListener('click', () => onTileClick(t.id, t.kind));
    return el;
  }

  /** 手牌の有効/無効・選択・ヒントバッジを状態に合わせて更新 */
  function applyHandState() {
    const canDiscard = game.phase === 'discard' && !auto.running;
    const riichiCands = mode === 'riichi' ? new Set(game.riichiCandidates()) : null;
    const kanKinds = mode === 'kan' ? new Set(game.kanOptions()) : null;
    const showBadges = settings.hints && analysis && mode === 'normal' && !game.riichi && canDiscard;
    const byKind = analysis ? Object.fromEntries(analysis.map((r) => [r.kind, r])) : {};
    const minS = analysis ? analysis[0].shanten : null;
    const bestTotal = analysis ? analysis[0].total : 0;

    els.hand.querySelectorAll('.tile[data-id]').forEach((el) => {
      const id = +el.dataset.id, kind = +el.dataset.kind;
      el.querySelectorAll('.badge').forEach((b) => b.remove());
      el.classList.remove('dim', 'locked', 'selected', 'candidate');
      let enabled = canDiscard;
      if (enabled && riichiCands) {
        enabled = riichiCands.has(id);
        el.classList.toggle('dim', !enabled);
        el.classList.toggle('candidate', enabled);
      } else if (enabled && kanKinds) {
        enabled = kanKinds.has(kind);
        el.classList.toggle('dim', !enabled);
        el.classList.toggle('candidate', enabled);
      } else if (enabled && game.riichi) {
        enabled = !!game.drawn && id === game.drawn.id;
        if (!enabled) el.classList.add('locked');
      }
      el.disabled = !enabled;
      if (selectedId === id) el.classList.add('selected');
      if (showBadges) {
        const r = byKind[kind];
        if (r && r.shanten === minS && r.total > 0) {
          const b = document.createElement('span');
          b.className = 'badge' + (r.total === bestTotal ? ' best' : '');
          b.textContent = r.total;
          el.appendChild(b);
        }
      }
    });
  }

  function renderStatus() {
    renderWaitsBox();
    if (game.phase === 'end' && game.result && game.result.type === 'win') {
      els.shanten.textContent = 'ツモ和了';
      els.shanten.className = 'shanten complete';
      els.waits.innerHTML = '';
      return;
    }
    if (game.drawn) {
      const s = game.currentShanten();
      els.shanten.className = 'shanten' + (s === -1 ? ' complete' : s === 0 ? ' tenpai' : '');
      if (s === -1) {
        els.shanten.textContent = '和了形！';
        els.waits.innerHTML = '<span>「ツモ和了」で和了できます</span>';
      } else {
        els.shanten.innerHTML = `<span class="sub">打牌後</span>${Tiles.shantenLabel(s)}`;
        els.waits.innerHTML = `<span class="muted">${auto.running ? '自動リセット中…' : game.riichi ? 'リーチ中：ツモ切り' : '捨てる牌を選んでください'}</span>`;
      }
      return;
    }
    const info = game.handInfo();
    els.shanten.textContent = Tiles.shantenLabel(info.shanten);
    els.shanten.className = 'shanten' + (info.shanten === 0 ? ' tenpai' : '');
    els.waits.innerHTML = game.phase === 'draw' ? '<span class="muted">ツモ待ち</span>' : '';
  }

  /** 卓右上の待ち表示。13枚の手牌（ツモ牌を除く）が聴牌なら常に表示する */
  function renderWaitsBox() {
    const info = game.phase === 'end' && game.result && game.result.type === 'win' ? { shanten: 1, waits: [] } : game.handInfo();
    if (info.shanten !== 0) {
      waitsKey = '';
      show(els.waitsBox, false);
      return;
    }
    const key = `${game.riichi ? 'r' : ''}:${info.waits.map((w) => `${w.kind}/${w.left}`).join(',')}`;
    show(els.waitsBox, true);
    if (key === waitsKey) return; // 内容が同じなら再描画しない（アニメーションの再生を防ぐ）
    waitsKey = key;
    els.waitsTitle.textContent = game.riichi ? 'リーチ ・ 待ち' : '待ち';
    els.waitsList.innerHTML = '';
    let total = 0;
    info.waits.forEach((w, i) => {
      const wrap = document.createElement('span');
      wrap.className = 'wait';
      wrap.style.animationDelay = `${i * 60}ms`;
      wrap.appendChild(kindEl(w.kind, 'sm'));
      const n = document.createElement('small');
      n.textContent = `${w.left}枚`;
      wrap.appendChild(n);
      els.waitsList.appendChild(wrap);
      total += w.left;
    });
    const tot = document.createElement('span');
    tot.className = 'total';
    tot.textContent = `計 ${total}枚`;
    els.waitsList.appendChild(tot);
  }

  function refreshHints() {
    const box = els.hint;
    box.innerHTML = '';
    if (!settings.hints) { box.innerHTML = '<p class="muted">非表示（チェックで表示）</p>'; return; }
    if (game.phase !== 'discard' || !analysis) {
      box.innerHTML = `<p class="muted">${game.phase === 'end' ? '終局' : 'ツモ後に打牌候補を表示します'}</p>`;
      return;
    }
    if (game.riichi) { box.innerHTML = '<p class="muted">リーチ中はツモ切りのみ</p>'; return; }
    const minS = analysis[0].shanten;
    const rows = analysis.filter((r) => r.shanten === minS).slice(0, 6);
    const head = document.createElement('div');
    head.className = 'hint-head';
    head.textContent = minS === -1 ? '和了形です' : `${Tiles.shantenLabel(minS)}に取れる打牌と受け入れ枚数`;
    box.appendChild(head);
    rows.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'hint-row' + (i === 0 && r.total > 0 ? ' best' : '');
      row.style.animationDelay = `${i * 40}ms`;
      const d = document.createElement('div');
      d.style.display = 'flex'; d.style.alignItems = 'center'; d.style.gap = '4px';
      const lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = '打';
      d.appendChild(lbl);
      d.appendChild(kindEl(r.kind, 'sm'));
      row.appendChild(d);
      const n = document.createElement('div');
      n.className = 'n';
      n.innerHTML = `${r.total}<small>枚</small>`;
      row.appendChild(n);
      const tl = document.createElement('div');
      tl.className = 'hint-tiles';
      for (const a of r.accepts) {
        const acc = document.createElement('span');
        acc.className = 'acc';
        acc.appendChild(kindEl(a.kind, 'xs'));
        const s = document.createElement('small');
        s.textContent = a.n;
        acc.appendChild(s);
        tl.appendChild(acc);
      }
      row.appendChild(tl);
      box.appendChild(row);
    });
  }

  function renderActions() {
    const p = game.phase;
    const normal = mode === 'normal';
    const active = !auto.running;
    const win = p === 'discard' && normal && active ? game.canTsumo() : null;
    const kanOpts = p === 'discard' && normal && active ? game.kanOptions() : [];
    show(els.btnDraw, p === 'draw' && !settings.autoDraw && active);
    show(els.btnTsumo, !!win);
    show(els.btnRiichi, p === 'discard' && normal && active && game.riichiCandidates().length > 0);
    show(els.btnKan, p === 'discard' && normal && kanOpts.length > 0);
    show(els.btnTsumogiri, p === 'discard' && normal && active && game.riichi && (!!win || kanOpts.length > 0));
    show(els.btnCancel, !normal);
    els.modeMsg.textContent = mode === 'riichi' ? 'リーチ宣言牌（光っている牌）を選んでください'
      : mode === 'kan' ? 'カンする牌を選んでください' : '';
    if (win) els.btnTsumo.textContent = `ツモ和了 ${win.limit ? `（${win.limit}）` : `（${win.fu}符 ${win.han}飜）`}`;
  }
  const show = (el, on) => el.classList.toggle('hidden', !on);

  // =====================================================
  // アニメーション
  // =====================================================
  /** 手牌の牌を河へ飛ばす */
  function flyToRiver(fromEl, d) {
    const start = fromEl.getBoundingClientRect();
    const target = riverTileEl(d);
    target.style.visibility = 'hidden';
    els.river.appendChild(target);
    const wrap = els.river.parentElement;
    wrap.scrollTop = wrap.scrollHeight; // 河が長い場合は末尾までスクロールしてから着地点を測る
    const end = target.getBoundingClientRect();

    const ghost = fromEl.cloneNode(true);
    ghost.classList.remove('drawn', 'selected', 'candidate', 'enter-draw', 'enter-deal');
    ghost.classList.add('fly-ghost');
    ghost.querySelectorAll('.badge').forEach((b) => b.remove());
    Object.assign(ghost.style, {
      position: 'fixed', left: `${start.left}px`, top: `${start.top}px`,
      width: `${start.width}px`, height: `${start.height}px`, margin: '0',
      transform: 'none', transition: 'none', zIndex: 50, animation: 'none',
    });
    document.body.appendChild(ghost);
    fromEl.style.visibility = 'hidden';

    const scale = (d.riichi ? end.height : end.width) / start.width;
    const dx = (end.left + end.width / 2) - (start.left + start.width / 2);
    const dy = (end.top + end.height / 2) - (start.top + start.height / 2);
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        ghost.style.transition = 'transform 0.42s cubic-bezier(0.3, 0.7, 0.25, 1)';
        ghost.style.transform = `translate(${dx}px, ${dy}px) ${d.riichi ? 'rotate(-90deg)' : ''} scale(${scale})`;
      }));
      setTimeout(() => {
        ghost.remove();
        target.style.visibility = '';
        target.classList.add('landed');
        resolve();
      }, 450);
    });
  }

  function showToast(text, small = false) {
    const el = document.createElement('div');
    el.className = 'toast' + (small ? ' small' : '');
    el.textContent = text;
    els.toastLayer.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  function log(when, text, tile) {
    const li = document.createElement('li');
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = when;
    li.appendChild(t);
    const body = document.createElement('span');
    body.textContent = text + (tile ? ' ' : '');
    if (tile) body.appendChild(tileEl(tile, { size: 'xs' }));
    li.appendChild(body);
    els.log.prepend(li);
    while (els.log.children.length > 30) els.log.lastElementChild.remove();
  }

  // =====================================================
  // 結果表示
  // =====================================================
  function showResult(r) {
    const body = els.resultBody;
    body.innerHTML = '';
    if (r.type === 'win') buildWinResult(body, r);
    else buildDrawResult(body, r);
    if (!els.resultDialog.open) els.resultDialog.showModal();
  }

  function buildWinResult(body, r) {
    const ctx = r.ctx;
    const title = document.createElement('h2');
    title.className = 'result-title';
    title.textContent = r.yakumanCount ? r.limit : 'ツモ和了';
    body.appendChild(title);
    const sub = document.createElement('div');
    sub.className = 'result-sub';
    sub.textContent = `${game.turn}巡目 ・ ${Tiles.WINDS[ctx.roundWind]}場 自風 ${Tiles.WINDS[ctx.seatWind]}${ctx.isDealer ? '（親）' : '（子）'}`;
    body.appendChild(sub);

    // 手牌
    const hand = document.createElement('div');
    hand.className = 'result-hand';
    let i = 0;
    for (const t of Tiles.sortTiles(ctx.closed)) {
      const el = tileEl(t, { size: 'md' });
      el.style.animationDelay = `${i++ * 30}ms`;
      hand.appendChild(el);
    }
    const gap = document.createElement('div'); gap.className = 'gap'; hand.appendChild(gap);
    const winEl = tileEl(ctx.winTile, { size: 'md' });
    winEl.classList.add('win-tile');
    winEl.style.animationDelay = `${i++ * 30}ms`;
    hand.appendChild(winEl);
    for (const k of ctx.kans) {
      const grp = document.createElement('div');
      grp.className = 'kan-group';
      k.tiles.forEach((t, j) => grp.appendChild(tileEl(t, { size: 'md', faceDown: j === 0 || j === 3 })));
      hand.appendChild(grp);
    }
    body.appendChild(hand);

    // ドラ・裏ドラ表示
    const ind = document.createElement('div');
    ind.className = 'result-indicators';
    ind.appendChild(indicatorGroup('ドラ表示', game.doraIndicators));
    if (ctx.riichi) ind.appendChild(indicatorGroup('裏ドラ表示', game.uraIndicators));
    body.appendChild(ind);

    // 役一覧
    const ul = document.createElement('ul');
    ul.className = 'yaku-list';
    r.yaku.forEach((y, idx) => {
      const li = document.createElement('li');
      if (y.yakuman) li.classList.add('yakuman');
      li.style.animationDelay = `${200 + idx * 90}ms`;
      li.innerHTML = `<span>${y.name}</span><span class="han">${y.yakuman ? y.han : `${y.han}飜`}</span>`;
      ul.appendChild(li);
    });
    body.appendChild(ul);

    // 点数
    const score = document.createElement('div');
    score.className = 'score';
    if (!r.yakumanCount) {
      const fh = document.createElement('span');
      fh.className = 'fuhan';
      fh.textContent = `${r.fu}符 ${r.han}飜`;
      score.appendChild(fh);
    }
    if (r.limit) {
      const lim = document.createElement('span');
      lim.className = 'limit';
      lim.textContent = r.limit;
      score.appendChild(lim);
    }
    const pts = document.createElement('span');
    pts.className = 'points';
    pts.innerHTML = `<span class="num">0</span>点<small>${r.points.detail}</small>`;
    score.appendChild(pts);
    body.appendChild(score);
    countUp(pts.querySelector('.num'), r.points.total, 200 + r.yaku.length * 90, 700);
  }

  function indicatorGroup(label, tiles) {
    const g = document.createElement('div');
    g.className = 'grp';
    const l = document.createElement('span');
    l.textContent = label;
    g.appendChild(l);
    for (const t of tiles) g.appendChild(tileEl(t, { size: 'xs' }));
    return g;
  }

  function buildDrawResult(body, r) {
    const title = document.createElement('h2');
    title.className = 'result-title draw';
    title.textContent = '荒牌流局';
    body.appendChild(title);
    const sub = document.createElement('div');
    sub.className = 'result-sub';
    sub.textContent = `${game.turn}巡目でツモが尽きました ・ ${r.tenpai ? '聴牌' : `ノーテン（${Tiles.shantenLabel(r.shanten)}）`}`;
    body.appendChild(sub);
    const hand = document.createElement('div');
    hand.className = 'result-hand';
    game.hand.forEach((t, i) => {
      const el = tileEl(t, { size: 'md' });
      el.style.animationDelay = `${i * 30}ms`;
      hand.appendChild(el);
    });
    for (const k of game.kans) {
      const grp = document.createElement('div');
      grp.className = 'kan-group';
      k.tiles.forEach((t, j) => grp.appendChild(tileEl(t, { size: 'md', faceDown: j === 0 || j === 3 })));
      hand.appendChild(grp);
    }
    body.appendChild(hand);
    if (r.tenpai) {
      const w = document.createElement('div');
      w.className = 'result-waits';
      const l = document.createElement('span'); l.className = 'muted'; l.textContent = '待ち';
      w.appendChild(l);
      for (const x of r.waits) {
        const wrap = document.createElement('span');
        wrap.className = 'wait';
        wrap.style.display = 'inline-flex'; wrap.style.flexDirection = 'column'; wrap.style.alignItems = 'center';
        wrap.appendChild(kindEl(x.kind, 'sm'));
        const s = document.createElement('small'); s.className = 'muted'; s.textContent = `${x.left}枚`;
        wrap.appendChild(s);
        w.appendChild(wrap);
      }
      body.appendChild(w);
    }
  }

  function countUp(el, to, delay, duration) {
    const start = performance.now() + delay;
    function step(now) {
      const p = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(to * eased).toLocaleString();
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /** 外部から状態を差し替えた後に再描画する（デバッグ用） */
  function refresh() {
    analysis = game.drawn ? game.analysis() : null;
    renderAll(false);
  }

  return { init, refresh, get game() { return game; }, get settings() { return settings; } };
})();
