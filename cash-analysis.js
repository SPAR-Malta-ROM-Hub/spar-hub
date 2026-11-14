/* SPAR Malta Hub · Cash Sheet Analyser: reading and checking the weekly Cash Report workbook.
   Shared by cash.html (and the tests). No Firebase here: parseBook() reads the workbook,
   analyse() turns the closes into flags, seller records, missing fields, safe bag and data issues. */
(function (root) {
  "use strict";
  const LIMIT = 2;            // unders / overs beyond ±€2 are flagged
  const BIG = 50;             // differences beyond ±€50 always need a look
  const COINS_MAX = 5;        // what's left out of the safe bag should be coins only (under €5)
  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  const pad = (n) => (n < 10 ? "0" : "") + n;
  const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const addDays = (s, n) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); };
  const diffDays = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 864e5);
  const mondayOf = (s) => addDays(s, -((new Date(s + "T12:00:00").getDay() + 6) % 7));
  const r2 = (v) => Math.round((+v || 0) * 100) / 100;
  const num = (v) => { if (v == null || v === "") return null; if (typeof v === "number") return v; const x = parseFloat(String(v).replace(/[€,\s]/g, "")); return isFinite(x) ? x : null; };
  const n0 = (v) => num(v) || 0;
  const norm = (s) => String(s == null ? "" : s).toUpperCase().replace(/[^A-Z]/g, "");
  const title = (s) => String(s || "").trim().toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
  const money = (v) => Math.abs(r2(v)).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const eur = (v) => (v < 0 ? "−" : "") + "€" + money(v);
  const sEur = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + "€" + money(v);
  const dayShort = (s) => new Date(s + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const dm = (s) => new Date(s + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  function lev(a, b) {
    if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
    let p = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) { const c = [i]; for (let j = 1; j <= b.length; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; }
    return p[b.length];
  }
  const similar = (a, b) => !!a && !!b && (a === b || a.startsWith(b) || b.startsWith(a) || lev(a, b) <= Math.max(1, Math.floor(Math.min(a.length, b.length) / 4)));

  function toISO(v, X) {
    if (v == null || v === "") return null;
    if (typeof v === "number" && X) { const p = X.SSF.parse_date_code(v); return p ? p.y + "-" + pad(p.m) + "-" + pad(p.d) : null; }
    if (v instanceof Date) return iso(v);
    const s = String(v).trim(); let m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[1] + "-" + m[2] + "-" + m[3];
    if ((m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/))) return (m[3].length === 2 ? "20" + m[3] : m[3]) + "-" + pad(+m[2]) + "-" + pad(+m[1]);
    return null;
  }

  // ── Reading the workbook: one sheet per week (Wk_01 … Wk_53), a block per day ──
  const COLS = [["num", /seller/], ["name", /cashier|name/], ["flt", /^float/], ["cd", /cash diff/], ["bd", /bov diff/], ["pd", /poyc.*diff/], ["td", /total diff/],
    ["ts", /total sales/], ["sc", /should.*cash/], ["ac", /actual cash/], ["sb", /should.*bov/], ["ab", /actual bov/], ["sp", /should.*poyc/], ["ap", /actual poyc/],
    ["cr", /credit/], ["bag", /safe bag|deposit no|bag/], ["com", /comment/], ["cl", /closed by/], ["dep", /cash deposit/], ["coins", /coin/]];
  const FORMULA = ["cd", "bd", "pd", "td", "ts", "coins"];
  function parseBook(X, wb, fileName) {
    const closes = [], totals = [], weeks = {};
    wb.SheetNames.forEach((sn) => {
      const m = sn.match(/wk[\s_.-]*(\d{1,2})/i); if (!m) return;
      const ws = wb.Sheets[sn]; if (!ws || !ws["!ref"]) return;
      const R = X.utils.decode_range(ws["!ref"]);
      const cell = (r, c) => ws[X.utils.encode_cell({ r, c })];
      const v = (r, c) => { const x = cell(r, c); return x ? x.v : null; };
      let col = null, date = null, prev = null, idx = 0;
      for (let r = R.s.r; r <= R.e.r; r++) {
        const b = v(r, 1);
        if (typeof b === "string" && /seller/i.test(b)) {
          col = {};
          for (let c = 0; c <= R.e.c; c++) {
            const h = String(v(r, c) == null ? "" : v(r, c)).toLowerCase().replace(/\s+/g, " ").trim(); if (!h) continue;
            const hit = COLS.find(([k, re]) => col[k] == null && re.test(h)); if (hit) col[hit[0]] = c;
          }
          date = toISO(v(r, 0), X) || (prev ? addDays(prev, 1) : null); prev = date; idx = 0;
          continue;
        }
        if (!col || !date) continue;
        const g = (k) => col[k] != null ? v(r, col[k]) : null;
        const a = v(r, 0);
        if (typeof a === "string" && DAYS.includes(a.trim()) && !g("num") && !g("name") && g("sc") == null) continue;
        const sNum = g("num"), sName = g("name") == null ? "" : String(g("name")).trim();
        const money = ["sc", "ac", "sb", "ab", "sp", "ap"].map((k) => num(g(k)));
        if (typeof a === "string" && /total|overview|balance/i.test(a)) continue;      // the week's summary at the bottom
        if (sNum == null && !sName) {
          const anyMoney = money.some((x) => x != null && x !== 0);
          if (num(g("flt")) == null) {
            // the day's total row (no seller, no float), or the coins summary rows under Sunday
            if (anyMoney) totals.push({ date, wk: sn, row: r + 1, sc: num(g("sc")), ac: num(g("ac")), sb: num(g("sb")), ab: num(g("ab")), td: num(g("td")) });
            continue;
          }
          if (!anyMoney && !g("bag") && !g("com") && !g("cl") && !num(g("dep"))) continue;    // an empty till line
        }
        const c = { wk: sn, wkNo: +m[1], row: r + 1, date, i: idx++, num: sNum == null ? null : String(sNum).trim().replace(/\.0+$/, ""), name: sName,
          flt: num(g("flt")), sc: num(g("sc")), ac: num(g("ac")), cd: num(g("cd")), sb: num(g("sb")), ab: num(g("ab")), bd: num(g("bd")),
          sp: num(g("sp")), ap: num(g("ap")), pd: num(g("pd")), td: num(g("td")), cr: num(g("cr")), ts: num(g("ts")),
          bag: g("bag") == null ? "" : String(g("bag")).trim(), com: g("com") == null ? "" : String(g("com")).trim(), cl: g("cl") == null ? "" : String(g("cl")).trim(),
          dep: num(g("dep")), coins: num(g("coins")), typed: [] };
        FORMULA.forEach((k) => { if (col[k] == null) return; const x = cell(r, col[k]); if (x && x.v != null && x.v !== "" && !x.f && typeof x.v === "number") c.typed.push(k); });
        closes.push(c);
        const w = mondayOf(date); (weeks[w] = weeks[w] || { sheet: sn, wkNo: +m[1] });
      }
    });
    const code = (String(fileName || "").match(/[-–]\s*([A-Z]{2,5})\s*(?:\(\d+\))?\s*(?:\.\w+)?$/i) || [])[1];
    return { closes, totals, weeks, code: code ? code.toUpperCase() : null };
  }

  // ── Comments ──
  function commentDates(com, year) {
    const out = []; const re = /(\d{1,2})\s*[\/.]\s*(\d{1,2})(?:\s*[\/.]\s*(\d{2,4}))?/g; let m;
    while ((m = re.exec(com))) { const d = +m[1], mo = +m[2]; if (d < 1 || d > 31 || mo < 1 || mo > 12) continue; const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : year; out.push(y + "-" + pad(mo) + "-" + pad(d)); }
    return out;
  }
  function commentAmounts(com) {
    const s = com.replace(/(\d{1,2})\s*[\/.]\s*(\d{1,2})\s*[\/.]\s*(\d{2,4})/g, " ").replace(/(\d{1,2})\/(\d{1,2})/g, " ");
    const out = []; const re = /(\d{1,5}(?:[.,]\d{1,3})?)/g; let m;
    while ((m = re.exec(s))) { const x = parseFloat(m[1].replace(",", ".")); if (isFinite(x) && x > 0) out.push(x); }
    return out;
  }
  const isRepayText = (s) => /(sort|short|sart|sorrt|shor|under)/i.test(s) && (/(paid|pay|repa)/i.test(s) || /\d{1,2}\s*\/\s*\d{1,2}/.test(s)) && !/(card|bov|verifone)/i.test(s);
  const isMixText = (s) => /(card|bov|verifone)/i.test(s) && /cash/i.test(s);

  // ── The checks ──
  function analyse(input, opts) {
    opts = opts || {};
    const L = opts.limit || LIMIT;
    const closes = input.closes.slice().sort((a, b) => a.date.localeCompare(b.date) || a.row - b.row);
    const flags = [], missing = [], bags = [], issues = [];
    closes.forEach((c) => {
      c.cash = r2(n0(c.ac) - n0(c.sc)); c.bov = r2(n0(c.ab) - n0(c.sb)); c.poyc = r2(n0(c.ap) - n0(c.sp)); c.tot = r2(c.cash + c.bov + c.poyc);
      c.key = norm(c.name); c.active = [c.sc, c.ac, c.sb, c.ab, c.sp, c.ap].some((x) => n0(x) !== 0);
      c.ref = c.wk + " row " + c.row;
    });
    // seller numbers: who normally uses each number, and the store's number format
    const byNum = {}, spell = {};
    closes.forEach((c) => {
      if (c.num && c.key) { const m = byNum[c.num] = byNum[c.num] || {}; m[c.key] = (m[c.key] || 0) + 1; }
      if (c.key) { const sp = spell[c.key] = spell[c.key] || {}; sp[c.name] = (sp[c.name] || 0) + 1; }
    });
    const canon = {}; Object.entries(byNum).forEach(([k, m]) => { canon[k] = Object.entries(m).sort((a, b) => b[1] - a[1])[0][0]; });
    // fold spelling variants (VZRUN → VARUN) into the commoner spelling
    const keyCount = {}; closes.forEach((c) => { if (c.key) keyCount[c.key] = (keyCount[c.key] || 0) + 1; });
    const keys = Object.keys(keyCount).sort((a, b) => keyCount[b] - keyCount[a]);
    const fold = {}; keys.forEach((k) => { fold[k] = keys.find((j) => keyCount[j] >= keyCount[k] && similar(j, k) && j.length >= 3) || k; });
    const display = (k) => { const sp = spell[k] || {}; const best = Object.entries(sp).sort((a, b) => b[1] - a[1])[0]; return best ? title(best[0]) : k; };
    const lens = {}, pre = {};
    Object.keys(byNum).forEach((k) => { if (/^\d+$/.test(k)) { lens[k.length] = (lens[k.length] || 0) + 1; pre[k.slice(0, 2)] = (pre[k.slice(0, 2)] || 0) + 1; } });
    const modeLen = +(Object.entries(lens).sort((a, b) => b[1] - a[1])[0] || [0])[0], modePre = (Object.entries(pre).sort((a, b) => b[1] - a[1])[0] || [""])[0];
    const numsOf = {};
    closes.forEach((c) => {
      const usual = c.num ? canon[c.num] : null;
      c.wrongCode = !!(usual && c.key && !similar(fold[usual] || usual, fold[c.key] || c.key));
      c.pid = c.key ? (fold[c.key] || c.key) : c.num ? (fold[canon[c.num]] || canon[c.num] || "#" + c.num) : null;
      c.who = c.key ? display(fold[c.key] || c.key) : c.num && canon[c.num] ? display(canon[c.num]) : "Seller " + (c.num || "?");
      if (c.pid && c.num) { const m = numsOf[c.pid] = numsOf[c.pid] || {}; m[c.num] = (m[c.num] || 0) + 1; }
    });
    const usualNum = (pid) => { const m = numsOf[pid] || {}; const e = Object.entries(m).sort((a, b) => b[1] - a[1])[0]; return e ? e[0] : null; };
    const badFormat = (k) => !!k && !!modeLen && (!/^\d+$/.test(k) || k.length !== modeLen || (modePre && k.slice(0, 2) !== modePre));

    const add = (list, o) => { list.push(o); return o; };
    const base = (c, type) => ({ id: type + "|" + c.date + "|" + (c.num || c.key || "") + "|" + c.row, date: c.date, wk: c.wk, wkNo: c.wkNo, row: c.row, ref: c.ref, num: c.num || "", who: c.who, pid: c.pid, com: c.com });

    // 1) repayments first, so unders they clear can be marked repaid
    const unders = closes.filter((c) => c.tot < -0.2 && c.pid);
    unders.forEach((u) => { u.left = -u.tot; u.repaidBy = []; });
    const repays = [];
    closes.forEach((c) => {
      if (!c.com || !c.pid || !isRepayText(c.com)) return;
      const amts = commentAmounts(c.com); if (!amts.length) return;
      const R = amts[0], dates = commentDates(c.com, +c.date.slice(0, 4)).filter((d) => d < c.date);
      let cand = unders.filter((u) => u.pid === c.pid && u.date < c.date && diffDays(u.date, c.date) <= 60 && u.left > 0.05);
      let hit = [];
      if (dates.length) hit = cand.filter((u) => dates.includes(u.date));
      if (!hit.length) { const one = cand.filter((u) => Math.abs(u.left - R) <= 0.15).sort((a, b) => b.date.localeCompare(a.date))[0]; if (one) hit = [one]; }
      hit.forEach((u) => { u.left = 0; u.repaidBy.push(c); });
      c.repay = { R, hit, dates };
      repays.push(c);
    });

    // 2) each close
    closes.forEach((c) => {
      if (!c.active && !c.com) return;
      const fl = [];
      const mixText = !!c.com && isMixText(c.com);
      const mixSeen = Math.abs(c.cash) > 0.5 && Math.abs(c.bov) > 0.5 && Math.sign(c.cash) !== Math.sign(c.bov);
      if (c.repay) {
        const own = r2(c.tot - c.repay.R), hit = c.repay.hit;
        const f = add(flags, Object.assign(base(c, "repay"), { kind: "repay", tags: ["REPAYMENT"], amt: c.tot, sub: "till " + sEur(own), action: false }));
        if (hit.length) f.text = "Repays " + eur(c.repay.R) + " for " + hit.map((u) => dm(u.date)).join(" and ") + ". Till's own result that day: " + sEur(own) + ".";
        else { f.tags.push("CHECK"); f.action = true; f.text = "Repays " + eur(c.repay.R) + (c.repay.dates.length ? " for " + c.repay.dates.map(dm).join(" and ") : "") + ", but no under was found for " + c.who + (c.repay.dates.length ? " on that date" : " to match it") + ". Till's own result that day: " + sEur(own) + "."; }
        if (own < -L) add(flags, Object.assign(base(c, "under"), { kind: "under", tags: ["UNDER", "CHECK"], amt: own, action: true, text: "Under " + eur(-own) + " after taking off the " + eur(c.repay.R) + " repayment." }));
        else if (own > L && !/extra|excess|over/i.test(c.com)) add(flags, Object.assign(base(c, "over"), { kind: "over", tags: ["OVER", "CHECK"], amt: own, action: true, text: eur(own) + " over after taking off the repayment, with no explanation." }));
      } else if (mixText || mixSeen) {
        const amt = (commentAmounts(c.com)[0]) || Math.abs(c.bov);
        if (c.tot < -L) {
          const f = add(flags, Object.assign(base(c, "under"), { kind: "under", tags: ["UNDER"], amt: c.tot, mix: true }));
          f.text = "Card/cash mix of " + eur(amt) + (/bov/i.test(c.com) ? " on BOV" : "") + ", still under after it.";
        } else if (c.tot > L && !(mixSeen)) {
          add(flags, Object.assign(base(c, "over"), { kind: "over", tags: ["OVER", "CHECK"], amt: c.tot, action: true, text: "Comment says paid by card, closed by cash, but the cash is not short (" + sEur(c.cash) + "). The till is genuinely " + eur(c.tot) + " over." }));
        } else {
          const f = add(flags, Object.assign(base(c, "mix"), { kind: "mix", tags: ["CARD/CASH"], amt: c.tot, sub: "cash " + sEur(c.cash), action: false }));
          f.text = (/cash to bov|paid by cash|closed by bov/i.test(c.com) ? "Paid by cash, closed by card." : "Paid by card, closed by cash.") + " Total " + (Math.abs(c.tot) <= L ? "within €" + L : sEur(c.tot)) + ".";
          if (!mixText && (Math.abs(c.cash) > L || Math.abs(c.bov) > L)) { f.tags.push("CHECK"); f.action = true; f.text = "Cash " + sEur(c.cash) + " and BOV " + sEur(c.bov) + " cancel out: looks like a card/cash mix-up with no comment to say so."; }
        }
      } else if (c.tot < -L) {
        const f = add(flags, Object.assign(base(c, "under"), { kind: "under", tags: ["UNDER"], amt: c.tot }));
      } else if (c.tot > L) {
        const f = add(flags, Object.assign(base(c, "over"), { kind: "over", tags: ["OVER"], amt: c.tot, action: false }));
        if (!c.com || /^(ok|\s*)$/i.test(c.com)) { f.tags.push("CHECK"); f.action = true; f.text = eur(c.tot) + " over with no explanation in the comment."; }
        else if (/(sort|short|under)/i.test(c.com) && !/(extra|excess|over)/i.test(c.com)) { f.tags.push("CHECK"); f.action = true; f.text = "The comment mentions an under, but the till is " + eur(c.tot) + " over."; }
        else f.text = "Over " + eur(c.tot) + " (explained in the comment).";
      }
      if (Math.abs(c.tot) > BIG) {
        const f = flags.find((x) => x.date === c.date && x.row === c.row && x.wk === c.wk && (x.kind === "over" || x.kind === "under" || x.kind === "mix"));
        if (f && !f.tags.includes("CHECK")) { f.tags.push("CHECK"); f.action = true; f.text = "Big difference of " + sEur(c.tot) + ": check the till reading. " + (f.text || ""); }
      }
    });
    // unders: repaid or outstanding
    flags.filter((f) => f.kind === "under" && !f.id.includes("|x")).forEach((f) => {
      const u = closes.find((c) => c.wk === f.wk && c.row === f.row);
      if (!u || !u.repaidBy || f.tags.includes("CHECK") && !f.mix) return;
      if (u.repaidBy.length) { const p = u.repaidBy[0]; f.tags.push("REPAID"); f.action = false; f.text = (f.text ? f.text + " " : "") + "Repaid " + dm(p.date) + " (" + p.ref + ")."; f.repaidOn = p.date; }
      else { f.tags.push("OUTSTANDING"); f.action = true; f.outstanding = true; f.text = "No repayment found yet." + (f.text ? " " + f.text : ""); }
    });
    // the wrong employee code, or a number that isn't this store's format
    closes.forEach((c) => {
      if (!c.active) return;
      if (c.wrongCode) add(flags, Object.assign(base(c, "code"), { kind: "code", tags: ["WRONG CODE", "CHECK"], amt: c.tot, action: true,
        text: c.who + " closed on seller " + c.num + ". Seller " + c.num + " is normally " + display(fold[canon[c.num]] || canon[c.num]) + (usualNum(c.pid) && usualNum(c.pid) !== c.num ? "; " + c.who + " normally uses " + usualNum(c.pid) : "") + "." }));
      else if (badFormat(c.num)) add(flags, Object.assign(base(c, "code"), { kind: "code", tags: ["SELLER NO.", "CHECK"], amt: c.tot, action: true,
        text: "Seller number " + c.num + " doesn't look like this store's numbers (" + modePre + "…, " + modeLen + " digits)" + (usualNum(c.pid) && usualNum(c.pid) !== c.num ? ". " + c.who + " normally uses " + usualNum(c.pid) : "") + "." }));
    });

    // 3) missing figures and missing days
    closes.forEach((c) => {
      if (!c.active) return;
      const miss = [];
      if (!c.num) miss.push("seller number"); if (!c.name) miss.push("cashier name");
      if (n0(c.sc) > 0 && c.ac == null) miss.push("actual cash"); if (n0(c.sb) > 0 && c.ab == null) miss.push("actual BOV"); if (n0(c.sp) > 0 && c.ap == null) miss.push("actual POYC");
      if ((n0(c.dep) > 0 || n0(c.ac) >= COINS_MAX) && !c.bag) miss.push("safe bag no.");
      if (!c.cl) miss.push("closed by");
      if (n0(c.ac) >= COINS_MAX && c.dep == null) miss.push("cash deposit");
      if (miss.length) add(missing, Object.assign(base(c, "miss"), { kind: "miss", action: true, fields: miss, text: "Missing: " + miss.join(", ") + "." }));
    });
    const dayHas = {}; closes.forEach((c) => { if (c.active) dayHas[c.date] = true; });
    const dates = Object.keys(dayHas).sort();
    if (dates.length) for (let d = dates[0]; d <= dates[dates.length - 1]; d = addDays(d, 1)) if (!dayHas[d]) {
      const wkc = closes.find((c) => mondayOf(c.date) === mondayOf(d));
      add(missing, { id: "day|" + d, kind: "day", date: d, wk: wkc ? wkc.wk : "", wkNo: wkc ? wkc.wkNo : null, ref: "", who: "Whole day", num: "", action: true, fields: ["day"], text: "No closes entered for " + dayShort(d) + "." });
    }

    // 4) safe bags
    const pat = (b) => b.toUpperCase().replace(/\d/g, "9");
    const pc = {}; closes.forEach((c) => { if (c.bag) pc[pat(c.bag)] = (pc[pat(c.bag)] || 0) + 1; });
    const modePat = (Object.entries(pc).sort((a, b) => b[1] - a[1])[0] || [""])[0];
    const bagDays = {}; closes.forEach((c) => { if (!c.bag) return; const b = c.bag.toUpperCase().replace(/\s+/g, ""); (bagDays[b] = bagDays[b] || new Set()).add(c.date); });
    const bagList = {};
    closes.forEach((c) => {
      if (c.bag) { const b = c.bag.toUpperCase().replace(/\s+/g, ""); const k = c.date + "|" + b; const x = bagList[k] = bagList[k] || { bag: b, date: c.date, wk: c.wk, n: 0, dep: 0, who: [] }; x.n++; x.dep += n0(c.dep); x.who.push(c.who); }
      if (!c.active) return;
      const probs = [];
      if (c.bag && modePat && pat(c.bag) !== modePat) probs.push("Bag number " + c.bag + " isn't in the usual format (" + modePat.replace(/9/g, "0") + ")");
      if (c.bag) { const b = c.bag.toUpperCase().replace(/\s+/g, ""); const other = [...bagDays[b]].filter((d) => d !== c.date).sort(); if (other.length) probs.push("Bag " + b + " is also used on " + other.map(dayShort).join(", ")); }
      if (c.dep != null && c.ac != null && c.dep > c.ac + 0.005) probs.push("Deposit " + eur(c.dep) + " is more than the actual cash " + eur(c.ac));
      if (c.ac != null && c.dep != null && r2(c.ac - c.dep) >= COINS_MAX) probs.push(eur(c.ac - c.dep) + " left out of the bag (only coins under €" + COINS_MAX + " should be)");
      if (probs.length) add(bags, Object.assign(base(c, "bag"), { kind: "bag", bag: c.bag, action: true, text: probs.join(". ") + "." }));
    });

    // 5) data issues: figures that don't add up, formulas typed over, floats, totals, who closed
    const fc = {}; closes.forEach((c) => { if (c.flt != null) fc[c.flt] = (fc[c.flt] || 0) + 1; });
    const modeFloat = +(Object.entries(fc).sort((a, b) => b[1] - a[1])[0] || [0])[0];
    const NAMES = { cd: "Cash Difference", bd: "BOV Difference", pd: "POYC Difference", td: "Total Difference", ts: "Should be Total Sales", coins: "Coins" };
    closes.forEach((c) => {
      if (!c.active) return;
      const want = { cd: c.cash, bd: c.bov, pd: c.poyc, td: c.tot, ts: r2(n0(c.sc) + n0(c.sb) + n0(c.sp) + n0(c.cr)), coins: c.dep == null ? null : r2(n0(c.ac) - n0(c.dep)) };
      const wrong = [], typed = [];
      Object.keys(want).forEach((k) => { if (want[k] == null || c[k] == null) return; if (Math.abs(r2(c[k]) - want[k]) > 0.011) wrong.push(NAMES[k] + " shows " + r2(c[k]).toFixed(2) + " but should be " + want[k].toFixed(2)); });
      c.typed.forEach((k) => { if (!wrong.some((w) => w.startsWith(NAMES[k]))) typed.push(NAMES[k]); });
      if (wrong.length) add(issues, Object.assign(base(c, "calc"), { kind: "calc", action: true, text: wrong.join(". ") + " (the formula may have been typed over)." }));
      else if (typed.length) add(issues, Object.assign(base(c, "typed"), { kind: "typed", action: false, text: typed.join(", ") + " typed in instead of the formula. The figure is right today, but it won't update if the cash is corrected." }));
      if (modeFloat && c.flt != null && c.flt !== modeFloat) add(issues, Object.assign(base(c, "float"), { kind: "float", action: true, text: "Float " + eur(c.flt) + " (the store's float is " + eur(modeFloat) + ")." }));
      if (c.cl && c.key && similar(norm(c.cl), c.key)) add(issues, Object.assign(base(c, "self"), { kind: "self", action: false, text: c.who + " closed their own till. Ideally a second person closes it." }));
      if (c.key && fold[c.key] !== c.key) add(issues, Object.assign(base(c, "spell"), { kind: "spell", action: false, text: "Name typed as “" + c.name + "” (usually " + display(fold[c.key]) + ")." }));
    });
    (input.totals || []).forEach((t) => {
      const day = closes.filter((c) => c.date === t.date);
      const chk = [["sc", "Should be Cash"], ["ac", "Actual Cash"], ["sb", "Should be BOV"], ["ab", "Actual BOV"]].filter(([k]) => t[k] != null && Math.abs(r2(t[k]) - r2(day.reduce((s, c) => s + n0(c[k]), 0))) > 0.011);
      if (chk.length) add(issues, { id: "total|" + t.date + "|" + t.row, kind: "total", date: t.date, wk: t.wk, row: t.row, ref: t.wk + " row " + t.row, who: "Day total", num: "", action: true,
        text: "The day's total for " + chk.map((x) => x[1]).join(", ") + " doesn't add up to the tills above it." });
    });

    // 6) sellers
    const sel = {};
    closes.forEach((c) => {
      if (!c.active || !c.pid) return;
      const s = sel[c.pid] = sel[c.pid] || { pid: c.pid, who: c.who, nums: {}, closes: 0, under: 0, over: 0, worst: 0, best: 0, net: 0, pos: 0, neg: 0, outstanding: 0, wrong: 0, underAmt: 0 };
      const own = c.repay ? r2(c.tot - c.repay.R) : c.tot;   // repayment days count only the till's own result
      s.closes++; s.net = r2(s.net + own); if (own < -L) { s.under++; s.underAmt += -own; } if (own > L) s.over++;
      s.worst = Math.min(s.worst, own); s.best = Math.max(s.best, own); if (own > 0.5) s.pos++; if (own < -0.5) s.neg++;
      if (c.num) s.nums[c.num] = (s.nums[c.num] || 0) + 1; if (c.wrongCode) s.wrong++;
    });
    flags.forEach((f) => { if (f.outstanding && sel[f.pid]) sel[f.pid].outstanding++; });
    const sellers = Object.values(sel).map((s) => {
      s.tags = [];
      if (s.under >= 3) s.tags.push("REPEATED UNDERS"); else if (s.under >= 2 && s.over >= 1) s.tags.push("SWINGS BOTH WAYS");
      if (s.over >= 3 && s.under === 0 && s.net > 5) s.tags.push("CONSISTENTLY OVER");
      if (s.outstanding) s.tags.push(s.outstanding + " OUTSTANDING");
      if (s.wrong) s.tags.push("WRONG CODE ×" + s.wrong);
      if (Object.keys(s.nums).length > 1) s.tags.push("USES " + Object.keys(s.nums).length + " NUMBERS");
      s.num = Object.entries(s.nums).sort((a, b) => b[1] - a[1]).map((e) => e[0])[0] || "";
      s.otherNums = Object.keys(s.nums).filter((k) => k !== s.num);
      return s;
    }).sort((a, b) => b.tags.length - a.tags.length || a.net - b.net);

    // tidy the flags: one id per flag
    const seen = {}; [flags, missing, bags, issues].forEach((l) => l.forEach((f) => { if (seen[f.id]) f.id += "|" + (++seen[f.id]); else seen[f.id] = 1; }));
    return { flags, missing, bags, issues, sellers, bagList: Object.values(bagList).sort((a, b) => b.date.localeCompare(a.date) || a.bag.localeCompare(b.bag)),
      dates, first: dates[0] || null, latest: dates[dates.length - 1] || null, limit: L, modeFloat, modeLen, modePre, closes: closes.filter((c) => c.active || c.num || c.name).length };
  }

  function dates0(closes, w) { const l = closes.filter((c) => (new Date(c.date + "T12:00:00").getDay() + 6) % 7 === w).map((c) => c.date).sort(); return l[l.length - 1] || null; }

  // a fingerprint of one day's figures, to notice when a day is changed after it was reviewed
  function dayHash(closes) {
    const s = closes.map((c) => [c.num, c.name, c.sc, c.ac, c.sb, c.ab, c.sp, c.ap, c.cr, c.bag, c.com, c.cl, c.dep].join("~")).join("|");
    let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + "." + closes.length;
  }

  const api = { LIMIT, parseBook, analyse, dayHash, mondayOf, addDays, diffDays, eur, sEur, dayShort, dm, toISO };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.CashCheck = api;
})(typeof window !== "undefined" ? window : globalThis);
