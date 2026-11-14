/* SPAR Malta Hub — reading the report files, shared by the hub pages and the Apps Script that loads them from email.
   The Sales Tracker (daily department report: report-51.xlsx …) and Unit Sales (hourly item sales: report-hourly_itemsales-51.xlsx …)
   both read and save their files with this code, and so does the automatic import, so the two can never disagree.
   No screen code and no database calls here: each "…Writes" function returns the documents to save as
   [{ path: ["modules", …], data, merge }], and the caller saves them (the page with Firestore, the script with its REST calls).
   Loaded as a classic script: window.HubReports (or module.exports / a global HubReports in Apps Script). */
(function (root) {
  "use strict";

  var DOWFULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  var iso = function (d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  var addDays = function (s, n) { var d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); };
  var mondayOf = function (d) { return addDays(d, -((new Date(d + "T12:00:00").getDay() + 6) % 7)); };
  var sum = function (a) { return a.reduce(function (p, v) { return p + (v || 0); }, 0); };

  // ── shared cell readers ──
  var keyOf = function (l) { return String(l).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80); };
  var nv = function (v) { if (v == null || v === "") return 0; var n = typeof v === "number" ? v : parseFloat(String(v).replace(/[,€\s]/g, "")); return isFinite(n) ? Math.round(n * 100) / 100 : 0; };
  function toISO(v, X) {
    if (v == null || v === "") return null;
    if (typeof v === "number" && X) { var p = X.SSF.parse_date_code(v); return p ? p.y + "-" + pad(p.m) + "-" + pad(p.d) : null; }
    if (v instanceof Date) return iso(v);
    var s = String(v).trim(), m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + "-" + m[2] + "-" + m[3];
    m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/); if (m) return m[3] + "-" + pad(+m[2]) + "-" + pad(+m[1]);
    return null;
  }
  /** First sheet of a workbook as rows of cells (data: ArrayBuffer/Uint8Array with type "array", or base64 with type "base64"). */
  function readRows(X, data, type) {
    var wb = X.read(data, { type: type || "array" });
    return X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  }
  /** Which kind of report a file is, from its name. */
  function kindOf(name) {
    var n = String(name || "").toLowerCase();
    if (/report[-_ ]?hourly[-_ ]?itemsales/.test(n)) return "hourly";
    if (/report[-_ ]?wastage/.test(n)) return "waste";
    if (/(^|[^a-z])report[-_ ]?\d+(\D|$)/.test(n)) return "sales";
    return "";
  }

  // ═════════ SALES TRACKER: the daily department report (Mon–Sun, one file per store) ═════════
  // Based on Keith's reader.
  function parseReport(rows, X) {
    var h = rows[0] || [], cols = [], dates = [];
    for (var c = 0; c < h.length; c++) { var v = h[c]; if (typeof v === "string" && DOWFULL.indexOf(v.trim()) >= 0) { cols.push(c); dates.push(toISO(h[c + 1], X)); } }
    if (cols.length !== 7 || dates.some(function (d) { return !d; })) throw new Error("This doesn't look like the daily department report: the Monday to Sunday columns weren't found.");
    if (new Date(dates[0] + "T12:00:00").getDay() !== 1) throw new Error("The first day in this report isn't a Monday.");
    var lyCol = h.findIndex(function (v) { return typeof v === "string" && /totals\s*ly/i.test(v); });
    var out = { title: String(h[0] || "").trim(), days: dates, depts: [], cats: [], waste: {}, m: {} };
    var sec = "sales", cur = null, blk = null;
    out.tob = {};
    for (var i = 2; i < rows.length; i++) {
      var r = rows[i] || [], code = r[0] == null ? "" : String(r[0]).trim(), label = r[1] == null ? "" : String(r[1]).trim();
      if (!label) continue;
      var d = cols.map(function (c) { return nv(r[c]); });
      var any = d.some(function (x) { return x; });
      if (label === "Waste") { sec = "waste"; continue; }
      if (sec === "sales") {
        var ly = lyCol >= 0 ? nv(r[lyCol]) : 0;
        if (/^D\d+\w*$/.test(code)) { cur = code; if (any || ly) out.depts.push({ c: code, n: label, d: d, ly: ly }); continue; }
        if (/^C\d+\w*$/.test(code)) { if (any || ly) out.cats.push({ c: code, n: label, p: cur, d: d, ly: ly }); continue; }
        sec = "misc";
      }
      if (sec === "waste" && /^D\d+\w*$/.test(code)) { if (any) out.waste[code.toLowerCase()] = d; continue; }
      if (label.indexOf("%") === 0) continue;
      // Tobacco comes in its own blocks (this week, previous week, previous year…), each a D030 row with its categories
      if (sec === "misc" && /^D\d+\w*$/.test(code)) blk = keyOf(label);
      else if (sec === "misc" && /^C\d+\w*$/.test(code) && blk) { (out.tob[blk] = out.tob[blk] || []).push({ c: code, n: label, d: d }); continue; }
      else blk = null;
      var k = keyOf(label); if (/^\d+$/.test(code)) k = "pay_" + k;
      if (k && !out.m[k]) out.m[k] = d;
    }
    if (!out.m.total_inc_vat) throw new Error("The sales totals weren't found in this file.");
    out.has = out.m.total_inc_vat.map(function (v, i) { return v > 0 || (out.m.total_inc_vat_inc_d030 || [])[i] > 0; });
    out.week = dates[0];
    return out;
  }
  var normName = function (s) { return String(s || "").toLowerCase().replace(/interspar|eurospar|spar|express|gourmet/g, "").replace(/[^a-z0-9]+/g, ""); };
  var repOf = function (s) { return String(s.report || "").toLowerCase().replace(/\s/g, ""); };
  /** The store a sales report belongs to: by the report number in the file name, checked against the store name in the file. */
  function matchStore(stores, fname, title) {
    var m = String(fname).match(/report[-_ ]?(\d+)/i);
    var byRep = m ? stores.find(function (s) { return repOf(s) === "report-" + m[1]; }) : null;
    var t = normName(title);
    var byName = t ? stores.find(function (s) { return normName(s.name) === t; }) || stores.find(function (s) { return normName(s.name).indexOf(t) >= 0 || t.indexOf(normName(s.name)) >= 0; }) : null;
    return { code: (byRep || byName || {}).code || "", check: byRep && byName && byRep.code !== byName.code ? byName : null };
  }
  function summaryOf(p) {
    var g = function (k) { return (p.m[k] || [0, 0, 0, 0, 0, 0, 0]).map(function (v) { return v || 0; }); };
    var tob = g("tobacco_related_products_incl_vat"), tobLW = g("tobacco_related_products_prev_week_incl_vat"), tobLY = g("tobacco_related_products_prev_year_incl_vat");
    var sx = g("total_inc_vat"), inc = p.m.total_inc_vat_inc_d030 ? g("total_inc_vat_inc_d030") : sx.map(function (v, i) { return v + tob[i]; });
    var plus = function (a, b) { return a.map(function (v, i) { return Math.round((v + b[i]) * 100) / 100; }); };
    // Sales = "Total inc VAT inc D030". The report's last week / last year exclude tobacco, so tobacco's own last week / last year are added back.
    return { v: 2, week: p.week, days: p.days, has: p.has, s: inc, sx: sx, t: g("target_sales"), lw: plus(g("total_prev_week_inc_vat"), tobLW), ly: plus(g("total_prev_year_inc_vat"), tobLY),
      tobLW: tobLW, tobLY: tobLY,
      c: g("customer_no_current_wk"), clw: g("customer_no_previous_wk"), w: g("total_waste"), tob: tob, n22: g("sales_between_22_00_23_59_inc_vat"), n00: g("sales_between_00_00_06_00_inc_vat"),
      online: g("online_sales_inc_vat") };
  }
  /** One category group's share of a store's week (F&V, Deli, Bakery & FTG…). */
  function groupFigures(g, d) {
    var G = {}; (g.codes || []).forEach(function (x) { G[String(x).toUpperCase()] = true; });
    var lines = [], sDay = [0, 0, 0, 0, 0, 0, 0], ly = 0, w = null;
    var addTo = function (arr, d7) { d7.forEach(function (v, i) { arr[i] = Math.round((arr[i] + (v || 0)) * 100) / 100; }); };
    (d.depts || []).forEach(function (x) {
      if (!G[x.c]) return;
      lines.push({ c: x.c, n: x.n, d: x.d, ly: x.ly || 0, top: 1 }); addTo(sDay, x.d); ly += x.ly || 0;
      w = w || [0, 0, 0, 0, 0, 0, 0]; var wd = (d.waste || {})[x.c.toLowerCase()]; if (wd) addTo(w, wd);
      (d.cats || []).filter(function (y) { return y.p === x.c; }).forEach(function (y) { lines.push({ c: y.c, n: y.n, d: y.d, ly: y.ly || 0, p: x.c }); });
    });
    (d.cats || []).forEach(function (y) {
      if (!G[y.c] || G[y.p]) return;
      lines.push({ c: y.c, n: y.n, d: y.d, ly: y.ly || 0, top: 1 }); addTo(sDay, y.d); ly += y.ly || 0;
    });
    var storeX = (d.m && d.m.total_inc_vat) || [0, 0, 0, 0, 0, 0, 0];
    return { gid: g.id, week: d.week, days: d.days, has: d.has, s: sDay, ly: Math.round(ly * 100) / 100,
      share: sDay.map(function (v, i) { return storeX[i] ? Math.round(v / storeX[i] * 10000) / 10000 : 0; }), w: w, lines: lines };
  }
  /** Everything to save for one store's sales report. The last one (meta: the weeks uploaded) is saved separately ("late"). */
  function salesWrites(code, p, file, groups, by, at) {
    var base = { code: code, week: p.week, file: file, title: p.title, at: at, by: by };
    var S = ["modules", "sales", "stores", code];
    var out = [
      { path: S.concat(["weeks", p.week]), data: Object.assign({}, base, { v: 2, days: p.days, has: p.has, depts: p.depts, cats: p.cats, waste: p.waste, m: p.m, tob: p.tob }) },
      { path: S.concat(["sum", p.week]), data: Object.assign({}, base, summaryOf(p)) }
    ];
    (groups || []).forEach(function (g) {
      out.push({ path: ["modules", "sales", "groups", g.id, "stores", code, "weeks", p.week], data: Object.assign({}, groupFigures(g, p), { code: code, at: at }) });
    });
    var wk = {}; wk[p.week] = p.has.filter(Boolean).length;
    out.push({ path: S.concat(["meta", "weeks"]), data: { weeks: wk, at: at }, merge: true, late: true });
    return out;
  }

  // ═════════ UNIT SALES: one store's hourly item sales for one day ═════════
  // Outlet / Report From / Report To, then Item Code, Description and one column per hour.
  // known(code): is the item in the item list (names of unknown items are kept from the file)
  function parseHourly(rows, X, known) {
    var lab = function (r) { return String((rows[r] || [])[0] || "").trim().toLowerCase(); };
    var outlet = String((rows[0] || [])[1] || "").trim();
    if (lab(0) !== "outlet") throw new Error("This isn't an hourly item sales file (no Outlet line at the top).");
    var from = toISO((rows[1] || [])[1], X), to = toISO((rows[2] || [])[1], X);
    if (!from) throw new Error("The report date wasn't found.");
    if (to && to !== from) throw new Error("This file covers more than one day (" + from + " to " + to + "). Use the daily file.");
    var hr = rows.findIndex(function (r) { return String((r || [])[0] || "").trim().toLowerCase() === "item code"; });
    if (hr < 0) throw new Error("The Item Code heading wasn't found.");
    var hcols = [];   // [column, hour]
    (rows[hr] || []).forEach(function (v, c) { var m = String(v || "").match(/^(\d{1,2}):\d{2}\s*>/); if (m) hcols.push([c, +m[1]]); });
    if (!hcols.length) throw new Error("No hour columns were found.");
    var items = new Map(), names = {}, tot = Array(24).fill(0);
    for (var r = hr + 1; r < rows.length; r++) {
      var row = rows[r] || [], code = row[0];
      if (code == null || code === "") continue;   // the Totals line has no item code
      var k = String(code).trim(), h = {};
      hcols.forEach(function (x) { var q = +row[x[0]] || 0; if (q) { h[x[1]] = Math.round(((h[x[1]] || 0) + q) * 1000) / 1000; tot[x[1]] += q; } });
      if (!Object.keys(h).length) continue;
      var prev = items.get(k); if (prev) Object.keys(h).forEach(function (x) { prev[x] = (prev[x] || 0) + h[x]; }); else items.set(k, h);
      if (!(known && known(k)) && row[1]) names[k] = String(row[1]).trim();
    }
    var num0 = (outlet.match(/^(\d+)/) || [])[1];
    return { outlet: outlet, num: num0, date: from, items: items, names: names, tot: tot.map(function (v) { return Math.round(v * 1000) / 1000; }), hours: hcols.map(function (x) { return x[1]; }) };
  }
  function matchOutlet(stores, n, outlet) {
    var byRep = n ? stores.find(function (s) { return repOf(s) === "report-" + n; }) : null;
    if (byRep) return byRep.code;
    var t = String(outlet || "").toLowerCase().replace(/^\d+\s*-\s*/, "").replace(/[^a-z0-9]+/g, "");
    var s = stores.find(function (x) { return x.name.toLowerCase().replace(/[^a-z0-9]+/g, "") === t; });
    return s ? s.code : "";
  }
  // Item rows are saved as one compact text field per week: "code:q,q,q,q,q,q,q|code:…" (Mon → Sun)
  var encode = function (items) { return Array.from(items).map(function (e) { return e[0] + ":" + e[1].map(function (v) { return v ? +v.toFixed(3) : ""; }).join(","); }).join("|"); };
  var encodeTot = function (items) { return Array.from(items).map(function (e) { return e[0] + ":" + +sum(e[1]).toFixed(3); }).join("|"); };
  var decodeTot = function (s) { var m = new Map(); if (!s) return m; s.split("|").forEach(function (p) { var i = p.lastIndexOf(":"); m.set(p.slice(0, i), +p.slice(i + 1)); }); return m; };
  // a day's hourly rows: "code:6=2,13=1|code:…" (hour=units)
  var encodeDay = function (items) { return Array.from(items).map(function (e) { var h = e[1]; return e[0] + ":" + Object.keys(h).map(function (k) { return k + "=" + +h[k].toFixed(3); }).join(","); }).join("|"); };
  var decodeDay = function (s) { var m = new Map(); if (!s) return m; s.split("|").forEach(function (p) { var i = p.lastIndexOf(":"), h = {}; p.slice(i + 1).split(",").forEach(function (x) { var kv = x.split("="); if (kv[0]) h[+kv[0]] = +kv[1]; }); m.set(p.slice(0, i), h); }); return m; };
  var decode = function (s) { var m = new Map(); if (!s) return m; s.split("|").forEach(function (p) { var i = p.lastIndexOf(":"); m.set(p.slice(0, i), p.slice(i + 1).split(",").map(function (v) { return v ? +v : 0; })); }); return m; };
  var inGroup = function (g, it) { return !!it && (g.codes || []).some(function (c) { return c === it.D || c === it.C; }); };
  var hourTot = function (items) { var t = Array(24).fill(0); items.forEach(function (h) { Object.keys(h).forEach(function (k) { t[k] += h[k]; }); }); return t.map(function (v) { return Math.round(v * 1000) / 1000; }); };
  var dayTotal = function (h) { return sum(Object.keys(h).map(function (k) { return h[k]; })); };
  /** Units hourly: the docs that must be read first (the store's week, its hours, and each group's hours). */
  function unitsReads(code, date, groups) {
    var mon = mondayOf(date), U = ["modules", "units", "stores", code];
    return { wk: U.concat(["wk", mon]), hr: U.concat(["hours", mon]), g: (groups || []).map(function (g) { return ["modules", "units", "groups", g.id, "stores", code, "hours", mon]; }) };
  }
  /** Everything to save for one store's day, folded into its Monday–Sunday week and each category group's copies.
      o: { code, p, file, wkData (the saved week's "data" or null), H (saved hours "h" or null), gH: [each group's saved "h" or null], groups, itemOf(code), by, at } */
  function unitsWrites(o) {
    var code = o.code, p = o.p, at = o.at, mon = mondayOf(p.date), di = (new Date(p.date + "T12:00:00").getDay() + 6) % 7;
    var days = Array.from({ length: 7 }, function (_, i) { return addDays(mon, i); });
    var U = ["modules", "units", "stores", code];
    var wk = decode(o.wkData);
    wk.forEach(function (q) { q[di] = 0; });
    p.items.forEach(function (h, k) { if (!wk.has(k)) wk.set(k, [0, 0, 0, 0, 0, 0, 0]); wk.get(k)[di] = Math.round(dayTotal(h) * 1000) / 1000; });
    Array.from(wk.keys()).forEach(function (k) { if (!sum(wk.get(k))) wk.delete(k); });
    var H = Object.assign({}, o.H || {}); H[p.date] = p.tot;
    var has = days.map(function (d) { return !!H[d]; });
    var base = { code: code, at: at, by: o.by };
    var md = {}; md[p.date] = at;
    var out = [
      { path: U.concat(["days", p.date]), data: Object.assign({}, base, { date: p.date, file: o.file || "", outlet: p.outlet || "", n: p.items.size, tot: p.tot, names: p.names || {}, data: encodeDay(p.items) }) },
      { path: U.concat(["wk", mon]), data: Object.assign({}, base, { week: mon, days: days, has: has, n: wk.size, data: encode(wk) }) },
      { path: U.concat(["wtot", mon]), data: Object.assign({}, base, { week: mon, days: days, has: has, n: wk.size, data: encodeTot(wk) }) },
      { path: U.concat(["hours", mon]), data: Object.assign({}, base, { week: mon, h: H }) },
      { path: U.concat(["meta", "days"]), data: { days: md, at: at }, merge: true }
    ];
    var pick = function (g, items) { var m = new Map(); items.forEach(function (q, c) { if (inGroup(g, o.itemOf(c))) m.set(c, q); }); return m; };
    (o.groups || []).forEach(function (g, i) {
      var gd = pick(g, p.items), gw = pick(g, wk), G = ["modules", "units", "groups", g.id, "stores", code];
      var GH = Object.assign({}, (o.gH || [])[i] || {}); GH[p.date] = hourTot(gd);
      out.push({ path: G.concat(["days", p.date]), data: Object.assign({}, base, { gid: g.id, date: p.date, n: gd.size, tot: GH[p.date], data: encodeDay(gd) }) });
      out.push({ path: G.concat(["wk", mon]), data: Object.assign({}, base, { gid: g.id, week: mon, days: days, has: has, n: gw.size, data: encode(gw) }) });
      out.push({ path: G.concat(["hours", mon]), data: Object.assign({}, base, { gid: g.id, week: mon, h: GH }) });
      out.push({ path: G.concat(["meta", "days"]), data: { days: md, at: at }, merge: true });
    });
    return out;
  }

  var api = { DOWFULL: DOWFULL, keyOf: keyOf, nv: nv, toISO: toISO, readRows: readRows, kindOf: kindOf,
    parseReport: parseReport, matchStore: matchStore, summaryOf: summaryOf, groupFigures: groupFigures, salesWrites: salesWrites,
    parseHourly: parseHourly, matchOutlet: matchOutlet, encode: encode, encodeTot: encodeTot, decodeTot: decodeTot, encodeDay: encodeDay, decodeDay: decodeDay, decode: decode,
    inGroup: inGroup, hourTot: hourTot, dayTotal: dayTotal, unitsReads: unitsReads, unitsWrites: unitsWrites, mondayOf: mondayOf, addDays: addDays };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.HubReports = api;
})(this);
