App.register("inventory", function (params) {
  const storeId = params.storeId || App.currentStore;
  let _products = [];

  // ── 画面の簡略化について(docs/superpowers/plans/2026-11-01-pwa-rewrite.md
  // Task8参照) ──────────────────────────────────────────────────────────
  // 買い手(シーシャ店ではない業態)の要望「在庫はお酒の種類なんかを入力、設定
  // して+-確認出来る感じ」に合わせ、旧シーシャ店時代の「フレーバー」表記・
  // 「発注」「人気」タブ(+ハードコードされたシーシャブランド/フレーバー名の
  // 辞書)は全て削除した。残すのは「商品一覧」+「在庫数の+/-ボタン」の
  // シンプルな1画面のみ。グリッド/一覧/発注/人気/ログのモード切り替え自体も
  // 廃止し、常に単一の商品一覧を表示する。
  //
  // バックエンド(local/inventory.js)側のデータモデル(brand/min_stock等の
  // フィールド名)はPython版routers/inventory.pyと1対1互換のまま変更していない
  // (既存データ・ログとの互換性のため)。「ブランド」入力欄は在庫の自由な
  // カテゴリ分け(例: 「ウイスキー」「ワイン」等)として汎用的に使えるよう、
  // ハードコードされた選択肢は持たせず、既存の登録済み商品から動的に拾った
  // 候補をdatalistで補助するのみに留めている。

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

  // ── 商品一覧の行 ──────────────────────────────────────────────────
  function _productRow(p) {
    const sc = _stockColor(p.stock, p.min_stock);
    const status = p.stock === 0
      ? `<span style="background:#7f1d1d;color:#fca5a5;font-size:9px;padding:1px 6px;border-radius:10px;font-weight:700;">切れ</span>`
      : p.stock < p.min_stock
      ? `<span style="background:#78350f;color:#fcd34d;font-size:9px;padding:1px 6px;border-radius:10px;font-weight:700;">少</span>`
      : "";
    const brandLabel = p.brand && p.brand !== "その他"
      ? `<span style="font-size:10px;color:#6b7280;margin-left:6px;">${escHtml(p.brand)}</span>` : "";
    return `<div id="inv-row-${p.id}" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #111827;">
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span style="font-size:14px;color:#f3f4f6;font-weight:500;">${escHtml(p.name)}</span>
          ${brandLabel}
          ${status}
        </div>
        <div style="margin-top:4px;display:flex;align-items:center;gap:4px;">
          ${_stockDots(p.stock, p.min_stock)}
          <span style="font-size:10px;color:#4b5563;margin-left:2px;">/ ${p.min_stock}</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        <button onclick="window._invDec('${p.id}')" style="width:32px;height:32px;background:#1f2937;border:1px solid #374151;border-radius:8px;color:#f3f4f6;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">−</button>
        <span style="min-width:28px;text-align:center;font-size:18px;font-weight:700;color:${sc};">${p.stock}</span>
        <button onclick="window._invInc('${p.id}')" style="width:32px;height:32px;background:#1f2937;border:1px solid #374151;border-radius:8px;color:#f3f4f6;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">＋</button>
      </div>
    </div>`;
  }

  function _brands() {
    const seen = new Set();
    return _products.reduce((acc, p) => {
      if (!seen.has(p.brand)) { seen.add(p.brand); acc.push(p.brand); }
      return acc;
    }, []);
  }

  // ── メインレンダリング(商品一覧のみ、タブ・モード切り替え無し) ──────────
  function _render() {
    const el = document.getElementById("main");

    const content = _products.length === 0
      ? `<div style="text-align:center;padding:48px;color:#6b7280;">商品が登録されていません。「＋追加」から登録してください</div>`
      : _products.map(_productRow).join("");

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

        <div style="background:#1f2937;border-radius:8px;overflow:hidden;">
          ${content}
        </div>
      </div>`;
  }

  // ── 在庫増減 ──────────────────────────────────────────────────────
  async function _setStock(id, delta) {
    const p = _products.find(x => x.id === id);
    if (!p) return;
    const newStock = Math.max(0, p.stock + delta);
    try {
      await App.api("PUT", `/inventory/${storeId}/${id}`, { stock: newStock });
      p.stock = newStock;
      _renderProduct(id);
    } catch (e) {
      _showToast("⚠️ 保存失敗: " + e.message);
    }
  }

  function _renderProduct(id) {
    const p = _products.find(x => x.id === id);
    if (!p) return;
    const el = document.getElementById(`inv-row-${p.id}`);
    if (!el) return;
    el.outerHTML = _productRow(p);
  }

  // ── 商品追加モーダル ────────────────────────────────────────────────
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
        <div style="font-size:14px;font-weight:700;color:#f3f4f6;margin-bottom:16px;">商品追加</div>
        <div style="margin-bottom:10px;">
          <label style="font-size:11px;color:#9ca3af;">ブランド・カテゴリ(任意)</label>
          <input id="inv-new-brand" list="inv-brand-list" value="${brands[0]||''}"
            style="width:100%;background:#111827;border:1px solid #374151;border-radius:6px;color:#f3f4f6;padding:8px;font-size:14px;box-sizing:border-box;margin-top:4px;">
          <datalist id="inv-brand-list">${brands.map(b=>`<option value="${b}">`).join("")}</datalist>
        </div>
        <div style="margin-bottom:10px;">
          <label style="font-size:11px;color:#9ca3af;">商品名</label>
          <input id="inv-new-name" placeholder="例: 山崎12年"
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
    if (!name) { _showToast("⚠️ 商品名を入力してください"); return; }
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
      _products = await App.api("GET", `/inventory/${storeId}`);
    } catch (e) {
      _showToast("⚠️ 在庫読み込み失敗: " + e.message);
      _products = [];
    }
    _render();
  }

  window._invDec        = id => _setStock(id, -1);
  window._invInc        = id => _setStock(id, +1);
  window._invAddModal   = () => _addModal();
  window._invAddConfirm = () => _addConfirm();

  _load();
});
