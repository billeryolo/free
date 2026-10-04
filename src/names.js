// Procedural naming. Each world picks one "language" so its own name, its
// moons and its continents sound like they belong to the same culture.

import { Rng } from './util.js';

const LANGS = [
  {
    // soft, latinate
    onset: ['', 'v', 's', 'l', 'm', 'n', 'th', 'c', 'r', 'h', 'f', 'sel', 'cal', 'ves', 'or', 'al'],
    vowel: ['a', 'e', 'i', 'o', 'ae', 'ia', 'io', 'u', 'ei'],
    coda: ['', '', 'n', 's', 'r', 'l', 'th', 'x', 'm', 'na', 'ra', 'ris', 'lis', 'tor', 'mir', 'dra', 'nne'],
    syl: [2, 3],
  },
  {
    // hard, guttural
    onset: ['k', 'kr', 'dr', 'gr', 't', 'z', 'v', 'b', 'x', 'sk', 'g', 'zh', 'r', 'h', 'q'],
    vowel: ['a', 'o', 'u', 'e', 'au', 'oa', 'y'],
    coda: ['k', 'th', 'g', 'r', 'n', 'x', 'sh', 'rg', 'nd', 'z', 'k', 'v', ''],
    syl: [1, 2],
  },
  {
    // open syllables, oceanic
    onset: ['h', 'k', 'l', 'm', 'n', 'p', 'w', 't', '', 'ng', 'v'],
    vowel: ['a', 'e', 'i', 'o', 'u', 'ai', 'ao', 'ei', 'au'],
    coda: [''],
    syl: [2, 4],
  },
  {
    // northern
    onset: ['sk', 'th', 'h', 'v', 'br', 'fr', 'y', 'g', 'st', 'bj', 'r', 'j'],
    vowel: ['a', 'e', 'i', 'o', 'u', 'y', 'ae', 'ei', 'au'],
    coda: ['ld', 'rn', 'm', 'nd', 'lf', 'r', 'n', 'st', 'rk', 'll', 'g', ''],
    syl: [1, 2],
  },
  {
    // crystalline, sibilant
    onset: ['s', 'z', 'ss', 'sh', 'c', 'x', 'l', 'th', 'ys', 'qu', 'v'],
    vowel: ['i', 'e', 'y', 'ia', 'ie', 'ae', 'a', 'o'],
    coda: ['s', 'x', 'th', 'l', 'ss', 'n', 'ra', 'lia', 'ne', ''],
    syl: [2, 3],
  },
];

const BAD = /([^aeiouy])\1\1|[^aeiouy]{4}|^[^aeiouy]{3}|(.)\2\2/;

function word(rng, lang, minSyl, maxSyl) {
  for (let tries = 0; tries < 40; tries++) {
    const n = rng.int(minSyl ?? lang.syl[0], maxSyl ?? lang.syl[1]);
    let w = '';
    for (let i = 0; i < n; i++) {
      w += rng.pick(lang.onset) + rng.pick(lang.vowel);
      if (i === n - 1 || rng.chance(0.3)) w += rng.pick(lang.coda);
    }
    if (w.length < 3 || w.length > 11 || BAD.test(w)) continue;
    return w[0].toUpperCase() + w.slice(1);
  }
  return 'Nameless';
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
const CATALOGS = ['ORB', 'KSS', 'LVX', 'TES', 'NHX', 'AUR', 'VDS', 'HLX'];

export class Namer {
  constructor(seed) {
    this.rng = new Rng(seed ^ 0x5bd1e995);
    this.lang = this.rng.pick(LANGS);
    this.used = new Set();
  }

  unique(fn) {
    for (let i = 0; i < 30; i++) {
      const n = fn();
      if (!this.used.has(n)) {
        this.used.add(n);
        return n;
      }
    }
    return fn();
  }

  planet() {
    const rng = this.rng;
    const base = this.unique(() => word(rng, this.lang));
    const r = rng.next();
    if (r < 0.12) return `${base} Prime`;
    if (r < 0.22) return `${base} ${rng.pick(ROMAN.slice(1, 7))}`;
    if (r < 0.27) return `New ${base}`;
    return base;
  }

  designation(index) {
    const rng = this.rng;
    const cat = rng.pick(CATALOGS);
    const num = rng.int(100, 9999);
    const letter = 'bcdefgh'[index] ?? 'b';
    return `${cat}-${num} ${letter}`;
  }

  moon() {
    return this.unique(() => word(this.rng, this.lang, 1, 2));
  }

  region() {
    return this.unique(() => word(this.rng, this.lang, 2, 3));
  }

  peak() {
    const rng = this.rng;
    const w = this.unique(() => word(rng, this.lang, 1, 2));
    return rng.pick([`Mount ${w}`, `${w} Massif`, `Mons ${w}`, `${w} Peak`]);
  }
}

export function continentName(namer) {
  return namer.region();
}

export function oceanName(namer, rank) {
  const w = namer.region();
  if (rank === 0) return `${w} Ocean`;
  return namer.rng.pick([`${w} Sea`, `Sea of ${w}`, `${w} Gulf`]);
}
