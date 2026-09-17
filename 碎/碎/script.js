/* ============================================================
   UNBELIEVABLY CRAP — 滚动驱动动效引擎
   原生 JS，无第三方动效库。

   全部动画都由 window.scrollY 计算，不使用 CSS transition /
   @keyframes 承担主体动效（噪点与扫描线除外，它们是质感层）。
   ============================================================ */

(function () {
  'use strict';

  var MOBILE_Q = '(max-width: 900px), (pointer: coarse)';

  /* ---------------------------------------------------------
     0. 桌面端闸门：移动端不做任何复杂动效
     --------------------------------------------------------- */
  if (window.matchMedia(MOBILE_Q).matches) {
    document.body.classList.add('is-mobile');
    return;
  }

  /* ---------------------------------------------------------
     1. 确定性噪声 + 量化
     --------------------------------------------------------- */

  /* 伪随机，但对同一个输入永远返回同一个值 —— 所以「错误的位置」是稳定可复现的 */
  function hash(n) {
    var x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }
  function rnd(seed, i) { return hash(seed * 1.37 + i * 7.13); }

  /* 量化：把连续值截断成台阶 —— 这是「生硬卡顿感」的唯一来源。
     去掉这一步，效果立刻变成丝滑的现代动效，风格当场失效。 */
  function q(v, step) { return Math.round(v / step) * step; }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function pad(n, w) {
    var s = String(n);
    while (s.length < w) s = '0' + s;
    return s;
  }

  /* ---------------------------------------------------------
     2. 节点收集
     --------------------------------------------------------- */
  var nodes = [];
  var marqs = [];
  var booted = false;

  /* 用 offsetTop 链计算文档绝对位置：不受自身 transform 影响，
     因此可以只测量一次，之后每帧复用。
     （getBoundingClientRect 会被 transform 污染，只能每帧重测。） */
  function absTop(el) {
    var t = 0, n = el;
    while (n) { t += n.offsetTop; n = n.offsetParent; }
    return t;
  }

  /* 把一段文字拆成单个字符的 span，供打散使用 —— 只能执行一次 */
  function splitChars(el) {
    var text = el.textContent.replace(/\s+/g, ' ').trim();
    var frag = document.createDocumentFragment();
    var spans = [];
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      var s = document.createElement('span');
      s.className = 'ch';
      s.textContent = (ch === ' ') ? '\u00A0' : ch;
      frag.appendChild(s);
      spans.push(s);
    }
    el.textContent = '';
    el.appendChild(frag);
    return spans;
  }

  function collect() {
    nodes = [];
    marqs = [];

    var list = document.querySelectorAll('[data-anim]');
    var seed = 0;

    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      var flags = (el.getAttribute('data-anim') || '').split(/\s+/);

      if (flags.indexOf('marq') > -1) {
        marqs.push({
          track: el.querySelector('.marq__track'),
          speed: parseFloat(el.getAttribute('data-marq-speed')) || 1
        });
        continue;
      }

      var o = {
        el: el,
        seed: (++seed) * 3.77,
        top: 0,
        h: 1,
        settled: false,

        plx: flags.indexOf('plx') > -1,
        jit: flags.indexOf('jit') > -1,
        rot: flags.indexOf('rot') > -1,
        zoom: flags.indexOf('zoom') > -1,
        clip: flags.indexOf('clip') > -1,
        glitch: flags.indexOf('glitch') > -1,
        scatter: flags.indexOf('scatter') > -1,
        fade: flags.indexOf('fade') > -1,
        chars: null,

        speed: parseFloat(el.getAttribute('data-speed')) || 0,
        amp: parseFloat(el.getAttribute('data-amp')) || 200,
        jitAmp: parseFloat(el.getAttribute('data-jit')) || 0,
        rotAmp: parseFloat(el.getAttribute('data-rot')) || 0,
        jump: parseFloat(el.getAttribute('data-jump')) || 0,
        zoomAmp: parseFloat(el.getAttribute('data-zoom')) || 0,
        lsAmp: parseFloat(el.getAttribute('data-ls')) || 0,
        clipAmp: parseFloat(el.getAttribute('data-clip')) || 0,
        clipDir: el.getAttribute('data-clip-dir') || 'bottom',
        scatterAmp: parseFloat(el.getAttribute('data-scatter')) || 0
      };

      if (o.scatter) o.chars = splitChars(el);
      nodes.push(o);
    }
  }

  function measure() {
    for (var i = 0; i < nodes.length; i++) {
      var o = nodes[i];
      o.top = absTop(o.el);
      o.h = o.el.offsetHeight || 1;   /* 布局高度，与 transform 无关 */
    }
  }

  /* ---------------------------------------------------------
     3. 读数面板
     --------------------------------------------------------- */
  var elY = document.getElementById('js-y');
  var elY2 = document.getElementById('js-y2');
  var elPct = document.getElementById('js-pct');
  var elPct2 = document.getElementById('js-pct2');
  var elWheel = document.getElementById('js-wheel');
  var elWheel2 = document.getElementById('js-wheel2');
  var elMeter = document.getElementById('js-meter');
  var elThumb = document.getElementById('js-thumb');
  var elHits = document.getElementById('js-hits');
  var elCx = document.getElementById('js-cx');
  var elCy = document.getElementById('js-cy');
  var elClock = document.getElementById('js-clock');
  var elScan = document.querySelector('.scan');

  var wheelCount = 0;

  /* 假的系统时钟：只显示，不可交互，等宽数字避免每秒钟左右抖动 */
  function tickClock() {
    if (!elClock) return;
    var d = new Date();
    elClock.textContent =
      pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2);
  }
  tickClock();
  window.setInterval(tickClock, 1000);

  /* ---------------------------------------------------------
     4. 每帧计算
     --------------------------------------------------------- */
  function update() {
    var y = window.pageYOffset;
    var vh = window.innerHeight;
    var docH = document.documentElement.scrollHeight;
    var max = Math.max(1, docH - vh);
    var ratio = clamp(y / max, 0, 1);

    /* 抖动节拍：每滚过 26px 换一次节拍。
       噪声只随节拍变化 → 位移是「跳」的，而不是随滚动平滑过渡。 */
    var beat = Math.floor(y / 26);

    for (var i = 0; i < nodes.length; i++) {
      var o = nodes[i];
      var top = o.top;
      var h = o.h;

      /* 视口外跳过，省算力；已应用的 transform 会停在原地 */
      if (top - y - h > vh * 0.8) continue;
      if (top + h - y < -vh * 0.8) continue;

      /* p: 0 = 元素刚从底部进入视口, 1 = 元素已完全离开顶部 */
      var p = clamp((y + vh - top) / (vh + h), 0, 1);
      var m = p - 0.5;                 /* -0.5 .. 0.5 */

      var tx = 0, ty = 0, rot = 0, sc = 1;

      /* — 分层视差：speed 为正 → 随滚动向下（相对慢）；为负 → 反向向上 — */
      if (o.plx) {
        ty = q(-m * o.amp * o.speed, 2);
      }

      /* — 非平滑抖动：X/Y 随机偏移，随节拍跳变 — */
      if (o.jit) {
        tx = q((rnd(o.seed, beat) - 0.5) * o.jitAmp, 1);
        ty += q((rnd(o.seed + 4.1, beat) - 0.5) * o.jitAmp * 0.4, 1);
      }

      /* — 生硬旋转：渐变旋转 + 节拍驱动的跳变 — */
      if (o.rot) {
        rot = q(m * o.rotAmp + (rnd(o.seed + 8.3, beat) - 0.5) * o.jump, 0.5);
      }

      /* — 缩放突变 — */
      if (o.zoom) {
        sc = 1 + q(m * o.zoomAmp, 0.01);
        if (o.jump) sc += q((rnd(o.seed + 12.7, beat) - 0.5) * o.jump * 0.012, 0.005);
        if (sc < 0.35) sc = 0.35;
        if (sc > 2.4) sc = 2.4;
      }

      var tf = '';
      if (tx || ty) tf += 'translate3d(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px,0)';
      if (rot) tf += ' rotate(' + rot.toFixed(2) + 'deg)';
      if (sc !== 1) tf += ' scale(' + sc.toFixed(3) + ')';
      o.el.style.transform = tf || 'none';

      /* — 字符间距随滚动变化 — */
      if (o.lsAmp) {
        o.el.style.letterSpacing = q(m * o.lsAmp, 0.25).toFixed(2) + 'px';
      }

      /* — clip 裁切：越往下滚，切掉的越多 — */
      if (o.clip && o.clipAmp) {
        var cut = q(clamp((p - 0.26) / 0.74, 0, 1) * o.clipAmp, 0.5);
        var inset;
        if (o.clipDir === 'top') {
          inset = 'inset(' + cut + '% 0% 0% 0%)';
        } else if (o.clipDir === 'both') {
          inset = 'inset(' + cut + '% 0% ' + cut + '% 0%)';
        } else {
          inset = 'inset(0% 0% ' + cut + '% 0%)';
        }
        o.el.style.clipPath = inset;
        o.el.style.webkitClipPath = inset;
      }

      /* — 故障错位：驱动伪元素的红 / 青偏移层 — */
      if (o.glitch) {
        o.el.style.setProperty('--gx', q((rnd(o.seed + 21.3, beat) - 0.5) * 16, 1) + 'px');
        o.el.style.setProperty('--gy', q((rnd(o.seed + 33.9, beat) - 0.5) * 7, 1) + 'px');
      }

      /* — 模糊解析：进入视口时由虚到实，替代参考站点的 CSS 逐行入场。
           只在解析带里写 filter（模糊很贵），一旦解析完成就落定为 none
           并停止写入 —— 这是这套效果唯一需要留意的性能点。 — */
      if (o.fade) {
        var f = clamp((p - 0.02) / 0.3, 0, 1);
        if (f >= 1) {
          if (!o.settled) {
            o.el.style.filter = 'none';
            o.el.style.opacity = '';
            o.settled = true;
          }
        } else {
          o.settled = false;
          var blur = q((1 - f) * 8, 0.5);
          o.el.style.filter = blur > 0.1 ? 'blur(' + blur + 'px)' : 'none';
          o.el.style.opacity = (0.2 + f * 0.8).toFixed(2);
        }
      }

      /* — 文本打散：逐字符偏移 — */
      if (o.scatter && o.chars) {
        var chars = o.chars;
        var n = chars.length;
        var a = o.scatterAmp;
        for (var c = 0; c < n; c++) {
          var r1 = rnd(o.seed + c * 2.71, beat);
          var r2 = rnd(o.seed + c * 5.19, beat + 17);
          var dx = q((r1 - 0.5) * a * 1.4 + m * a * 0.35, 1);
          var dy = q((r2 - 0.5) * a * 0.7 + m * a * 0.4, 1);
          chars[c].style.transform =
            'translate3d(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px,0)';
        }
      }
    }

    /* — 扫描线滚动偏移：3px 一个周期，做取模保证无缝 — */
    if (elScan) {
      elScan.style.setProperty('--scan-roll', ((y * 0.12) % 3).toFixed(2) + 'px');
    }

    /* — 滚动驱动跑马灯 — */
    for (var k = 0; k < marqs.length; k++) {
      var mo = marqs[k];
      if (!mo.track) continue;
      var w = mo.track.offsetWidth / 2;
      if (w < 10) continue;
      var x = -(((y * mo.speed) % w + w) % w);
      mo.track.style.transform = 'translate3d(' + x.toFixed(1) + 'px,0,0)';
    }

    /* — 面板读数 — */
    if (elY) elY.textContent = String(y);
    if (elY2) elY2.textContent = pad(y, 4);
    if (elCy) elCy.textContent = pad(y, 6);
    if (elCx) elCx.textContent = pad(Math.round(y * 0.37 + vh * 0.5), 4);

    /* 假装是上传进度，其实是滚动进度，而且永远到不了 100% */
    if (elMeter) elMeter.style.width = (ratio * 97).toFixed(1) + '%';
    if (elPct) elPct.textContent = Math.round(ratio * 97) + '%';
    if (elPct2) elPct2.textContent = Math.round(ratio * 100) + '%';
    if (elThumb) elThumb.style.width = (ratio * 100).toFixed(1) + '%';

    /* 计数器跟着滚动往上跳，但它是「1999 年停止更新」的计数器 */
    if (elHits) elHits.textContent = pad(133 + Math.floor(y / 3), 6);
  }

  /* ---------------------------------------------------------
     5. 事件绑定
     --------------------------------------------------------- */
  var ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      update();
      ticking = false;
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });

  window.addEventListener('wheel', function () {
    wheelCount++;
    if (elWheel) elWheel.textContent = String(wheelCount);
    if (elWheel2) elWheel2.textContent = String(wheelCount);
  }, { passive: true });

  /* resize: 重新测量（节流） */
  var rzTimer = null;
  window.addEventListener('resize', function () {
    if (rzTimer) window.clearTimeout(rzTimer);
    rzTimer = window.setTimeout(function () {
      measure();
      update();
    }, 120);
  });

  /* ---------------------------------------------------------
     6. 启动
     --------------------------------------------------------- */
  function boot() {
    if (booted) return;
    booted = true;
    collect();
    measure();
    update();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* 字体 / 图片导致的布局位移后再校准两次 */
  window.addEventListener('load', function () {
    if (!booted) return;
    measure();
    update();
  });
  window.setTimeout(function () {
    if (!booted) return;
    measure();
    update();
  }, 900);

})();
