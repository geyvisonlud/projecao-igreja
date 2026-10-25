// Ícones em traço fino, no espírito dos SF Symbols. Elementos com data-icon="nome" recebem o SVG.
(function (root) {
  'use strict';

  const P = {
    sidebar: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M9 4.5v15M5.5 8h1.5M5.5 10.5h1.5"/>',
    chevronDown: '<path d="M7 10l5 5 5-5"/>',
    chevronLeft: '<path d="M14.5 6l-6 6 6 6"/>',
    moon: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"/>',
    eyeSlash: '<path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4.5 9.5 6-.5.8-1.6 2.2-3.1 3.5M6.6 7.6C4.6 9 3.2 10.9 2.5 12c1 1.5 4.5 6 9.5 6 1.6 0 3-.4 4.3-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/><circle cx="12" cy="12" r="6.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    music: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    photo: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8.5" cy="10" r="1.6"/><path d="M21 16l-5.5-5.5L6 19"/>',
    video: '<rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="M15.5 10.5l6-3.5v10l-6-3.5"/>',
    timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.5M9.5 2.5h5M18.5 6.5l1.5-1.5"/>',
    rectangles: '<rect x="3" y="7" width="14" height="11" rx="2"/><path d="M7 4h11a3 3 0 0 1 3 3v8"/>',
    text: '<path d="M5 6.5V5h14v1.5M12 5v14M9 19h6"/>',
    search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
    pause: '<path d="M8 5.5v13M16 5.5v13" stroke-width="3.2"/>',
    waveform: '<path d="M3 12h1.5M6.5 9v6M10 5.5v13M13.5 8v8M17 10v4M20.5 12H21"/>',
    xmark: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    speaker: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10"/>',
    captions: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 11h4M13 11h4M7 14.5h7M16 14.5h1"/>',
    ellipsis: '<circle cx="6" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18" cy="12" r="1.2" fill="currentColor"/>',
  };

  function svg(name) {
    return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
  }

  function fill(scope = document) {
    scope.querySelectorAll('[data-icon]').forEach((el) => {
      if (el.dataset.iconDone === el.dataset.icon) return;
      // Botões que só têm ícone guardam o texto em title; aqui o ícone é inserido antes do texto.
      el.insertAdjacentHTML('afterbegin', svg(el.dataset.icon));
      el.querySelectorAll('svg.icon').forEach((s, i) => i > 0 && s.remove());
      el.dataset.iconDone = el.dataset.icon;
    });
  }

  // Troca o ícone de um elemento (ex.: tocar ↔ pausar).
  function set(el, name) {
    el.querySelector('svg.icon')?.remove();
    el.dataset.icon = name;
    el.dataset.iconDone = '';
    fill(el.parentElement || document);
  }

  root.Icons = { svg, fill, set };
})(window);
