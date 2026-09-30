/* ==========================================================================
   hero-motion.js — A/B-тест первого экрана (вариант B).
   B = кинематографичная canvas-сцена «200 -> +200 -> 400» (премиум-финтех:
   стекло, частицы, cyan-glow, motion blur). 8.2 с, бесконечный цикл.

   Тест откатывается удалением двух тегов со страницы; существующие файлы
   (styles.css, инлайн-скрипты) не изменяются.
   QA: ?mo=a | ?mo=b принудительно задают вариант,
       window.__cineSeek(sec) рисует конкретный кадр, window.__cineFreeze(true) стопорит цикл.
   ========================================================================== */
(() => {
  'use strict';

  const NS = 'tao-hero-v1';
  const COOKIE = 'mo_ab';

  /* ---------- 1. вариант A/B ---------- */
  const forced = (new URLSearchParams(location.search).get('mo') || '').toLowerCase();
  const fromCookie = (document.cookie.match(new RegExp('(?:^|; )' + COOKIE + '=([ab])')) || [])[1];
  let variant = (forced === 'a' || forced === 'b') ? forced : fromCookie;
  if (!variant) {
    variant = Math.random() < 0.5 ? 'a' : 'b';
    document.cookie = COOKIE + '=' + variant + '; path=/; max-age=604800; SameSite=Lax';
  }
  const root = document.documentElement;
  root.setAttribute('data-mo-variant', variant);
  window.__moVariant = variant;

  /* ---------- 2. замер CTR: маяк через Image (без CORS) ---------- */
  const hit = (key) => {
    try {
      const seen = 'mo_seen_' + key;
      if (sessionStorage.getItem(seen)) return;      // считаем сессии, не хиты
      sessionStorage.setItem(seen, '1');
      new Image().src = 'https://abacus.jasoncameron.dev/hit/' + NS + '/' + key;
    } catch (e) { /* приватный режим — пропускаем */ }
  };
  hit(variant + '-view');
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href*="getstarted.tiktok.com"]');
    if (a) hit(variant + '-click');
  }, true);

  if (variant !== 'b') return;

  /* ---------- 3. карточка со сценой ---------- */
  const host = document.querySelector('.hero-copy .hero-actions');
  if (!host || !host.parentNode) return;

  const card = document.createElement('div');
  card.className = 'mo-cine';
  card.setAttribute('role', 'img');
  card.setAttribute('aria-label',
    'Анимация: 200 USD расходов на рекламу превращаются в 400 USD рекламного бюджета — ' +
    '200 USD расходов плюс 200 USD рекламного кредита.');
  card.innerHTML =
    '<div class="mo-canvas-wrap"><canvas></canvas></div>' +
    '<div class="mo-cine-bar"><span><i></i><b>200 USD</b> + <b>200 USD кредит*</b></span><span>= 400 USD рекламного бюджета</span></div>' +
    '<p class="mo-caption">* Если предложение доступно и выполнены условия TikTok: критерии участия, период расходов и сроки ' +
    'начисления зависят от рекламодателя и страны. Суммы в USD, кредит не является денежными средствами.</p>';
  host.parentNode.insertBefore(card, host.nextSibling);
  root.classList.add('mo-b');

  const canvas = card.querySelector('canvas');
  const ctx = canvas.getContext('2d', { alpha: true });
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const CYAN = [32, 217, 231];
  const PINK = [251, 40, 120];
  const WHITE = [232, 238, 246];

  let W = 468, H = 232, DPR = 1;
  let parts = [];
  let targets = { big200: [], mid200: [], big400: [] };
  let ready = false;
  let frozen = false, seekT = null, simulateOnly = false;

  /* ---------- 4. сэмплирование текста в частицы ---------- */
  const fontStr = (size, weight) => `${weight || 700} ${size}px "Space Grotesk", "DM Sans", Arial, sans-serif`;

  function sampleText(text, fontSize, weight, step) {
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const c = off.getContext('2d');
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = fontStr(fontSize, weight);
    c.fillText(text, W / 2, H / 2);
    const d = c.getImageData(0, 0, W, H).data;
    const pts = [];
    for (let y = 0; y < H; y += step) {
      for (let x = 0; x < W; x += step) {
        if (d[(y * W + x) * 4 + 3] > 130) pts.push({ x, y });
      }
    }
    return pts;
  }

  function buildTargets() {
    targets.big200 = sampleText('$200', Math.round(H * 0.52), 700, Math.max(2, Math.round(H / 90)));
    targets.mid200 = sampleText('$200', Math.round(H * 0.34), 700, Math.max(2, Math.round(H / 105)));
    targets.big400 = sampleText('$400', Math.round(H * 0.60), 700, Math.max(2, Math.round(H / 95)));
    // равномерно прореживаем, чтобы пул частиц был одинаковым для всех состояний
    const N = 1150;
    const stride = (arr) => {
      if (!arr.length) return [];
      const out = [];
      for (let i = 0; i < N; i++) out.push(arr[Math.floor(i * arr.length / N)]);
      return out;
    };
    targets.big200 = stride(targets.big200);
    targets.mid200 = stride(targets.mid200);
    targets.big400 = stride(targets.big400);
  }

  function initParticles() {
    parts = [];
    for (let i = 0; i < targets.big200.length; i++) {
      const edge = Math.random();
      parts.push({
        x: edge < .5 ? Math.random() * W : (Math.random() < .5 ? -20 : W + 20),
        y: Math.random() * H,
        tx: targets.big200[i].x, ty: targets.big200[i].y,
        vx: 0, vy: 0,
        s: 0.7 + Math.random() * 1.1,
        ph: Math.random() * Math.PI * 2,
        c: WHITE.slice(),
        side: i % 100 < 55 ? 0 : 1          // 0 — первый $200, 1 — клон
      });
    }
  }

  /* ---------- 5. размеры ---------- */
  function resize() {
    const wrap = card.querySelector('.mo-canvas-wrap');
    const r = wrap.getBoundingClientRect();
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(240, Math.round(r.width));
    H = Math.max(150, Math.round(r.height));
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    buildTargets();
    initParticles();
    ready = true;
  }

  /* ---------- 6. таймлайн ---------- */
  const TOTAL = 8.2;
  const stage = (t) => {
    if (t < 1.6) return { n: 'assemble', p: t / 1.6 };
    if (t < 3.2) return { n: 'forward', p: (t - 1.6) / 1.6 };
    if (t < 4.6) return { n: 'clone', p: (t - 3.2) / 1.4 };
    if (t < 6.0) return { n: 'merge', p: (t - 4.6) / 1.4 };
    return { n: 'hold', p: (t - 6.0) / (TOTAL - 6.0) };
  };

  const easeOut = (p) => 1 - Math.pow(1 - p, 3);
  const easeInOut = (p) => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  const mix = (a, b, p) => a + (b - a) * p;
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  function assignTargets(st, t) {
    const cx = W / 2, cy = H / 2;
    const scale = (pt, k, dx, dy) => ({ x: cx + (pt.x - cx) * k + (dx || 0), y: cy + (pt.y - cy) * k + (dy || 0) });

    if (st.n === 'assemble' || st.n === 'forward') {
      const k = st.n === 'assemble' ? 1 - 0.06 * st.p : mix(1, 1.3, easeInOut(st.p));
      const dy = st.n === 'forward' ? mix(0, -6, easeInOut(st.p)) : 0;
      for (let i = 0; i < parts.length; i++) {
        const pt = parts[i];
        const t0 = targets.big200[i] || targets.big200[0];
        const g = scale(t0, k, 0, dy);
        pt.tx = g.x; pt.ty = g.y;
        pt.c = WHITE;
      }
      return;
    }

    if (st.n === 'clone') {
      const q = easeOut(st.p);
      for (let i = 0; i < parts.length; i++) {
        const pt = parts[i];
        const src = targets.big200[i];
        if (!src) continue;
        if (pt.side === 0) {
          const g = scale(src, mix(1.3, .55, q), mix(0, -W * 0.185, q), mix(-6, 0, q));
          pt.tx = g.x; pt.ty = g.y;
          pt.c = WHITE;
        } else {
          const m = targets.mid200[i] || src;
          const g = scale(m, mix(1.1, .55, q), mix(W * 0.62, W * 0.185, q), mix(-6, 0, q));
          pt.tx = g.x; pt.ty = g.y;
          pt.c = CYAN;
        }
      }
      return;
    }

    // merge + hold
    const q = st.n === 'merge' ? easeInOut(st.p) : 1;
    for (let i = 0; i < parts.length; i++) {
      const src = targets.big400[i] || targets.big400[0];
      const pt = parts[i];
      const punch = st.n === 'merge' ? 1 + 0.16 * flashP : 1 + 0.012 * Math.sin(t * 1.6);
      const g = scale(src, mix(.9, 1, q) * punch, 0, 0);
      pt.tx = g.x; pt.ty = g.y;
      const wasCyan = pt.side === 1;
      pt.c = wasCyan && st.n === 'merge' && st.p < .7 ? CYAN : WHITE;
    }
  }

  function drawHud(st, t) {
    const fadeIn = Math.max(0, Math.min(1, (t - 1.5) / .5));
    const fadeOut = st.n === 'merge' ? 1 - Math.min(1, st.p / .5) : st.n === 'hold' ? 0 : 1;
    const a = fadeIn * fadeOut;
    if (a <= .01) return;

    ctx.save();
    ctx.globalAlpha = a;

    // HUD-рамка вокруг числа
    const pad = 16, boxTop = H * .18, boxH = H * .64, boxW = W * .58;
    ctx.strokeStyle = rgba(CYAN, .28);
    ctx.lineWidth = 1;
    const x0 = (W - boxW) / 2, x1 = x0 + boxW, y0 = boxTop, y1 = boxTop + boxH, L = 14;
    [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]].forEach(([x, y, sx, sy]) => {
      ctx.beginPath();
      ctx.moveTo(x + sx * L, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * L);
      ctx.stroke();
    });

    // мини-график (слева снизу)
    const gw = W * .26, gh = H * .17, gx = pad, gy = H - pad - gh;
    ctx.strokeStyle = rgba(CYAN, .5);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const seedPts = [0.62, 0.5, 0.56, 0.38, 0.44, 0.26, 0.3, 0.12];
    seedPts.forEach((v, i) => {
      const px = gx + (gw / (seedPts.length - 1)) * i;
      const py = gy + gh * v;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.stroke();
    ctx.fillStyle = rgba(CYAN, .10);
    ctx.lineTo(gx + gw, gy + gh); ctx.lineTo(gx, gy + gh); ctx.closePath(); ctx.fill();

    // подписи-чипы
    ctx.font = '700 8px "DM Sans", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const chips = [['IMPRESSIONS', CYAN], ['CLICKS', PINK]];
    chips.forEach(([label, col], i) => {
      const cw = ctx.measureText(label).width + 12;
      const cx0 = W - pad - cw, cy0 = pad + i * 17;
      ctx.fillStyle = 'rgba(255,255,255,.05)';
      ctx.fillRect(cx0, cy0, cw, 13);
      ctx.strokeStyle = rgba(col, .35);
      ctx.lineWidth = 1;
      ctx.strokeRect(cx0 + .5, cy0 + .5, cw - 1, 12);
      ctx.fillStyle = rgba(col, .85);
      ctx.fillText(label, cx0 + 6, cy0 + 7);
    });

    // подпись под графиком
    ctx.fillStyle = 'rgba(139,147,161,.75)';
    ctx.font = '700 8px "DM Sans", Arial, sans-serif';
    ctx.fillText('ADS MANAGER', gx, gy - 8);

    if (st.n === 'clone' && st.p > .45) {
      ctx.textAlign = 'center';
      ctx.fillStyle = rgba(CYAN, Math.min(1, (st.p - .45) * 3));
      ctx.font = '700 10px "DM Sans", Arial, sans-serif';
      ctx.fillText('+200 USD КРЕДИТ*', W * .72, H * .90);
    }
    ctx.restore();
  }

  function drawGrid() {
    ctx.save();
    ctx.globalAlpha = .16;
    ctx.strokeStyle = 'rgba(63,144,159,.5)';
    ctx.lineWidth = 1;
    const g = 46;
    ctx.beginPath();
    for (let x = (W % g) / 2; x < W; x += g) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = (H % g) / 2; y < H; y += g) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    ctx.restore();
  }

  function frame(t) {
    const st = stage(t);
    assignTargets(st, t);

    // затухание (motion blur / trail)
    if (!simulateOnly) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(8,11,16,0.34)';
      ctx.fillRect(0, 0, W, H);
      drawGrid();
    }

    // свечение при «схлопывании»
    const flashP = st.n === 'merge' ? Math.max(0, 1 - Math.abs(st.p - .72) * 9) : 0;

    const k = st.n === 'hold' ? .022
      : st.n === 'merge' ? .085
      : st.n === 'forward' ? .045 : .085;

    ctx.globalCompositeOperation = 'lighter';
    const big = st.n === 'forward' || st.n === 'merge';
    for (const p of parts) {
      p.x += (p.tx - p.x) * k;
      p.y += (p.ty - p.y) * k;
      if (st.n === 'hold') {
        const j = Math.sin(t * 2 + p.ph) * .5;
        p.x += j * .12; p.y += Math.cos(t * 1.7 + p.ph) * .12;
      }
      if (simulateOnly) continue;
      const tw = st.n === 'hold' ? .62 + .38 * Math.sin(t * 2.4 + p.ph) : .92;
      const size = p.s * (big ? 1.15 : 1);
      ctx.fillStyle = rgba(p.c, .85 * tw);
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, 6.283);
      ctx.fill();
      if (size > 1.1) {                       // мягкий ореол у крупных частиц
        ctx.fillStyle = rgba(p.c, .10 * tw);
        ctx.beginPath();
        ctx.arc(p.x, p.y, size * 3.4, 0, 6.283);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    if (!simulateOnly) drawHud(st, t);

    if (flashP > .01 && !simulateOnly) {
      ctx.fillStyle = `rgba(255,255,255,${.32 * flashP})`;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = rgba(CYAN, .45 * flashP);
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, W - 2, H - 2);
    }

    // затемнение по краям (vignette)
    if (simulateOnly) return;
    const g = ctx.createRadialGradient(W / 2, H / 2, H * .28, W / 2, H / 2, H * .95);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    if (st.n === 'hold') {
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(139,147,161,${.55 + .25 * Math.sin(t * 2)})`;
      ctx.font = '700 9px "DM Sans", Arial, sans-serif';
      ctx.fillText('200 USD РАСХОДОВ  +  200 USD КРЕДИТ*', W / 2, H * .88);
    }
  }

  /* ---------- 7. цикл ---------- */
  let t0 = performance.now();
  function loop(now) {
    if (!ready) { requestAnimationFrame(loop); return; }
    if (!frozen && seekT === null) {
      const t = ((now - t0) / 1000) % TOTAL;
      frame(t);
    }
    requestAnimationFrame(loop);
  }

  window.__cineSeek = (sec) => { seekT = sec; ready && frame(sec); return 'кадр ' + sec + 'с'; };
  // рендер «как будет выглядеть на sec секунде»: сброс частиц и прогон таймлайна
  window.__cineStill = (sec) => {
    if (!ready) return null;
    resize();
    const step = 1 / 32;
    simulateOnly = true;                       // прогон позиций без отрисовки (быстро)
    for (let t = 0; t <= sec + 1e-6; t += step) frame(t);
    simulateOnly = false;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgb(8,11,16)';
    ctx.fillRect(0, 0, W, H);
    frame(sec);                                // и один полноценный кадр
    return canvas.toDataURL('image/png');
  };
  window.__cineFreeze = (v) => { frozen = !!v; if (!v) t0 = performance.now(); return frozen; };
  window.__cineInfo = () => ({ W, H, particles: parts.length, texts: {
    big200: targets.big200.length, mid200: targets.mid200.length, big400: targets.big400.length } });

  const start = () => {
    requestAnimationFrame(loop);
    window.addEventListener('resize', () => setTimeout(resize, 120), { passive: true });
  };

  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => {
    resize();
    if (reduce) { frozen = true; frame(6.9); }   // статичный финальный кадр
    else start();
  });
})();
