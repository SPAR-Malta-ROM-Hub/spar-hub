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

  window.SPARUI = {
    el: el, isoDate: isoDate, fmtDate: fmtDate, fmtDateTime: fmtDateTime, uid: uid, toast: toast,
    // The modules list, used by the hub. "page" set = built; otherwise "coming soon".
    // who: which roles see the tile.
    MODULES: [
      { group: "Sales & stock", id: "sales", icon: "📈", name: "Sales Tracker", desc: "Daily sales by store against target and last year.", who: "all", page: "sales.html" },
      { group: "Sales & stock", id: "units", icon: "📦", name: "Unit Sales", desc: "Weekly units by item: lookup, best and worst sellers, zero-sales gaps, ordering suggestions.", who: "all", page: "units.html" },
      { group: "Sales & stock", id: "waste", icon: "🗑️", name: "Waste Tracker", desc: "Log waste by department and reason; spot the trends.", who: "all" },
      { group: "Sales & stock", id: "gaps", icon: "🔍", name: "Gap Check Tracker", desc: "Each store uploads its daily 1pm gap check: out of stock, stock on system, suppliers, daily brief.", who: "all", page: "gaps.html" },
      { group: "Cash", id: "cash", icon: "💶", name: "Cash Sheet Analyser", desc: "Weekly cash sheets, cashier unders and overs, unders check.", who: "all" },
      { group: "Cash", id: "safe", icon: "🔐", name: "Safe Count", desc: "Daily safe counts by denomination, checked against the expected balance.", who: "all" },
      { group: "Cash", id: "coins", icon: "🪙", name: "Coin Order", desc: "Order change for the store's floats and track deliveries.", who: "all" },
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
