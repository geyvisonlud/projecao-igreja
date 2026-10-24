// Desenha o conteúdo do telão (fundo, letra ou timer, tela preta) num elemento.
// A mesma função alimenta a janela de projeção e a pré-visualização do operador,
// então o que o operador vê é exatamente o que vai para o telão.
(function (root) {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');

  function fmt(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  // Timer rodando guarda o horário de término; pausado guarda o tempo restante.
  function remaining(t) {
    return t.endAt != null ? t.endAt - Date.now() : t.remaining;
  }

  function create(root) {
    root.classList.add('screen');
    root.innerHTML =
      '<div class="bg"></div><div class="dim"></div>' +
      '<div class="content"><div class="top"></div><div class="main"></div></div>' +
      '<div class="black"></div>';
    const bg = root.querySelector('.bg');
    const dim = root.querySelector('.dim');
    const content = root.querySelector('.content');
    const top = root.querySelector('.top');
    const main = root.querySelector('.main');
    const black = root.querySelector('.black');

    let state = null;
    let bgKey = null;
    let contentKey = null;
    let fadeTimer = null;
    let tick = null;

    function setBackground(b) {
      const key = b ? `${b.type}|${b.url || b.color}` : 'none';
      if (key === bgKey) return;
      bgKey = key;
      const layer = document.createElement('div');
      layer.className = 'bg-layer';
      if (b && b.type === 'color') layer.style.background = b.color;
      else if (b && b.type === 'video') {
        const v = document.createElement('video');
        Object.assign(v, { src: b.url, autoplay: true, loop: true, muted: true, playsInline: true });
        layer.append(v);
      } else if (b && b.type === 'image') {
        const img = document.createElement('img');
        img.src = b.url;
        layer.append(img);
      }
      bg.append(layer);
      requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('on')));
      const old = [...bg.children].filter((c) => c !== layer);
      setTimeout(() => old.forEach((c) => c.remove()), 800);
    }

    // Reduz a fonte até o texto caber na área útil da tela.
    function fit(basePx) {
      let size = basePx;
      main.style.fontSize = size + 'px';
      for (let i = 0; i < 60 && size > 6; i++) {
        const tooTall = main.offsetHeight + top.offsetHeight > content.clientHeight;
        const tooWide = main.scrollWidth > main.clientWidth;
        if (!tooTall && !tooWide) break;
        size *= 0.94;
        main.style.fontSize = size + 'px';
      }
    }

    function draw() {
      const c = state && !state.hideText ? state.content : null;
      const theme = (state && state.theme) || {};
      const h = root.clientHeight;
      top.textContent = '';
      main.textContent = '';
      main.className = 'main';
      root.classList.toggle('is-timer', !!c && c.type === 'timer');
      main.style.textTransform = theme.uppercase ? 'uppercase' : 'none';
      if (!c || !h) return;

      if (c.type === 'text') {
        main.textContent = c.text;
        fit((h * (theme.fontSize || 8)) / 100);
      } else if (c.type === 'timer') {
        const ms = remaining(c);
        top.textContent = c.message || '';
        top.style.fontSize = h * 0.07 + 'px';
        if (ms <= 0 && c.endMessage) {
          main.textContent = c.endMessage;
          main.classList.add('done');
          fit(h * 0.14);
        } else {
          main.textContent = fmt(ms);
          main.classList.add('clock');
          if (ms > 0 && ms <= 60000) main.classList.add('warn');
          fit(h * 0.28);
        }
      }
    }

    function update(next) {
      state = next;
      setBackground(state.background);
      const hasMedia = state.background && state.background.type !== 'color';
      dim.style.opacity = hasMedia ? String(state.theme?.dim ?? 0.35) : '0';
      black.classList.toggle('on', !!state.black);

      const c = state.hideText ? null : state.content;
      clearInterval(tick);
      tick = c && c.type === 'timer' ? setInterval(draw, 250) : null;

      // Troca de letra faz um fade rápido; atualizações do mesmo conteúdo redesenham direto.
      const key = c ? (c.type === 'timer' ? 'timer' : 't:' + c.text) : '';
      if (key !== contentKey) {
        contentKey = key;
        content.classList.add('fade');
        clearTimeout(fadeTimer);
        fadeTimer = setTimeout(() => {
          fadeTimer = null;
          draw();
          content.classList.remove('fade');
        }, 160);
      } else if (!fadeTimer) {
        draw();
      }
    }

    new ResizeObserver(() => draw()).observe(root);
    return { update };
  }

  root.ScreenView = { create, fmt, remaining };
})(window);
