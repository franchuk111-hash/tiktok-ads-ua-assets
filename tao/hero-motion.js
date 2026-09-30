/* ==========================================================================
   hero-motion.js — A/B-тест первого экрана (вариант B: «механика предложения»).
   Самостоятельный файл: существующие скрипты и разметка не меняются, модуль
   добавляется в DOM динамически, поэтому тест откатывается удалением 2 тегов.
   QA: страница принимает ?mo=a | ?mo=b (принудительный вариант).
   ========================================================================== */
(() => {
  'use strict';

  const NS = 'tao-hero-v1';                 // namespace счётчика
  const COOKIE = 'mo_ab';
  const STEP_MS = 2600;                     // шаг по уровням = один «прилёт» монеты
  const TIERS = [
    { spend: '200',    reward: 200  },
    { spend: '1 000',  reward: 750  },
    { spend: '4 000',  reward: 3000 },
    { spend: '10 000', reward: 6000 }
  ];

  /* ---------- 1. вариант ---------- */
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

  /* ---------- 2. замер: маяк через Image (CORS не нужен) ---------- */
  const hit = (key) => {
    try {
      const seen = 'mo_seen_' + key;
      if (sessionStorage.getItem(seen)) return;      // считаем сессии, а не хиты
      sessionStorage.setItem(seen, '1');
      new Image().src = 'https://abacus.jasoncameron.dev/hit/' + NS + '/' + key;
    } catch (e) { /* приватный режим — просто пропускаем */ }
  };
  hit(variant + '-view');

  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href*="getstarted.tiktok.com"]');
    if (a) hit(variant + '-click');
  }, true);

  if (variant !== 'b') return;                    // вариант A — страница не меняется

  /* ---------- 3. модуль «механика предложения» ---------- */
  const COIN =
    '<svg viewBox="0 0 32 32" aria-hidden="true">' +
      '<defs><linearGradient id="moCoinG" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#ffe27a"/><stop offset="1" stop-color="#f0a91c"/>' +
      '</linearGradient></defs>' +
      '<g class="mo-coin-face">' +
        '<circle cx="16" cy="16" r="14" fill="url(#moCoinG)"/>' +
        '<circle cx="16" cy="16" r="11.4" fill="none" stroke="rgba(120,70,0,.32)" stroke-width="1.2"/>' +
        '<circle cx="11.6" cy="13.4" r="1.7" fill="#3a2500"/>' +
        '<circle cx="20.4" cy="13.4" r="1.7" fill="#3a2500"/>' +
        '<path d="M10.6 19.4c1.5 2.3 3.4 3.4 5.4 3.4s3.9-1.1 5.4-3.4" fill="none" ' +
          'stroke="#3a2500" stroke-width="1.7" stroke-linecap="round"/>' +
        '<circle cx="9.2" cy="18" r="1.5" fill="rgba(251,40,120,.4)"/>' +
        '<circle cx="22.8" cy="18" r="1.5" fill="rgba(251,40,120,.4)"/>' +
      '</g>' +
    '</svg>';

  const marks = TIERS.map((t, i) =>
    '<div class="mo-mark' + (i === TIERS.length - 1 ? ' is-prize' : '') + '" style="left:' + (i * 25) + '%">' +
      t.spend +
    '</div>').join('');

  const el = document.createElement('div');
  el.className = 'mo-mech';
  el.setAttribute('aria-hidden', 'true');   // те же факты уже озвучены в блоке предложения
  el.innerHTML =
    '<div class="mo-head">' +
      '<span class="mo-live"><i></i>МЕХАНИКА ПРЕДЛОЖЕНИЯ</span><span>4 УРОВНЯ</span>' +
    '</div>' +
    '<div class="mo-pair">' +
      '<div class="mo-cell mo-spend"><span>Ваши расходы</span><strong data-mo-spend>0 USD</strong></div>' +
      '<div class="mo-arrow" aria-hidden="true">→</div>' +
      '<div class="mo-cell mo-credit"><span>Ваш кредит</span><strong data-mo-credit>+0 USD*</strong></div>' +
    '</div>' +
    '<div class="mo-track">' +
      '<div class="mo-rail"></div>' + marks +
      '<div class="mo-coin">' + COIN + '</div>' +
    '</div>' +
    '<div class="mo-tier-read">' +
      '<span data-mo-tier-label>Кредит на уровне 200 USD расходов</span>' +
      '<b data-mo-tier-reward>200 USD*</b>' +
    '</div>' +
    '<p class="mo-note">* Если предложение доступно и выполнены условия TikTok. Суммы в USD, ' +
      'кредит не является денежными средствами.</p>';

  const host = document.querySelector('.hero-copy .hero-actions');
  if (!host || !host.parentNode) return;      // разметка не та — ничего не ломаем
  host.parentNode.insertBefore(el, host.nextSibling);
  root.classList.add('mo-b');

  /* ---------- 4. счётчики и цикл уровней ---------- */
  const q = (s) => el.querySelector(s);
  const spendEl = q('[data-mo-spend]');
  const creditEl = q('[data-mo-credit]');
  const rewardEl = q('[data-mo-tier-reward]');
  const labelEl = q('[data-mo-tier-label]');
  const creditCell = q('.mo-credit');
  const markEls = el.querySelectorAll('.mo-mark');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const fmt = (n) => n.toLocaleString('ru-RU').replace(/\u00a0/g, ' ');

  const countTo = (node, from, to, ms, suffix, prefix) => {
    if (reduce) { node.textContent = (prefix || '') + fmt(to) + suffix; return; }
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      node.textContent = (prefix || '') + fmt(Math.round(from + (to - from) * eased)) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  countTo(spendEl, 0, 200, 1000, ' USD', '');
  countTo(creditEl, 0, 200, 1350, ' USD*', '+');

  let i = 0, prev = 0;
  const step = () => {
    const tier = TIERS[i];
    markEls.forEach((m, idx) => m.classList.toggle('is-on', idx <= i));
    countTo(rewardEl, prev, tier.reward, 480, ' USD*', '');
    labelEl.textContent = 'Кредит на уровне ' + tier.spend + ' USD расходов';
    prev = tier.reward;
    creditCell.classList.remove('is-hit');
    void creditCell.offsetWidth;              // рестарт анимации
    creditCell.classList.add('is-hit');
    i = (i + 1) % TIERS.length;
    if (i === 0) prev = 0;                    // цикл начинается заново
  };
  setTimeout(step, 1500);
  if (!reduce) setInterval(step, STEP_MS);
})();
