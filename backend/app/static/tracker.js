/*!
 * YSII Tracker — Sistem Promosi Digital Terintegrasi SEO & Machine Learning
 *
 * Pasang di <head> website:
 *   <script src="https://api.ysii.org/static/tracker.js" defer
 *           data-privacy-url="https://ysii.org/kebijakan-privasi"></script>
 *
 * Atribut opsional pada tag <script>:
 *   data-api            URL API (default: asal script ini)
 *   data-consent        "required" (default, tampilkan banner persetujuan) | "implied"
 *   data-privacy-url    tautan kebijakan privasi di banner
 *   data-mirror-forms   "auto" (default: salin form yang punya kolom telepon/email ke sistem lead)
 *                       | "marked" (hanya form ber-atribut data-ysii-form) | "off"
 *   data-whatsapp-ref   "on" (default: tambahkan kode referensi ke pesan WhatsApp) | "off"
 */
(function () {
  "use strict";
  if (window.ysii && window.ysii.loaded) return;

  var script = document.currentScript || document.querySelector('script[src*="tracker.js"]');
  var cfg = (script && script.dataset) || {};
  var API = (cfg.api || (script ? new URL(script.src).origin : "")).replace(/\/$/, "");
  var CONSENT_MODE = cfg.consent || "required";
  var MIRROR = cfg.mirrorForms || "auto";
  var WA_REF = cfg.whatsappRef !== "off";
  var SESSION_TIMEOUT = 30 * 60 * 1000;

  // ---------- util ----------
  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      if (val === null) localStorage.removeItem(key);
      else localStorage.setItem(key, val);
    } catch (e) { return null; }
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x + 0x100).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }
  function send(path, data) {
    var body = JSON.stringify(data);
    var url = API + path;
    // text/plain = "simple request", tidak perlu preflight CORS
    if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }))) return;
    try { fetch(url, { method: "POST", body: body, keepalive: true, headers: { "Content-Type": "text/plain" } }); } catch (e) {}
  }

  // ---------- program slug ----------
  function detectProgram() {
    var meta = document.querySelector('meta[name="ysii:program"]');
    if (meta && meta.content) return meta.content;
    if (document.body && document.body.dataset.program) return document.body.dataset.program;
    var m = location.pathname.match(/\/(?:program|pelatihan|kursus|sertifikasi|training|kelas)\/([a-z0-9-]+)/i);
    return m ? m[1].toLowerCase() : null;
  }
  var PROGRAM = detectProgram();

  // ---------- identitas ----------
  var consent = store("ysii_consent"); // "1" setuju, "0" menolak, null belum memilih
  if (CONSENT_MODE === "implied" && consent === null) consent = "1";
  var tracking = consent === "1";
  var vid = null, sid = null, refCode = null;

  function initIds() {
    vid = store("ysii_vid");
    if (!vid) { vid = uuid(); store("ysii_vid", vid); }
    var now = Date.now(), last = +(store("ysii_last") || 0);
    sid = store("ysii_sid");
    var q = new URLSearchParams(location.search);
    var newCampaign = q.get("utm_source") && q.get("utm_source") !== store("ysii_utm");
    if (!sid || now - last > SESSION_TIMEOUT || newCampaign) { sid = uuid(); store("ysii_sid", sid); }
    if (q.get("utm_source")) store("ysii_utm", q.get("utm_source"));
    store("ysii_last", String(now));
    refCode = vid.replace(/-/g, "").slice(0, 6).toUpperCase();
  }

  // ---------- antrian event ----------
  var buf = [], ctx = null;
  function track(type, label, value) {
    if (!tracking) return;
    buf.push({ type: type, ts: Date.now(), label: label ? String(label).slice(0, 250) : null, value: value == null ? null : value });
    if (buf.length >= 20) flush();
  }
  function flush() {
    if (!tracking || !buf.length) return;
    store("ysii_last", String(Date.now()));
    send("/v1/collect", { ctx: ctx, events: buf.splice(0, 50) });
  }

  // ---------- waktu aktif ----------
  var activeSec = 0, lastTick = Date.now(), lastInput = Date.now();
  ["mousemove", "keydown", "scroll", "touchstart"].forEach(function (ev) {
    addEventListener(ev, function () { lastInput = Date.now(); }, { passive: true });
  });
  function tick() {
    var now = Date.now();
    // dihitung aktif hanya jika tab terlihat dan ada interaksi dalam 60 detik terakhir
    if (!document.hidden && now - lastInput < 60000) activeSec += (now - lastTick) / 1000;
    lastTick = now;
  }
  function heartbeat() {
    tick();
    if (activeSec >= 1) { track("heartbeat", null, Math.round(activeSec)); activeSec = 0; }
  }

  // ---------- WhatsApp ----------
  function isWa(href) { return /(^|\/\/)(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)|^whatsapp:/i.test(href || ""); }
  function addRef(a) {
    if (!WA_REF || !refCode || a.dataset.ysiiRef) return;
    try {
      var u = new URL(a.href, location.href);
      var text = u.searchParams.get("text") || "Halo admin YSII, saya ingin bertanya tentang pelatihan.";
      u.searchParams.set("text", text + "\n\n(Kode: " + refCode + ")");
      // URLSearchParams menulis spasi sebagai "+", yang tidak selalu dibaca sebagai spasi oleh WhatsApp
      a.href = u.toString().replace(/\+/g, "%20");
      a.dataset.ysiiRef = "1";
    } catch (e) {}
  }

  // ---------- form ----------
  var EXCLUDED_FORM = 'form[role="search"], #commentform, .search-form, form[action*="wp-login"], form[action*="/search"]';
  function shouldMirror(f) {
    if (MIRROR === "off" || f.matches(EXCLUDED_FORM) || f.querySelector('input[type="password"]')) return false;
    if (f.hasAttribute("data-ysii-form")) return true;
    if (MIRROR !== "auto") return false;
    return !!f.querySelector('input[type="tel"], input[type="email"], input[name*="phone" i], input[name*="hp" i], input[name*="whatsapp" i], input[name*="telepon" i]');
  }
  function formData(f) {
    var data = {};
    Array.prototype.forEach.call(f.elements, function (el) {
      if (!el.name || el.disabled || el.type === "password" || el.type === "file") return;
      if ((el.type === "checkbox" || el.type === "radio") && !el.checked) return;
      data[el.name] = data[el.name] ? data[el.name] + ", " + el.value : el.value;
    });
    return data;
  }
  function bindForm(f) {
    if (f.dataset.ysiiBound) return;
    f.dataset.ysiiBound = "1";
    if (tracking && vid && !f.querySelector('input[name="visitor_id"]')) {
      var h = document.createElement("input");
      h.type = "hidden"; h.name = "visitor_id"; h.value = vid;
      f.appendChild(h);
    }
    f.addEventListener("focusin", function once() {
      track("form_start", f.id || f.getAttribute("name") || null);
      f.removeEventListener("focusin", once);
    });
    f.addEventListener("submit", function () {
      track("form_submit", f.id || null);
      flush();
      if (shouldMirror(f)) {
        var data = formData(f);
        if (tracking && vid) data.visitor_id = vid; else delete data.visitor_id;
        if (PROGRAM && !data.program) data.program = PROGRAM;
        data.page_url = location.href;
        send("/v1/leads", data);
      }
    });
  }

  // ---------- klik ----------
  document.addEventListener("click", function (e) {
    var el = e.target.closest && e.target.closest("a, button, [data-track]");
    if (!el) return;
    var href = el.getAttribute("href") || "";
    var label = (el.dataset.trackLabel || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80);
    if (isWa(href)) { addRef(el); track("click_whatsapp", label || href); }
    else if (el.dataset.track) track(el.dataset.track, label);
    else if (/\.pdf($|\?)/i.test(href) || /brosur|brochure/i.test(href + label)) track("download_brochure", label || href);
    else if (/daftar|registrasi|register|enroll/i.test(label) || el.matches(".cta, .btn-daftar")) track("click_cta", label);
  }, true);

  // ---------- scroll & bagian harga ----------
  var marks = {};
  function onScroll() {
    var h = document.documentElement.scrollHeight - innerHeight;
    var pct = h > 0 ? Math.round((scrollY / h) * 100) : 100;
    [25, 50, 75, 100].forEach(function (m) { if (pct >= m && !marks[m]) { marks[m] = 1; track("scroll", null, m); } });
  }
  function watchPrice() {
    if (!("IntersectionObserver" in window)) return;
    var els = document.querySelectorAll('[data-track="view_price"], [data-ysii-price], #harga, #biaya, #jadwal, .harga, .biaya');
    if (!els.length) return;
    var seen = false;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && !seen) { seen = true; track("view_price", en.target.id || null); io.disconnect(); }
      });
    }, { threshold: 0.5 });
    Array.prototype.forEach.call(els, function (el) { io.observe(el); });
  }

  // ---------- rekomendasi ----------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^(https?:|\/)/i.test(u || "") ? u : "#"; }
  function renderReco() {
    var box = document.getElementById("ysii-reco");
    if (!box || !tracking) return;
    var url = API + "/v1/recommend/" + vid + (PROGRAM ? "?current=" + encodeURIComponent(PROGRAM) : "");
    fetch(url).then(function (r) { return r.json(); }).then(function (d) {
      var wa = box.dataset.whatsapp, daftar = box.dataset.daftarUrl || "#";
      var ctaHref = d.cta.type === "daftar" ? daftar : d.cta.type === "konsultasi" && wa
        ? "https://wa.me/" + wa + "?text=" + encodeURIComponent("Halo admin YSII, saya ingin konsultasi program pelatihan.") : (d.programs[0] && d.programs[0].url) || daftar;
      var cards = d.programs.map(function (p) {
        return '<a class="ysii-card" data-track="click_cta" data-track-label="reco:' + esc(p.slug) + '" href="' + esc(safeUrl(p.url)) + '">' +
          "<strong>" + esc(p.name) + "</strong>" + (p.next_batch ? "<span>Batch: " + esc(p.next_batch) + "</span>" : "") + "</a>";
      }).join("");
      box.innerHTML =
        '<div class="ysii-reco"><h3>' + esc(d.cta.title) + "</h3><p>" + esc(d.cta.text) + "</p>" +
        (cards ? '<div class="ysii-cards">' + cards + "</div>" : "") +
        '<a class="ysii-btn" data-track="click_cta" data-track-label="reco-cta:' + esc(d.cta.type) + '" href="' + esc(safeUrl(ctaHref)) + '">' + esc(d.cta.button) + "</a></div>";
      Array.prototype.forEach.call(box.querySelectorAll("a"), function (a) { if (isWa(a.href)) addRef(a); });
    }).catch(function () {});
  }
  function injectStyle() {
    var css =
      ".ysii-reco{border:1px solid #e3e6ea;border-radius:12px;padding:16px;margin:16px 0;font-family:inherit}" +
      ".ysii-reco h3{margin:0 0 6px;font-size:1.1em}.ysii-reco p{margin:0 0 12px;color:#555}" +
      ".ysii-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:12px}" +
      ".ysii-card{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:8px;background:#f5f7fa;color:inherit;text-decoration:none}" +
      ".ysii-card span{font-size:.85em;color:#666}" +
      ".ysii-btn{display:inline-block;padding:10px 16px;border-radius:8px;background:#0b7a4b;color:#fff!important;text-decoration:none;font-weight:600}" +
      "#ysii-consent{position:fixed;left:16px;right:16px;bottom:16px;z-index:99999;max-width:560px;margin:auto;background:#1f2933;color:#fff;" +
      "padding:14px 16px;border-radius:10px;font:14px/1.5 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25)}" +
      "#ysii-consent a{color:#9fe3c1}#ysii-consent .b{margin-top:10px;display:flex;gap:8px;justify-content:flex-end}" +
      "#ysii-consent button{border:0;border-radius:6px;padding:8px 14px;cursor:pointer;font:inherit}" +
      "#ysii-consent .y{background:#0b7a4b;color:#fff}#ysii-consent .n{background:transparent;color:#ddd;border:1px solid #555}";
    var s = document.createElement("style");
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ---------- banner persetujuan (UU PDP No. 27/2022) ----------
  function showConsent() {
    var d = document.createElement("div");
    d.id = "ysii-consent";
    d.setAttribute("role", "dialog");
    d.setAttribute("aria-label", "Persetujuan cookie");
    d.innerHTML =
      "Kami memakai cookie untuk memahami cara pengunjung menggunakan situs ini dan memberi rekomendasi program yang sesuai." +
      (cfg.privacyUrl ? ' <a href="' + esc(safeUrl(cfg.privacyUrl)) + '">Kebijakan privasi</a>.' : "") +
      '<div class="b"><button class="n" type="button">Tolak</button><button class="y" type="button">Setuju</button></div>';
    document.body.appendChild(d);
    d.querySelector(".y").onclick = function () { store("ysii_consent", "1"); d.remove(); start(); };
    d.querySelector(".n").onclick = function () { store("ysii_consent", "0"); d.remove(); };
  }

  // ---------- mulai ----------
  var started = false;
  function start() {
    if (started) return;
    started = true;
    tracking = true;
    initIds();
    var q = new URLSearchParams(location.search);
    ctx = {
      visitor_id: vid, session_id: sid, page_url: location.href, page_title: document.title.slice(0, 290),
      referrer: document.referrer || null,
      utm_source: q.get("utm_source"), utm_medium: q.get("utm_medium"),
      utm_campaign: q.get("utm_campaign"), utm_term: q.get("utm_term"),
      program_slug: PROGRAM, device: /Mobi|Android|iPhone/i.test(navigator.userAgent) ? "mobile" : "desktop"
    };
    track("page_view", document.title);
    var search = q.get("s") || q.get("q") || q.get("search");
    if (search) track("site_search", search);
    Array.prototype.forEach.call(document.querySelectorAll("form"), bindForm);
    Array.prototype.forEach.call(document.querySelectorAll("a[href]"), function (a) { if (isWa(a.href)) addRef(a); });
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    watchPrice();
    renderReco();
    setInterval(function () { heartbeat(); flush(); }, 15000);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { heartbeat(); flush(); } else { lastTick = Date.now(); }
    });
    addEventListener("pagehide", function () { heartbeat(); flush(); });
    // form yang dimuat belakangan (popup / AJAX)
    if ("MutationObserver" in window) {
      new MutationObserver(function () {
        Array.prototype.forEach.call(document.querySelectorAll("form:not([data-ysii-bound])"), bindForm);
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  function boot() {
    injectStyle();
    if (tracking) start();
    else {
      // Tanpa persetujuan: tetap salin form pendaftaran (tanpa visitor_id), tanpa tracking
      Array.prototype.forEach.call(document.querySelectorAll("form"), bindForm);
      if (consent === null && CONSENT_MODE === "required") showConsent();
    }
  }

  window.ysii = {
    loaded: true,
    track: function (type, label, value) { track(type, label, value); },
    flush: flush,
    get visitorId() { return vid; },
    get refCode() { return refCode; },
    resetConsent: function () { store("ysii_consent", null); location.reload(); }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
