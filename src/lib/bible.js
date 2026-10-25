// Livros da Bíblia e leitura de referências digitadas ("Jo 3:16-18", "1 Co 13", "Salmos 23", "John 3:16").
// Funciona no navegador (window.Bible) e no Node (require), para os testes.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Bible = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // [nome em português, nome em inglês, abreviações aceitas]
  const BOOKS = [
    ['Gênesis', 'Genesis', 'gn gen ge'],
    ['Êxodo', 'Exodus', 'ex exo exod'],
    ['Levítico', 'Leviticus', 'lv lev'],
    ['Números', 'Numbers', 'nm num nu'],
    ['Deuteronômio', 'Deuteronomy', 'dt deut deu'],
    ['Josué', 'Joshua', 'js jos josh'],
    ['Juízes', 'Judges', 'jz jui judg jdg'],
    ['Rute', 'Ruth', 'rt rut'],
    ['1 Samuel', '1 Samuel', '1sm 1sam 1sa'],
    ['2 Samuel', '2 Samuel', '2sm 2sam 2sa'],
    ['1 Reis', '1 Kings', '1rs 1re 1ki 1kgs'],
    ['2 Reis', '2 Kings', '2rs 2re 2ki 2kgs'],
    ['1 Crônicas', '1 Chronicles', '1cr 1cro 1ch 1chr'],
    ['2 Crônicas', '2 Chronicles', '2cr 2cro 2ch 2chr'],
    ['Esdras', 'Ezra', 'ed esd ezr'],
    ['Neemias', 'Nehemiah', 'ne nee neh'],
    ['Ester', 'Esther', 'et est esth'],
    ['Jó', 'Job', 'jó jb'],
    ['Salmos', 'Psalms', 'sl sal salmo ps psa psalm'],
    ['Provérbios', 'Proverbs', 'pv pr prov pro'],
    ['Eclesiastes', 'Ecclesiastes', 'ec ecl eccl ecc'],
    ['Cânticos', 'Song of Solomon', 'ct cant cantares ct cânt song sos'],
    ['Isaías', 'Isaiah', 'is isa'],
    ['Jeremias', 'Jeremiah', 'jr jer'],
    ['Lamentações', 'Lamentations', 'lm lam'],
    ['Ezequiel', 'Ezekiel', 'ez eze ezek'],
    ['Daniel', 'Daniel', 'dn dan'],
    ['Oséias', 'Hosea', 'os ose hos oseias'],
    ['Joel', 'Joel', 'jl joe'],
    ['Amós', 'Amos', 'am'],
    ['Obadias', 'Obadiah', 'ob oba obad'],
    ['Jonas', 'Jonah', 'jn jon'],
    ['Miquéias', 'Micah', 'mq miq mic miqueias'],
    ['Naum', 'Nahum', 'na nah'],
    ['Habacuque', 'Habakkuk', 'hc hab'],
    ['Sofonias', 'Zephaniah', 'sf sof zep zeph'],
    ['Ageu', 'Haggai', 'ag hag'],
    ['Zacarias', 'Zechariah', 'zc zac zec zech'],
    ['Malaquias', 'Malachi', 'ml mal'],
    ['Mateus', 'Matthew', 'mt mat matt'],
    ['Marcos', 'Mark', 'mc mar mk mrk'],
    ['Lucas', 'Luke', 'lc luc lk luk'],
    ['João', 'John', 'jo joa jhn joh'],
    ['Atos', 'Acts', 'at ato act'],
    ['Romanos', 'Romans', 'rm rom ro'],
    ['1 Coríntios', '1 Corinthians', '1co 1cor'],
    ['2 Coríntios', '2 Corinthians', '2co 2cor'],
    ['Gálatas', 'Galatians', 'gl gal'],
    ['Efésios', 'Ephesians', 'ef efe eph'],
    ['Filipenses', 'Philippians', 'fp fil php phil'],
    ['Colossenses', 'Colossians', 'cl col'],
    ['1 Tessalonicenses', '1 Thessalonians', '1ts 1tes 1th 1thess'],
    ['2 Tessalonicenses', '2 Thessalonians', '2ts 2tes 2th 2thess'],
    ['1 Timóteo', '1 Timothy', '1tm 1tim 1ti'],
    ['2 Timóteo', '2 Timothy', '2tm 2tim 2ti'],
    ['Tito', 'Titus', 'tt tit'],
    ['Filemom', 'Philemon', 'fm flm phm philem'],
    ['Hebreus', 'Hebrews', 'hb heb'],
    ['Tiago', 'James', 'tg tia jas jm'],
    ['1 Pedro', '1 Peter', '1pe 1ped 1pt'],
    ['2 Pedro', '2 Peter', '2pe 2ped 2pt'],
    ['1 João', '1 John', '1jo 1joa 1jn 1jhn'],
    ['2 João', '2 John', '2jo 2joa 2jn 2jhn'],
    ['3 João', '3 John', '3jo 3joa 3jn 3jhn'],
    ['Judas', 'Jude', 'jd jud'],
    ['Apocalipse', 'Revelation', 'ap apo apoc rev rv revelations'],
  ].map(([pt, en, abbr], index) => ({ index, pt, en, abbr: abbr.split(' ') }));

  const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const key = (s) => String(s || '').toLowerCase().replace(/[\s.]/g, '');

  // Índices de nomes: com acento (para separar "Jó" de "Jo" = João) e sem acento.
  const exact = new Map();
  const loose = new Map();
  for (const b of BOOKS) {
    for (const n of [b.pt, b.en, ...b.abbr]) {
      if (!exact.has(key(n))) exact.set(key(n), b);
      if (!loose.has(plain(key(n)))) loose.set(plain(key(n)), b);
    }
  }

  function findBook(text) {
    const k = key(text);
    if (!k) return null;
    if (exact.has(k)) return exact.get(k);
    const p = plain(k);
    if (loose.has(p)) return loose.get(p);
    // Começo do nome por extenso, se só um livro combinar (ex.: "efes" → Efésios).
    const hits = BOOKS.filter((b) => plain(key(b.pt)).startsWith(p) || plain(key(b.en)).startsWith(p));
    return hits.length === 1 ? hits[0] : null;
  }

  // "Jo 3:16-18" → { book, chapter: 3, from: 16, to: 18 }. Sem versículo: o capítulo inteiro.
  function parseRef(input) {
    const m = String(input || '')
      .trim()
      .match(/^([123]?\s*[^\d\s:.,-][^\d:]*?)\s*(\d+)(?:\s*[:.,]\s*(\d+)(?:\s*[-–]\s*(\d+))?)?\s*$/);
    if (!m) return null;
    const book = findBook(m[1]);
    if (!book) return null;
    const chapter = Number(m[2]);
    const from = m[3] ? Number(m[3]) : null;
    const to = m[4] ? Number(m[4]) : from;
    if (!chapter || (from && to < from)) return null;
    return { book: book.index, chapter, from, to };
  }

  function bookName(index, lang = 'pt') {
    const b = BOOKS[index];
    return b ? (lang === 'en' ? b.en : b.pt) : '';
  }

  function formatRef(ref, lang = 'pt') {
    const name = bookName(ref.book, lang);
    if (!ref.from) return `${name} ${ref.chapter}`;
    return ref.to && ref.to !== ref.from ? `${name} ${ref.chapter}:${ref.from}-${ref.to}` : `${name} ${ref.chapter}:${ref.from}`;
  }

  return { BOOKS, findBook, parseRef, bookName, formatRef, plain };
});
