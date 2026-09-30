/* Campus Portal — interactive login layer (additive only).
 *
 * Enhances the existing React login screen (.cp-auth-page) WITHOUT replacing or removing any login
 * feature: password sign-in, role picker, Face ID, fingerprint, forgot-password, student
 * registration and faculty rules all stay exactly as they are in app-runtime.js.
 *
 * What it adds:
 *   - live particle-network background that reacts to the pointer
 *   - spotlight + gentle 3D tilt on the card, parallax on the glow orbs
 *   - progress line on the card that fills as the form is completed
 *   - ripple on buttons, shake on a sign-in error
 *   - Caps Lock warning on password fields
 *   - password strength bar on "create password" fields + match indicator on confirm fields
 *   - ghost e-mail domain auto-complete (Tab / → / tap) taken from each field's own placeholder
 *   - role hotkeys (Alt+1..4) and remembering the last chosen role
 *   - auto-highlighting feature list, greeting + online/offline status pill
 *   - v2: live password checklist, "did you mean ...?" e-mail typo fixer, magnetic sign-in button,
 *         animated signing-in bar, auto-hide of a revealed password, refocus after a wrong password,
 *         welcome overlay after a successful sign-in
 *
 * Safety: it only reads/sets values through the browser's native setter + a real `input` event, so
 * React state stays the source of truth. It never reads passwords into storage or the network.
 * It stops all work (canvas, timers) as soon as the login page is no longer on screen.
 */
(function () {
  'use strict';
  if (window.__CP_LOGIN_LIVE__) return;
  window.__CP_LOGIN_LIVE__ = true;

  var doc = document, root = doc.documentElement;
  var reduce = false;
  try { reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) {}
  var finePointer = true;
  try { finePointer = !!(window.matchMedia && matchMedia('(hover:hover) and (pointer:fine)').matches); } catch (_) {}

  var ROLE_KEY = 'cp:login:lastRole';
  var ROLE_ORDER = ['student', 'teacher', 'mentor', 'admin'];

  /* ------------------------------------------------------------------ helpers */
  function $(sel, ctx) { return (ctx || doc).querySelector(sel); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function setVar(name, val) { root.style.setProperty(name, val); }
  function isPasswordish(el) {
    return el && el.tagName === 'INPUT' && (el.type === 'password' || el.getAttribute('data-cp-pw') === '1');
  }
  function inAuth(el) { return !!(el && el.closest && el.closest('.cp-auth-page')); }
  function setNativeValue(input, value) {
    var proto = Object.getPrototypeOf(input);
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(input, value); else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  /* ------------------------------------------------------------------ canvas background */
  var canvas = null, ctx = null, particles = [], raf = 0, W = 0, H = 0, dpr = 1;
  var pointer = { x: -9999, y: -9999, active: false };

  function makeParticles() {
    var target = clamp(Math.round((W * H) / 22000), 18, W < 700 ? 26 : 72);
    particles = [];
    for (var i = 0; i < target; i++) {
      particles.push({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35,
        r: 1 + Math.random() * 1.6
      });
    }
  }
  function resize() {
    if (!canvas) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    makeParticles();
  }
  function frame() {
    raf = 0;
    if (!canvas || doc.hidden || document.visibilityState !== 'visible') return;
    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#071426'); g.addColorStop(0.46, '#0a1d38'); g.addColorStop(1, '#0d1730');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // soft colour washes (same palette as the original page background)
    var a = ctx.createRadialGradient(W * 0.08, H * 0.08, 0, W * 0.08, H * 0.08, Math.max(W, H) * 0.55);
    a.addColorStop(0, 'rgba(14,165,233,.20)'); a.addColorStop(1, 'rgba(14,165,233,0)');
    ctx.fillStyle = a; ctx.fillRect(0, 0, W, H);
    var b = ctx.createRadialGradient(W * 0.92, H * 0.14, 0, W * 0.92, H * 0.14, Math.max(W, H) * 0.5);
    b.addColorStop(0, 'rgba(99,102,241,.22)'); b.addColorStop(1, 'rgba(99,102,241,0)');
    ctx.fillStyle = b; ctx.fillRect(0, 0, W, H);

    var link = 118, i, j, p, q, dx, dy, d;
    for (i = 0; i < particles.length; i++) {
      p = particles[i];
      if (pointer.active) {
        dx = p.x - pointer.x; dy = p.y - pointer.y; d = dx * dx + dy * dy;
        if (d < 22000 && d > 1) { var f = (1 - d / 22000) * 0.9; d = Math.sqrt(d); p.vx += (dx / d) * f * 0.06; p.vy += (dy / d) * f * 0.06; }
      }
      p.vx *= 0.995; p.vy *= 0.995;
      var sp = Math.abs(p.vx) + Math.abs(p.vy);
      if (sp < 0.12) { p.vx += (Math.random() - 0.5) * 0.02; p.vy += (Math.random() - 0.5) * 0.02; }
      p.x += p.vx; p.y += p.vy;
      if (p.x < -10) p.x = W + 10; else if (p.x > W + 10) p.x = -10;
      if (p.y < -10) p.y = H + 10; else if (p.y > H + 10) p.y = -10;
    }
    ctx.lineWidth = 1;
    for (i = 0; i < particles.length; i++) {
      p = particles[i];
      for (j = i + 1; j < particles.length; j++) {
        q = particles[j]; dx = p.x - q.x; dy = p.y - q.y; d = dx * dx + dy * dy;
        if (d < link * link) {
          ctx.strokeStyle = 'rgba(125,211,252,' + (0.20 * (1 - d / (link * link))).toFixed(3) + ')';
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        }
      }
      if (pointer.active) {
        dx = p.x - pointer.x; dy = p.y - pointer.y; d = dx * dx + dy * dy;
        if (d < 24000) {
          ctx.strokeStyle = 'rgba(147,197,253,' + (0.34 * (1 - d / 24000)).toFixed(3) + ')';
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(pointer.x, pointer.y); ctx.stroke();
        }
      }
      ctx.fillStyle = 'rgba(186,230,253,.75)';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fill();
    }
    raf = requestAnimationFrame(frame);
  }
  function startCanvas() {
    if (canvas || reduce) return;
    try {
      canvas = doc.createElement('canvas'); canvas.id = 'cp-li-canvas'; canvas.setAttribute('aria-hidden', 'true');
      ctx = canvas.getContext('2d');
      if (!ctx) { canvas = null; return; }
      doc.body.insertBefore(canvas, doc.body.firstChild);
      resize();
      root.classList.add('cp-login-live');
      if (!raf) raf = requestAnimationFrame(frame);
    } catch (_) { stopCanvas(); }
  }
  function stopCanvas() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    canvas = null; ctx = null; particles = [];
    root.classList.remove('cp-login-live');
  }

  /* ------------------------------------------------------------------ pointer: spotlight, tilt, parallax */
  var ptrRaf = 0, lastEvt = null;
  function onPointerMove(e) {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true;
    lastEvt = e;
    if (!ptrRaf) ptrRaf = requestAnimationFrame(applyPointer);
  }
  function applyPointer() {
    ptrRaf = 0;
    var e = lastEvt; if (!e || !$('.cp-auth-page')) return;
    setVar('--cp-px', ((e.clientX / Math.max(1, window.innerWidth)) - 0.5).toFixed(3));
    setVar('--cp-py', ((e.clientY / Math.max(1, window.innerHeight)) - 0.5).toFixed(3));
    var card = $('.cp-auth-card'); if (!card) return;
    applyMagnet(e);
    var r = card.getBoundingClientRect();
    var mx = e.clientX - r.left, my = e.clientY - r.top;
    setVar('--cp-mx', mx.toFixed(0) + 'px'); setVar('--cp-my', my.toFixed(0) + 'px');
    var near = mx > -80 && mx < r.width + 80 && my > -80 && my < r.height + 80;
    setVar('--cp-spot', near ? '1' : '0');
    if (finePointer && !reduce) {
      var nx = clamp((mx / r.width) - 0.5, -0.6, 0.6), ny = clamp((my / r.height) - 0.5, -0.6, 0.6);
      setVar('--cp-rx', near ? (-ny * 5).toFixed(2) + 'deg' : '0deg');
      setVar('--cp-ry', near ? (nx * 6).toFixed(2) + 'deg' : '0deg');
    }
  }
  function onPointerLeave() {
    pointer.active = false; pointer.x = pointer.y = -9999;
    resetMagnet();
    setVar('--cp-spot', '0'); setVar('--cp-rx', '0deg'); setVar('--cp-ry', '0deg');
  }

  /* ------------------------------------------------------------------ ripple + error shake */
  function onPointerDown(e) {
    var b = e.target && e.target.closest ? e.target.closest('.cp-auth-card button, .cp-auth-page button.w-full') : null;
    if (!b || b.disabled || reduce) return;
    // only buttons that are positioned containers get a ripple: absolute icon buttons (the eye toggle)
    // and static text links ("Forgot password?") would otherwise draw the ripple in the wrong place
    var cs = getComputedStyle(b);
    if (cs.position !== 'relative') return;
    var r = b.getBoundingClientRect();
    var size = Math.max(r.width, r.height) * 1.6;
    var s = el('span', 'cp-li-ripple');
    s.style.width = s.style.height = size + 'px';
    s.style.left = (e.clientX - r.left - size / 2) + 'px';
    s.style.top = (e.clientY - r.top - size / 2) + 'px';
    b.appendChild(s);
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 650);
  }
  var lastError = '';
  function watchError() {
    var card = $('.cp-auth-card'); if (!card) { lastError = ''; return; }
    var err = card.querySelector('p.border-l-rose-500') || card.querySelector('p.text-rose-700');
    var txt = err ? (err.textContent || '').trim() : '';
    if (err && err.getAttribute('role') !== 'alert') err.setAttribute('role', 'alert');
    if (txt && txt !== lastError) refocusPassword(card);
    if (txt && txt !== lastError && !reduce && card.animate) {
      card.animate([
        { transform: 'translateX(0)' }, { transform: 'translateX(-9px)' }, { transform: 'translateX(8px)' },
        { transform: 'translateX(-6px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }
      ], { duration: 460, easing: 'ease-in-out' });
    }
    lastError = txt;
  }

  /* ------------------------------------------------------------------ Caps Lock tip */
  var capsTip = null, capsOn = false;
  function ensureCapsTip() {
    if (capsTip) return capsTip;
    capsTip = el('div', 'cp-li-tip'); capsTip.setAttribute('role', 'status'); capsTip.setAttribute('aria-live', 'polite');
    capsTip.textContent = '\u21EA Caps Lock is ON';
    doc.body.appendChild(capsTip);
    return capsTip;
  }
  function showCaps(input, on) {
    var t = ensureCapsTip();
    capsOn = !!(on && input);
    if (!on || !input) { t.removeAttribute('data-show'); return; }
    var r = input.getBoundingClientRect();
    t.style.left = Math.max(8, r.left) + 'px';
    t.style.top = (r.top - 30) + 'px';
    t.setAttribute('data-show', '1');
  }
  function onKey(e) {
    if (e.key === 'Alt') root.classList.add('cp-alt-down');
    var t = e.target;
    if (isPasswordish(t) && inAuth(t) && typeof e.getModifierState === 'function') {
      showCaps(t, e.getModifierState('CapsLock'));
    }
    // ghost completion accept
    if (ghostFor && t === ghostFor && (e.key === 'Tab' || e.key === 'ArrowRight') && !e.shiftKey) {
      var caret = null; try { caret = t.selectionStart; } catch (_) {}
      if ((caret === null || caret === t.value.length) && ghostText) { e.preventDefault(); acceptGhost(); return; }
    }
    // role hotkeys: Alt+1..4
    if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-4]$/.test(e.key)) {
      var btns = $all('.cp-auth-role-grid button');
      var b = btns[parseInt(e.key, 10) - 1];
      if (b) { e.preventDefault(); roleClickedByUser = true; saveRole(parseInt(e.key, 10) - 1); b.click(); }
    }
  }
  function onKeyUp(e) {
    if (e.key === 'Alt') root.classList.remove('cp-alt-down');
    var t = e.target;
    if (isPasswordish(t) && inAuth(t) && typeof e.getModifierState === 'function') showCaps(t, e.getModifierState('CapsLock'));
  }
  function onFocusOut(e) {
    if (isPasswordish(e.target)) showCaps(null, false);
    if (e.target === ghostFor) hideGhost();
  }

  /* ------------------------------------------------------------------ password strength + match */
  var strengthLbl = null;
  function ensureStrengthLbl() {
    if (strengthLbl) return strengthLbl;
    strengthLbl = el('div', 'cp-li-strength'); strengthLbl.setAttribute('aria-live', 'polite');
    doc.body.appendChild(strengthLbl);
    return strengthLbl;
  }
  function scorePassword(v) {
    var s = 0;
    if (v.length >= 8) s++;
    if (v.length >= 12) s++;
    if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++;
    if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) s++;
    else if (/\d/.test(v) || /[^A-Za-z0-9]/.test(v)) s += 0.5;
    if (/^(.)\1+$/.test(v) || /^(password|12345678|qwerty|admin)/i.test(v)) s = Math.min(s, 1);
    return clamp(Math.floor(s), 0, 4);
  }
  var STR = [
    ['Too weak', '#f43f5e'], ['Weak', '#f97316'], ['Okay', '#eab308'], ['Good', '#22c55e'], ['Strong', '#10b981']
  ];
  function isNewPasswordField(input) {
    if (!isPasswordish(input) || !inAuth(input)) return false;
    var ac = (input.getAttribute('autocomplete') || '').toLowerCase();
    if (ac === 'current-password') return false;
    var ph = (input.getAttribute('placeholder') || '').toLowerCase();
    return ph.indexOf('at least') === 0;
  }
  function isConfirmField(input) {
    if (!isPasswordish(input) || !inAuth(input)) return false;
    var ph = (input.getAttribute('placeholder') || '').toLowerCase();
    return ph.indexOf('re-enter') === 0;
  }
  function updateStrength(input) {
    var v = input.value || '';
    var lbl = ensureStrengthLbl();
    if (!v) { input.removeAttribute('data-cp-strength'); lbl.removeAttribute('data-show'); return; }
    var sc = scorePassword(v);
    input.setAttribute('data-cp-strength', '1');
    input.style.setProperty('--cp-str', String(Math.max(1, sc)));
    input.style.setProperty('--cp-str-c', STR[sc][1]);
    var r = input.getBoundingClientRect();
    lbl.textContent = STR[sc][0];
    lbl.style.color = STR[sc][1];
    lbl.style.left = (r.right - 92) + 'px';
    lbl.style.width = '84px'; lbl.style.textAlign = 'right';
    lbl.style.top = (r.top - 15) + 'px';
    lbl.setAttribute('data-show', '1');
  }
  function updateMatch(input) {
    var pwFields = $all('input[type=password], input[data-cp-pw="1"]', input.closest('form') || doc)
      .filter(function (n) { return isNewPasswordField(n); });
    var first = pwFields[0];
    if (!first) { input.removeAttribute('data-cp-valid'); return; }
    var v = input.value || '';
    if (!v) { input.removeAttribute('data-cp-valid'); return; }
    input.setAttribute('data-cp-valid', v === first.value ? '1' : '0');
  }

  /* ------------------------------------------------------------------ ghost e-mail domain completion */
  var ghost = null, ghostFor = null, ghostText = '', measureCtx = null;
  function domainFromPlaceholder(input) {
    var ph = input.getAttribute('placeholder') || '';
    var m = ph.match(/@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/);
    return m ? m[0] : '';
  }
  function textWidth(input, text) {
    if (!measureCtx) measureCtx = doc.createElement('canvas').getContext('2d');
    var cs = getComputedStyle(input);
    measureCtx.font = cs.font && cs.font.indexOf('px') > -1 ? cs.font
      : (cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily);
    return measureCtx.measureText(text).width;
  }
  function hideGhost() {
    if (ghost) ghost.style.display = 'none';
    ghostFor = null; ghostText = '';
  }
  function acceptGhost() {
    var input = ghostFor, add = ghostText;
    if (!input || !add) return;
    hideGhost();
    setNativeValue(input, input.value + add);
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) {}
    input.focus();
  }
  function updateGhost(input) {
    if (!input || input.tagName !== 'INPUT' || input.type !== 'email' || !inAuth(input)) { hideGhost(); return; }
    var dom = domainFromPlaceholder(input), v = input.value || '';
    if (!dom || !v || v.indexOf('@') > -1 || /\s/.test(v) || v.length < 2) { hideGhost(); return; }
    if (!ghost) {
      ghost = el('div', 'cp-li-ghost'); ghost.setAttribute('aria-hidden', 'true');
      var txt = el('span'); var k = el('kbd', '', 'Tab');
      ghost.appendChild(txt); ghost.appendChild(k);
      ghost.addEventListener('mousedown', function (e) { e.preventDefault(); acceptGhost(); });
      ghost.addEventListener('touchstart', function (e) { e.preventDefault(); acceptGhost(); }, { passive: false });
      doc.body.appendChild(ghost);
    }
    var cs = getComputedStyle(input), r = input.getBoundingClientRect();
    var left = r.left + parseFloat(cs.borderLeftWidth || 0) + parseFloat(cs.paddingLeft || 0) + textWidth(input, v);
    var maxRight = r.right - parseFloat(cs.paddingRight || 0) - 8;
    ghostFor = input; ghostText = dom;
    ghost.firstChild.textContent = dom;
    ghost.style.font = cs.font && cs.font.indexOf('px') > -1 ? cs.font : (cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily);
    ghost.style.left = left + 'px';
    ghost.style.top = (r.top + (r.height - parseFloat(cs.fontSize || 13)) / 2 - 2) + 'px';
    ghost.style.display = 'flex';
    // hide if it would not fit inside the input
    if (left + textWidth(input, dom) > maxRight) hideGhost();
  }

  /* ------------------------------------------------------------------ live validity + progress fill */
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function updateFill() {
    var card = $('.cp-auth-card'); if (!card) return;
    var inputs = $all('input:not([type=checkbox]):not([type=file])', card).filter(function (n) { return n.type !== 'hidden'; });
    if (!inputs.length) return;
    var need = 0, done = 0;
    inputs.forEach(function (n) {
      if (!n.required) return;
      need++;
      var v = (n.value || '').trim();
      if (!v) return;
      if (n.type === 'email') { if (EMAIL_RE.test(v)) done++; }
      else if (n.type === 'password' || n.getAttribute('data-cp-pw') === '1') { if (v.length >= (n.minLength > 0 ? n.minLength : 1)) done++; }
      else done++;
    });
    var f = need ? clamp(done / need, 0, 1) : 0;
    setVar('--cp-fill', String(0.22 + f * 0.78));
  }
  function updateValidity(input) {
    if (!inAuth(input) || input.tagName !== 'INPUT') return;
    if (input.type === 'email') {
      var v = (input.value || '').trim();
      if (!v) input.removeAttribute('data-cp-valid');
      else input.setAttribute('data-cp-valid', EMAIL_RE.test(v) ? '1' : '0');
    }
  }
  function onInput(e) {
    var t = e.target;
    if (!t || t.tagName !== 'INPUT' || !inAuth(t)) return;
    if (t.type === 'password' && !t.getAttribute('data-cp-pw')) { /* marker only; type may toggle to text */ t.setAttribute('data-cp-pw', '1'); }
    updateValidity(t);
    if (isNewPasswordField(t)) {
      updateStrength(t);
      $all('input[data-cp-pw="1"]', t.closest('form') || doc).filter(isConfirmField).forEach(updateMatch);
    } else if (isConfirmField(t)) updateMatch(t);
    updateGhost(t);
    updateReqs(t);
    updateTypo(t);
    updateFill();
  }
  function onFocusIn(e) {
    var t = e.target;
    if (t && t.tagName === 'INPUT' && inAuth(t)) {
      if (t.type === 'password') t.setAttribute('data-cp-pw', '1');
      if (isNewPasswordField(t) && t.value) updateStrength(t);
      updateGhost(t);
      updateReqs(t);
      updateTypo(t);
    }
  }
  function onFocusOutStrength(e) {
    if (strengthLbl && isNewPasswordField(e.target)) strengthLbl.removeAttribute('data-show');
    if (isNewPasswordField(e.target)) hideReqs();
    if (e.target === typoFor) hideTypo();
  }

  /* ------------------------------------------------------------------ roles: remember + hotkey badges */
  var roleRestored = false, roleClickedByUser = false;
  function saveRole(idx) { try { if (ROLE_ORDER[idx]) localStorage.setItem(ROLE_KEY, ROLE_ORDER[idx]); } catch (_) {} }
  function onRoleClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest('.cp-auth-role-grid button') : null;
    if (!btn) return;
    var idx = $all('.cp-auth-role-grid button').indexOf(btn);
    if (idx > -1 && e.isTrusted) { roleClickedByUser = true; saveRole(idx); }
  }
  function decorateRoles() {
    var btns = $all('.cp-auth-role-grid button');
    if (!btns.length) return;
    btns.forEach(function (b, i) {
      // Keep the keyboard shortcut for accessibility/power users, but never render
      // the old "Alt+1 / Alt+2 / Alt+3 / Alt+4" badges on the role cards.
      var oldKey = b.querySelector('.cp-li-key');
      if (oldKey) oldKey.remove();
      b.setAttribute('aria-keyshortcuts', 'Alt+' + (i + 1));
      b.setAttribute('aria-pressed', b.classList.contains('scale-[1.02]') ? 'true' : 'false');
      b.setAttribute('data-cp-role-index', String(i));
    });
    if (!roleRestored) {
      roleRestored = true;
      var saved = '';
      try { saved = localStorage.getItem(ROLE_KEY) || ''; } catch (_) {}
      var idx = ROLE_ORDER.indexOf(saved);
      // only restore when nothing has been typed yet, so we never disturb an in-progress sign-in
      var anyTyped = $all('.cp-auth-card input').some(function (n) { return n.type !== 'checkbox' && (n.value || '').length > 0; });
      if (idx > 0 && btns[idx] && !roleClickedByUser && !anyTyped) btns[idx].click();
    }
  }

  /* ------------------------------------------------------------------ feature highlight cycle */
  var featIdx = 0, featPaused = false;
  function cycleFeatures() {
    var items = $all('.cp-auth-feature');
    if (!items.length || featPaused) return;
    items.forEach(function (n, i) { if (i === featIdx % items.length) n.setAttribute('data-cp-active', '1'); else n.removeAttribute('data-cp-active'); });
    featIdx++;
  }

  /* ------------------------------------------------------------------ greeting + connection pill */
  var pill = null;
  function greetingWord() {
    var h = new Date().getHours();
    return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night';
  }
  function updatePill() {
    if (!pill) {
      pill = el('div', 'cp-li-status'); pill.setAttribute('role', 'status'); pill.setAttribute('aria-live', 'polite');
      pill.appendChild(el('span', 'cp-li-dot'));
      pill.appendChild(el('span', 'cp-li-txt'));
      doc.body.appendChild(pill);
    }
    var online = navigator.onLine !== false;
    pill.setAttribute('data-online', online ? '1' : '0');
    var t = pill.querySelector('.cp-li-txt');
    var msg = online ? (greetingWord() + ' \u00B7 secure connection ready') : 'You are offline \u2014 sign-in needs internet';
    if (t.textContent !== msg) t.textContent = msg;
  }
  function removePill() { if (pill && pill.parentNode) pill.parentNode.removeChild(pill); pill = null; }

  /* ------------------------------------------------------------------ v2: live password checklist */
  var reqs = null, reqItems = [];
  var REQS = [
    ['8+ characters (required)', function (v) { return v.length >= 8; }],
    ['Upper and lower case letters', function (v) { return /[a-z]/.test(v) && /[A-Z]/.test(v); }],
    ['At least one number', function (v) { return /\d/.test(v); }],
    ['At least one symbol (! @ # $ ...)', function (v) { return /[^A-Za-z0-9]/.test(v); }]
  ];
  function ensureReqs() {
    if (reqs) return reqs;
    reqs = el('div', 'cp-li-reqs'); reqs.setAttribute('aria-hidden', 'true');
    reqs.appendChild(el('b', '', 'Password checklist'));
    var ul = el('ul');
    REQS.forEach(function (r) { var li = el('li', '', r[0]); ul.appendChild(li); reqItems.push(li); });
    reqs.appendChild(ul);
    doc.body.appendChild(reqs);
    return reqs;
  }
  function hideReqs() { if (reqs) reqs.removeAttribute('data-show'); }
  function updateReqs(input) {
    if (!input || document.activeElement !== input || !isNewPasswordField(input)) { hideReqs(); return; }
    var box = ensureReqs(), v = input.value || '';
    REQS.forEach(function (r, i) { reqItems[i].setAttribute('data-ok', v && r[1](v) ? '1' : '0'); });
    var r = input.getBoundingClientRect();
    var top = r.bottom + 8;
    // keep the card inside the viewport: flip above the field when there is no room underneath
    if (top + 118 > window.innerHeight) top = Math.max(8, r.top - 126);
    box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 248)) + 'px';
    box.style.top = top + 'px';
    box.style.width = Math.min(240, Math.max(200, r.width)) + 'px';
    box.setAttribute('data-show', '1');
  }

  /* ------------------------------------------------------------------ v2: "did you mean ...?" e-mail typo fixer */
  var typo = null, typoFor = null, typoFix = '';
  var DOMAIN_FIX = {
    'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com',
    'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmaill.com': 'gmail.com',
    'gmail.comm': 'gmail.com', 'gmil.com': 'gmail.com', 'gogglemail.com': 'gmail.com', 'googlemail.co': 'gmail.com'
  };
  function lev(a, b) {
    var m = a.length, n = b.length, i, j, prev, cur, t;
    if (Math.abs(m - n) > 2) return 3;
    prev = []; for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur = [i];
      for (j = 1; j <= n; j++) {
        t = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + t);
      }
      prev = cur;
    }
    return prev[n];
  }
  function suggestDomain(input) {
    var v = (input.value || '').trim(), at = v.lastIndexOf('@');
    if (at < 1) return '';
    var dom = v.slice(at + 1).toLowerCase();
    // only judge a domain once it looks finished (has a dot and a 2+ letter ending)
    if (!/^[a-z0-9.\-]+\.[a-z]{2,}$/.test(dom)) return '';
    if (DOMAIN_FIX[dom]) return v.slice(0, at + 1) + DOMAIN_FIX[dom];
    var expected = domainFromPlaceholder(input).slice(1).toLowerCase();
    if (expected && dom !== expected && expected.length >= 6 && lev(dom, expected) <= 2 && expected.indexOf(dom) !== 0) {
      return v.slice(0, at + 1) + expected;
    }
    return '';
  }
  function hideTypo() { if (typo) typo.removeAttribute('data-show'); typoFor = null; typoFix = ''; }
  function updateTypo(input) {
    if (!input || input.tagName !== 'INPUT' || input.type !== 'email' || !inAuth(input) || document.activeElement !== input) { hideTypo(); return; }
    var fix = suggestDomain(input);
    if (!fix) { hideTypo(); return; }
    if (!typo) {
      typo = el('div', 'cp-li-fix'); typo.setAttribute('role', 'button'); typo.setAttribute('tabindex', '-1');
      typo.appendChild(el('span', 'cp-li-fix-lbl', 'Did you mean'));
      typo.appendChild(el('b'));
      typo.appendChild(el('span', 'cp-li-fix-q', '?'));
      var apply = function (e) { e.preventDefault(); var i = typoFor, f = typoFix; if (i && f) { hideTypo(); setNativeValue(i, f); try { i.setSelectionRange(f.length, f.length); } catch (_) {} i.focus(); } };
      typo.addEventListener('mousedown', apply);
      typo.addEventListener('touchstart', apply, { passive: false });
      doc.body.appendChild(typo);
    }
    typoFor = input; typoFix = fix;
    typo.querySelector('b').textContent = fix;
    var r = input.getBoundingClientRect();
    typo.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 300)) + 'px';
    typo.style.top = Math.max(8, r.top - 34) + 'px';
    typo.setAttribute('data-show', '1');
  }

  /* ------------------------------------------------------------------ v2: keep floating helpers aligned */
  var refreshRaf = 0;
  function scheduleRefresh() { if (!refreshRaf) refreshRaf = requestAnimationFrame(refreshFloaters); }
  function refreshFloaters() {
    refreshRaf = 0;
    var a = doc.activeElement;
    if (!a || a.tagName !== 'INPUT' || !inAuth(a)) { hideGhost(); hideReqs(); hideTypo(); if (strengthLbl) strengthLbl.removeAttribute('data-show'); return; }
    updateGhost(a); updateReqs(a); updateTypo(a);
    if (isNewPasswordField(a) && a.value) updateStrength(a);
    if (capsOn && isPasswordish(a)) showCaps(a, true);
  }

  /* ------------------------------------------------------------------ v2: magnetic sign-in button */
  var magnet = null;
  function applyMagnet(e) {
    if (!finePointer || reduce) return;
    var b = $('.cp-auth-card button[type="submit"]');
    if (!b || b.disabled) { if (magnet) { magnet.style.removeProperty('--cp-bx'); magnet.style.removeProperty('--cp-by'); } return; }
    magnet = b;
    var r = b.getBoundingClientRect();
    var dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    var reach = Math.max(r.width / 2 + 60, 120), d = Math.sqrt(dx * dx + dy * dy);
    if (d > reach) { b.style.removeProperty('--cp-bx'); b.style.removeProperty('--cp-by'); return; }
    var k = (1 - d / reach) * 0.16;
    b.style.setProperty('--cp-bx', clamp(dx * k, -8, 8).toFixed(1) + 'px');
    b.style.setProperty('--cp-by', clamp(dy * k * 1.6, -5, 5).toFixed(1) + 'px');
  }
  function resetMagnet() {
    if (magnet) { magnet.style.removeProperty('--cp-bx'); magnet.style.removeProperty('--cp-by'); }
  }

  /* ------------------------------------------------------------------ v2: signing-in bar, refocus, auto-hide password */
  function watchBusy(card) {
    var sb = card ? card.querySelector('button[type="submit"]') : null;
    var busy = !!(sb && /signing in|sending|verifying|resetting|creating/i.test(sb.textContent || ''));
    root.classList.toggle('cp-signing', busy);
  }
  function refocusPassword(card) {
    var pw = card.querySelector('input[autocomplete="current-password"]');
    var a = doc.activeElement;
    if (!pw || !pw.value) return;
    if (a && a !== doc.body && a.tagName === 'INPUT') return;   // never steal focus from a field being edited
    try { pw.focus({ preventScroll: true }); pw.select(); } catch (_) {}
  }
  var REVEAL_MS = 15000;
  function watchReveal(card) {
    if (!card) return;
    var now = Date.now();
    $all('input[data-cp-pw="1"]', card).forEach(function (n) {
      if (n.type === 'text') {
        if (!n.__cpRevealAt) n.__cpRevealAt = now;
        else if (now - n.__cpRevealAt > REVEAL_MS) {
          n.__cpRevealAt = 0;
          var hideBtn = card.querySelector('button[aria-label="Hide password"]');
          if (hideBtn) hideBtn.click();       // uses the app's own eye toggle, so React state stays correct
        }
      } else n.__cpRevealAt = 0;
    });
  }

  /* ------------------------------------------------------------------ v2: welcome overlay after sign-in */
  var welcome = null;
  function firstName() {
    try {
      var raw = localStorage.getItem('CP_USER'); if (!raw) return '';
      var u = JSON.parse(raw); var n = (u && u.name ? String(u.name) : '').trim().split(/\s+/)[0] || '';
      return n.slice(0, 24);
    } catch (_) { return ''; }
  }
  function showWelcome() {
    if (reduce || welcome) return;
    var w = el('div', 'cp-li-welcome'); w.setAttribute('role', 'status'); w.setAttribute('aria-live', 'polite');
    var ring = el('div', 'cp-li-ring');
    var svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    var path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M5 12.5l4.5 4.5L19 7.5'); svg.appendChild(path); ring.appendChild(svg);
    var name = firstName();
    w.appendChild(ring);
    w.appendChild(el('strong', '', name ? 'Welcome back, ' + name : 'Welcome back'));
    w.appendChild(el('span', '', 'Signed in securely \u2014 opening your portal\u2026'));
    doc.body.appendChild(w); welcome = w;
    setTimeout(function () { w.setAttribute('data-out', '1'); }, 1150);
    setTimeout(function () { if (w.parentNode) w.parentNode.removeChild(w); welcome = null; }, 1550);
  }

  /* ------------------------------------------------------------------ lifecycle */
  var active = false, timers = [], authSince = 0;
  function activate() {
    if (active) return; active = true; authSince = Date.now();
    startCanvas();
    timers.push(setInterval(cycleFeatures, 3200));
    cycleFeatures();
  }
  function deactivate() {
    if (!active) return; active = false;
    stopCanvas();
    timers.forEach(clearInterval); timers = [];
    removePill(); showCaps(null, false); hideGhost(); hideReqs(); hideTypo(); resetMagnet();
    root.classList.remove('cp-signing');
    if (strengthLbl) strengthLbl.removeAttribute('data-show');
    ['--cp-px', '--cp-py', '--cp-mx', '--cp-my', '--cp-spot', '--cp-rx', '--cp-ry', '--cp-fill'].forEach(function (v) { root.style.removeProperty(v); });
    lastError = ''; roleRestored = false; featIdx = 0;
  }
  function tick() {
    var page = $('.cp-auth-page');
    if (!page) {
      var was = active, dwell = Date.now() - authSince;
      deactivate();
      // the login page went away after being on screen for a while = the user just signed in
      if (was && dwell > 1500) showWelcome();
      return;
    }
    activate();
    decorateRoles();
    updatePill();
    watchError();
    updateFill();
    var card = $('.cp-auth-card');
    watchBusy(card);
    watchReveal(card);
    var a = doc.activeElement;
    if (a && a.tagName === 'INPUT' && inAuth(a)) scheduleRefresh();
  }

  function init() {
    doc.addEventListener('pointermove', onPointerMove, { passive: true });
    doc.addEventListener('pointerdown', onPointerDown, true);
    doc.addEventListener('click', onRoleClick, true);
    doc.addEventListener('keydown', onKey, true);
    doc.addEventListener('keyup', onKeyUp, true);
    doc.addEventListener('input', onInput, true);
    doc.addEventListener('focusin', onFocusIn, true);
    doc.addEventListener('focusout', function (e) { onFocusOut(e); onFocusOutStrength(e); }, true);
    doc.documentElement.addEventListener('mouseleave', onPointerLeave);
    window.addEventListener('blur', function () { root.classList.remove('cp-alt-down'); });
    window.addEventListener('resize', function () { if (canvas) resize(); scheduleRefresh(); });
    window.addEventListener('online', updatePill);
    window.addEventListener('offline', updatePill);
    doc.addEventListener('visibilitychange', function () { if (!doc.hidden && canvas && !raf) raf = requestAnimationFrame(frame); });
    doc.addEventListener('mouseover', function (e) { if (e.target && e.target.closest && e.target.closest('.cp-auth-feature')) featPaused = true; }, true);
    doc.addEventListener('mouseout', function (e) { if (e.target && e.target.closest && e.target.closest('.cp-auth-feature')) featPaused = false; }, true);
    window.addEventListener('scroll', scheduleRefresh, true);
    setInterval(function () { if (!doc.hidden) tick(); }, 400);
    tick();
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
