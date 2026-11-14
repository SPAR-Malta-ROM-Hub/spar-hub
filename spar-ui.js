/* SPAR Malta Hub — shared page furniture: header, store picker, small helpers.
   Load after spar-runtime.js. A page declares its header as:
     <header class="top" data-title="DAP" data-store="1"></header>
   data-store="1" adds the store picker (or the fixed store for a Store Manager).
   When the store changes, the page gets a "spar:store" event with detail = store. */
(function () {
  "use strict";

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "class") n.className = attrs[k];
      else if (k.indexOf("on") === 0) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isoDate(d) { d = d || new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  }
  function fmtDateTime(ms) {
    if (!ms) return "";
    var d = new Date(ms);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function uid() {
    var a = new Uint8Array(10); crypto.getRandomValues(a);
    return Date.now().toString(36) + Array.prototype.map.call(a, function (x) { return (x % 36).toString(36); }).join("");
  }

  var toastTimer;
  function toast(text, kind) {
    var t = document.getElementById("spar-toast");
    if (!t) {
      t = el("div", { id: "spar-toast", role: "status", "aria-live": "polite" });
      t.style.cssText = "position:fixed;left:50%;bottom:max(18px,env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:3000;" +
        "padding:11px 16px;border-radius:10px;font:700 14px Arial,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.18);max-width:calc(100% - 32px)";
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.style.background = kind === "err" ? "#C5121A" : "#10252b";
    t.style.color = "#fff";
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  function buildHeader(me) {
    var h = document.querySelector("header.top");
    if (!h) return;
    var base = (window.SPAR && SPAR.base) || "./";
    var title = h.getAttribute("data-title") || "";
    var withStore = h.getAttribute("data-store") === "1" && me.role !== "dept";
    h.innerHTML = "";

    var logo = el("a", { href: base, "aria-label": "SPAR Malta Hub home" }, [el("img", { class: "brand-logo", src: base + "spar-logo.png", alt: "SPAR" })]);
    var h1 = el("h1", null, [el("a", { href: base, text: "Hub" })]);
    if (title) h1.appendChild(el("span", { class: "mod", text: title }));
    h.appendChild(logo);
    h.appendChild(el("div", { class: "brand-title" }, [h1]));

    var box = el("div", { class: "userbox" });
    if (withStore) box.appendChild(storePicker(me));
    box.appendChild(el("div", { class: "who" }, [el("b", { text: me.name }), el("small", { text: me.roleLabel })]));
    var btns = el("div", { class: "row" });
    if (title) btns.appendChild(el("a", { class: "ub-btn", href: base, text: "⌂ Home" }));
    btns.appendChild(el("button", { class: "ub-btn", type: "button", text: "Sign out", onclick: function () { me.signOut(); } }));
    box.appendChild(btns);
    h.appendChild(box);
  }

  function storePicker(me) {
    var wrap = el("label", { class: "storepick" }, ["Store"]);
    if (!me.stores.length) {
      wrap.appendChild(el("span", { class: "fixed", text: "No store assigned" }));
      return wrap;
    }
    if (me.stores.length === 1) {
      wrap.appendChild(el("span", { class: "fixed", text: me.stores[0].name }));
      return wrap;
    }
    var sel = el("select", { "aria-label": "Store" });
    var allowAll = me.seesAll && document.querySelector("header.top[data-allstores='1']");
    if (allowAll) sel.appendChild(el("option", { value: "__ALL__", text: "All stores" }));
    me.stores.forEach(function (s) {
      sel.appendChild(el("option", { value: s.code, text: s.name }));
    });
    var cur = allowAll ? me.store() : me.firstStore();
    if (cur) sel.value = cur.code;
    sel.addEventListener("change", function () {
      me.setStore(sel.value);
      document.dispatchEvent(new CustomEvent("spar:store", { detail: me.store() }));
    });
    wrap.appendChild(sel);
    return wrap;
  }

  /* Shared uploader: heading ▼, bordered box with a file input (drag and drop too),
     "No … selected" line and a green Upload button. onUpload(files, out) does the work.
     SPARUI.uploader(host, {title, noun:"sales files", button:"Upload Selected Sales Files",
                            accept:".xlsx,.xls", multiple:true, open:true, onUpload}) */
  function uploader(host, o) {
    if (typeof host === "string") host = document.getElementById(host);
    o = o || {};
    var multiple = o.multiple !== false, noun = o.noun || (multiple ? "files" : "file");
    var files = [];
    var input = el("input", { type: "file" });
    if (o.accept) input.accept = o.accept;
    if (multiple) input.multiple = true;
    if (o.id) input.id = o.id;
    var status = el("div", { class: "upl-status" });
    var btn = el("button", { class: "upl-btn", type: "button", text: o.button || "Upload" });
    var out = el("div", { class: "upl-out" });
    var box = el("div", { class: "upl-box" }, [input]);
    var body = el("div", { class: "upl-body" }, [box, status, btn, out]);
    var wrap = el("div", { class: "upl" + (o.open === false ? " closed" : "") });
    if (o.title) {
      var h = el("button", { class: "upl-h", type: "button" }, [el("span", { text: o.title }), el("span", { class: "upl-arrow", text: "▼" })]);
      h.addEventListener("click", function () { wrap.classList.toggle("closed"); });
      wrap.appendChild(h);
    }
    wrap.appendChild(body);
    function show() {
      status.textContent = "";
      if (!files.length) { status.textContent = "No " + noun + " selected"; btn.disabled = true; return; }
      var names = files.map(function (f) { return f.name; });
      status.appendChild(el("b", { text: files.length + " " + (files.length === 1 ? noun.replace(/s$/, "") : noun) + " selected: " }));
      status.appendChild(document.createTextNode(names.length > 6 ? names.slice(0, 6).join(", ") + " and " + (names.length - 6) + " more" : names.join(", ")));
      btn.disabled = false;
    }
    function okType(f) {
      if (!o.accept) return true;
      var n = f.name.toLowerCase();
      return o.accept.split(",").some(function (a) { a = a.trim().toLowerCase(); return a.charAt(0) === "." ? n.slice(-a.length) === a : true; });
    }
    input.addEventListener("change", function () { files = Array.prototype.slice.call(input.files || []); show(); });
    ["dragenter", "dragover"].forEach(function (t) { box.addEventListener(t, function (e) { e.preventDefault(); box.classList.add("drag"); }); });
    ["dragleave", "drop"].forEach(function (t) { box.addEventListener(t, function (e) { e.preventDefault(); box.classList.remove("drag"); }); });
    box.addEventListener("drop", function (e) {
      var f = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []).filter(okType);
      if (!f.length) return;
      files = multiple ? files.concat(f) : f.slice(0, 1);
      try { input.value = ""; } catch (x) {}
      show();
    });
    btn.addEventListener("click", function () {
      if (!files.length || !o.onUpload) return;
      var list = files.slice(), label = btn.textContent;
      btn.disabled = true; btn.textContent = "Uploading…";
      Promise.resolve().then(function () { return o.onUpload(list, out); }).catch(function (e) {
        out.textContent = ""; out.appendChild(el("p", { class: "msg err", text: (e && e.message) || "Upload failed." }));
      }).then(function () {
        btn.textContent = label; files = []; try { input.value = ""; } catch (x) {} show();
      });
    });
    show();
    host.appendChild(wrap);
    return { el: wrap, out: out, input: input, clear: function () { files = []; try { input.value = ""; } catch (x) {} show(); } };
  }

  /* Makes a headline tile open the detail behind it: click (or Enter) runs go(). */
  function linkTile(node, go, hint) {
    if (!go) return node;
    node.classList.add("go"); node.setAttribute("tabindex", "0"); node.setAttribute("role", "button");
    node.setAttribute("title", hint || "Open the detail");
    node.addEventListener("click", go);
    node.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    return node;
  }
  /* Scrolls to a section once it has been drawn (pages draw after switching tab) and flashes it. */
  function jump(target) {
    var t0 = Date.now();
    (function tick() {
      var n = typeof target === "string" ? document.getElementById(target) : target;
      if (n && n.offsetParent && n.childNodes.length) {
        n.scrollIntoView({ behavior: "smooth", block: "start" });
        n.classList.remove("flash"); void n.offsetWidth; n.classList.add("flash");
        return;
      }
      if (Date.now() - t0 < 5000) setTimeout(tick, 120);
    })();
  }

  window.SPARUI = {
    el: el, isoDate: isoDate, fmtDate: fmtDate, fmtDateTime: fmtDateTime, uid: uid, toast: toast, uploader: uploader, linkTile: linkTile, jump: jump,
    // The modules list, used by the hub. "page" set = built; otherwise "coming soon".
    // who: which roles see the tile.
    MODULES: [
      { group: "Sales & stock", id: "sales", icon: "📈", name: "Sales Tracker", desc: "Daily sales by store against target and last year.", who: "all", page: "sales.html" },
      { group: "Sales & stock", id: "units", icon: "📦", name: "Unit Sales", desc: "Weekly units by item: lookup, best and worst sellers, zero-sales gaps, ordering suggestions.", who: "all", page: "units.html" },
      { group: "Sales & stock", id: "waste", icon: "🗑️", name: "Waste Tracker", desc: "Each store's daily wastage report: by reason, department, item and supplier, against sales; spot the trends.", who: "all", page: "waste.html" },
      { group: "Sales & stock", id: "gaps", icon: "🔍", name: "Gap Check Tracker", desc: "Each store uploads its daily 1pm gap check: out of stock, stock on system, suppliers, daily brief.", who: "all", page: "gaps.html" },
      { group: "Sales & stock", id: "neg-stock", icon: "➖", name: "Negative Stocks", desc: "Items showing negative stock on the system, by store and department, to correct and follow up.", who: "all" },
      { group: "Customers", id: "online", icon: "🛒", name: "Online Shopping Reports", desc: "Online orders and sales by store: order numbers, basket value, picking and missing items.", who: "all" },
      { group: "Customers", id: "loyalty", icon: "💳", name: "Loyalty Reports", desc: "Loyalty card sales, members and points by store, and how loyalty shoppers are trending.", who: "all" },
      { group: "Cash", id: "cash", icon: "💶", name: "Cash Sheet Analyser", desc: "Each store uploads its cash sheet daily: unders and overs, seller codes, safe bags, daily review and weekly sign-off to accounts.", who: ["admin", "rom", "sm"], alsoIf: "cashAccess", page: "cash.html" },
      { group: "Cash", id: "safe", icon: "🔐", name: "Safe Count", desc: "Safe counts at every shift handover and the weekly SM and ROM checks, locked once saved, with the deposit bags tracked until the CIT collects them.", who: ["admin", "rom", "sm"], alsoIf: "cashAccess", page: "safe.html" },
      { group: "Cash", id: "coins", icon: "🪙", name: "Coin Order", desc: "Order coins by 9am, kept within the store's €12,000 coin change, and track each delivery against the safe count.", who: ["admin", "rom", "sm"], alsoIf: "cashAccess", page: "coins.html" },
      { group: "Checklists", id: "sm-checklist", icon: "✅", name: "Store Manager Weekly Checklist", desc: "Daily and weekly store tasks, ticked off with notes.", who: "all" },
      { group: "Checklists", id: "rom-checklist", icon: "🧭", name: "ROM Weekly Checklist", desc: "ROM store visits and weekly tasks across your stores.", who: ["admin", "hq", "support", "rom"] },
      { group: "Checklists", id: "deli", icon: "🧀", name: "Deli Counter Checklist", desc: "Opening, during-day and closing checks for the deli.", who: "all" },
      { group: "Checklists", id: "butcher", icon: "🥩", name: "Butcher Counter Checklist", desc: "Opening, during-day and closing checks for the butcher.", who: "all" },
      { group: "Food safety & quality", id: "haccp", icon: "🌡️", name: "HACCP Recording", desc: "Fridge and freezer temperatures, deliveries, cooking and cooling records.", who: "all" },
      { group: "Food safety & quality", id: "fv-quality", icon: "🥬", name: "F&V Quality Reporting", desc: "Report F&V quality issues on delivery and on the shelf, with photos, for follow-up with the supplier.", who: "all" },
      { group: "Communication", id: "dap", icon: "📣", name: "DAP — Daily Action Points", desc: "Head Office actions for stores, ticked off and tracked.", who: "all", page: "dap.html" },
      { group: "Communication", id: "rom-moves", icon: "🚗", name: "ROM Movements", desc: "Where each ROM is this week: planned store visits, meetings and days off.", who: ["admin", "hq", "support", "rom"] },
      { group: "Ordering", id: "fv-order", icon: "🍎", name: "F&V Order", desc: "Fruit & veg store orders.", who: "all" },
      { group: "Ordering", id: "meat-order", icon: "🍖", name: "Fresh Meat Ordering", desc: "Fresh meat store orders.", who: "all" },
      { group: "Ordering", id: "salads-order", icon: "🥗", name: "Fresh Salads Ordering", desc: "Fresh salads store orders.", who: "all" }
    ]
  };

  if (window.SPAR) SPAR.ready.then(buildHeader, function () {});
})();
