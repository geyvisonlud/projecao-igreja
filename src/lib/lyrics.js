// Transforma uma letra colada (texto livre) em partes e slides.
// Funciona no navegador (window.Lyrics) e no Node (require), para os testes.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Lyrics = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // Nomes de parte reconhecidos mesmo sem colchetes: "Refrão", "Verso 2:", "Ponte"...
  const KNOWN_LABEL =
    /^(verso|estrofe|parte|primeira parte|segunda parte|terceira parte|refr[aã]o|coro|ponte|pr[eé][\s-]?(refr[aã]o|coro)|final|intro|introdu[cç][aã]o|interl[uú]dio|tag|bridge|chorus|verse|pre[\s-]?chorus|outro)(\s*\d+)?$/i;
  const CHORD = /^[A-G][#b]?(?:maj|min|dim|aug|sus|add|m|M|[0-9]|[#b+\-°º()])*(?:\/[A-G][#b]?)?$/;
  const FILLER = /^[|\-–—.:x0-9()]+$/i; // "|", "-", "x2", "(2x)" entre acordes
  const TAB = /^[eBGDAE]\s*\|[-0-9|hpbr\/\\~x ]+$/;
  const INSTRUMENTAL = /^\s*\[?(intro|introdu[cç][aã]o|solo|riff|interl[uú]dio|passagem|final)\]?\s*:?\s+/i;

  function normalize(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  function isChordLine(line) {
    const tokens = line.trim().split(/\s+/).filter((t) => t && !FILLER.test(t));
    return tokens.length > 0 && tokens.every((t) => CHORD.test(t));
  }

  // Linhas que não são letra: acordes, tablaturas, "[Intro] G D Em".
  function isNoise(line) {
    if (!line.trim()) return false;
    if (TAB.test(line.trim()) || isChordLine(line)) return true;
    const m = line.match(INSTRUMENTAL);
    if (m) return isChordLine(line.slice(m[0].length));
    const b = line.match(/^\s*\[[^\]]+\]\s+(.+)$/);
    return !!(b && isChordLine(b[1]));
  }

  function labelOf(line) {
    const b = line.match(/^\s*[\[(]([^\])]+)[\])]\s*:?\s*$/);
    if (b) return b[1].trim();
    const plain = line.replace(/[:\s]+$/, '').trim();
    return KNOWN_LABEL.test(plain) ? plain : null;
  }

  // Divide as linhas em grupos de no máximo `max`, de forma equilibrada (5 linhas → 3 + 2).
  function chunk(lines, max) {
    if (lines.length <= max) return [lines];
    const parts = Math.ceil(lines.length / max);
    const size = Math.ceil(lines.length / parts);
    const out = [];
    for (let i = 0; i < lines.length; i += size) out.push(lines.slice(i, i + size));
    return out;
  }

  function parse(text, { maxLines = 4 } = {}) {
    const blocks = String(text || '')
      .replace(/\r\n?/g, '\n')
      .split(/\n[ \t]*\n/)
      .map((b) => b.split('\n').filter((l) => !isNoise(l)).map((l) => l.trim()).filter(Boolean))
      .filter((b) => b.length);

    const sections = [];
    let pendingLabel = null;
    for (const block of blocks) {
      let label = labelOf(block[0]);
      const lines = label ? block.slice(1) : block;
      if (!label) label = pendingLabel;
      pendingLabel = null;

      if (!lines.length) {
        // Só o nome da parte: repete a parte anterior de mesmo nome
        // ou, se ela ainda não apareceu, nomeia o bloco seguinte.
        const prev = [...sections].reverse().find((s) => normalize(s.label) === normalize(label));
        if (prev) sections.push({ label: prev.label, lines: prev.lines, repeat: true });
        else pendingLabel = label;
        continue;
      }
      sections.push({ label: label || '', lines });
    }

    const slides = [];
    sections.forEach((s, sectionIndex) => {
      for (const part of chunk(s.lines, Math.max(1, maxLines))) {
        slides.push({ label: s.label, text: part.join('\n'), sectionIndex });
      }
    });
    return { sections, slides };
  }

  return { parse, normalize, isChordLine };
});
