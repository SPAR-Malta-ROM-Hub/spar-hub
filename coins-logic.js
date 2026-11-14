/* SPAR Malta Hub — Coin Order: the sums, the 9am order rounds and matching deliveries to the safe counts.
   Loaded by coins.html and safe.html as a classic script: window.CoinCheck.

   An order (one document, confirmed by the store):
     qty   { n5, c200, c100, c50, c20, c10, c5, c2, c1 }  number of wrap packs (bags) of each
     total = Σ packs × bag value
     day   the 9am order it goes in (orders confirmed before 9am on a weekday go that morning; later ones the next weekday)
   The coins normally arrive 5 days after the order day, as a CIT delivery on a safe count (the yellow slip value).
   The safe at its last count + coin orders still on the way + the new order can't go over €12,000 (the store's coin change). */
(function (root) {
  "use strict";

  var DENOMS = [
    { k: "n5", label: "€5.00", roll: 5, bag: 2500 },
    { k: "c200", label: "€2.00", roll: 50, bag: 1000 },
    { k: "c100", label: "€1.00", roll: 25, bag: 750 },
    { k: "c50", label: "€0.50", roll: 20, bag: 400 },
    { k: "c20", label: "€0.20", roll: 8, bag: 160 },
    { k: "c10", label: "€0.10", roll: 4, bag: 120 },
    { k: "c5", label: "€0.05", roll: 2.5, bag: 50 },
    { k: "c2", label: "€0.02", roll: 1, bag: 30 },
    { k: "c1", label: "€0.01", roll: 0.5, bag: 20 }
  ];
  var CAP = 12000;          // coin change per store: safe + orders on the way can't go over this
  var LEAD_DAYS = 5;        // days from the order to the coins arriving
  var DEADLINE_HOUR = 9;    // orders go to Sales Support at 9am

  var r2 = function (v) { return Math.round((Number(v) || 0) * 100) / 100; };
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  var isoOf = function (ms) { var d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  var addDays = function (s, n) { var d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return isoOf(d.getTime()); };
  var dow = function (s) { return new Date(s + "T12:00:00").getDay(); };   // 0 Sunday … 6 Saturday
  var nextWeekday = function (s) { var d = addDays(s, 1); while (dow(d) === 0 || dow(d) === 6) d = addDays(d, 1); return d; };
  var ms = function (v) {
    if (v == null) return 0;
    if (typeof v === "number") return v;
    if (typeof v.toMillis === "function") return v.toMillis();
    if (v.seconds != null) return v.seconds * 1000 + Math.round((v.nanoseconds || 0) / 1e6);
    if (v.__ts != null) return v.__ts;
    var p = Date.parse(v); return isFinite(p) ? p : 0;
  };

  function total(qty) {
    qty = qty || {};
    return r2(DENOMS.reduce(function (s, d) { return s + Math.max(0, Math.round(Number(qty[d.k]) || 0)) * d.bag; }, 0));
  }
  /** The order day an order confirmed at this moment goes in. */
  function roundOf(t) {
    var d = new Date(t), day = isoOf(t), wd = d.getDay();
    if (wd >= 1 && wd <= 5 && d.getHours() < DEADLINE_HOUR) return day;
    return nextWeekday(day);
  }
  function deadline(day) { return new Date(day + "T" + pad(DEADLINE_HOUR) + ":00:00").getTime(); }
  function expected(day) { return addDays(day, LEAD_DAYS); }

  /** Orders against the CIT deliveries on the safe counts.
      orders: [{ id, day, total, status, … }]; deliveries: [{ id, at, day, cit, rc }] (safe counts with a CIT delivery).
      Each delivery goes to the oldest order still waiting that was ordered on or before that day. */
  function match(orders, deliveries, now) {
    var today = isoOf(now);
    var list = (orders || []).map(function (o) { return Object.assign({}, o, { arr: null }); })
      .sort(function (a, b) { return String(a.day).localeCompare(String(b.day)) || ms(a.at) - ms(b.at); });
    var extra = [];
    (deliveries || []).slice().sort(function (a, b) { return a.at - b.at; }).forEach(function (d) {
      var o = list.filter(function (x) { return x.status !== "cancelled" && !x.arr && x.day <= d.day; })[0];
      if (o) o.arr = d; else extra.push(d);
    });
    list.forEach(function (o) {
      o.exp = expected(o.day);
      if (o.status === "cancelled") o.st = "cancelled";
      else if (o.arr) o.st = Math.abs(r2(o.arr.cit - o.total)) >= 0.005 ? "differs" : "arrived";
      else if (now < deadline(o.day)) o.st = "waiting";
      else if (today > o.exp) o.st = "late";
      else o.st = "sent";
    });
    return { orders: list, extra: extra };
  }
  /** Coins ordered and not yet delivered (including orders still waiting for 9am). */
  function onWay(m, exceptId) {
    return r2(m.orders.filter(function (o) { return o.id !== exceptId && ["waiting", "sent", "late"].indexOf(o.st) >= 0; }).reduce(function (s, o) { return s + (Number(o.total) || 0); }, 0));
  }

  function flags(code, m) {
    var out = [];
    var euro = function (v) { return (v < 0 ? "−€" : "€") + Math.abs(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var dayName = function (s) { return s ? new Date(s + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : ""; };
    m.orders.forEach(function (o) {
      if (o.st === "late") out.push({ store: code, level: "act", kind: "late", id: "late:" + o.id, date: o.exp, amt: o.total, orderId: o.id, title: "Coins not arrived",
        text: "The coin order of " + dayName(o.day) + " (" + euro(o.total) + ") was due on " + dayName(o.exp) + " and no CIT delivery has been recorded on a safe count since." });
      if (o.st === "differs") out.push({ store: code, level: "act", kind: "differs", id: "differs:" + o.id, date: o.arr.day, amt: r2(o.arr.cit - o.total), orderId: o.id, countId: o.arr.id, title: "Delivery doesn't match the order",
        text: "Ordered " + euro(o.total) + " on " + dayName(o.day) + "; the CIT delivery on the safe count of " + dayName(o.arr.day) + " was " + euro(o.arr.cit) + (o.arr.rc ? " (receipt " + o.arr.rc + ")" : "") + "." });
      if (o.status !== "cancelled" && o.cap != null && r2((o.safe || 0) + (o.onWay || 0) + o.total) > o.cap + 0.005)
        out.push({ store: code, level: "watch", kind: "cap", id: "cap:" + o.id, date: o.day, amt: o.total, orderId: o.id, title: "Over the €" + o.cap.toLocaleString("en-GB") + " limit",
          text: "When this order was placed the safe (" + euro(o.safe || 0) + ") + coins on the way (" + euro(o.onWay || 0) + ") + the order (" + euro(o.total) + ") came to more than €" + o.cap.toLocaleString("en-GB") + "." });
    });
    m.extra.forEach(function (d) {
      out.push({ store: code, level: "watch", kind: "noorder", id: "noorder:" + d.id, date: d.day, amt: d.cit, countId: d.id, title: "CIT delivery with no coin order",
        text: "A CIT delivery of " + euro(d.cit) + " was recorded on the safe count of " + dayName(d.day) + (d.rc ? " (receipt " + d.rc + ")" : "") + ", but there's no coin order waiting for it." });
    });
    return out.sort(function (a, b) { return (a.level === "act" ? 0 : 1) - (b.level === "act" ? 0 : 1) || String(b.date).localeCompare(String(a.date)); });
  }

  var api = { DENOMS: DENOMS, CAP: CAP, LEAD_DAYS: LEAD_DAYS, DEADLINE_HOUR: DEADLINE_HOUR, total: total, roundOf: roundOf, deadline: deadline, expected: expected,
    nextWeekday: nextWeekday, match: match, onWay: onWay, flags: flags, ms: ms, isoOf: isoOf, addDays: addDays, r2: r2 };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.CoinCheck = api;
})(this);
