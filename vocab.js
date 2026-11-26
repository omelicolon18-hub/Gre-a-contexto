// Vocabulario + ranking semántico por idioma. Para añadir un idioma: data/<lang>/secrets.json + build-vocab.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const langs = new Map();
const plain = (w) => w.normalize('NFD').replace(/n\u0303/g, 'ñ').replace(/[\u0300-\u036f]/g, '');

export function load(lang = 'es') {
  if (langs.has(lang)) return langs.get(lang);
  const dir = path.join(ROOT, lang);
  const words = JSON.parse(fs.readFileSync(path.join(dir, 'vocab.json'), 'utf8'));
  const raw = fs.readFileSync(path.join(dir, 'vocab.f32'));
  const vecs = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const dim = vecs.length / words.length;
  const exact = new Map(), plainMap = new Map();
  words.forEach((w, i) => { exact.set(w, i); if (!plainMap.has(plain(w))) plainMap.set(plain(w), i); });
  const secrets = JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8'));
  const L = { lang, words, vecs, dim, exact, plainMap, secrets, size: words.length };
  langs.set(lang, L);
  return L;
}

export function lookup(L, input) {
  const w = String(input || '').normalize('NFC').toLowerCase().trim();
  if (!/^[a-záéíóúüñ]{2,30}$/.test(w)) return null;
  const i = L.exact.has(w) ? L.exact.get(w) : L.plainMap.get(plain(w));
  return i === undefined ? null : { i, word: L.words[i] };
}

// rank[i] = posición (1 = palabra secreta) de la palabra i según su cercanía semántica al secreto
export function makeRanking(L, secretIdx) {
  const { vecs, dim, size } = L;
  const sims = new Float32Array(size);
  const s = secretIdx * dim;
  for (let i = 0; i < size; i++) {
    let d = 0; const o = i * dim;
    for (let k = 0; k < dim; k++) d += vecs[o + k] * vecs[s + k];
    sims[i] = d;
  }
  sims[secretIdx] = 10;
  const order = Array.from({ length: size }, (_, k) => k).sort((a, b) => sims[b] - sims[a]);
  const rank = new Int32Array(size);
  order.forEach((k, p) => { rank[k] = p + 1; });
  return rank;
}
