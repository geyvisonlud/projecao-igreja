// Tela de Retorno (monitor de palco para músicos e pregador): relógio, timer, o que está no
// telão agora e o que vem a seguir. Usada na janela de Retorno e na prévia do operador.
(function (root) {
  'use strict';

  const { fmt, remaining } = root.ScreenView;
  const pad = (n) => String(n).padStart(2, '0');

  function create(el) {
    el.classList.add('stage');
    el.innerHTML =
      '<div class="st-top"><span class="st-clock"></span><span class="st-title"></span><span class="st-flags"></span><span class="st-timer"></span></div>' +
      '<div class="st-now"><div class="st-now-text"></div></div>' +
      '<div class="st-next"><div class="st-next-label">A seguir</div><div class="st-next-text"></div></div>';
    const q = (s) => el.querySelector(s);
    const clock = q('.st-clock');
    const title = q('.st-title');
    const flags = q('.st-flags');
    const timerEl = q('.st-timer');
    const nowBox = q('.st-now');
    const nowText = q('.st-now-text');
    const nextBox = q('.st-next');
    const nextText = q('.st-next-text');
    let state = null;

    function fit(box, text, basePx) {
      let size = basePx;
      text.style.fontSize = size + 'px';
      for (let i = 0; i < 60 && size > 6; i++) {
        if (text.offsetHeight <= box.clientHeight && text.scrollWidth <= text.clientWidth) break;
        size *= 0.93;
        text.style.fontSize = size + 'px';
      }
    }

    const describe = (part) =>
      !part ? '' : part.text != null ? part.text : part.mediaType === 'video' ? `▶ Vídeo — ${part.name}` : `Imagem — ${part.name}`;

    function draw() {
      const h = el.clientHeight;
      if (!h) return;
      el.style.setProperty('--u', h / 100 + 'px');
      const now = new Date();
      clock.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      if (!state) return;
      const st = state.stage || {};

      title.textContent = [st.title, st.label].filter(Boolean).join(' · ');
      flags.textContent = state.black ? 'Tela preta' : state.hideText ? 'Letra oculta' : '';

      // O timer aparece sempre que estiver correndo ou no telão, mesmo durante as músicas.
      const t = state.timer;
      const showTimer = t && (t.endAt != null || state.content?.type === 'timer');
      timerEl.classList.toggle('on', !!showTimer);
      if (showTimer) {
        const ms = remaining(t);
        timerEl.textContent = fmt(ms);
        timerEl.classList.toggle('warn', ms > 0 && ms <= 60000);
        timerEl.classList.toggle('over', ms <= 0);
      }

      const current = state.content?.type === 'timer' ? { text: fmt(remaining(state.content)) } : st.current;
      nowText.textContent = describe(current);
      nowText.classList.toggle('media', !!current && current.text == null);
      fit(nowBox, nowText, h * 0.11);

      nextBox.classList.toggle('empty', !st.next);
      nextText.textContent = st.next ? [st.next.title, describe(st.next)].filter(Boolean).join('\n') : '';
      fit(nextBox, nextText, h * 0.055);
    }

    setInterval(draw, 500);
    new ResizeObserver(draw).observe(el);
    return {
      update(next) {
        state = next;
        draw();
      },
    };
  }

  root.StageView = { create };
})(window);
