// Genera el vocabulario con embeddings (se ejecuta UNA vez).  Uso: node scripts/build-vocab.js es 30000
import fs from 'fs';
import path from 'path';
import { pipeline } from '@huggingface/transformers';

const lang = process.argv[2] || 'es';
const N = parseInt(process.argv[3] || '30000', 10);
const MODEL = process.env.EMBED_MODEL || 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const dir = path.join('data', lang);
const FREQ_URL = `https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/${lang}/${lang}_50k.txt`;
const OK = /^[a-záéíóúüñ]{3,24}$/;

fs.mkdirSync(dir, { recursive: true });
const secrets = JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8'));
const freqFile = path.join(dir, 'freq.txt');
if (!fs.existsSync(freqFile)) {
  console.log('Descargando lista de frecuencias…');
  const r = await fetch(FREQ_URL);
  if (!r.ok) throw new Error('No se pudo descargar ' + FREQ_URL);
  fs.writeFileSync(freqFile, await r.text());
}
const seen = new Set();
const words = [];
const add = (w) => { w = w.normalize('NFC').toLowerCase(); if (OK.test(w) && !seen.has(w)) { seen.add(w); words.push(w); } };
for (const line of fs.readFileSync(freqFile, 'utf8').split('\n')) {
  if (words.length >= N) break;
  add(line.split(' ')[0] || '');
}
Object.values(secrets).flat().forEach(add); // las palabras secretas SIEMPRE están en el vocabulario

console.log(`Cargando modelo ${MODEL}…`);
const extractor = await pipeline('feature-extraction', MODEL, { dtype: 'q8' });
let dim = 0, out = null;
const B = 64;
for (let i = 0; i < words.length; i += B) {
  const t = await extractor(words.slice(i, i + B), { pooling: 'mean', normalize: true });
  if (!out) { dim = t.dims[1]; out = new Float32Array(words.length * dim); }
  out.set(t.data, i * dim);
  if ((i / B) % 20 === 0) console.log(`${i}/${words.length}`);
}
fs.writeFileSync(path.join(dir, 'vocab.json'), JSON.stringify(words));
fs.writeFileSync(path.join(dir, 'vocab.f32'), Buffer.from(out.buffer));
// Cloudflare serves these generated files as static assets, outside the Worker bundle.
const assetDir = path.join('public', 'data', lang);
fs.mkdirSync(assetDir, { recursive: true });
fs.copyFileSync(path.join(dir, 'vocab.json'), path.join(assetDir, 'vocab.json'));
fs.copyFileSync(path.join(dir, 'vocab.f32'), path.join(assetDir, 'vocab.f32'));
fs.copyFileSync(path.join(dir, 'secrets.json'), path.join(assetDir, 'secrets.json'));
console.log(`Listo: ${words.length} palabras, dim ${dim}. Assets: ${assetDir}`);
