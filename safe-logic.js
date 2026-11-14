/* SPAR Malta Hub — Safe Count: the sums and the checks (no screen code here).
   Loaded by safe.html as a classic script: window.SafeCheck.

   A count (one document per count, locked once saved):
     qty     { n100, n50, n20, n10, n5, c200 … c1 }  number of notes, or number of coin bags (batches)
     loose   loose coins (value)
     extra   coins after closing cash (should be no more than €5)
     cit     money delivered by the CIT (yellow slip), citRc = receipt no.
     deps    [{ bag, amt }]              money deposited from the safe (sealed into a bag)
     outs    [{ store, amt, mgr }]       money transferred OUT to another shop
     ins     [{ store, amt, mgr }]       money received IN from another shop
     exps    [{ what, amt, mgr }]        expenses paid from the safe
     bags    [{ bag, date, amt, st, on, rc, src }]   deposit bags: st = in (in the safe) | out (collected by CIT) | gone (not found)
   Grand total = notes and coins + loose coins + coins after closing cash  (the cash in the safe now).
   Expected    = previous count's grand total + CIT + money in − deposits − money out − expenses.
   Difference  = grand total − expected. */
(function (root) {
  "use strict";

  // Batch value: notes are counted one by one; coins in bags (a bag of €2 coins holds €50, and so on)
  var DENOMS = [
    { k: "n100", label: "€100", face: 100, batch: 100, note: true },
    { k: "n50", label: "€50", face: 50, batch: 50, note: true },
    { k: "n20", label: "€20", face: 20, batch: 20, note: true },
    { k: "n10", label: "€10", face: 10, batch: 10, note: true },
    { k: "n5", label: "€5", face: 5, batch: 5, note: true },
    { k: "c200", label: "€2", face: 2, batch: 50 },
    { k: "c100", label: "€1", face: 1, batch: 25 },
    { k: "c50", label: "€0.50", face: 0.5, batch: 20 },
    { k: "c20", label: "€0.20", face: 0.2, batch: 8 },
    { k: "c10", label: "€0.10", face: 0.1, batch: 4 },
    { k: "c5", label: "€0.05", face: 0.05, batch: 2.5 },
    { k: "c2", label: "€0.02", face: 0.02, batch: 1 },
    { k: "c1", label: "€0.01", face: 0.01, batch: 0.5 }
  ];
  var EXTRA_MAX = 5;        // coins after closing cash: no more than €5
  var BAG_DAYS = 7;         // a deposit bag still in the safe after this many days is flagged
  var BIG = 1;              // a difference of €1 or more is "act now"; smaller ones are "watch"
  var TYPES = { handover: "Shift handover", sm: "Weekly SM check", rom: "Weekly ROM check" };

  var r2 = function (v) { return Math.round((Number(v) || 0) * 100) / 100; };
  var num = function (v) { var n = Number(v); return isFinite(n) ? n : 0; };
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  var isoOf = function (ms) { var d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  var addDays = function (s, n) { var d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return isoOf(d.getTime()); };
  var mondayOf = function (s) { return addDays(s, -((new Date(s + "T12:00:00").getDay() + 6) % 7)); };
  var daysBetween = function (a, b) { return Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 864e5); };
  var dayName = function (s) { return s ? new Date(s + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : ""; };
  var bagKey = function (b) { return String(b || "").toUpperCase().replace(/\s+/g, ""); };
  var sumOf = function (list) { return r2((list || []).reduce(function (s, x) { return s + num(x && x.amt); }, 0)); };
  // Firestore timestamps arrive as objects; anything else is taken as milliseconds
  var ms = function (v) {
    if (v == null) return 0;
    if (typeof v === "number") return v;
    if (typeof v.toMillis === "function") return v.toMillis();
    if (v.seconds != null) return v.seconds * 1000 + Math.round((v.nanoseconds || 0) / 1e6);
    if (v.__ts != null) return v.__ts;
    var p = Date.parse(v); return isFinite(p) ? p : 0;
  };

  /** The sums of one count, always worked out from the figures typed in (never from stored totals). */
  function sums(c) {
    var q = c.qty || {}, lines = DENOMS.map(function (d) {
      var n = Math.max(0, num(q[d.k])); return { k: d.k, label: d.label, batch: d.batch, n: n, val: r2(n * d.batch) };
    });
    var notes = r2(lines.reduce(function (s, l) { return s + l.val; }, 0));
    var sub = r2(notes + num(c.loose));
    var total = r2(sub + num(c.extra));
    var dep = sumOf(c.deps), out = sumOf(c.outs), inn = sumOf(c.ins), exp = sumOf(c.exps), cit = r2(num(c.cit));
    var moves = r2(cit + inn - dep - out - exp);
    return { lines: lines, notes: notes, sub: sub, total: total, cit: cit, dep: dep, out: out, inn: inn, exp: exp, moves: moves };
  }

  /** One store's counts in time order, each with its sums, the previous count, expected and difference. */
  function sequence(counts, before) {
    var list = (counts || []).slice().sort(function (a, b) { return ms(a.at) - ms(b.at); });
    var prev = before || null;
    return list.map(function (c) {
      var s = sums(c), at = ms(c.at);
      var row = { c: c, id: c.id, at: at, day: isoOf(at), s: s, prev: prev ? prev.c || prev : null, prevTotal: null, expected: null, diff: null };
      if (prev) {
        var pt = prev.s ? prev.s.total : sums(prev).total;
        row.prevTotal = pt; row.expected = r2(pt + s.moves); row.diff = r2(s.total - row.expected);
      }
      // the totals saved with the count must match the figures (someone changing a total by hand shows up here)
      row.tampered = (c.total != null && Math.abs(num(c.total) - s.total) > 0.005) || (c.sub != null && Math.abs(num(c.sub) - s.sub) > 0.005);
      prev = row;
      return row;
    });
  }

  /** Deposit bags: what the cash sheet says went into the safe, against what each count found.
      cashBags: [{ bag, date, dep }] from the Cash Sheet Analyser. rows: sequence(). */
  function bagTrack(rows, cashBags, opts) {
    opts = opts || {};
    var today = opts.today || isoOf(Date.now());
    var byBag = {}, list = [];
    function inst(key, date) {
      var a = byBag[key] || [];
      // the newest bag with this number that's on or before the date (bag numbers can come round again)
      var hit = null;
      a.forEach(function (x) { if (!x.done && (!date || !x.date || x.date <= date)) hit = x; });
      if (!hit) a.forEach(function (x) { if (!x.done) hit = hit || x; });
      return hit;
    }
    function make(key, bag, date, amt, sheet) {
      var x = { key: key, bag: bag, date: date || "", amt: amt == null ? null : r2(amt), sheet: !!sheet, src: sheet ? "sheet" : "count",
        st: sheet ? "unseen" : "in", seen: [], lastAt: 0, firstAt: 0, on: "", rc: "", done: false };
      (byBag[key] = byBag[key] || []).push(x); list.push(x); return x;
    }
    (cashBags || []).slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); }).forEach(function (b) {
      var key = bagKey(b.bag); if (!key) return;
      make(key, String(b.bag).toUpperCase(), b.date, b.dep, true);
    });
    (rows || []).forEach(function (r) {
      (r.c.bags || []).forEach(function (e) {
        var key = bagKey(e.bag); if (!key) return;
        var x = inst(key, e.date || r.day);
        if (!x) x = make(key, String(e.bag).toUpperCase(), e.date || r.day, e.amt, false);
        if (x.amt == null && e.amt != null && e.amt !== "") x.amt = r2(e.amt);
        if (e.src === "float") x.src = "float";
        x.seen.push({ id: r.id, at: r.at, st: e.st });
        if (!x.firstAt) x.firstAt = r.at;
        x.lastAt = r.at;
        x.st = e.st === "out" ? "out" : e.st === "gone" ? "gone" : "in";
        if (e.st === "out") { x.on = e.on || r.day; x.rc = e.rc || ""; x.done = true; }
      });
    });
    // bags added at a count that turn up on a later cash sheet: one bag, not two
    list.filter(function (x) { return !x.sheet; }).forEach(function (x) {
      var twin = (byBag[x.key] || []).filter(function (y) { return y !== x && y.sheet && y.st === "unseen" && Math.abs(daysBetween(y.date, x.date)) <= 3; })[0];
      if (twin) { x.sheet = true; if (x.amt == null) x.amt = twin.amt; x.sheetDate = twin.date; twin.merged = true; }
    });
    list = list.filter(function (x) { return !x.merged; });
    var lastCount = rows && rows.length ? rows[rows.length - 1] : null;
    list.forEach(function (x) {
      x.daysIn = x.st === "in" && x.date ? daysBetween(x.date, today) : 0;
      // on the cash sheet, but not on any count from two days after the bag's date (time to count it in)
      x.missed = x.st === "unseen" && !!lastCount && x.date && lastCount.day >= addDays(x.date, 2);
    });
    return list.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)) || a.key.localeCompare(b.key); });
  }

  /** Bags to list on a new count: everything still in the safe (or not found last time) plus cash-sheet bags not counted yet. */
  function bagsForNewCount(track) {
    return (track || []).filter(function (x) { return x.st === "in" || x.st === "gone" || x.st === "unseen"; })
      .map(function (x) { return { bag: x.bag, date: x.date, amt: x.amt, src: x.src === "float" ? "float" : x.sheet ? "sheet" : "count", was: x.st }; });
  }

  /** The flags for one store. Each: { id, level: act|watch, kind, title, text, amt, date, countId }. */
  function flags(code, rows, track, opts) {
    opts = opts || {};
    var today = opts.today || isoOf(Date.now());
    var out = [];
    function add(level, kind, id, title, text, extra) { out.push(Object.assign({ store: code, level: level, kind: kind, id: kind + ":" + id, title: title, text: text }, extra || {})); }
    var euro = function (v) { return (v < 0 ? "−€" : "€") + Math.abs(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var when = function (r) { var d = new Date(r.at); return dayName(isoOf(r.at)) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); };

    rows.forEach(function (r) {
      var c = r.c, w = when(r), who = TYPES[c.type] || "Count";
      var base = { countId: r.id, date: r.day, at: r.at };
      if (c.locked === false) add("act", "open", r.id, "Unlocked, waiting for correction", who + " of " + w + " was unlocked by " + (c.unlockName || "the ROM") + (c.unlockReason ? " (" + c.unlockReason + ")" : "") + " and hasn't been corrected and locked again.", base);
      if (r.tampered) add("act", "calc", r.id, "Totals don't match the figures", who + " of " + w + ": the saved total (" + euro(Number(c.total) || 0) + ") isn't what the notes and coins add up to (" + euro(r.s.total) + ").", Object.assign({ amt: r2((Number(c.total) || 0) - r.s.total) }, base));
      if (r.diff != null && Math.abs(r.diff) >= 0.005) {
        add(Math.abs(r.diff) >= BIG ? "act" : "watch", "diff", r.id, r.diff < 0 ? "Safe short" : "Safe over",
          who + " of " + w + ": counted " + euro(r.s.total) + ", expected " + euro(r.expected) + " (previous count " + euro(r.prevTotal) + (r.s.moves ? ", movements " + (r.s.moves > 0 ? "+" : "") + euro(r.s.moves) : "") + ")." + (c.note ? " Note: " + c.note : ""), Object.assign({ amt: r.diff }, base));
      }
      if (Number(c.extra) > EXTRA_MAX) add("watch", "extra", r.id, "Coins after closing over €" + EXTRA_MAX, who + " of " + w + ": " + euro(Number(c.extra)) + " in coins left after closing cash.", Object.assign({ amt: Number(c.extra) }, base));
      var a = String(c.nameA || "").trim().toLowerCase(), b = String(c.nameB || "").trim().toLowerCase();
      if (a && a === b) add("watch", "same", r.id, "Same person signed twice", who + " of " + w + " was signed by " + c.nameA + " on both lines; a count needs two people.", base);
      (c.exps || []).forEach(function (e, i) { if (!String(e.what || "").trim() || !String(e.mgr || "").trim()) add("watch", "exp", r.id + "-" + i, "Expense without details", who + " of " + w + ": an expense of " + euro(Number(e.amt) || 0) + " has no description or no manager's name.", Object.assign({ amt: Number(e.amt) || 0 }, base)); });
      if ((c.version || 1) > 1) add("watch", "fixed", r.id, "Corrected after unlock", who + " of " + w + " was corrected after the ROM unlocked it" + (c.editName ? " (by " + c.editName + ")" : "") + ".", base);
      (c.bags || []).forEach(function (e) { if (e.st === "out" && !String(e.rc || "").trim()) add("watch", "norc", r.id + "-" + bagKey(e.bag), "Bag collected without a receipt no.", "Bag " + e.bag + " was marked as collected by the CIT at the count of " + w + ", but no CIT receipt number was written.", base); });
    });

    track.forEach(function (x) {
      var id = x.key + "@" + x.date;
      if (x.st === "gone") add("act", "gone", id, "Deposit bag not found", "Bag " + x.bag + (x.date ? " (" + dayName(x.date) + ")" : "") + (x.amt != null ? ", " + euro(x.amt) : "") + " was not found in the safe at the last count it was listed on.", { amt: x.amt, date: x.date });
      else if (x.missed) add("act", "unseen", id, "Bag on the cash sheet never counted in the safe", "Bag " + x.bag + " from the cash sheet of " + dayName(x.date) + (x.amt != null ? " (" + euro(x.amt) + ")" : "") + " isn't on any safe count since.", { amt: x.amt, date: x.date });
      else if (x.st === "in" && x.daysIn > BAG_DAYS) add("watch", "old", id, "Bag in the safe for " + x.daysIn + " days", "Bag " + x.bag + " (" + dayName(x.date) + ") is still in the safe; it hasn't been collected by the CIT.", { amt: x.amt, date: x.date });
      if (!x.sheet && x.src !== "float" && opts.sheetLatest && x.date && opts.sheetLatest >= addDays(x.date, 2))
        add("watch", "nosheet", id, "Bag in the safe not on the cash sheet", "Bag " + x.bag + " was counted in the safe (" + dayName(x.date) + ") but isn't on the cash sheet.", { amt: x.amt, date: x.date });
    });

    // days with no count at all (from the first count on, up to yesterday)
    if (rows.length) {
      var have = {}; rows.forEach(function (r) { have[r.day] = true; });
      var first = opts.from && opts.from > rows[0].day ? opts.from : rows[0].day;
      for (var d = first; d < today; d = addDays(d, 1)) if (!have[d]) add("act", "noday", d, "No safe count", "No safe count was recorded on " + dayName(d) + ".", { date: d });
      // weekly checks: one by the Store Manager and one by the ROM each week (Monday to Sunday), once the week has ended
      for (var w = mondayOf(first); addDays(w, 7) <= today; w = addDays(w, 7)) {
        var inWeek = rows.filter(function (r) { return r.day >= w && r.day <= addDays(w, 6); });
        if (!inWeek.some(function (r) { return r.c.type === "sm"; })) add("watch", "nosm", w, "No weekly SM check", "No Store Manager safe check was recorded in the week of " + dayName(w) + ".", { date: w });
        if (!inWeek.some(function (r) { return r.c.type === "rom"; })) add("watch", "norom", w, "No weekly ROM check", "No ROM safe check was recorded in the week of " + dayName(w) + ".", { date: w });
      }
    }
    return out.sort(function (a, b) { return (a.level === "act" ? 0 : 1) - (b.level === "act" ? 0 : 1) || String(b.date || "").localeCompare(String(a.date || "")); });
  }

  /** Transfers between stores: money sent OUT should show up as received IN at the other store (within 2 days). */
  function transferFlags(seqByStore, nameOf) {
    var out = [];
    Object.keys(seqByStore).forEach(function (code) {
      seqByStore[code].forEach(function (r) {
        (r.c.outs || []).forEach(function (t, i) {
          var to = t.store, other = seqByStore[to];
          if (!to || !other) return;   // the other store isn't loaded here: can't check
          var hit = other.some(function (o) { return (o.c.ins || []).some(function (x) { return x.store === code && Math.abs(r2(x.amt) - r2(t.amt)) < 0.005; }) && Math.abs(daysBetween(o.day, r.day)) <= 2; });
          if (!hit) out.push({ store: code, level: "watch", kind: "xfer", id: "xfer:" + r.id + "-" + i, title: "Transfer not received", date: r.day, countId: r.id, amt: -r2(t.amt),
            text: "€" + r2(t.amt).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " was sent to " + (nameOf ? nameOf(to) : to) + " on " + dayName(r.day) + ", but no matching \"received in\" was recorded there within 2 days." });
        });
      });
    });
    return out;
  }

  var api = { DENOMS: DENOMS, TYPES: TYPES, EXTRA_MAX: EXTRA_MAX, BAG_DAYS: BAG_DAYS, BIG: BIG, sums: sums, sequence: sequence, bagTrack: bagTrack,
    bagsForNewCount: bagsForNewCount, flags: flags, transferFlags: transferFlags, ms: ms, isoOf: isoOf, addDays: addDays, mondayOf: mondayOf, r2: r2, bagKey: bagKey };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SafeCheck = api;
})(this);
