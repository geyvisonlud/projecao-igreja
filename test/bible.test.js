const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRef, formatRef, BOOKS } = require('../src/lib/bible.js');

const ref = (s) => {
  const r = parseRef(s);
  return r && formatRef(r);
};

test('66 livros', () => assert.equal(BOOKS.length, 66));

test('referências em português', () => {
  assert.equal(ref('Jo 3:16'), 'João 3:16');
  assert.equal(ref('joão 3.16-18'), 'João 3:16-18');
  assert.equal(ref('Jó 1:1'), 'Jó 1:1');
  assert.equal(ref('Sl 23'), 'Salmos 23');
  assert.equal(ref('salmos 23:1'), 'Salmos 23:1');
  assert.equal(ref('1 Co 13:4-7'), '1 Coríntios 13:4-7');
  assert.equal(ref('1co 13'), '1 Coríntios 13');
  assert.equal(ref('Gênesis 1:1'), 'Gênesis 1:1');
  assert.equal(ref('genesis 1'), 'Gênesis 1');
  assert.equal(ref('Ap 21:4'), 'Apocalipse 21:4');
  assert.equal(ref('efes 2:8'), 'Efésios 2:8');
  assert.equal(ref('Rm 8, 28'), 'Romanos 8:28');
});

test('referências em inglês', () => {
  assert.equal(ref('John 3:16'), 'João 3:16');
  assert.equal(ref('Psalm 23'), 'Salmos 23');
  assert.equal(ref('1 John 4:8'), '1 João 4:8');
  assert.equal(ref('Rev 22:20'), 'Apocalipse 22:20');
});

test('o que não é referência', () => {
  assert.equal(parseRef('amor'), null);
  assert.equal(parseRef('Jo'), null);
  assert.equal(parseRef('Xyz 3:16'), null);
  assert.equal(parseRef('Jo 3:18-16'), null);
});
