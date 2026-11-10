/**
 * SPAR Malta Hub — DAP email sender (Google Apps Script)
 *
 * Every 10 minutes this checks the hub for DAP tasks that have just gone out
 * (the 3pm DAP, or an urgent task) and emails them as ONE message.
 * Each task is then marked as emailed, so nothing is sent twice.
 *
 * Set up once (see DAP_EMAIL_SETUP.md):
 *   1. Fill in the SETTINGS below.
 *   2. Run  setup  (authorise when asked). It creates the 10-minute timer.
 *   3. Run  sendTestEmail  to get a preview of the latest DAP in your own inbox.
 */

// ═══════════ SETTINGS ═══════════
var SETTINGS = {
  PROJECT_ID: 'spar-rom-hub',
  // Firebase web API key (from the hub's firebase-config.js) — used to check who is uploading
  FIREBASE_API_KEY: 'AIzaSyAJGn2Q8-5-BqS80BRgheNUbc-ingJZSRQ',
  // Google Drive folder (in this account) where store photos and files are saved
  UPLOAD_FOLDER: 'SPAR DAP uploads',
  HUB_URL: 'https://spar-malta-rom-hub.github.io/spar-hub/dap.html',

  // Who receives the DAP from this script.
  // Sending from your SPAR address: put ONLY 'pkelly@spar.com.mt' here, and your
  // Outlook flow (Power Automate) re-sends it from that address to the stores.
  // Several addresses: separate with commas. Leave '' to build the list from the
  // hub's store list (store emails + store managers).
  TO: 'pkelly@spar.com.mt',
  // Also include ROMs (from the store list) when TO is built automatically?
  INCLUDE_ROMS: true,
  // Extra people to copy in (comma separated), e.g. 'ops@spar.com.mt'
  CC: '',
  // Where replies go
  REPLY_TO: '',
  SENDER_NAME: 'SPAR Malta Head Office — DAP',
  // Outlook feed: always add these people to every DAP email (comma separated),
  // e.g. Head Office or department heads. Everyone else comes from the hub.
  FEED_ALWAYS_BCC: '',
  // Compiled answer sheets are emailed to the requester and copied to:
  COMPILED_CC: 'salessupport@spar.com.mt',
  // Email the Store Manager and ROM when a store misses a DAP deadline
  REMINDERS: true,
  // Send the preview (sendTestEmail) to this address. '' = you.
  TEST_TO: 'pkelly@spar.com.mt'
};
// ════════════════════════════════

var BASE = 'https://firestore.googleapis.com/v1/projects/' + SETTINGS.PROJECT_ID + '/databases/(default)/documents';

/** Run once: creates the 10-minute check. Running it again replaces the old timer. */
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkAndSend') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkAndSend').timeBased().everyMinutes(10).create();
  Logger.log('Timer created: the DAP will be checked every 10 minutes.');
  Logger.log('Mail you can still send today: ' + MailApp.getRemainingDailyQuota() + ' recipients.');
}

/** Run to stop the emails. */
function stop() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  Logger.log('Timer removed. No more DAP emails will be sent.');
}

/** Called by the timer. */
function checkAndSend() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var now = Date.now();
    var pending = runQuery_({
      from: [{ collectionId: 'items' }],
      where: { fieldFilter: { field: { fieldPath: 'emailed' }, op: 'EQUAL', value: { booleanValue: false } } }
    }).filter(function (t) { return t.releaseAt && t.releaseAt <= now; });
    if (!pending.length) return;

    var stores = getStores_();
    var byDate = {};
    pending.forEach(function (t) { (byDate[t.dapDate] = byDate[t.dapDate] || []).push(t); });
    Object.keys(byDate).sort().forEach(function (date) {
      var tasks = byDate[date];
      var recipients = recipients_(tasks, stores);
      if (!recipients.to) { Logger.log('No recipients found. Set SETTINGS.TO.'); return; }
      sendMail_(recipients, date, tasks, stores, false);
      tasks.forEach(function (t) { markEmailed_(t._name); });
      Logger.log('Emailed DAP ' + date + ' (' + tasks.length + ' tasks) to ' + recipients.count + ' recipients.');
    });
  } finally {
    lock.releaseLock();
  }
}

/** Sends you a preview of the most recent DAP, without marking anything as emailed. */
function sendTestEmail() {
  var tasks = runQuery_({
    from: [{ collectionId: 'items' }],
    orderBy: [{ field: { fieldPath: 'releaseAt' }, direction: 'DESCENDING' }],
    limit: 50
  });
  if (!tasks.length) { Logger.log('No DAP tasks in the hub yet. Add one, then run this again.'); return; }
  var date = tasks[0].dapDate;
  tasks = tasks.filter(function (t) { return t.dapDate === date; });
  var to = SETTINGS.TEST_TO || Session.getActiveUser().getEmail();
  var stores = getStores_();
  sendMail_({ to: to, cc: '', count: 1 }, date, tasks, stores, true);
  Logger.log('Preview of DAP ' + date + ' sent to ' + to + '. Recipients the real email would go to: ' + recipients_(tasks, stores).to);
}

// ───────── helpers ─────────

function recipients_(tasks, stores) {
  if (SETTINGS.TO) return { to: SETTINGS.TO, cc: SETTINGS.CC, count: SETTINGS.TO.split(',').length + (SETTINGS.CC ? SETTINGS.CC.split(',').length : 0) };
  var codes = {};
  tasks.forEach(function (t) { (t.stores || []).forEach(function (c) { codes[c] = true; }); });
  var set = {};
  Object.keys(codes).forEach(function (c) {
    var s = stores[c]; if (!s) return;
    String(s.storeEmail || '').split(/[,;\s]+/).forEach(function (e) { if (/@/.test(e)) set[e.toLowerCase()] = true; });
    if (s.smEmail) set[String(s.smEmail).toLowerCase()] = true;
    if (SETTINGS.INCLUDE_ROMS && s.romEmail) set[String(s.romEmail).toLowerCase()] = true;
  });
  var list = Object.keys(set);
  // Everyone goes in BCC so stores don't see each other's addresses.
  return { to: Session.getEffectiveUser().getEmail(), bcc: list.join(','), cc: SETTINGS.CC, count: list.length + 1 };
}

function sendMail_(rcpt, date, tasks, stores, isTest) {
  var m = buildDap_(date, tasks, stores, isTest);
  var opts = { name: SETTINGS.SENDER_NAME, htmlBody: m.html };
  if (rcpt.cc) opts.cc = rcpt.cc;
  if (rcpt.bcc) opts.bcc = rcpt.bcc;
  if (SETTINGS.REPLY_TO) opts.replyTo = SETTINGS.REPLY_TO;
  MailApp.sendEmail(rcpt.to, m.subject, m.text, opts);
}

/** Builds the subject, HTML and plain text of one DAP message. */
function buildDap_(date, tasks, stores, isTest) {
  tasks.sort(function (a, b) {
    return (b.priority === 'urgent') - (a.priority === 'urgent') || a.releaseAt - b.releaseAt || String(a.title).localeCompare(String(b.title));
  });
  var allStores = Object.keys(stores).filter(function (c) { return stores[c].active !== false; }).length;
  var onlyUrgent = tasks.every(function (t) { return t.priority === 'urgent'; });
  var due = Math.max.apply(null, tasks.map(function (t) { return t.dueAt || 0; }));
  var dayTxt = Utilities.formatDate(new Date(date + 'T12:00:00'), 'Europe/Malta', 'EEE d MMM');
  var dueTxt = Utilities.formatDate(new Date(due), 'Europe/Malta', 'EEE d MMM, HH:mm');
  // Real emails always start "SPAR DAP" (your Outlook flow looks for that); previews never contain it.
  var subject = (isTest ? 'PREVIEW – Daily Action Points' : 'SPAR DAP') + (onlyUrgent ? ' · URGENT' : '') + ' · ' + dayTxt +
    ' · ' + tasks.length + ' task' + (tasks.length === 1 ? '' : 's');

  var rows = tasks.map(function (t, i) {
    var who = (t.stores || []).length >= allStores ? 'All stores'
      : (t.stores || []).map(function (c) { return stores[c] ? stores[c].name : c; }).join(', ');
    var links = (t.links || []).map(function (l) {
      return '<a href="' + esc_(l.url) + '" style="display:inline-block;margin:4px 6px 0 0;padding:5px 9px;border-radius:7px;background:#EEF4FB;color:#0B4F8A;font-weight:bold;text-decoration:none;border:1px solid #D6E4F2">📎 ' + esc_(l.label || 'Open document') + '</a>';
    }).join('');
    return '<tr>' +
      '<td style="padding:12px 10px;border-bottom:1px solid #E9EBEA;vertical-align:top;font-weight:bold;color:#60727a">' + (i + 1) + '</td>' +
      '<td style="padding:12px 10px;border-bottom:1px solid #E9EBEA;vertical-align:top">' +
        '<div style="font-weight:bold;font-size:15px">' + esc_(t.title) +
          (t.priority === 'urgent' ? ' <span style="background:#F9E3E3;color:#C5121A;border-radius:99px;padding:2px 8px;font-size:12px">URGENT</span>' : '') + '</div>' +
        (t.details ? '<div style="margin-top:5px;white-space:pre-wrap;line-height:1.45">' + esc_(t.details) + '</div>' : '') +
        (links ? '<div style="margin-top:6px">' + links + '</div>' : '') +
        (t.resp && t.resp.type && t.resp.type !== 'none' ? '<div style="margin-top:6px;font-weight:bold;color:#C5121A">➡ ' +
          esc_(({ number: 'Send back a number', text: 'Send back an answer', photo: 'Send back photo(s)', file: 'Send back a file', form: 'Fill in' }[t.resp.type] || 'Reply') +
          (t.resp.label ? ': ' + t.resp.label : '')) + ' (in the SPAR Hub)</div>' : '') +
        (t.dueCustom ? '<div style="margin-top:4px;font-weight:bold">⏰ By ' + esc_(Utilities.formatDate(new Date(t.dueAt), 'Europe/Malta', 'EEE d MMM, HH:mm')) + '</div>' : '') +
        '<div style="margin-top:6px;color:#60727a;font-size:12px">' + (t.dept ? 'From ' + esc_(t.dept) + ' · ' : '') + 'To: ' + esc_(who) + '</div>' +
      '</td></tr>';
  }).join('');

  var html =
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#10252b;max-width:720px">' +
    '<div style="border-bottom:5px solid #EC1B24;padding:10px 0 8px;font-size:22px;font-weight:bold">' +
      '<span style="color:#EC1B24">SPAR</span> Daily Action Points · ' + esc_(dayTxt) + '</div>' +
    '<p style="font-size:15px;margin:14px 0">Please complete the following and <b>sign off in the SPAR Hub by ' + esc_(dueTxt) + '</b>.</p>' +
    '<table style="border-collapse:collapse;width:100%;font-size:14px">' + rows + '</table>' +
    '<p style="margin:20px 0"><a href="' + esc_(SETTINGS.HUB_URL) + '" style="background:#EC1B24;color:#fff;padding:12px 18px;border-radius:9px;font-weight:bold;text-decoration:none;display:inline-block">Open the DAP to tick off and sign off</a></p>' +
    '<p style="color:#60727a;font-size:12px">Sent automatically by the SPAR Malta Hub.</p></div>';

  var text = 'SPAR DAP · ' + dayTxt + '\nSign off in the SPAR Hub by ' + dueTxt + '\n\n' +
    tasks.map(function (t, i) {
      return (i + 1) + '. ' + t.title + (t.priority === 'urgent' ? ' (URGENT)' : '') + (t.details ? '\n' + t.details : '') +
        (t.links || []).map(function (l) { return '\n  ' + l.label + ': ' + l.url; }).join('');
    }).join('\n\n') + '\n\nOpen the DAP: ' + SETTINGS.HUB_URL;

  return { subject: subject, html: html, text: text };
}

// ═══════════ OUTLOOK FEED (no email needed) ═══════════
// Your Outlook (Power Automate) reads this feed and sends the DAP from your own
// SPAR address. Nothing is emailed into SPAR from outside, so no filters get in the way.
// Each release (the 3pm DAP, or an urgent task) is one item in the feed.

/** Run once after deploying as a Web app: prints the link to paste into Power Automate. */
function showFeedLink() {
  var url = ScriptApp.getService().getUrl();
  if (!url) { Logger.log('Deploy first: Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).'); return; }
  Logger.log('Paste this into Power Automate (RSS → When a feed item is published):');
  Logger.log(url + '?key=' + feedKey_());
}

/** Makes a new secret key: run this if the link has been shared with someone it shouldn't. */
function newFeedKey() {
  PropertiesService.getScriptProperties().deleteProperty('FEED_KEY');
  showFeedLink();
}

function feedKey_() {
  var props = PropertiesService.getScriptProperties();
  var k = props.getProperty('FEED_KEY');
  if (!k) { k = Utilities.getUuid().replace(/-/g, ''); props.setProperty('FEED_KEY', k); }
  return k;
}

/** Everyone who should get a DAP for these stores, taken live from the hub:
 *  store emails, store managers and ROMs from the store list, plus any hub user
 *  (ROM or Store Manager) who has one of those stores. */
function feedRecipients_(tasks, stores, members) {
  var codes = {};
  tasks.forEach(function (t) { (t.stores || []).forEach(function (c) { codes[c] = true; }); });
  var set = {};
  function add(e) { e = String(e || '').trim().toLowerCase(); if (/^[^@\s;,]+@[^@\s;,]+\.[^@\s;,]+$/.test(e)) set[e] = true; }
  Object.keys(codes).forEach(function (c) {
    var s = stores[c]; if (!s || s.active === false) return;
    String(s.storeEmail || '').split(/[,;\s]+/).forEach(add);
    add(s.smEmail); add(s.romEmail);
  });
  (members || getMembers_()).forEach(function (m) {
    if ((m.role === 'rom' || m.role === 'sm') && (m.stores || []).some(function (c) { return codes[c]; })) add(m.email);
  });
  String(SETTINGS.FEED_ALWAYS_BCC || '').split(/[,;\s]+/).forEach(add);
  return Object.keys(set).sort();
}

function getMembers_() {
  var out = [], token = '';
  do {
    var res = fetch_('GET', BASE + '/members?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : ''));
    (res.documents || []).forEach(function (d) {
      var m = fromFields_(d.fields || {}); m.email = decodeURIComponent(d.name.split('/').pop()); out.push(m);
    });
    token = res.nextPageToken || '';
  } while (token);
  return out;
}

/** Lists who the next DAP email would go to (run it to check after changing people or stores). */
function showRecipients() {
  var stores = getStores_();
  var all = Object.keys(stores).filter(function (c) { return stores[c].active !== false; }).map(function (c) { return { stores: [c] }; });
  var list = feedRecipients_(all, stores);
  Logger.log(list.length + ' people would get a DAP sent to all stores:');
  Logger.log(list.join('; '));
}

/** The feed itself (called by Power Automate). Three kinds of item:
 *  1. the DAP itself (each 3pm release, or an urgent task) → stores, SMs and ROMs
 *  2. a compiled answer sheet, once every store has done a task (or its deadline passes) → requester + Sales Support
 *  3. an overdue reminder for a store that missed a deadline → that store's SM and ROM */
function doGet(e) {
  if (!e || !e.parameter || e.parameter.key !== feedKey_()) {
    return ContentService.createTextOutput('Not allowed').setMimeType(ContentService.MimeType.TEXT);
  }
  var lock = LockService.getScriptLock();
  lock.tryLock(20000);
  try {
    var now = Date.now(), since3 = now - 3 * 864e5, since10 = now - 10 * 864e5;
    var tasks = runQuery_({
      from: [{ collectionId: 'items' }],
      where: { fieldFilter: { field: { fieldPath: 'releaseAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { integerValue: String(since10) } } },
      orderBy: [{ field: { fieldPath: 'releaseAt' }, direction: 'DESCENDING' }],
      limit: 500
    }).filter(function (t) { return t.releaseAt <= now; });
    var stores = tasks.length ? getStores_() : {};
    var members = tasks.length ? getMembers_() : [];
    tasks.forEach(function (t) { t._id = t._name.split('/').pop(); });
    var items = [];

    // 1. DAP releases (last 3 days)
    var byRel = {};
    tasks.filter(function (t) { return t.releaseAt >= since3; }).forEach(function (t) { (byRel[t.releaseAt] = byRel[t.releaseAt] || []).push(t); });
    Object.keys(byRel).forEach(function (rel) {
      var list = byRel[rel], m = buildDap_(list[0].dapDate, list, stores, false);
      items.push({ at: Number(rel), guid: 'spar-dap-' + rel, title: m.subject, html: m.html, rcpt: feedRecipients_(list, stores, members) });
    });
    tasks.filter(function (t) { return !t.emailed && t.releaseAt >= since3; }).forEach(function (t) { try { markEmailed_(t._name); } catch (err) {} });

    // Each store's copy of every task that is still being worked on or needs compiling
    var live = tasks.filter(function (t) { return (t.compileTo && !t.compiledAt) || t.dueAt >= since3; });
    var copies = getCopies_(live);

    // 2. Compiled answer sheets
    tasks.forEach(function (t) {
      if (!t.compileTo) return;
      if (!t.compiledAt) {
        var mine = copies[t._id] || {};
        var codes = t.stores || [];
        var allDone = codes.length && codes.every(function (c) { return mine[c] && mine[c].status === 'done'; });
        if (!allDone && !(t.dueAt && t.dueAt < now)) return;   // wait for every store, or the deadline
        try {
          var out = buildCompiled_(t, mine, stores);
          t.compiledAt = now; t.compiledUrl = out.url; t.compiledXlsx = out.xlsx; t.compiledDone = out.done; t.compiledOf = codes.length;
          patch_(t._name, { compiledAt: { integerValue: String(now) }, compiledUrl: { stringValue: out.url },
            compiledXlsx: { stringValue: out.xlsx }, compiledDone: { integerValue: String(out.done) }, compiledOf: { integerValue: String(codes.length) } });
        } catch (err) { Logger.log('Compile failed for ' + t.title + ': ' + err); return; }
      }
      if (t.compiledAt < since3) return;
      var rc = splitEmails_(t.compileTo).concat(splitEmails_(SETTINGS.COMPILED_CC));
      items.push({ at: t.compiledAt, guid: 'spar-compiled-' + t._id, title: compiledSubject_(t), html: compiledHtml_(t), rcpt: uniq_(rc) });
    });

    // 3. Overdue reminders: one per store per deadline, to that store's SM and ROM
    if (SETTINGS.REMINDERS) {
      var seen = JSON.parse(PropertiesService.getScriptProperties().getProperty('REMINDERS_SEEN') || '{}');
      var groups = {};
      tasks.forEach(function (t) {
        if (!t.dueAt || t.dueAt >= now || t.dueAt < since3) return;
        var mine = copies[t._id] || {};
        (t.stores || []).forEach(function (c) {
          var p = mine[c];
          if (!p || p.status === 'done') return;
          var key = c + '-' + t.dueAt;
          (groups[key] = groups[key] || { code: c, due: t.dueAt, tasks: [] }).tasks.push(t);
        });
      });
      Object.keys(groups).forEach(function (key) {
        var g = groups[key], st = stores[g.code] || { name: g.code };
        if (st.active === false) return;
        if (!seen[key]) seen[key] = now;
        items.push({ at: seen[key], guid: 'spar-reminder-' + key,
          title: 'SPAR DAP · OVERDUE · ' + st.name + ' · ' + g.tasks.length + ' task' + (g.tasks.length === 1 ? '' : 's'),
          html: reminderHtml_(st, g), rcpt: managersOf_(g.code, stores, members) });
      });
      Object.keys(seen).forEach(function (k) { if (seen[k] < since10) delete seen[k]; });
      PropertiesService.getScriptProperties().setProperty('REMINDERS_SEEN', JSON.stringify(seen));
    }
  } finally {
    try { lock.releaseLock(); } catch (err) {}
  }

  items.sort(function (a, b) { return b.at - a.at; });
  var xml = '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>' +
    '<title>SPAR Malta DAP</title><link>' + esc_(SETTINGS.HUB_URL) + '</link>' +
    '<description>Daily Action Points released by the SPAR Malta Hub</description>' +
    items.filter(function (it) { return it.rcpt.length; }).map(function (it) {
      return '<item><title>' + esc_(it.title) + '</title><link>' + esc_(SETTINGS.HUB_URL) + '</link>' +
        '<guid isPermaLink="false">' + it.guid + '</guid><pubDate>' + new Date(Number(it.at)).toUTCString() + '</pubDate>' +
        // The recipient list rides at the very end between ##RCPT: and ##END; the flow splits it off before sending.
        '<description><![CDATA[' + (it.html + '##RCPT:' + it.rcpt.join(';') + '##END').replace(/]]>/g, ']]&gt;') + ']]></description></item>';
    }).join('') + '</channel></rss>';
  return ContentService.createTextOutput(xml).setMimeType(ContentService.MimeType.RSS);
}

// ── helpers for the feed ──
function splitEmails_(s) {
  return String(s || '').split(/[,;\s]+/).map(function (e) { return e.trim().toLowerCase(); })
    .filter(function (e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); });
}
function uniq_(a) { var o = {}; a.forEach(function (x) { o[x] = true; }); return Object.keys(o); }

/** Store Manager + ROM for one store (store list + hub users with that store). */
function managersOf_(code, stores, members) {
  var s = stores[code] || {}, out = splitEmails_(s.smEmail).concat(splitEmails_(s.romEmail));
  (members || []).forEach(function (m) {
    if ((m.role === 'sm' || m.role === 'rom') && (m.stores || []).indexOf(code) >= 0) out = out.concat(splitEmails_(m.email));
  });
  return uniq_(out);
}

/** Reads every store's copy of these tasks in one go: { taskId: { storeCode: copy } } */
function getCopies_(tasks) {
  var names = [], out = {};
  var root = 'projects/' + SETTINGS.PROJECT_ID + '/databases/(default)/documents';
  tasks.forEach(function (t) {
    t._id = t._name.split('/').pop();
    out[t._id] = {};
    (t.stores || []).forEach(function (c) { names.push(root + '/modules/dap/stores/' + c + '/posts/' + t._id); });
  });
  for (var i = 0; i < names.length; i += 200) {
    var res = fetch_('POST', BASE + ':batchGet', { documents: names.slice(i, i + 200) }) || [];
    res.forEach(function (r) {
      if (!r.found) return;
      var parts = r.found.name.split('/'), id = parts.pop(); parts.pop(); var code = parts.pop();
      if (out[id]) out[id][code] = fromFields_(r.found.fields || {});
    });
  }
  tasks.forEach(function (t) { if (!t._id) t._id = t._name.split('/').pop(); });
  return out;
}

function patch_(name, fields) {
  var mask = Object.keys(fields).map(function (k) { return 'updateMask.fieldPaths=' + k; }).join('&');
  fetch_('PATCH', 'https://firestore.googleapis.com/v1/' + name + '?' + mask + '&currentDocument.exists=true', { fields: fields });
}

/** Builds the compiled sheet (a Google Sheet in the uploads folder, shared by link) and returns its links. */
function buildCompiled_(t, mine, stores) {
  var fields = (t.resp && t.resp.fields) || [];
  var sheet = (t.resp && t.resp.sheet) || { name: t.title, codeHeader: 'Store', codes: [] };
  var codes = (sheet.codes || []).filter(function (c) { return (t.stores || []).indexOf(c) >= 0; });
  (t.stores || []).slice().sort().forEach(function (c) { if (codes.indexOf(c) < 0) codes.push(c); });
  var isForm = t.resp && t.resp.type === 'form';
  var hasAns = isForm || (t.resp && (t.resp.type === 'number' || t.resp.type === 'text'));
  var head = [sheet.codeHeader || 'Store'].concat(isForm ? fields.map(function (f) { return f.label; }) : hasAns ? [(t.resp && t.resp.label) || 'Answer'] : [],
    (t.resp && (t.resp.type === 'photo' || t.resp.type === 'file')) ? ['Photos / files'] : [], ['Store name', 'Done by', 'Completed', 'Note']);
  var rows = [head], done = 0;
  codes.forEach(function (c) {
    var p = mine[c], a = (p && p.answers) || {};
    if (p && p.status === 'done') done++;
    var vals = isForm ? fields.map(function (f, i) { return a[i] != null ? a[i] : ''; }) : hasAns ? [p && p.answer != null ? p.answer : ''] : [];
    var files = (t.resp && (t.resp.type === 'photo' || t.resp.type === 'file')) ? [((p && p.files) || []).map(function (f) { return f.url; }).join('\n')] : [];
    rows.push([c].concat(vals, files, [(stores[c] || {}).name || '', p && p.status === 'done' ? (p.doneByName || p.ackName || '') : 'NOT DONE',
      p && p.status === 'done' && p.ackAt ? Utilities.formatDate(new Date(p.ackAt), 'Europe/Malta', 'dd/MM/yyyy HH:mm') : '', (p && p.note) || '']));
  });
  var folder = sub_(sub_(rootFolder_(), t.dapDate), 'Compiled sheets');
  var ss = SpreadsheetApp.create((sheet.name || t.title) + ' - compiled ' + t.dapDate);
  var sh = ss.getSheets()[0];
  sh.setName('Compiled');
  sh.getRange(1, 1, rows.length, head.length).setValues(rows.map(function (r) { return r.map(function (v) { return v == null ? '' : v; }); }));
  sh.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#F1F2F2');
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, head.length);
  var file = DriveApp.getFileById(ss.getId());
  file.moveTo(folder);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { url: ss.getUrl(), xlsx: 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx', done: done };
}

function compiledSubject_(t) {
  var complete = t.compiledDone >= t.compiledOf;
  return 'SPAR DAP · COMPILED · ' + ((t.resp && t.resp.sheet && t.resp.sheet.name) || t.title) + ' · ' +
    (complete ? 'all ' + t.compiledOf + ' stores' : t.compiledDone + ' of ' + t.compiledOf + ' stores (deadline passed)');
}
function compiledHtml_(t) {
  var complete = t.compiledDone >= t.compiledOf;
  var btn = 'display:inline-block;margin:0 8px 8px 0;padding:12px 18px;border-radius:9px;font-weight:bold;text-decoration:none;';
  return '<div style="font-family:Arial,Helvetica,sans-serif;color:#10252b;max-width:720px">' +
    '<div style="border-bottom:5px solid #EC1B24;padding:10px 0 8px;font-size:22px;font-weight:bold"><span style="color:#EC1B24">SPAR</span> DAP · Compiled answers</div>' +
    '<p style="font-size:15px;margin:14px 0">Hello,</p>' +
    '<p style="font-size:15px;margin:0 0 14px">Here are the stores\' answers for <b>' + esc_(t.title) + '</b> (DAP ' +
      esc_(Utilities.formatDate(new Date(t.dapDate + 'T12:00:00'), 'Europe/Malta', 'EEE d MMM')) + ', requested by ' + esc_(t.dept || 'Head Office') + ').</p>' +
    '<p style="font-size:15px;margin:0 0 16px">' + (complete
      ? '✅ <b>All ' + t.compiledOf + ' stores</b> have completed it.'
      : '⚠️ The deadline has passed: <b>' + t.compiledDone + ' of ' + t.compiledOf + '</b> stores completed it. Stores still missing are marked <b>NOT DONE</b>.') + '</p>' +
    '<p><a href="' + esc_(t.compiledXlsx) + '" style="' + btn + 'background:#EC1B24;color:#fff">Download the compiled sheet (Excel)</a>' +
    '<a href="' + esc_(t.compiledUrl) + '" style="' + btn + 'background:#EEF0EF;color:#10252b">Open in Google Sheets</a></p>' +
    '<p style="color:#60727a;font-size:12px">Sent automatically by the SPAR Malta Hub.</p></div>';
}
function reminderHtml_(st, g) {
  var rows = g.tasks.map(function (t, i) {
    return '<tr><td style="padding:10px;border-bottom:1px solid #E9EBEA;font-weight:bold;color:#60727a;vertical-align:top">' + (i + 1) + '</td>' +
      '<td style="padding:10px;border-bottom:1px solid #E9EBEA"><b>' + esc_(t.title) + '</b>' +
      '<div style="color:#60727a;font-size:12px;margin-top:4px">' + (t.dept ? 'From ' + esc_(t.dept) + ' · ' : '') + 'DAP ' +
      esc_(Utilities.formatDate(new Date(t.dapDate + 'T12:00:00'), 'Europe/Malta', 'EEE d MMM')) + '</div></td></tr>';
  }).join('');
  return '<div style="font-family:Arial,Helvetica,sans-serif;color:#10252b;max-width:720px">' +
    '<div style="border-bottom:5px solid #EC1B24;padding:10px 0 8px;font-size:22px;font-weight:bold"><span style="color:#EC1B24">SPAR</span> DAP · Overdue reminder</div>' +
    '<p style="font-size:15px;margin:14px 0"><b>' + esc_(st.name) + '</b> has not completed the following DAP task' + (g.tasks.length === 1 ? '' : 's') +
    ', due <b>' + esc_(Utilities.formatDate(new Date(g.due), 'Europe/Malta', 'EEE d MMM, HH:mm')) + '</b>:</p>' +
    '<table style="border-collapse:collapse;width:100%;font-size:14px">' + rows + '</table>' +
    '<p style="margin:20px 0"><a href="' + esc_(SETTINGS.HUB_URL) + '" style="background:#EC1B24;color:#fff;padding:12px 18px;border-radius:9px;font-weight:bold;text-decoration:none;display:inline-block">Open the DAP and complete it</a></p>' +
    '<p style="color:#60727a;font-size:12px">Sent automatically by the SPAR Malta Hub to the Store Manager and ROM.</p></div>';
}

// ═══════════ UPLOADS (store photos & files → Google Drive) ═══════════

/** Run once after adding uploads: asks for Google Drive permission and creates the folder. */
function setupUploads() {
  var f = rootFolder_();
  Logger.log('Uploads folder ready: ' + f.getUrl());
}

/** Called by the hub when a store uploads a photo or file. */
function doPost(e) {
  function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (req.action !== 'upload') return out({ ok: false, error: 'Unknown request' });
    var email = whoIs_(req.idToken);
    var m = getMember_(email);
    if (!m) throw new Error('Your login (' + email + ") isn't on the SPAR Hub access list");
    var seesAll = ['admin', 'hq', 'support'].indexOf(m.role) >= 0;
    if (!seesAll && (m.stores || []).indexOf(req.store) < 0) throw new Error("You don't have access to store " + req.store);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.dapDate || ''))) throw new Error('Missing DAP date');
    var bytes = Utilities.base64Decode(String(req.data || ''));
    if (!bytes.length) throw new Error('The file is empty');
    if (bytes.length > 20 * 1024 * 1024) throw new Error('The file is too big (max 20 MB)');
    var mime = String(req.mime || 'application/octet-stream');
    var name = String(req.filename || 'upload').replace(/[\\\/:*?"<>|]+/g, '_').slice(0, 80);
    var title = String(req.title || '').replace(/[\\\/:*?"<>|]+/g, '_').slice(0, 40);
    var folder = sub_(sub_(rootFolder_(), req.dapDate), String(req.store) + (req.storeName ? ' - ' + String(req.storeName).slice(0, 40) : ''));
    var stamp = Utilities.formatDate(new Date(), 'Europe/Malta', 'HHmmss');
    var file = folder.createFile(Utilities.newBlob(bytes, mime, (title ? title + ' - ' : '') + stamp + ' - ' + name));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    file.setDescription('DAP ' + req.dapDate + ' · ' + (req.title || '') + ' · ' + req.store + ' · uploaded by ' + email);
    var id = file.getId();
    return out({ ok: true, id: id, url: 'https://drive.google.com/file/d/' + id + '/view',
      thumb: /^image\//.test(mime) ? 'https://drive.google.com/thumbnail?id=' + id + '&sz=w400' : '' });
  } catch (err) {
    return out({ ok: false, error: String((err && err.message) || err) });
  }
}

// Checks the hub login token with Google and returns the person's email.
function whoIs_(idToken) {
  if (!idToken) throw new Error('Please sign in to the hub again');
  var r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + SETTINGS.FIREBASE_API_KEY, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true
  });
  var j = JSON.parse(r.getContentText() || '{}');
  var u = j.users && j.users[0];
  if (r.getResponseCode() >= 300 || !u || !u.email) throw new Error('Your hub login has expired. Reload the page and try again');
  return String(u.email).toLowerCase();
}

function getMember_(email) {
  try {
    var d = fetch_('GET', BASE + '/members/' + encodeURIComponent(email));
    return d && d.fields ? fromFields_(d.fields) : null;
  } catch (e) { return null; }
}

function rootFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('UPLOAD_FOLDER_ID');
  if (id) { try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {} }
  var it = DriveApp.getFoldersByName(SETTINGS.UPLOAD_FOLDER);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(SETTINGS.UPLOAD_FOLDER);
  props.setProperty('UPLOAD_FOLDER_ID', folder.getId());
  return folder;
}
function sub_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function getStores_() {
  var out = {}, token = '';
  do {
    var res = fetch_('GET', BASE + '/stores?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : ''));
    (res.documents || []).forEach(function (d) {
      var code = d.name.split('/').pop();
      out[code] = fromFields_(d.fields || {});
    });
    token = res.nextPageToken || '';
  } while (token);
  return out;
}

function runQuery_(structuredQuery) {
  var res = fetch_('POST', BASE + '/modules/dap/config/posts:runQuery', { structuredQuery: structuredQuery });
  return (res || []).filter(function (r) { return r.document; }).map(function (r) {
    var o = fromFields_(r.document.fields || {});
    o._name = r.document.name;
    return o;
  });
}

function markEmailed_(name) {
  fetch_('PATCH', 'https://firestore.googleapis.com/v1/' + name +
    '?updateMask.fieldPaths=emailed&updateMask.fieldPaths=emailedAt&currentDocument.exists=true',
    { fields: { emailed: { booleanValue: true }, emailedAt: { integerValue: String(Date.now()) } } });
}

function fetch_(method, url, body) {
  var opts = {
    method: method, muteHttpExceptions: true, contentType: 'application/json',
    // x-goog-user-project bills the request to your Firebase project instead of the script's hidden one
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'x-goog-user-project': SETTINGS.PROJECT_ID }
  };
  if (body) opts.payload = JSON.stringify(body);
  var r = UrlFetchApp.fetch(url, opts);
  var code = r.getResponseCode();
  if (code >= 300) throw new Error('Firestore ' + method + ' failed (' + code + '): ' + r.getContentText().slice(0, 500));
  var txt = r.getContentText();
  return txt ? JSON.parse(txt) : null;
}

function fromValue_(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue_);
  if ('mapValue' in v) return fromFields_(v.mapValue.fields || {});
  return null;
}
function fromFields_(f) {
  var o = {};
  Object.keys(f).forEach(function (k) { o[k] = fromValue_(f[k]); });
  return o;
}
function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
