App.register("inventory", function (params) {
  const storeId = params.storeId || App.currentStore;
  let _flavors = [];
  let _mode = "grid"; // grid | list | order | freq | log
  let _filterBrand = "";

  const BRAND_COLORS = {
    AF: "#7c3aed", DZJ: "#0891b2", りら: "#d97706", AFZ: "#059669",
    あるわふぁ: "#dc2626", スターバズ: "#f59e0b", TRIFECIA: "#9333ea",
    SS: "#0284c7", ふまり: "#16a34a", フルータス: "#ea580c", その他: "#6b7280",
  };

  const BRAND_FULL = {
    AF:       "Al Fakher",
    AFZ:      "Afzal",
    DZJ:      "Dozaj",
    SS:       "Social Smoke",
    TRIFECIA: "Trifecta",
    りら:     "Lira",
    あるわふぁ: "Al Waha",
    スターバズ: "Starbuzz",
    ふまり:   "Fumari",
    フルータス: "Frutas",
  };

  const FLAVOR_FULL = {
    // AF
    'ダブアポ':     'ダブルアップル',
    'グレフル':     'グレープフルーツ',
    'レッドアップル': 'レッドアップル',
    // DZJ
    'チョコ':       'チョコレート',
    'ドラゴン':     'ドラゴンフルーツ',
    'ペア':         'ペアー',
    'パイン':       'パイナップル',
    // AFZ
    'ヘーゼル':     'ヘーゼルナッツ',
    // SS
    'デリアポ':     'デリシャスアップル',
    'ペアチル':     'ペアー＆チル',
    // ふまり
    'すいか':       'スイカ',
    // フルータス
    'ちび炭':       'ちび炭（小）',
    'デカ炭':       'デカ炭（大）',
  };

  function _bc(brand) { return BRAND_COLORS[brand] || "#6b7280"; }
  function _bf(brand) { return BRAND_FULL[brand] || brand; }
  function _ff(name)  { return FLAVOR_FULL[name]  || name; }

  function _stockColor(stock, min) {
    if (stock === 0) return "#ef4444";
    if (stock < min) return "#f59e0b";
    return "#34d399";
  }

  function _stockDots(stock, min) {
    const cap = Math.max(min, stock, 1);
    return Array.from({ length: Math.min(cap, 6) }, (_, i) => {
      const filled = i < stock;
      const color = stock === 0 ? "#ef4444" : stock < min ? "#f59e0b" : "#34d399";
      return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:2px;background:${filled ? color : '#374151'};"></span>`;
    }).join("");
  }

  // ── グリッドセル ──────────────────────────────────────────────────
  function _gridCell(f) {
    const sc = _stockColor(f.stock, f.min_stock);
    const bg = f.stock === 0 ? "#2d0a0a" : f.stock < f.min_stock ? "#2d1a00" : "#1a2d1a";
    const border = f.stock === 0 ? "#7f1d1d" : f.stock < f.min_stock ? "#78350f" : "#1f2937";
    const shortage = f.min_stock > 0 && f.stock < f.min_stock
      ? `<span style="font-size:9px;color:#f87171;font-weight:700;">−${f.min_stock - f.stock}</span>` : '';
    return `<div onclick="window._invGridTap('${f.id}')"
      style="background:${bg};border:1px solid ${border};border-radius:8px;padding:8px 6px;
             display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;min-height:72px;justify-content:center;">
      <span style="font-size:10px;color:#d1d5db;font-weight:600;text-align:center;line-height:1.3;word-break:break-all;">${_ff(f.name)}</span>
      <span style="font-size:18px;font-weight:700;color:${sc};line-height:1;">${f.stock}</span>
      <div style="display:flex;align-items:center;gap:3px;">
        <span style="font-size:9px;color:#4b5563;">/${f.min_stock}</span>
        ${shortage}
      </div>
    </div>`;
  }

  // ── リスト行 ──────────────────────────────────────────────────────
  function _flavorRow(f) {
    const sc = _stockColor(f.stock, f.min_stock);
    const status = f.stock === 0
      ? `<span style="background:#7f1d1d;color:#fca5a5;font-size:9px;padding:1px 6px;border-radius:10px;font-weight:700;">切れ</span>`
      : f.stock < f.min_stock
      ? `<span style="background:#78350f;color:#fcd34d;font-size:9px;padding:1px 6px;border-radius:10px;font-weight:700;">少</span>`
      : "";
    return `<div id="inv-row-${f.id}" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #111827;">
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span style="font-size:14px;color:#f3f4f6;font-weight:500;">${_ff(f.name)}</span>
          ${status}
        </div>
        <div style="margin-top:4px;display:flex;align-items:center;gap:4px;">
          ${_stockDots(f.stock, f.min_stock)}
          <span style="font-size:10px;color:#4b5563;margin-left:2px;">/ ${f.min_stock}</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        <button onclick="window._invDec('${f.id}')" style="width:32px;height:32px;background:#1f2937;border:1px solid #374151;border-radius:8px;color:#f3f4f6;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">−</button>
        <span style="min-width:28px;text-align:center;font-size:18px;font-weight:700;color:${sc};">${f.stock}</span>
        <button onclick="window._invInc('${f.id}')" style="width:32px;height:32px;background:#1f2937;border:1px solid #374151;border-radius:8px;color:#f3f4f6;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">＋</button>
      </div>
    </div>`;
  }

  // ── ブランドセクションヘッダー ─────────────────────────────────────
  function _brandHeader(brand, items) {
    const outCnt = items.filter(f => f.stock === 0).length;
    const lowCnt = items.filter(f => f.stock > 0 && f.stock < f.min_stock).length;
    const alert = outCnt > 0
      ? `<span style="font-size:9px;background:#7f1d1d;color:#fca5a5;border-radius:8px;padding:1px 6px;">${outCnt}切れ</span>`
      : lowCnt > 0
      ? `<span style="font-size:9px;background:#78350f;color:#fcd34d;border-radius:8px;padding:1px 6px;">${lowCnt}少</span>`
      : "";
    return `<div style="padding:7px 14px;background:#0d1117;display:flex;align-items:center;gap:8px;">
      <span style="width:10px;height:10px;border-radius:50%;background:${_bc(brand)};display:inline-block;flex-shrink:0;"></span>
      <span style="font-size:13px;font-weight:700;color:#f3f4f6;">${_bf(brand)}</span>
      ${alert}
      <span style="font-size:10px;color:#374151;margin-left:auto;">${items.length}種</span>
    </div>`;
  }

  function _brands() {
    const seen = new Set();
    return _flavors.reduce((acc, f) => {
      if (!seen.has(f.brand)) { seen.add(f.brand); acc.push(f.brand); }
      return acc;
    }, []);
  }

  // ── メインレンダリング ─────────────────────────────────────────────
  function _render() {
    const el = document.getElementById("main");
    const color = (window.STORE_COLOR || {})[storeId] || "#7c3aed";
    const brands = _brands();
    const filtered = _filterBrand ? _flavors.filter(f => f.brand === _filterBrand) : _flavors;
    const orderItems = _flavors.filter(f => f.stock < f.min_stock);

    // ブランドフィルタータブ
    const brandTabs = [`<button onclick="window._invBrand('')"
      style="padding:4px 10px;border-radius:12px;border:none;cursor:pointer;font-size:11px;
      background:${_filterBrand===''?color:'#374151'};color:#f3f4f6;margin:2px;white-space:nowrap;">全て</button>`];
    brands.forEach(b => brandTabs.push(
      `<button onclick="window._invBrand('${b}')"
        style="padding:4px 10px;border-radius:12px;border:none;cursor:pointer;font-size:11px;
        background:${_filterBrand===b?_bc(b):'#374151'};color:#f3f4f6;margin:2px;white-space:nowrap;">${_bf(b)}</button>`
    ));

    let content = "";

    if (_mode === "grid") {
      const grouped = {};
      filtered.forEach(f => { (grouped[f.brand] = grouped[f.brand] || []).push(f); });
      content = Object.entries(grouped).map(([brand, items]) =>
        `<div style="margin-bottom:4px;">
          ${_brandHeader(brand, items)}
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:10px 12px;">
            ${items.map(_gridCell).join("")}
          </div>
        </div>`
      ).join("");

    } else if (_mode === "list") {
      const grouped = {};
      filtered.forEach(f => { (grouped[f.brand] = grouped[f.brand] || []).push(f); });
      content = Object.entries(grouped).map(([brand, items]) =>
        `<div style="margin-bottom:2px;">
          ${_brandHeader(brand, items)}
          ${items.map(_flavorRow).join("")}
        </div>`
      ).join("");

    } else if (_mode === "order") {
      content = orderItems.length === 0
        ? `<div style="text-align:center;padding:48px;color:#6b7280;">発注が必要なフレーバーはありません</div>`
        : `<div style="padding:12px 14px;border-bottom:1px solid #111827;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <button onclick="window._invCopyOrder()" style="background:#374151;border:none;color:#f3f4f6;border-radius:6px;padding:5px 12px;font-size:11px;cursor:pointer;margin-left:auto;">📋 コピー</button>
          </div>` +
          orderItems.map(f => {
            const need = f.min_stock - f.stock;
            return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #111827;">
              <div>
                <span style="font-size:13px;color:#f3f4f6;">${_ff(f.name)}</span>
                <span style="font-size:10px;color:#6b7280;margin-left:6px;">${_bf(f.brand)}</span>
              </div>
              <div style="text-align:right;">
                <span style="font-size:12px;color:#f87171;">在庫${f.stock}</span>
                <span style="color:#6b7280;font-size:12px;"> → </span>
                <span style="font-size:12px;font-weight:700;color:#fcd34d;">+${need}</span>
              </div>
            </div>`;
          }).join("");

    } else if (_mode === "freq") {
      content = `<div id="inv-freq-area" style="padding:8px;">
        <div style="text-align:center;color:#6b7280;font-size:12px;padding:16px;">集計中...</div>
      </div>`;
      setTimeout(_loadFreq, 50);

    } else if (_mode === "log") {
      content = `<div id="inv-log-area" style="padding:8px;">
        <div style="text-align:center;color:#6b7280;font-size:12px;padding:16px;">読み込み中...</div>
      </div>`;
      setTimeout(_loadLog, 50);
    }

    const showBrandFilter = _mode === "grid" || _mode === "list";

    el.innerHTML = `
      <div style="padding:12px 16px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;min-width:0;">
          <div style="display:flex;background:#1f2937;border-radius:8px;padding:2px;gap:2px;flex:1;min-width:0;">
            ${(window._storeIds || []).map(id => {
              const btnColor = (window.STORE_COLOR || {})[id] || "#7c3aed";
              const active   = storeId === id;
              return `<button onclick="App.go('inventory',{storeId:'${id}'})"
                style="flex:1;padding:5px 4px;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;
                background:${active?btnColor:'transparent'};color:${active?'#fff':'#6b7280'};">${escHtml((window.STORE_NAME || {})[id] || id)}</button>`;
            }).join("")}
          </div>
          <button onclick="window._invAddModal()" style="background:#374151;border:none;color:#f3f4f6;border-radius:6px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">＋追加</button>
        </div>

        <div style="display:flex;gap:4px;margin-bottom:10px;overflow-x:auto;padding-bottom:2px;">
          <button onclick="window._invMode('grid')"
            style="flex:1;min-width:44px;padding:7px 4px;border-radius:8px;border:none;cursor:pointer;font-size:11px;font-weight:700;white-space:nowrap;
            background:${_mode==='grid'?color:'#374151'};color:#f3f4f6;">グリッド</button>
          <button onclick="window._invMode('list')"
            style="flex:1;min-width:44px;padding:7px 4px;border-radius:8px;border:none;cursor:pointer;font-size:11px;font-weight:700;white-space:nowrap;
            background:${_mode==='list'?color:'#374151'};color:#f3f4f6;">一覧</button>
          <button onclick="window._invMode('order')"
            style="flex:1;min-width:44px;padding:7px 4px;border-radius:8px;border:none;cursor:pointer;font-size:11px;font-weight:700;white-space:nowrap;position:relative;
            background:${_mode==='order'?'#b45309':'#374151'};color:#f3f4f6;">発注${orderItems.length>0?`<span style="position:absolute;top:-4px;right:-2px;background:#ef4444;color:#fff;border-radius:50%;width:14px;height:14px;font-size:8px;display:flex;align-items:center;justify-content:center;">${orderItems.length}</span>`:''}</button>
          <button onclick="window._invMode('freq')"
            style="flex:1;min-width:44px;padding:7px 4px;border-radius:8px;border:none;cursor:pointer;font-size:11px;font-weight:700;white-space:nowrap;
            background:${_mode==='freq'?'#9333ea':'#374151'};color:#f3f4f6;">人気</button>
          <button onclick="window._invMode('log')"
            style="flex:1;min-width:44px;padding:7px 4px;border-radius:8px;border:none;cursor:pointer;font-size:11px;font-weight:700;white-space:nowrap;
            background:${_mode==='log'?'#0369a1':'#374151'};color:#f3f4f6;">ログ</button>
        </div>

        ${showBrandFilter ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;">${brandTabs.join("")}</div>` : ""}

        <div style="background:#1f2937;border-radius:8px;overflow:hidden;">
          ${content}
        </div>
      </div>`;
  }

  // ── グリッドタップ → インライン +/- ───────────────────────────────
  window._invGridTap = function(id) {
    const f = _flavors.find(x => x.id === id);
    if (!f) return;
    const sc = _stockColor(f.stock, f.min_stock);
    const cell = document.querySelector(`[onclick="window._invGridTap('${id}')"]`);
    if (!cell) return;
    // すでに展開中なら閉じる
    if (cell.querySelector('.inv-grid-ctrl')) { return; }
    const ctrl = document.createElement("div");
    ctrl.className = "inv-grid-ctrl";
    Object.assign(ctrl.style, {
      position:"fixed", bottom:"0", left:"0", right:"0",
      background:"#111827", borderTop:"1px solid #374151",
      padding:"16px", zIndex:"600", display:"flex",
      alignItems:"center", justifyContent:"space-between", gap:"16px",
    });
    ctrl.innerHTML = `
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:700;color:#f3f4f6;">${f.name}</div>
        <div style="font-size:11px;color:#6b7280;">${_bf(f.brand)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;">
        <button onclick="window._invDec('${id}');document.querySelector('.inv-grid-ctrl')?.remove();" style="width:40px;height:40px;background:#1f2937;border:1px solid #374151;border-radius:10px;color:#f3f4f6;font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;">−</button>
        <span style="min-width:36px;text-align:center;font-size:24px;font-weight:700;color:${sc};" id="inv-ctrl-num">${f.stock}</span>
        <button onclick="window._invInc('${id}');document.querySelector('.inv-grid-ctrl')?.remove();" style="width:40px;height:40px;background:#1f2937;border:1px solid #374151;border-radius:10px;color:#f3f4f6;font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;">＋</button>
      </div>
      <button onclick="document.querySelector('.inv-grid-ctrl')?.remove();" style="background:none;border:none;color:#6b7280;font-size:22px;cursor:pointer;padding:0 4px;">✕</button>`;
    document.body.appendChild(ctrl);
  };

  // ── 在庫増減 ──────────────────────────────────────────────────────
  async function _setStock(id, delta) {
    const f = _flavors.find(x => x.id === id);
    if (!f) return;
    const newStock = Math.max(0, f.stock + delta);
    try {
      await App.api("PUT", `/inventory/${storeId}/${id}`, { stock: newStock });
      f.stock = newStock;
      if (_mode === "list") _renderFlavor(id);
      else _render();
    } catch (e) {
      _showToast("⚠️ 保存失敗: " + e.message);
    }
  }

  function _renderFlavor(id) {
    const f = _flavors.find(x => x.id === id);
    if (!f) return;
    const el = document.getElementById(`inv-row-${f.id}`);
    if (!el) return;
    el.outerHTML = _flavorRow(f);
  }

  // ── 頻度集計 ──────────────────────────────────────────────────────
  async function _loadFreq() {
    try {
      const log = await App.api("GET", `/inventory/${storeId}/log/recent?limit=1000`);
      const area = document.getElementById("inv-freq-area");
      if (!area) return;
      if (!log.length) {
        area.innerHTML = `<div style="text-align:center;color:#6b7280;font-size:12px;padding:24px;">データが溜まると表示されます</div>`;
        return;
      }
      // 減少（消費）回数を集計
      const counts = {};
      log.forEach(e => {
        if (e.to_stock < e.from_stock) {
          counts[e.flavor_id] = counts[e.flavor_id] || { name: e.name, brand: e.brand, cnt: 0, total: 0 };
          counts[e.flavor_id].cnt++;
          counts[e.flavor_id].total += (e.from_stock - e.to_stock);
        }
      });
      const ranked = Object.values(counts).sort((a, b) => b.cnt - a.cnt);
      if (!ranked.length) {
        area.innerHTML = `<div style="text-align:center;color:#6b7280;font-size:12px;padding:24px;">まだ消費ログがありません</div>`;
        return;
      }
      const maxCnt = ranked[0].cnt;
      area.innerHTML = `
        <div style="padding:10px 14px 6px;font-size:10px;color:#4b5563;">消費回数ランキング（ログ全期間）</div>` +
        ranked.map((r, i) => {
          const bar = Math.round(r.cnt / maxCnt * 100);
          const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i+1}.`;
          return `<div style="padding:8px 14px;border-bottom:1px solid #111827;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-size:12px;min-width:24px;">${medal}</span>
                <span style="font-size:13px;color:#f3f4f6;font-weight:500;">${r.name}</span>
                <span style="font-size:10px;color:#6b7280;">${_bf(r.brand)}</span>
              </div>
              <span style="font-size:12px;color:#a78bfa;font-weight:700;">${r.cnt}回</span>
            </div>
            <div style="background:#374151;border-radius:4px;height:4px;">
              <div style="background:#7c3aed;border-radius:4px;height:4px;width:${bar}%;"></div>
            </div>
          </div>`;
        }).join("");
    } catch (e) {
      _showToast("⚠️ 集計失敗: " + e.message);
    }
  }

  // ── 更新ログ ──────────────────────────────────────────────────────
  async function _loadLog() {
    try {
      const log = await App.api("GET", `/inventory/${storeId}/log/recent?limit=80`);
      const area = document.getElementById("inv-log-area");
      if (!area) return;
      if (!log.length) {
        area.innerHTML = `<div style="text-align:center;color:#6b7280;font-size:12px;padding:16px;">ログがありません</div>`;
        return;
      }
      area.innerHTML = log.map(e => {
        const t = e.ts.slice(5, 16).replace("T", " ");
        const arrow = e.to_stock > e.from_stock ? "↑" : "↓";
        const col = e.to_stock > e.from_stock ? "#34d399" : "#f87171";
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 12px;border-bottom:1px solid #111827;">
          <div>
            <span style="font-size:12px;color:#f3f4f6;">${_ff(e.name)}</span>
            <span style="font-size:10px;color:#4b5563;margin-left:6px;">${_bf(e.brand)}</span>
          </div>
          <div style="text-align:right;">
            <span style="font-size:13px;font-weight:700;color:${col};">${arrow} ${e.from_stock}→${e.to_stock}</span>
            <div style="font-size:9px;color:#6b7280;">${t}</div>
          </div>
        </div>`;
      }).join("");
    } catch (e) {
      _showToast("⚠️ ログ読み込み失敗: " + e.message);
    }
  }

  // ── 発注コピー ────────────────────────────────────────────────────
  window._invCopyOrder = function() {
    const orderItems = _flavors.filter(f => f.stock < f.min_stock);
    const lines = ["【発注リスト】"];
    const grouped = {};
    orderItems.forEach(f => { (grouped[f.brand] = grouped[f.brand] || []).push(f); });
    Object.entries(grouped).forEach(([brand, items]) => {
      lines.push(`\n■ ${_bf(brand)}`);
      items.forEach(f => lines.push(`・${f.name} +${f.min_stock - f.stock}個`));
    });
    navigator.clipboard.writeText(lines.join("\n"))
      .then(() => _showToast("📋 クリップボードにコピーしました"))
      .catch(() => _showToast("⚠️ コピー失敗"));
  };

  // ── フレーバー追加モーダル ────────────────────────────────────────
  function _addModal() {
    const brands = _brands();
    const existing = document.getElementById("inv-add-modal");
    if (existing) existing.remove();
    const modal = document.createElement("div");
    modal.id = "inv-add-modal";
    Object.assign(modal.style, {
      position:"fixed", inset:"0", background:"rgba(0,0,0,0.7)",
      display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:"9000",
    });
    modal.innerHTML = `
      <div style="background:#1f2937;border-radius:12px 12px 0 0;padding:20px;width:100%;max-width:500px;">
        <div style="font-size:14px;font-weight:700;color:#f3f4f6;margin-bottom:16px;">フレーバー追加</div>
        <div style="margin-bottom:10px;">
          <label style="font-size:11px;color:#9ca3af;">ブランド</label>
          <input id="inv-new-brand" list="inv-brand-list" value="${brands[0]||''}"
            style="width:100%;background:#111827;border:1px solid #374151;border-radius:6px;color:#f3f4f6;padding:8px;font-size:14px;box-sizing:border-box;margin-top:4px;">
          <datalist id="inv-brand-list">${brands.map(b=>`<option value="${b}">`).join("")}</datalist>
        </div>
        <div style="margin-bottom:10px;">
          <label style="font-size:11px;color:#9ca3af;">フレーバー名</label>
          <input id="inv-new-name" placeholder="例: ダブルアップル"
            style="width:100%;background:#111827;border:1px solid #374151;border-radius:6px;color:#f3f4f6;padding:8px;font-size:14px;box-sizing:border-box;margin-top:4px;">
        </div>
        <div style="display:flex;gap:8px;margin-bottom:16px;">
          <div style="flex:1;">
            <label style="font-size:11px;color:#9ca3af;">在庫</label>
            <input id="inv-new-stock" type="number" value="0" min="0"
              style="width:100%;background:#111827;border:1px solid #374151;border-radius:6px;color:#f3f4f6;padding:8px;font-size:14px;box-sizing:border-box;margin-top:4px;">
          </div>
          <div style="flex:1;">
            <label style="font-size:11px;color:#9ca3af;">適正在庫</label>
            <input id="inv-new-min" type="number" value="1" min="0"
              style="width:100%;background:#111827;border:1px solid #374151;border-radius:6px;color:#f3f4f6;padding:8px;font-size:14px;box-sizing:border-box;margin-top:4px;">
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <button onclick="document.getElementById('inv-add-modal').remove()"
            style="flex:1;padding:10px;background:#374151;border:none;border-radius:8px;color:#9ca3af;font-size:14px;cursor:pointer;">キャンセル</button>
          <button onclick="window._invAddConfirm()"
            style="flex:1;padding:10px;background:#7c3aed;border:none;border-radius:8px;color:#fff;font-size:14px;font-weight:700;cursor:pointer;">追加</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById("inv-new-name").focus();
  }

  async function _addConfirm() {
    const brand = document.getElementById("inv-new-brand").value.trim();
    const name  = document.getElementById("inv-new-name").value.trim();
    const stock = parseInt(document.getElementById("inv-new-stock").value) || 0;
    const min_stock = parseInt(document.getElementById("inv-new-min").value) || 1;
    if (!name) { _showToast("⚠️ フレーバー名を入力してください"); return; }
    try {
      await App.api("POST", `/inventory/${storeId}/flavor`, { brand, name, stock, min_stock });
      document.getElementById("inv-add-modal").remove();
      await _load();
      _showToast("✅ 追加しました");
    } catch (e) {
      _showToast("⚠️ 追加失敗: " + e.message);
    }
  }

  async function _load() {
    try {
      _flavors = await App.api("GET", `/inventory/${storeId}`);
    } catch (e) {
      _showToast("⚠️ 在庫読み込み失敗: " + e.message);
      _flavors = [];
    }
    _render();
  }

  window._invDec       = id => _setStock(id, -1);
  window._invInc       = id => _setStock(id, +1);
  window._invMode      = m  => { _mode = m; _render(); };
  window._invBrand     = b  => { _filterBrand = b; _render(); };
  window._invAddModal  = () => _addModal();
  window._invAddConfirm= () => _addConfirm();

  _load();
});
