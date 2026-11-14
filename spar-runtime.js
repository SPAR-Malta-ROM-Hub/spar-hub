/* ═══════════════════════════════════════════════════════════════════
   SPAR Malta Hub — runtime
   Loaded (as a classic script, after firebase-config.js) by every page
   behind the login: the hub, the admin page and each tool.

   It does three jobs:
   1. LOGIN GATE — hides the page until a signed-in team member is
      confirmed; otherwise sends them to login.html.
   2. STORAGE — gives the tools the same storage calls they used on
      claude.ai (`claude.use("db")`, `claude.use("user")` and the older
      `window.storage`), but backed by your own Firebase database. That
      is why the tools themselves barely change.
   3. ACCOUNT PILL — a small "Hub · Sign out" control on tool pages.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var FB_VER = "10.12.2";
  var FB = "https://www.gstatic.com/firebasejs/" + FB_VER + "/";

  // ── Where the site lives (works on github.io/<repo>/ or a domain root) ──
  var me = document.currentScript;
  var BASE = me ? me.src.replace(/spar-runtime\.js(\?.*)?$/, "") : "/";
  var PAGE = (document.querySelector('meta[name="spar-page"]') || {}).content || "tool";
  var TOOL = (document.querySelector('meta[name="spar-tool"]') || {}).content ||
    (location.pathname.match(/\/([a-z-]+)\.html$/) || [])[1] || "hub";

  // ── 1. Hide the page until the login check passes ──
  var lockCss = document.createElement("style");
  lockCss.id = "spar-lock";
  lockCss.textContent = "html.spar-locked body{visibility:hidden!important}";
  (document.head || document.documentElement).appendChild(lockCss);
  document.documentElement.classList.add("spar-locked");

  var ctx = null;             // { app, auth, db, fs, authMod, user, member }
  var readyResolve, readyReject;
  var ready = new Promise(function (res, rej) { readyResolve = res; readyReject = rej; });
  ready.catch(function () {});

  function goLogin() {
    var next = location.pathname + location.search + location.hash;
    location.replace(BASE + "login.html?next=" + encodeURIComponent(next));
  }

  function unlock() {
    document.documentElement.classList.remove("spar-locked");
  }

  function boot() {
    var cfg = window.SPAR_FIREBASE_CONFIG;
    if (!cfg || !cfg.apiKey || /PASTE/.test(cfg.apiKey)) {
      showNotice("Setup not finished",
        "This site hasn't been connected to its Firebase project yet. " +
        "Paste your Firebase settings into js/firebase-config.js (see SETUP.md, step 3).", false);
      readyReject(new Error("not_configured"));
      return;
    }
    Promise.all([
      import(FB + "firebase-app.js"),
      import(FB + "firebase-auth.js"),
      import(FB + "firebase-firestore.js")
    ]).then(function (m) {
      var appMod = m[0], authMod = m[1], fs = m[2];
      var app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(cfg);
      var auth = authMod.getAuth(app);
      var db;
      try {
        db = fs.initializeFirestore(app, {
          localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() })
        });
      } catch (e) { db = fs.getFirestore(app); }

      var first = true;
      authMod.onAuthStateChanged(auth, function (user) {
        if (!first) { if (!user) goLogin(); return; }
        first = false;
        if (!user) { goLogin(); return; }
        var email = (user.email || "").toLowerCase();
        fs.getDoc(fs.doc(db, "members", email)).then(function (snap) {
          if (!snap.exists()) throw { code: "permission-denied" };
          var member = snap.data();
          return fs.getDocs(fs.collection(db, "stores")).catch(function () { return { docs: [] }; }).then(function (qs) {
            var all = qs.docs.map(function (d) { var x = d.data(); x.code = d.id; return x; })
              .sort(function (a, b) { return String(a.name || a.code).localeCompare(String(b.name || b.code)); });
            var seesAll = SEES_ALL.indexOf(member.role) >= 0;
            var mine = Array.isArray(member.stores) ? member.stores : [];
            var visible = all.filter(function (st) { return st.active !== false && (seesAll || mine.indexOf(st.code) >= 0); });
            ctx = { app: app, auth: auth, db: db, fs: fs, authMod: authMod, user: user, member: member,
              stores: visible, allStores: all, seesAll: seesAll };
            // Keep a small public profile so modules can show names for ids.
            var prof = { name: member.name || user.displayName || email, email: email, role: member.role || "" };
            fs.setDoc(fs.doc(db, "profiles", user.uid), prof, { merge: true }).catch(function () {});
            readyResolve(ctx);
            unlock();
            if (PAGE === "tool") addPill();
            document.dispatchEvent(new CustomEvent("spar:ready", { detail: publicCtx() }));
          });
        }).catch(function (err) {
          if (err && err.code === "permission-denied") {
            showNotice("No access yet",
              "You're signed in as " + email + ", but this account hasn't been given access to the SPAR Malta Hub. " +
              "Ask a hub admin to add you.", true);
          } else {
            showNotice("Can't reach the database",
              "Check your connection and reload the page. (" + ((err && (err.code || err.message)) || "error") + ")", true);
          }
          readyReject(err);
        });
      });
    }).catch(function (e) {
      showNotice("Can't load the sign-in system",
        "Check your internet connection and reload the page.", false);
      readyReject(e);
    });
  }

  var SEES_ALL = ["admin", "hq", "support"];
  var ROLE_LABELS = { admin: "Admin", hq: "Head Office", support: "Support", rom: "ROM", sm: "Store Manager", dept: "Department" };
  var STORE_KEY = "sparStore";

  function publicCtx() {
    if (!ctx) return null;
    var role = ctx.member.role || "";
    var stores = ctx.stores.slice();
    var ALL = { code: "__ALL__", name: "All stores", all: true };
    function current() {
      var saved = null;
      try { saved = localStorage.getItem(STORE_KEY); } catch (e) {}
      if (saved === ALL.code && ctx.seesAll && stores.length > 1) return ALL;
      var hit = stores.filter(function (s) { return s.code === saved; })[0];
      return hit || stores[0] || null;
    }
    return {
      uid: ctx.user.uid,
      email: (ctx.user.email || "").toLowerCase(),
      name: ctx.member.name || ctx.user.email,
      role: role,
      roleLabel: role === "dept" && ctx.member.dept ? ctx.member.dept : (ROLE_LABELS[role] || role),
      dept: ctx.member.dept || "",
      cashAccess: ctx.member.cashAccess === true,   // Head Office / Support people in the accounts team: Cash Sheet Analyser (read only)
      salesGroups: Array.isArray(ctx.member.salesGroups) ? ctx.member.salesGroups : [],   // Sales Tracker: [] = full figures, else only these category groups          // for role "dept": the department they post DAP tasks for
      isAdmin: role === "admin",
      isHQ: role === "admin" || role === "hq",
      seesAll: ctx.seesAll,
      stores: stores,                 // stores this person may see (active only)
      allStores: ctx.allStores.slice(),
      store: function () { return current(); },          // may be { all: true } on pages that allow "All stores"
      firstStore: function () { var c = current(); return c && c.all ? (stores[0] || null) : c; },
      setStore: function (code) { try { localStorage.setItem(STORE_KEY, code); } catch (e) {} },
      storeName: function (code) {
        var hit = ctx.allStores.filter(function (s) { return s.code === code; })[0];
        return hit ? hit.name : code;
      },
      signOut: function () { return ctx.authMod.signOut(ctx.auth).then(goLogin); }
    };
  }

  // ── Notice screen (setup / no access / offline) ──
  function showNotice(title, text, withSignOut) {
    function render() {
      unlock();
      var d = document.createElement("div");
      d.setAttribute("role", "alert");
      d.style.cssText = "position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;padding:16px;" +
        "background:#F2F5F3;font:16px/1.5 Barlow,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#13201A";
      var card = document.createElement("div");
      card.style.cssText = "max-width:420px;width:100%;background:#fff;border:1px solid #DCE4DF;border-radius:12px;padding:24px";
      var h = document.createElement("h1");
      h.style.cssText = "margin:0 0 8px;font:700 24px/1.1 'Barlow Condensed','Arial Narrow',Arial,sans-serif";
      h.textContent = title;
      var p = document.createElement("p");
      p.style.cssText = "margin:0 0 16px;color:#5A6B62";
      p.textContent = text;
      card.appendChild(h); card.appendChild(p);
      if (withSignOut) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = "Sign out";
        b.style.cssText = "background:#0A7A42;color:#fff;border:0;border-radius:8px;padding:10px 16px;font:600 15px inherit;cursor:pointer";
        b.onclick = function () {
          import(FB + "firebase-auth.js").then(function (a) { return a.signOut(a.getAuth()); }).finally(goLogin);
        };
        card.appendChild(b);
      }
      d.appendChild(card);
      document.body.appendChild(d);
    }
    if (document.body) render(); else document.addEventListener("DOMContentLoaded", render);
  }

  // ── Account pill on tool pages ──
  function addPill() {
    function render() {
      var css = document.createElement("style");
      css.textContent =
        ".spar-pill{position:fixed;right:max(12px,env(safe-area-inset-right,0px));bottom:max(12px,env(safe-area-inset-bottom,0px));" +
        "z-index:2147483000;display:flex;gap:2px;background:#13201A;border-radius:999px;padding:3px;box-shadow:0 2px 10px rgba(0,0,0,.25);" +
        "font:600 13px/1 Barlow,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;opacity:.88}" +
        ".spar-pill:hover{opacity:1}" +
        ".spar-pill a,.spar-pill button{color:#E4EDE8;background:none;border:0;border-radius:999px;padding:8px 12px;cursor:pointer;" +
        "text-decoration:none;font:inherit}" +
        ".spar-pill a:hover,.spar-pill button:hover{background:#26352D}" +
        "@media print{.spar-pill{display:none}}";
      document.head.appendChild(css);
      var pill = document.createElement("div");
      pill.className = "spar-pill";
      var a = document.createElement("a");
      a.href = BASE; a.textContent = "← Hub";
      var b = document.createElement("button");
      b.type = "button"; b.textContent = "Sign out";
      b.onclick = function () { publicCtx().signOut(); };
      pill.appendChild(a); pill.appendChild(b);
      document.body.appendChild(pill);
    }
    if (document.body) render(); else document.addEventListener("DOMContentLoaded", render);
  }

  /* ═════════════════════════════════════════════════════════════════
     2. STORAGE — claude.ai-compatible API over Firestore
     ─────────────────────────────────────────────────────────────────
     Where a tool's data goes in Firestore:
       shared   tool path P         →  apps/<tool>/P
       private  data/users/<uid>/Q  →  private/<uid>/tools/<tool>/d/Q
       old window.storage (shared)  →  apps/<tool>/_kv/<key>
       old window.storage (own)     →  private/<uid>/tools/<tool>/_kv/<key>
     ═════════════════════════════════════════════════════════════════ */

  function dbErr(code, message) { return { code: code, message: message || code }; }
  function mapErr(e) {
    var c = e && e.code;
    if (c && c.code) return c; // already mapped
    if (c === "permission-denied") return dbErr("invalid_argument", "You don't have permission to change this.");
    if (c === "not-found") return dbErr("invalid_argument", "That record doesn't exist.");
    if (c === "invalid-argument" || c === "failed-precondition") return dbErr("invalid_argument", e.message);
    if (c === "resource-exhausted") return dbErr("resource_exhausted", e.message);
    if (c === "unauthenticated") return dbErr("revoked", "Signed out.");
    if (e && e.name === "TypeError") return dbErr("invalid_argument", e.message);
    return dbErr("unavailable", (e && e.message) || "Database unavailable");
  }

  var SEG_RE = /^[A-Za-z0-9_\-.~:@+]+$/;
  function splitPath(p) {
    if (typeof p !== "string") throw new TypeError("Path must be a string");
    var s = p.replace(/^\/+|\/+$/g, "").split("/");
    for (var i = 0; i < s.length; i++) {
      if (!s[i] || !SEG_RE.test(s[i]) || s[i] === "." || s[i] === "..")
        throw new TypeError("Invalid path segment \"" + s[i] + "\" in \"" + p + "\"");
    }
    if (s.length > 16) throw new TypeError("Path has more than 16 segments");
    return s;
  }

  // tool path segments → Firestore path segments
  function toFs(segs, uid) {
    if (segs[0] === "data" && segs[1] === "users" && segs.length >= 3) {
      return ["private", segs[2], "tools", TOOL, "d"].concat(segs.slice(3));
    }
    return ["apps", TOOL].concat(segs);
  }

  function randId() {
    var c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", s = "";
    var a = new Uint8Array(20);
    (window.crypto || window.msCrypto).getRandomValues(a);
    for (var i = 0; i < 20; i++) s += c[a[i] % 62];
    return s;
  }

  function deepFreeze(o) {
    if (o && typeof o === "object" && !Object.isFrozen(o)) {
      Object.freeze(o);
      Object.keys(o).forEach(function (k) { deepFreeze(o[k]); });
    }
    return o;
  }

  function clean(data) {
    // Strip lease bookkeeping and Firestore types → plain JSON
    if (!data) return data;
    var out = JSON.parse(JSON.stringify(data, function (k, v) {
      if (v && typeof v === "object" && typeof v.toDate === "function") return v.toDate().toISOString();
      return v;
    }));
    delete out._lease;
    return out;
  }

  function wrapDoc(snap) {
    var exists = snap.exists();
    var body = exists ? deepFreeze(clean(snap.data())) : undefined;
    return Object.freeze({
      id: snap.id,
      exists: exists,
      data: function () { return body; },
      metadata: Object.freeze({ fromCache: snap.metadata.fromCache, hasPendingWrites: snap.metadata.hasPendingWrites })
    });
  }

  function wrapQuery(qs) {
    var docs = qs.docs.map(wrapDoc);
    var changes = qs.docChanges().map(function (ch) {
      return { type: ch.type, doc: wrapDoc(ch.doc), oldIndex: ch.oldIndex, newIndex: ch.newIndex };
    });
    return {
      docs: docs, size: docs.length, empty: docs.length === 0,
      docChanges: function () { return changes; },
      metadata: { fromCache: qs.metadata.fromCache, hasPendingWrites: qs.metadata.hasPendingWrites }
    };
  }

  function checkBody(data) {
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw dbErr("invalid_argument", "Document body must be an object");
    var s = JSON.stringify(data);
    if (s.length > 1000000) throw dbErr("invalid_argument", "Document is too large");
    return JSON.parse(s); // drop undefined, functions etc.
  }

  function subscribe(makeRef, onNext, onErr, wrap) {
    var unsub = null, dead = false;
    ready.then(function (c) {
      if (dead) return;
      var r = makeRef(c);
      unsub = c.fs.onSnapshot(r, { includeMetadataChanges: true }, function (s) {
        if (!dead) onNext(wrap(s));
      }, function (e) {
        if (dead) return;
        dead = true;
        var m = mapErr(e);
        if (onErr) onErr(m); else if (window.reportError) window.reportError(m);
      });
    }, function () {
      if (!dead && onErr) { dead = true; onErr(dbErr("not_granted", "Not signed in")); }
    });
    return function () { dead = true; if (unsub) unsub(); };
  }

  function makeDocRef(segs) {
    if (segs.length % 2 !== 0) throw new TypeError("A document path needs an even number of segments (got " + segs.length + ")");
    var path = segs.join("/");
    function ref(c) { return c.fs.doc.apply(null, [c.db].concat(toFs(segs, c.user.uid))); }
    return {
      id: segs[segs.length - 1],
      path: path,
      get: function () {
        return ready.then(function (c) { return c.fs.getDoc(ref(c)); }).then(wrapDoc, function (e) {
          if (e && e.code === "permission-denied") {
            return { id: segs[segs.length - 1], exists: false, data: function () { return undefined; },
              metadata: { fromCache: false, hasPendingWrites: false } };
          }
          throw mapErr(e);
        });
      },
      set: function (data) {
        var body = checkBody(data);
        return ready.then(function (c) { return c.fs.setDoc(ref(c), body); }).catch(function (e) { throw mapErr(e); });
      },
      update: function (data) {
        var body = checkBody(data);
        return ready.then(function (c) {
          var r = ref(c);
          return c.fs.getDoc(r).then(function (s) {
            if (!s.exists()) throw dbErr("invalid_argument", "update() needs an existing document: " + path);
            return c.fs.setDoc(r, body, { merge: true });
          });
        }).catch(function (e) { throw mapErr(e); });
      },
      delete: function () {
        return ready.then(function (c) { return c.fs.deleteDoc(ref(c)); }).catch(function (e) { throw mapErr(e); });
      },
      acquire: function (opts) {
        opts = opts || {};
        var ttl = Math.min(600000, Math.max(1000, opts.ttlMs || 30000));
        return ready.then(function (c) {
          var r = ref(c);
          return c.fs.runTransaction(c.db, function (tx) {
            return tx.get(r).then(function (s) {
              var now = Date.now();
              var cur = s.exists() ? s.data()._lease : null;
              if (cur && cur.expiresAt > now && cur.holder !== opts.holder) {
                return { acquired: false, expiresAt: new Date(cur.expiresAt).toISOString() };
              }
              var exp = now + ttl;
              var patch = Object.assign({}, opts.data || {}, { _lease: { holder: String(opts.holder), expiresAt: exp } });
              tx.set(r, patch, { merge: true });
              return { acquired: true, version: exp, expiresAt: new Date(exp).toISOString(), holder: String(opts.holder) };
            });
          });
        }).catch(function (e) { throw mapErr(e); });
      },
      onSnapshot: function (next, error) { return subscribe(ref, next, error, wrapDoc); },
      collection: function (sub) { return makeCollRef(segs.concat(splitPath(sub))); }
    };
  }

  function makeQuery(segs, cons) {
    function ref(c) {
      var col = c.fs.collection.apply(null, [c.db].concat(toFs(segs, c.user.uid)));
      if (!cons.length) return col;
      return c.fs.query.apply(null, [col].concat(cons.map(function (k) {
        if (k[0] === "where") return c.fs.where(k[1], k[2], k[3]);
        if (k[0] === "orderBy") return c.fs.orderBy(k[1], k[2] || "asc");
        return c.fs.limit(k[1]);
      })));
    }
    return {
      where: function (f, op, v) { return makeQuery(segs, cons.concat([["where", f, op, v]])); },
      orderBy: function (f, dir) { return makeQuery(segs, cons.concat([["orderBy", f, dir]])); },
      limit: function (n) { return makeQuery(segs, cons.concat([["limit", n]])); },
      get: function () {
        return ready.then(function (c) { return c.fs.getDocs(ref(c)); }).then(wrapQuery, function (e) {
          if (e && e.code === "permission-denied") {
            return { docs: [], size: 0, empty: true, docChanges: function () { return []; },
              metadata: { fromCache: false, hasPendingWrites: false } };
          }
          throw mapErr(e);
        });
      },
      onSnapshot: function (next, error) { return subscribe(ref, next, error, wrapQuery); }
    };
  }

  function makeCollRef(segs) {
    if (segs.length % 2 !== 1) throw new TypeError("A collection path needs an odd number of segments (got " + segs.length + ")");
    var q = makeQuery(segs, []);
    q.path = segs.join("/");
    q.doc = function (id) { return makeDocRef(segs.concat(id == null ? [randId()] : splitPath(String(id)))); };
    q.add = function (data) { var d = q.doc(); return d.set(data).then(function () { return d; }); };
    return q;
  }

  var dbNs = Object.freeze({
    doc: function (p) { return makeDocRef(splitPath(p)); },
    collection: function (p) { return makeCollRef(splitPath(p)); }
  });

  // ── user ──
  var COLORS = ["#0A7A42", "#D2232A", "#1F6FB2", "#B26A00", "#7A3FB2", "#00808A", "#9C2E5B", "#4F6B12"];
  function colorFor(id) {
    var h = 0; id = String(id || "");
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return COLORS[h % COLORS.length];
  }
  function avatarFor(name, color) {
    var ini = (name || "?").trim().split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join("").toUpperCase() || "?";
    ini = ini.replace(/[<>&"']/g, "");
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="' +
      color + '"/><text x="32" y="41" font-family="Arial" font-size="26" font-weight="700" fill="#fff" text-anchor="middle">' +
      ini + "</text></svg>";
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
  var profCache = {};
  function profileOf(id, data, myId) {
    var name = (data && data.name) || "";
    var color = colorFor(id);
    return { id: id, name: name, avatarUrl: avatarFor(name, color), color: color,
      email: (data && data.email) || null, isMe: id === myId, guest: false };
  }
  function role() { return (ctx && ctx.member && ctx.member.role) || "sm"; }

  var userNs = Object.freeze({
    isOwner: function () { return ready.then(function () { return role() === "admin"; }, function () { return false; }); },
    canEdit: function () { return ready.then(function () { return role() === "admin"; }, function () { return false; }); },
    can: function (name) {
      return ready.then(function () {
        var r = role();
        if (name === "data.write") return ["admin", "hq", "support", "rom"].indexOf(r) >= 0;
        if (name === "files.write" || name === "assets.write") return r === "admin";
        return false;
      }, function () { return null; });
    },
    me: function () {
      return ready.then(function (c) {
        var id = c.user.uid, name = c.member.name || c.user.email, color = colorFor(id);
        return { id: id, name: name, avatarUrl: avatarFor(name, color), color: color,
          email: (c.user.email || "").toLowerCase(), isOwner: role() === "admin", canEdit: role() === "admin" };
      }, function () {
        return { id: null, name: "", avatarUrl: avatarFor("?", "#5A6B62"), color: "#5A6B62", email: null, isOwner: false, canEdit: false };
      });
    },
    id: function () { return ready.then(function (c) { return c.user.uid; }, function () { return null; }); },
    name: function () { return ready.then(function (c) { return c.member.name || c.user.email || ""; }, function () { return ""; }); },
    email: function () { return ready.then(function (c) { return (c.user.email || "").toLowerCase(); }, function () { return null; }); },
    avatarUrl: function () { return userNs.me().then(function (m) { return m.id ? m.avatarUrl : null; }); },
    profiles: function (ids) {
      if (typeof ids === "string") ids = [ids];
      ids = Array.from(new Set(ids || []));
      return ready.then(function (c) {
        return Promise.all(ids.map(function (id) {
          if (profCache[id]) return profCache[id];
          if (typeof id !== "string" || !SEG_RE.test(id)) return Promise.resolve(profileOf(id, null, c.user.uid));
          profCache[id] = c.fs.getDoc(c.fs.doc(c.db, "profiles", id)).then(function (s) {
            return profileOf(id, s.exists() ? s.data() : null, c.user.uid);
          }, function () { delete profCache[id]; return profileOf(id, null, c.user.uid); });
          return profCache[id];
        }));
      }, function () { return ids.map(function (id) { return profileOf(id, null, null); }); })
        .then(function (list) { var o = {}; list.forEach(function (p) { o[p.id] = p; }); return o; });
    },
    search: function (q) {
      q = String(q || "").toLowerCase().trim();
      return ready.then(function (c) {
        return c.fs.getDocs(c.fs.collection(c.db, "profiles")).then(function (qs) {
          var hits = [];
          qs.forEach(function (s) {
            var d = s.data();
            if (!d.name) return;
            if (!q || d.name.toLowerCase().indexOf(q) >= 0 || (d.email || "").indexOf(q) >= 0)
              hits.push(profileOf(s.id, d, c.user.uid));
          });
          return hits.slice(0, 8);
        });
      }).catch(function () { return []; });
    }
  });

  // ── downloads ──
  var downloadsNs = Object.freeze({
    save: function (o) {
      return new Promise(function (res, rej) {
        try {
          var blob = o.data instanceof Blob ? o.data : new Blob([o.data], { type: o.type || o.mimeType || "application/octet-stream" });
          var url = URL.createObjectURL(blob);
          var a = document.createElement("a");
          a.href = url; a.download = o.filename || "download";
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
          res({ saved: true });
        } catch (e) { rej({ code: "unavailable", message: String(e) }); }
      });
    }
  });

  // ── permissions (everything here is granted by the login itself) ──
  var permissionsNs = Object.freeze({
    state: function (n) { return Promise.resolve(typeof n === "string" ? "granted" : {}); },
    request: function (n) { return Promise.resolve(typeof n === "string" ? "granted" : {}); },
    manage: function () { return Promise.reject({ code: "unavailable", message: "No permissions panel on this site" }); }
  });

  var NS = { db: dbNs, user: userNs, downloads: downloadsNs, permissions: permissionsNs };

  window.claude = Object.freeze({
    use: function (name) {
      if (!NS[name]) return Promise.resolve(null); // room, sample, mcp, comments… aren't available off claude.ai
      if (name === "permissions" || name === "downloads") return Promise.resolve(NS[name]);
      return ready.then(function () { return NS[name]; }, function () { return null; });
    }
  });

  // ── Older claude.ai artifact storage: window.storage.get/set/delete/list ──
  function kvRef(c, key, shared) {
    var k = encodeURIComponent(String(key)).replace(/\./g, "%2E");
    return shared
      ? c.fs.doc(c.db, "apps", TOOL, "_kv", k)
      : c.fs.doc(c.db, "private", c.user.uid, "tools", TOOL, "_kv", k);
  }
  function kvCol(c, shared) {
    return shared
      ? c.fs.collection(c.db, "apps", TOOL, "_kv")
      : c.fs.collection(c.db, "private", c.user.uid, "tools", TOOL, "_kv");
  }
  window.storage = Object.freeze({
    get: function (key, shared) {
      shared = !!shared;
      return ready.then(function (c) { return c.fs.getDoc(kvRef(c, key, shared)); }).then(function (s) {
        if (!s.exists()) return null;
        return { key: key, value: s.data().value, shared: shared };
      });
    },
    set: function (key, value, shared) {
      shared = !!shared;
      var v = typeof value === "string" ? value : JSON.stringify(value);
      return ready.then(function (c) {
        return c.fs.setDoc(kvRef(c, key, shared), { key: String(key), value: v, updatedAt: Date.now() });
      }).then(function () { return { key: key, value: v, shared: shared }; }, function (e) {
        console.warn("[SPAR] storage.set failed", e); return null;
      });
    },
    delete: function (key, shared) {
      shared = !!shared;
      return ready.then(function (c) { return c.fs.deleteDoc(kvRef(c, key, shared)); })
        .then(function () { return { key: key, deleted: true, shared: shared }; }, function () { return null; });
    },
    list: function (prefix, shared) {
      shared = !!shared; prefix = prefix || "";
      return ready.then(function (c) { return c.fs.getDocs(kvCol(c, shared)); }).then(function (qs) {
        var keys = [];
        qs.forEach(function (s) { var k = s.data().key; if (k != null && String(k).indexOf(prefix) === 0) keys.push(k); });
        return { keys: keys.sort(), prefix: prefix, shared: shared };
      }, function () { return { keys: [], prefix: prefix, shared: shared }; });
    }
  });

  // For the hub and admin pages.
  var readyPub = ready.then(publicCtx);
  readyPub.catch(function () {});
  window.SPAR = Object.freeze({
    base: BASE,
    tool: TOOL,
    ready: readyPub,
    firebase: function () { return ready; } // raw handles, admin page only
  });

  boot();
})();
