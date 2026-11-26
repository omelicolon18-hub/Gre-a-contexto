import test from 'node:test';
import assert from 'node:assert/strict';
import { lookup, makeRanking } from './vocab.js';

const words = ['casa', 'perro', 'árbol'];
const plain = (w) => w.normalize('NFD').replace(/n\u0303/g, 'ñ').replace(/[\u0300-\u036f]/g, '');
const L = {
  words,
  exact: new Map(words.map((w, i) => [w, i])),
  plainMap: new Map(words.map((w, i) => [plain(w), i])),
  vecs: new Float32Array([1, 0, 0.8, 0.6, -1, 0]),
  dim: 2,
  size: words.length,
};

test('lookup normaliza mayúsculas y tildes', () => {
  assert.deepEqual(lookup(L, 'ARBOL'), { i: 2, word: 'árbol' });
  assert.deepEqual(lookup(L, 'casa'), { i: 0, word: 'casa' });
});

test('lookup rechaza entradas no válidas o desconocidas', () => {
  assert.equal(lookup(L, ''), null);
  assert.equal(lookup(L, 'casa123'), null);
  assert.equal(lookup(L, 'palabra-inexistente'), null);
});

test('ranking asigna #1 a la palabra secreta y ordena por similitud', () => {
  assert.deepEqual([...makeRanking(L, 0)], [1, 2, 3]);
  assert.deepEqual([...makeRanking(L, 1)], [2, 1, 3]);
});
