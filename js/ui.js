'use strict';
/**
 * 描画・アニメーション・操作
 */
const UI = (() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const STORAGE_KEY = 'soloMahjong.settings.v1';
  const TAB_KEY = 'soloMahjong.settingsTab';
  const DEFAULTS = {
    display: 'image',
    redDora: true,
    autoDraw: true,
    autoTsumogiri: true,
    clickMode: 'single',     // single | double
    fastTsumo: false,        // ツモ動作の簡略化
    showKeys: true,          // 手牌の下にキー表示
    autoWin: false,          // 自動和了
    autoKan: false,          // 自動カン
    autoTsumogiriAll: false, // 自動ツモ切り（下のボタン。条件があれば欲しい牌が来るまで）
    autoDiscard: null,       // 自動ツモ切りの欲しい牌の条件（AutoDiscard.normalize で補完）
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
    'display', 'roundWind', 'seatWind', 'autoDraw', 'autoTsumogiri', 'clickMode', 'fastTsumo', 'showKeys',
    'instantReset', 'autoReset', 'autoResetInterval', 'autoResetShanten',
    'redDora', 'tileM19', 'tileM28', 'tileP19', 'tileP28', 'tileS19', 'tileS28', 'tileZ',
    'maxDraws', 'simulateOthers',
  ];
  const TILE_KEYS = Tiles.TILE_GROUPS.map((g) => g.key);
  const MIN_WALL_TILES = 40;   // 王牌14 + 配牌13 + 最低限のツモ
  const AUTO_KEYS = ['autoWin', 'autoKan']; // 卓上のトグル
  // キーボード打牌: 手牌の左から順に対応するキー（JIS 配列の数字キー列）
  const KEY_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '^', '¥'];
  const KEY_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal', 'IntlYen'];
  const KEY_CHARS = { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6, '8': 7, '9': 8, '0': 9, '-': 10, '^': 11, '=': 11, '¥': 12, '\\': 12 };
  const canHover = typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches;
  const FAST_AUTO_MS = 500;    // これ未満の間隔は「高速」扱い（アニメーション省略・表示間引き）
  const RIVER_MIN_SCALE = 0.55; // 河の牌を縮小する下限（これでも収まらなければスクロール）
  // 操作ボタンのキー（拼音の頭文字＋ローマ字の別名）: 立直 lìzhí / 杠 gàng / 和 hú / 过 guò(見逃し)
  const ACTION_KEYS = {
    riichi: ['l', 'r'],
    kan: ['g', 'k'],
    tsumo: ['h', 't'],
    pass: ['p'],
    autoDiscard: ['z', 'j'], // 自动 zìdòng / 自動 jidō
  };

  let settings;
  let game;
  let busy = false;          // アニメーション中は操作を受け付けない
  let gen = 0;               // 局の世代（リセット時に進行中の非同期処理を無効化する）
  let mode = 'normal';       // normal | riichi | kan
  let selectedId = null;     // 2クリック打牌の選択中の牌
  let analysis = null;       // 牌効率解析（14枚時のみ）
  let shownDora = 0;         // 表示済みドラ表示牌の数（めくりアニメ用）
  let waitsKey = '';         // 待ち表示の内容キー（変化時のみ再描画）
  let hoverKind = null;      // ホバー中の手牌の牌種（視覚補助）
  let hoverPreview = null;   // ホバー中の牌を切った場合の待ち（聴牌になる場合のみ）
  const auto = { running: false, timer: null, count: 0, lastRender: 0 };
  // 条件付き自動ツモ切りの状態（ツモ累計・目標達成で停止中か）
  const ad = { draws: {}, countedId: null, stopped: false, checked: '' };
  const els = {};

  // =====================================================
  // 初期化
  // =====================================================
  function init() {
    settings = loadSettings();
    const ids = [
      'round-info', 'dora', 'remaining', 'wall-count', 'turn', 'shanten', 'waits-box', 'waits-title', 'waits-list',
      'river', 'riichi-stick', 'toast-layer', 'hint', 'log', 'hand', 'kans',
      'btn-draw', 'btn-tsumo', 'btn-riichi', 'btn-kan', 'btn-tsumogiri', 'btn-cancel', 'mode-msg',
      'btn-reset', 'btn-auto', 'auto-status', 'btn-settings', 'chk-hints', 'result-dialog', 'settings-dialog',
      'result-body', 'btn-result-next', 'btn-result-close', 'btn-show-result', 'table', 'tileset-note', 'settings-tabs',
      'want-editor', 'want-progress', 'btn-autodiscard',
    ];
    for (const id of ids) els[camel(id)] = document.getElementById(id);
    document.body.dataset.display = settings.display;
    document.body.classList.toggle('show-keys', !!settings.showKeys);
    bindEvents();
    buildAdEditor();
    syncSettingsForm();
    syncAutoUI();
    syncAutoDiscardButton();
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
    if (s.twoClick) { s.clickMode = 'double'; delete s.twoClick; } // 旧設定の移行
    if (!s.imageDisplayMigrated) { s.display = 'image'; s.imageDisplayMigrated = true; } // 画像表示を既定に（1回だけ）
    if (countTiles(s) < MIN_WALL_TILES) for (const k of TILE_KEYS) s[k] = true;
    s.autoDiscard = AutoDiscard.normalize(s.autoDiscard);
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
    els.btnAutodiscard.addEventListener('click', () => toggleAutoDiscard());
    els.btnSettings.addEventListener('click', () => els.settingsDialog.showModal());
    els.settingsTabs.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (b) selectSettingsTab(b.dataset.tab);
    });
    let tab = 'view';
    try { tab = localStorage.getItem(TAB_KEY) || tab; } catch (e) { /* ignore */ }
    selectSettingsTab(tab);
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
    els.btnResultClose.addEventListener('click', () => { els.resultDialog.close(); renderActions(); });
    els.btnShowResult.addEventListener('click', () => { if (game.result) showResult(game.result); });

    // 卓上の自動操作トグル
    for (const key of AUTO_KEYS) {
      const el = document.getElementById(`tg-${key}`);
      el.checked = !!settings[key];
      el.addEventListener('change', async () => {
        settings[key] = el.checked;
        saveSettings();
        if (!el.checked) return;
        // ON にした瞬間にも適用（アニメーション中なら終わるまで待つ）
        const g = gen;
        for (let i = 0; i < 30 && busy; i++) await sleep(100);
        if (g === gen && !busy) afterDraw(g, game.drawn);
      });
    }

    // 手牌ホバー時の視覚補助（マウス操作のときのみ）
    if (canHover) {
      els.hand.addEventListener('mouseover', (e) => {
        const t = e.target.closest('.tile[data-kind]');
        if (t) setHover(+t.dataset.kind);
      });
      els.hand.addEventListener('mouseleave', () => setHover(null));
    }

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
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const mod = e.ctrlKey || e.metaKey || e.altKey;
      // クリック後にボタンへ残ったフォーカスで Enter / Space が二重に作用しないようにする
      if ((k === 'Enter' || k === ' ') && e.target instanceof HTMLButtonElement && !els.resultDialog.open) e.preventDefault();
      if (!mod && ACTION_KEYS.riichi.includes(k)) {
        if (isShown(els.btnRiichi)) enterMode('riichi');
        else if (mode === 'riichi') exitMode();
      }
      else if (!mod && ACTION_KEYS.kan.includes(k)) {
        if (isShown(els.btnKan)) onKanButton();
        else if (mode === 'kan') exitMode();
      }
      else if (!mod && ACTION_KEYS.tsumo.includes(k)) { if (isShown(els.btnTsumo)) doTsumo(); }
      else if (!mod && ACTION_KEYS.pass.includes(k)) { if (isShown(els.btnTsumogiri) && game.drawn) doDiscard(game.drawn.id); }
      else if (e.key === 'Escape') {
        if (auto.running) { stopAuto(); return; }
        if (mode !== 'normal') exitMode();
        if (selectedId !== null) { selectedId = null; applyHandState(); }
      }
      else if (!mod && k === 'n') { stopAuto(); resetGame(); }
      else if (!mod && k === 'a') toggleAuto();
      else if (!mod && ACTION_KEYS.autoDiscard.includes(k)) toggleAutoDiscard();
      else if (e.key === ' ') { if (isShown(els.btnDraw)) { e.preventDefault(); doDraw(); } }
      else if (e.key === 'Enter') {
        if (isShown(els.btnDraw)) { e.preventDefault(); doDraw(); }
        else if (game.drawn && game.phase === 'discard') { e.preventDefault(); onTileKey(game.drawn.id, game.drawn.kind); }
      }
      else if (!mod) {
        let idx = KEY_CODES.indexOf(e.code);
        if (idx < 0 && e.key in KEY_CHARS) idx = KEY_CHARS[e.key];
        if (idx >= 0 && idx < game.hand.length && game.phase === 'discard') {
          e.preventDefault();
          const t = game.hand[idx];
          onTileKey(t.id, t.kind);
        }
      }
    });
    // 画面サイズ・向きが変わったら河の縮小率を計算し直す
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(fitRiver, 100);
    });
    // 入場アニメーションのクラスは終了後に外す（hover 等の transform を有効にするため）
    document.addEventListener('animationend', (e) => {
      const el = e.target;
      if (el.classList) el.classList.remove('enter-deal', 'enter-draw', 'flip-in', 'enter-kan', 'landed');
      if (el.style) el.style.animationDelay = '';
    });
  }

  /** 設定ダイアログのタブ切り替え（最後に開いたタブを記憶） */
  function selectSettingsTab(tab) {
    const tabs = els.settingsTabs.querySelectorAll('button[data-tab]');
    if (![...tabs].some((b) => b.dataset.tab === tab)) tab = tabs[0].dataset.tab;
    tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    document.querySelectorAll('.settings-page').forEach((p) => p.classList.toggle('active', p.dataset.page === tab));
    try { localStorage.setItem(TAB_KEY, tab); } catch (e) { /* ignore */ }
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
      buildAdEditor();
    } else if (key === 'roundWind' || key === 'seatWind') {
      renderHeader();
      renderActions();
      buildAdEditor();
    } else if (key === 'autoDraw') {
      renderActions();
      if (settings.autoDraw && game.phase === 'draw' && !busy) doDraw();
    } else if (key === 'showKeys') {
      document.body.classList.toggle('show-keys', !!settings.showKeys);
    } else if (key === 'clickMode') {
      selectedId = null;
      applyHandState();
    } else if (key === 'autoReset') {
      if (settings.autoReset) startAuto(); else stopAuto();
    } else if (key === 'autoResetShanten' || key === 'autoResetInterval') {
      syncAutoUI();
    } else if (TILE_KEYS.includes(key)) {
      updateTilesetNote();
      buildAdEditor();
    } else if (key === 'redDora') {
      buildAdEditor();
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
    resetAd();
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
    resetAd();
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

  /** ツモ後の自動処理（自動和了・自動カン・自動ツモ切り） */
  async function afterDraw(g, tile) {
    if (!tile || game.phase !== 'discard' || mode !== 'normal' || auto.running) return;
    const wait = settings.fastTsumo ? 120 : 550;
    if (settings.autoWin && game.canTsumo()) {
      await sleep(settings.fastTsumo ? 120 : 400);
      if (g !== gen || busy || game.phase !== 'discard') return;
      doTsumo();
      return;
    }
    if (settings.autoKan) {
      const opts = game.kanOptions();
      if (opts.length > 0) {
        await sleep(wait);
        if (g !== gen || busy || game.phase !== 'discard') return;
        doKan(opts[0]);
        return;
      }
    }
    if (game.canTsumo() || game.kanOptions().length > 0) return;
    let target = null;
    if (game.riichi && settings.autoTsumogiri) target = game.drawn.id;
    else if (settings.autoTsumogiriAll) target = autoDiscardTarget();
    if (target === null) return;
    await sleep(wait);
    if (g !== gen || busy || game.phase !== 'discard' || !game.drawn) return;
    doDiscard(target);
  }

  // ---------- 条件付き自動ツモ切り ----------
  function resetAd() {
    ad.draws = {};
    ad.countedId = null;
    ad.stopped = false;
    ad.checked = '';
  }
  const adCtx = () => ({ doraKinds: game.doraKinds, roundWind: settings.roundWind, seatWind: settings.seatWind });
  const adHeld = () => game.fullTiles().concat(...game.kans.map((k) => k.tiles));
  const adProgress = () => AutoDiscard.progress(settings.autoDiscard, ad.draws, adHeld(), adCtx());
  /** 局の山・ドラで条件が達成できるか */
  const adFeasibility = () => AutoDiscard.feasibility(settings.autoDiscard,
    Tiles.makeWall(game.opts.redDora, game.opts.kinds), adCtx(), 14 + game.kans.length);

  /** 自動ツモ切りの ON/OFF（下のボタン・Z キー）。ON にするたびにカウントをリセット */
  async function toggleAutoDiscard() {
    if (!settings.autoTsumogiriAll && game && AutoDiscard.isActive(settings.autoDiscard)) {
      const f = adFeasibility();
      if (!f.ok) { showToast(`達成できない条件です: ${f.messages[0]}`, true); return; }
    }
    settings.autoTsumogiriAll = !settings.autoTsumogiriAll;
    saveSettings();
    resetAd();
    syncAutoDiscardButton();
    renderAdProgress();
    if (!settings.autoTsumogiriAll) return;
    // ON にした瞬間にも適用（アニメーション中なら終わるまで待つ）
    const g = gen;
    for (let i = 0; i < 30 && busy; i++) await sleep(100);
    if (g === gen && !busy) afterDraw(g, game.drawn);
  }
  function syncAutoDiscardButton() {
    const on = !!settings.autoTsumogiriAll;
    els.btnAutodiscard.classList.toggle('running', on);
    els.btnAutodiscard.setAttribute('aria-pressed', String(on));
    els.btnAutodiscard.querySelector('.lbl').textContent = on ? '■ 自動ツモ切り中' : '▶ 自動ツモ切り';
  }

  /**
   * 自動ツモ切りで切る牌の id。止まる場合は null。
   * 条件が無ければ常にツモ切り。条件があれば、目標に足りない枚数を最も増やさない牌を切り
   * （欲しくない牌 → 目標を超えた牌の順。ツモ牌が最善ならツモ切り）、目標に達したら止まる。
   */
  function autoDiscardTarget() {
    const cfg = settings.autoDiscard;
    if (!AutoDiscard.isActive(cfg)) return game.drawn.id;
    if (ad.stopped) return null;
    // 配牌・カンのたびにドラを含めて達成できるか判定し直す
    const checkKey = `${game.doraCount}:${game.kans.length}`;
    if (ad.checked !== checkKey) {
      ad.checked = checkKey;
      const f = adFeasibility();
      if (!f.ok) {
        ad.stopped = true;
        renderAdProgress();
        showToast(`達成できない条件です: ${f.messages[0]}`, true);
        log(`${game.turn}巡目`, '自動ツモ切り 停止（達成できない条件）');
        return null;
      }
    }
    const ctx = adCtx();
    const tile = game.drawn;
    if (tile.id !== ad.countedId) {
      ad.countedId = tile.id;
      AutoDiscard.countDraw(ad.draws, tile, cfg, ctx);
    }
    const prog = adProgress();
    if (AutoDiscard.goalReached(prog, cfg)) {
      ad.stopped = true;
      renderAdProgress(prog);
      showToast('目標達成', true);
      log(`${game.turn}巡目`, '自動ツモ切り 目標達成');
      return null;
    }
    renderAdProgress(prog);
    if (game.riichi) return tile.id;
    const pick = AutoDiscard.pickDiscard(game.fullTiles(), cfg, ctx, analysis || game.analysis(), {
      drawnId: tile.id,
      kanTiles: game.kans.flatMap((k) => k.tiles),
    });
    return pick ? pick.id : null;
  }

  /** 自動ツモ切りボタンの横に進捗を表示 */
  function renderAdProgress(prog) {
    const el = els.wantProgress;
    const cfg = settings.autoDiscard;
    if (!settings.autoTsumogiriAll || !AutoDiscard.isActive(cfg) || !game) { el.innerHTML = ''; show(el, false); return; }
    prog = prog || adProgress();
    el.innerHTML = '';
    const MAX_SHOWN = 4;
    prog.slice(0, MAX_SHOWN).forEach((p) => {
      const item = document.createElement('span');
      item.className = 'wantp-item' + (p.done ? ' done' : '');
      item.textContent = `${p.label} ${Math.min(p.have, p.need)}/${p.need}`;
      el.appendChild(item);
    });
    if (prog.length > MAX_SHOWN) {
      const more = document.createElement('span');
      more.className = 'wantp-item';
      more.textContent = `他${prog.length - MAX_SHOWN}`;
      el.appendChild(more);
    }
    if (ad.stopped) {
      const st = document.createElement('span');
      st.className = 'wantp-stop';
      st.textContent = '停止中';
      el.appendChild(st);
    }
    el.title = prog.map((p) => `${p.label} ${p.have}/${p.need}`).join('\n');
    show(el, true);
  }

  /** 設定「自動」タブの欲しい牌の条件エディタ */
  function buildAdEditor() {
    const root = els.wantEditor;
    const cfg = settings.autoDiscard;
    const changed = () => {
      saveSettings();
      resetAd();
      renderAdProgress();
      refreshEditor();
    };
    root.innerHTML = '';
    // 設定画面ではドラは未定（他の項目と重ならない4枚とみなす）
    const wall = Tiles.makeWall(settings.redDora, Tiles.kindsFromSettings(settings));
    const ctx = { doraKinds: null, roundWind: settings.roundWind, seatWind: settings.seatWind };
    const maxOf = (key) => Math.max(1, Math.min(14, AutoDiscard.available(key, wall, ctx)));

    // 上段: 停止条件・数え方・合計枚数・手出しの選び方（横に揃える）
    const head = document.createElement('div');
    head.className = 'want-head';
    const field = (label, control) => {
      const f = document.createElement('label');
      f.className = 'want-field';
      const l = document.createElement('span');
      l.textContent = label;
      f.append(l, control);
      head.appendChild(f);
      return f;
    };
    const select = (html, value, onChange) => {
      const el = document.createElement('select');
      el.innerHTML = html;
      el.value = value;
      el.addEventListener('change', () => onChange(el.value));
      return el;
    };
    field('停止条件', select('<option value="or">どれか1つ達成（OR）</option><option value="and">すべて達成（AND）</option><option value="sum">合計枚数</option>',
      cfg.combine, (v) => { cfg.combine = v; changed(); }));
    field('数え方', select('<option value="draw">ツモった枚数（累計）</option><option value="hold">手牌に持つ枚数</option>',
      cfg.countMode, (v) => { cfg.countMode = v; changed(); }));
    field('手出しの選び方', select('<option value="efficiency">牌効率（最も不要な牌）</option><option value="keep">向聴を保ってランダム</option><option value="random">完全ランダム</option>',
      cfg.pick, (v) => { cfg.pick = v; changed(); }));
    const total = stepper(() => cfg.total, 14, (v) => { cfg.total = v; changed(); });
    const totalField = field('合計枚数', total.el);
    root.appendChild(head);

    // 選択中の項目（目標枚数はここで調整）
    const selRow = document.createElement('div');
    selRow.className = 'want-group';
    const selLabel = document.createElement('span');
    selLabel.className = 'want-label';
    selLabel.textContent = '選択中';
    const selBox = document.createElement('div');
    selBox.className = 'want-selected';
    selRow.append(selLabel, selBox);
    root.appendChild(selRow);
    const warn = document.createElement('div');
    warn.className = 'want-warn';
    root.appendChild(warn);

    const cells = []; // { key, chip, badge }
    const itemOf = (key) => cfg.items.find((it) => it.key === key);
    const toggle = (key) => {
      const i = cfg.items.findIndex((it) => it.key === key);
      if (i >= 0) cfg.items.splice(i, 1); else cfg.items.push({ key, count: 1 });
      changed();
    };
    const makeCell = (key, content, title) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip want-chip';
      if (typeof content === 'string') b.textContent = content; else { b.classList.add('tile-chip'); b.appendChild(content); }
      b.title = title;
      b.addEventListener('click', () => toggle(key));
      const badge = document.createElement('span');
      badge.className = 'want-badge';
      b.appendChild(badge);
      cells.push({ key, chip: b, badge });
      return b;
    };

    for (const g of AutoDiscard.GROUPS) {
      const row = document.createElement('div');
      row.className = 'want-group';
      const l = document.createElement('span');
      l.className = 'want-label';
      l.textContent = g.label;
      const grid = document.createElement('div');
      grid.className = 'want-grid';
      for (const [key, text, title] of g.items) grid.appendChild(makeCell(key, text, title));
      row.append(l, grid);
      root.appendChild(row);
    }
    // 特定の牌: 萬子・筒子・索子・字牌を1行ずつ（山に無い牌種は空欄）
    const inWall = Tiles.kindsFromSettings(settings);
    const row = document.createElement('div');
    row.className = 'want-group';
    const l = document.createElement('span');
    l.className = 'want-label';
    l.textContent = '特定の牌';
    const grid = document.createElement('div');
    grid.className = 'want-grid tiles';
    for (let k = 0; k < 34; k++) {
      if (!inWall.has(k)) { grid.appendChild(document.createElement('div')); continue; }
      grid.appendChild(makeCell(`kind:${k}`, kindEl(k, 'sm', true), Tiles.info(k).label));
    }
    row.append(l, grid);
    root.appendChild(row);

    const foot = document.createElement('div');
    foot.className = 'want-foot';
    const summary = document.createElement('span');
    summary.className = 'want-summary';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'btn ghost small';
    clear.textContent = '条件をすべて解除';
    clear.addEventListener('click', () => { cfg.items = []; changed(); });
    foot.append(summary, clear);
    root.appendChild(foot);

    function refreshEditor() {
      const sum = cfg.combine === 'sum';
      totalField.classList.toggle('hidden', !sum);
      total.sync();
      for (const c of cells) {
        const it = itemOf(c.key);
        c.chip.setAttribute('aria-pressed', String(!!it));
        c.badge.textContent = it && !sum ? `×${it.count}` : '';
        c.badge.classList.toggle('hidden', !it || sum);
      }
      // 選択中の一覧
      selBox.innerHTML = '';
      if (cfg.items.length === 0) {
        const e = document.createElement('span');
        e.className = 'want-empty';
        e.textContent = '未選択（下の項目を押して追加）';
        selBox.appendChild(e);
      }
      for (const it of cfg.items) {
        const sel = document.createElement('span');
        sel.className = 'want-sel';
        const name = document.createElement('span');
        name.className = 'want-sel-name';
        if (it.key.startsWith('kind:')) name.appendChild(kindEl(+it.key.slice(5), 'xs', true));
        else name.textContent = AutoDiscard.shortLabel(it.key);
        sel.appendChild(name);
        if (!sum) sel.appendChild(stepper(() => it.count, maxOf(it.key), (v) => { it.count = v; changed(); }).el);
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'want-del';
        del.textContent = '✕';
        del.title = '解除';
        del.setAttribute('aria-label', `${AutoDiscard.shortLabel(it.key)}を解除`);
        del.addEventListener('click', () => toggle(it.key));
        sel.appendChild(del);
        selBox.appendChild(sel);
      }
      const f = AutoDiscard.feasibility(cfg, wall, ctx);
      warn.innerHTML = '';
      for (const m of f.messages) {
        const d = document.createElement('div');
        d.textContent = (f.ok ? '注意: ' : '達成できません: ') + m;
        warn.appendChild(d);
      }
      warn.classList.toggle('soft', f.ok);
      show(warn, f.messages.length > 0);
      clear.disabled = cfg.items.length === 0;
      summary.textContent = cfg.items.length === 0
        ? '条件なし: 常にツモ切りします'
        : `欲しい牌: ${cfg.items.map((it) => AutoDiscard.shortLabel(it.key) + (sum ? '' : `×${it.count}`)).join('・')}${sum ? `（合計${cfg.total}枚）` : ''}`;
    }
    refreshEditor();
  }

  /** 目標枚数の − n ＋（1〜max） */
  function stepper(get, max, onChange) {
    const el = document.createElement('span');
    el.className = 'stepper';
    const minus = document.createElement('button');
    const plus = document.createElement('button');
    const val = document.createElement('span');
    val.className = 'stepper-val';
    minus.type = plus.type = 'button';
    minus.textContent = '−';
    plus.textContent = '+';
    minus.setAttribute('aria-label', '減らす');
    plus.setAttribute('aria-label', '増やす');
    const sync = () => {
      const v = get();
      val.textContent = v;
      minus.disabled = v <= 1;
      plus.disabled = v >= max;
    };
    const step = (d) => onChange(Math.min(max, Math.max(1, get() + d)));
    minus.addEventListener('click', () => step(-1));
    plus.addEventListener('click', () => step(1));
    el.append(minus, val, plus);
    sync();
    return { el, sync };
  }

  async function doDiscard(tileId, declareRiichi = false) {
    if (busy || game.phase !== 'discard') return;
    const fromEl = els.hand.querySelector(`.tile[data-id="${tileId}"]`);
    if (!fromEl) return;
    const g = gen;
    mode = 'normal';
    selectedId = null;
    analysis = null;
    setHover(null);

    const res = game.discard(tileId, declareRiichi);
    if (declareRiichi) {
      showToast(game.doubleRiichi ? 'ダブルリーチ！' : 'リーチ！');
      els.riichiStick.classList.remove('hidden');
      log(`${game.turn}巡目`, `${game.doubleRiichi ? 'ダブル' : ''}リーチ 宣言牌`, res.tile);
    }

    const fly = flyToRiver(fromEl, res);

    if (settings.fastTsumo) {
      // 簡略化: 打牌の飛行と同時に次をツモり、待ち時間（クールダウン）を置かない
      let tile = null;
      if (settings.autoDraw && game.phase === 'draw') {
        tile = game.draw();
        analysis = game.analysis();
      }
      renderHand(true);
      const drawnEl = els.hand.querySelector('.tile.drawn');
      if (drawnEl && tile) drawnEl.classList.add('enter-draw');
      renderHeader();
      renderStatus();
      refreshHints();
      renderActions();
      if (game.phase === 'exhausted') { await fly; if (g !== gen) return; await onExhausted(g); return; }
      if (tile) afterDraw(g, tile);
      return;
    }

    busy = true;
    renderHand(true);
    renderHeader();
    renderStatus();
    refreshHints();
    renderActions();
    await fly;
    if (g !== gen) return;
    busy = false;

    if (game.phase === 'exhausted') { await onExhausted(g); return; }
    if (settings.autoDraw) {
      await sleep(230);
      if (g !== gen || busy) return;
      doDraw();
    }
  }

  async function onExhausted(g) {
    const r = game.exhaust();
    log('流局', r.tenpai ? '聴牌' : 'ノーテン');
    renderStatus();
    renderActions();
    applyHandState();
    await sleep(300);
    if (g !== gen) return;
    showResult(r);
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
    setHover(null);
    renderHand(true, { hideDrawn: true }); // 嶺上牌はまだ見せない
    const grp = els.kans.lastElementChild;
    if (grp) grp.classList.add('enter-kan');
    renderActions();
    await sleep(settings.fastTsumo ? 200 : 380);
    if (g !== gen) return;

    // 嶺上牌ツモ・新ドラめくり
    renderHand(false);
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
      if (!game.riichiCandidates().includes(tileId)) return;
      if (settings.clickMode === 'double' && selectedId !== tileId) {
        selectedId = tileId;
        applyHandState();
        return;
      }
      doDiscard(tileId, true);
      return;
    }
    if (mode === 'kan') {
      if (game.kanOptions().includes(kind)) doKan(kind);
      return;
    }
    if (game.riichi && (!game.drawn || game.drawn.id !== tileId)) return;
    if (settings.clickMode === 'double' && selectedId !== tileId) {
      selectedId = tileId;
      applyHandState();
      return;
    }
    doDiscard(tileId);
  }

  /** キーボードからの打牌（クリックと同じ扱い。ダブルクリック設定なら2回押しで確定） */
  const onTileKey = (tileId, kind) => onTileClick(tileId, kind);

  /** ホバー中の牌種を設定し、同種牌の強調と待ちプレビューを更新 */
  function setHover(kind) {
    if (kind === hoverKind) return;
    hoverKind = kind;
    document.querySelectorAll('.tile.same').forEach((el) => el.classList.remove('same'));
    if (kind !== null) {
      document.querySelectorAll(`#hand .tile[data-kind="${kind}"], #river .tile[data-kind="${kind}"], #dora .tile[data-kind="${kind}"], #kans .tile[data-kind="${kind}"]`)
        .forEach((el) => el.classList.add('same'));
    }
    hoverPreview = kind === null ? null : previewWaits(kind);
    renderWaitsBox();
  }

  /** kind を切った場合に聴牌なら、その待ち（残り枚数付き）。聴牌にならなければ null */
  function previewWaits(kind) {
    if (!game.drawn || game.riichi || game.phase !== 'discard') return null;
    const c = Tiles.counts(game.fullTiles());
    if (c[kind] === 0) return null;
    c[kind]--;
    if (Shanten.calc(c, game.kans.length) !== 0) return null;
    const unseen = game.unseenCounts();
    const waits = Shanten.waits(c, game.kans.length)
      .filter((k) => game.initialCounts[k] > 0)
      .map((k) => ({ kind: k, left: Math.max(0, unseen[k]) }));
    return { kind, waits };
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
    if (!opts.noDora && game && game.doraKinds.includes(tile.kind)) el.classList.add('dora');
    if (hoverKind === tile.kind && !opts.noDora) el.classList.add('same');
    el.dataset.id = tile.id;
    el.dataset.kind = tile.kind;
    el.title = info.label + (tile.red ? '（赤）' : '');
    el.setAttribute('aria-label', el.title);
    if (settings.display === 'image') {
      const code = tile.red ? `0${info.suit}` : info.code;
      el.innerHTML = `<img class="face img" src="assets/tiles/${code}.svg" alt="" draggable="false">`;
    } else if (settings.display === 'glyph') {
      el.innerHTML = `<span class="face glyph">${info.glyph}</span>`;
    } else if (info.suit === 'z') {
      el.innerHTML = `<span class="face honor">${info.kanji}</span>`;
    } else {
      el.innerHTML = `<span class="face num">${info.num}</span><span class="face suit">${info.kanji}</span>`;
    }
    return el;
  }
  const kindEl = (kind, size, noDora = false) => tileEl({ id: -1, kind, red: false }, { size, noDora });

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
    fitRiver();
  }

  /**
   * 河の牌を縮小して表示領域に収める（スクロールを極力発生させない）。
   * 河の横幅は固定のまま、牌が小さくなった分だけ1行に並ぶ枚数を増やす。
   */
  function fitRiver() {
    const wrap = els.river.parentElement;
    const width = els.river.clientWidth;
    const availH = wrap.clientHeight - parseFloat(getComputedStyle(wrap).paddingTop || 0);
    if (!width || availH <= 0) return;
    const n = els.river.children.length;
    const baseCols = +getComputedStyle(els.river).getPropertyValue('--river-cols') || 14;
    const baseW = width / baseCols - 3; // 等倍時の牌幅
    const riichiExtra = els.river.querySelector('.riichi-tile') ? 1 : 0; // 横向きの宣言牌の分
    let scale = 1;
    for (let s = 1; s >= RIVER_MIN_SCALE - 1e-9; s -= 0.05) {
      scale = s;
      const w = baseW * s, h = w * 1.35;
      const cols = Math.max(1, Math.floor((width + 3) / (w + 3)));
      const rows = Math.max(3, Math.ceil((n + riichiExtra) / cols));
      if (rows * (h + 3) <= availH) break;
    }
    els.river.style.setProperty('--river-scale', scale.toFixed(2));
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
  function renderHand(animate, opts = {}) {
    const before = new Map();
    if (animate) {
      els.hand.querySelectorAll('.tile[data-id]').forEach((el) => before.set(el.dataset.id, el.getBoundingClientRect()));
    }
    els.hand.innerHTML = '';
    game.hand.forEach((t, i) => els.hand.appendChild(handTileEl(t, KEY_LABELS[i] || '')));
    const gap = document.createElement('div');
    gap.className = 'hand-gap';
    els.hand.appendChild(gap);
    if (game.drawn && !opts.hideDrawn) {
      const el = handTileEl(game.drawn, 'Enter');
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

  function handTileEl(t, keyLabel) {
    const el = tileEl(t, { button: true, size: 'lg' });
    el.addEventListener('click', () => onTileClick(t.id, t.kind));
    if (keyLabel) {
      const k = document.createElement('span');
      k.className = 'key';
      k.textContent = keyLabel;
      el.appendChild(k);
    }
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
    renderAdProgress();
    if (game.phase === 'end' && game.result && game.result.type === 'win') {
      els.shanten.textContent = 'ツモ和了';
      els.shanten.className = 'shanten complete';
      return;
    }
    if (game.drawn) {
      const s = game.currentShanten();
      els.shanten.className = 'shanten' + (s === -1 ? ' complete' : s === 0 ? ' tenpai' : '');
      if (s === -1) els.shanten.textContent = '和了形！';
      else els.shanten.innerHTML = `<span class="sub">打牌後</span>${Tiles.shantenLabel(s)}`;
      return;
    }
    const info = game.handInfo();
    els.shanten.textContent = Tiles.shantenLabel(info.shanten);
    els.shanten.className = 'shanten' + (info.shanten === 0 ? ' tenpai' : '');
  }

  /** 卓右上の待ち表示。13枚の手牌（ツモ牌を除く）が聴牌なら常に表示する */
  function renderWaitsBox() {
    const preview = hoverPreview;
    const info = preview ? { shanten: 0, waits: preview.waits }
      : game.phase === 'end' && game.result && game.result.type === 'win' ? { shanten: 1, waits: [] } : game.handInfo();
    if (info.shanten !== 0) {
      waitsKey = '';
      show(els.waitsBox, false);
      return;
    }
    const key = `${preview ? `p${preview.kind}` : game.riichi ? 'r' : ''}:${info.waits.map((w) => `${w.kind}/${w.left}`).join(',')}`;
    show(els.waitsBox, true);
    els.waitsBox.classList.toggle('preview', !!preview);
    if (key === waitsKey) return; // 内容が同じなら再描画しない（アニメーションの再生を防ぐ）
    waitsKey = key;
    els.waitsTitle.innerHTML = '';
    if (preview) {
      els.waitsTitle.append('打 ');
      els.waitsTitle.appendChild(kindEl(preview.kind, 'xs', true));
      els.waitsTitle.append(' → 待ち');
    } else {
      els.waitsTitle.textContent = game.riichi ? 'リーチ ・ 待ち' : '待ち';
    }
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
      d.appendChild(kindEl(r.kind, 'sm', true));
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
        acc.appendChild(kindEl(a.kind, 'xs', true));
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
    show(els.btnShowResult, p === 'end' && !!game.result && !els.resultDialog.open && !auto.running);
    els.modeMsg.textContent = mode === 'riichi'
      ? `リーチ宣言牌（光っている牌）を選んでください${settings.clickMode === 'double' ? '（2回で確定）' : ''}`
      : mode === 'kan' ? 'カンする牌を選んでください' : '';
  }
  const show = (el, on) => el.classList.toggle('hidden', !on);
  const isShown = (el) => !el.classList.contains('hidden');

  // =====================================================
  // アニメーション
  // =====================================================
  /** 手牌の牌を河へ飛ばす */
  function flyToRiver(fromEl, d) {
    const start = fromEl.getBoundingClientRect();
    const target = riverTileEl(d);
    target.style.visibility = 'hidden';
    els.river.appendChild(target);
    fitRiver();
    // 縮小しても収まらず着地点が見えない場合のみ、最小限スクロールする（通常は手動のみ）
    const wrap = els.river.parentElement;
    const wr = wrap.getBoundingClientRect();
    let end = target.getBoundingClientRect();
    if (end.bottom > wr.bottom || end.top < wr.top) {
      wrap.scrollTop += end.bottom > wr.bottom ? end.bottom - wr.bottom + 4 : end.top - wr.top - 4;
      end = target.getBoundingClientRect();
    }

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
