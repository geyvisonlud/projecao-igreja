const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, normalize, isChordLine } = require('../src/lib/lyrics.js');

test('linha em branco separa slides', () => {
  const { slides } = parse('Linha 1\nLinha 2\n\nLinha 3\nLinha 4');
  assert.equal(slides.length, 2);
  assert.equal(slides[0].text, 'Linha 1\nLinha 2');
  assert.equal(slides[1].text, 'Linha 3\nLinha 4');
});

test('nomes de parte com e sem colchetes', () => {
  const { slides } = parse('[Verso 1]\nSanto\nDigno\n\nRefrão:\nGlória\nAleluia');
  assert.deepEqual(slides.map((s) => s.label), ['Verso 1', 'Refrão']);
  assert.equal(slides[0].text, 'Santo\nDigno');
});

test('parte só com o nome repete a anterior', () => {
  const { slides } = parse('[Refrão]\nGlória\nAleluia\n\n[Verso]\nOutra\n\n[Refrão]');
  assert.equal(slides.length, 3);
  assert.equal(slides[2].label, 'Refrão');
  assert.equal(slides[2].text, 'Glória\nAleluia');
});

test('nome solto antes do bloco nomeia o bloco seguinte', () => {
  const { slides } = parse('[Primeira Parte]\n\nTexto um\nTexto dois');
  assert.equal(slides.length, 1);
  assert.equal(slides[0].label, 'Primeira Parte');
});

test('blocos longos são divididos de forma equilibrada', () => {
  const { slides } = parse('1\n2\n3\n4\n5', { maxLines: 4 });
  assert.deepEqual(slides.map((s) => s.text.split('\n').length), [3, 2]);
});

test('remove cifras e tablaturas coladas de sites', () => {
  const text = '[Intro] G  D  Em  C\n\n[Primeira Parte]\nG           D\nQuão grande és tu\nEm      C/E    D4\nDeus de amor\ne|---3---0---|';
  const { slides } = parse(text);
  assert.equal(slides.length, 1);
  assert.equal(slides[0].text, 'Quão grande és tu\nDeus de amor');
});

test('acordes x palavras', () => {
  assert.ok(isChordLine('C#m7  F#m7(b5)  Bb7M  G/B'));
  assert.ok(!isChordLine('Deus é bom'));
  assert.ok(!isChordLine('Em ti confio'));
});

test('normalize ignora acentos e maiúsculas', () => {
  assert.equal(normalize('Refrão ÚNICO'), 'refrao unico');
});
