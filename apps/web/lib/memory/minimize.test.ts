import { describe, expect, it } from 'vitest';

import {
  contextNotice,
  DEFAULT_MAX_CHARS,
  ELISION,
  excerptEntry,
  minimizeRecall,
  scoreSentence,
  splitSentences,
} from './minimize';

const LONG_ENTRY = [
  'I went to the market this morning and it was raining.',
  'My father called after and we talked about the house again.',
  'He still will not say what he actually wants to do with it.',
  'Afterwards I sat in the car for twenty minutes.',
  'The dog needs a vet appointment at some point this week.',
].join(' ');

describe('splitSentences', () => {
  it('splits on sentence enders and keeps the punctuation', () => {
    expect(splitSentences('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?']);
  });

  it('treats a bare line break as an ender — journals are not tidy prose', () => {
    // Without this, an entry written with no full stops is ONE sentence, so
    // nothing can be trimmed from it and the whole thing gets sent.
    expect(splitSentences('woke up late\nfelt fine\nthen did not')).toEqual([
      'woke up late',
      'felt fine',
      'then did not',
    ]);
  });

  it('is empty for empty input, never [""]', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   \n  ')).toEqual([]);
  });
});

describe('scoreSentence', () => {
  it('does not reward length — the longest sentence must not always win', () => {
    // The first version normalised by nothing, so excerpting reliably picked
    // the longest sentence. That is the opposite of minimising.
    const q = new Set(['house']);
    const short = scoreSentence('The house.', q);
    const long = scoreSentence(
      'The house sat there among many other things that morning while everyone talked.',
      q,
    );
    expect(short).toBeGreaterThan(long);
  });

  it('counts a repeated query word once — repetition is not extra credit', () => {
    const q = new Set(['house']);
    // Three hits would score 3/sqrt(3); one distinct hit scores 1/sqrt(3).
    expect(scoreSentence('house house house', q)).toBeCloseTo(1 / Math.sqrt(3), 5);
  });

  it('is zero when nothing overlaps, and for an empty query', () => {
    expect(scoreSentence('completely unrelated', new Set(['house']))).toBe(0);
    expect(scoreSentence('anything at all', new Set())).toBe(0);
  });

  it('ignores stopwords, so "the" is not a match', () => {
    expect(scoreSentence('the the the', new Set(['the']))).toBe(0);
  });
});

describe('excerptEntry', () => {
  it('keeps the part that earned its place and drops the rest', () => {
    const e = excerptEntry(LONG_ENTRY, 'talking to my father about the house', {
      maxSentences: 2,
    });
    expect(e.text).toContain('father called');
    expect(e.text).toContain('house');
    // The vet and the market are why this matters: recall selected the entry
    // for one paragraph and used to forward the whole year.
    expect(e.text).not.toContain('vet');
    expect(e.text).not.toContain('market');
    expect(e.reduced).toBe(true);
    expect(e.charsWithheld).toBeGreaterThan(0);
  });

  it('preserves the writer’s original order', () => {
    // Reordering someone's sentences misrepresents what they wrote, even to a
    // model. Query terms here favour the LATER sentence.
    const e = excerptEntry('Alpha about houses. Beta about houses and houses.', 'houses', {
      maxSentences: 2,
    });
    expect(e.text.indexOf('Alpha')).toBeLessThan(e.text.indexOf('Beta'));
  });

  it('marks elision where text was withheld', () => {
    const e = excerptEntry(LONG_ENTRY, 'father house', { maxSentences: 2 });
    expect(e.text).toContain(ELISION);
  });

  it('never returns the whole entry when it had more to say', () => {
    const e = excerptEntry(LONG_ENTRY, 'father', { maxSentences: 1 });
    expect(e.kept).toBeLessThan(e.total);
    expect(e.text.replace(new RegExp(ELISION, 'g'), '').trim().length).toBeLessThan(
      LONG_ENTRY.length,
    );
  });

  it('falls back to the opening when nothing overlaps — recall is SEMANTIC', () => {
    // An entry can be genuinely relevant while sharing no words with the query.
    // Dropping it would lose a real memory; sending it whole is what we are
    // fixing. So: the opening, bounded.
    const e = excerptEntry(LONG_ENTRY, 'xylophone quasar', { maxSentences: 1 });
    expect(e.text).toContain('market');
    expect(e.kept).toBe(1);
    expect(e.reduced).toBe(true);
  });

  it('honours the character ceiling even for one enormous sentence', () => {
    const huge = 'x'.repeat(5_000);
    const e = excerptEntry(huge, 'x', { maxChars: 100 });
    expect(e.text.length).toBeLessThanOrEqual(100 + ELISION.length + 2);
    expect(e.charsWithheld).toBeGreaterThan(4_000);
  });

  it('never returns nothing for a non-empty entry', () => {
    // Returning '' would silently drop a memory recall had judged relevant.
    for (const q of ['', 'zzz', 'father']) {
      expect(excerptEntry(LONG_ENTRY, q).text.length, q).toBeGreaterThan(0);
    }
  });

  it('is empty, and not reduced, for an empty entry', () => {
    const e = excerptEntry('   ', 'anything');
    expect(e.text).toBe('');
    expect(e.total).toBe(0);
    expect(e.reduced).toBe(false);
  });

  it('does not count inter-sentence whitespace as withheld', () => {
    // Counting the sum of sentence lengths would overstate the saving, because
    // splitting discards the whitespace between them. Every sentence here
    // scores, so nothing is actually dropped and the answer must be exactly 0.
    const entry = 'The house is old. The house is cold.';
    const e = excerptEntry(entry, 'house', { maxSentences: 5, maxChars: 10_000 });
    expect(e.kept).toBe(2);
    expect(e.charsWithheld).toBe(0);
    expect(e.reduced).toBe(false);
  });

  it('drops a zero-scoring sentence even when the sentence budget allows it', () => {
    // The budget is a ceiling, not a quota: an unrelated sentence is never sent
    // just because there was room for it.
    const e = excerptEntry(LONG_ENTRY, 'father house', { maxSentences: 5, maxChars: 10_000 });
    // Only one of the five sentences mentions either term, so exactly one is
    // sent — four sentences' worth of room went deliberately unused.
    expect(e.kept).toBe(1);
    expect(e.total).toBe(5);
    expect(e.text).not.toContain('vet');
    expect(e.text).not.toContain('market');
  });

  it('defaults are actually restrictive', () => {
    const wall = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} about the house.`).join(' ');
    const e = excerptEntry(wall, 'house');
    expect(e.text.length).toBeLessThanOrEqual(DEFAULT_MAX_CHARS + 40);
    expect(e.kept).toBeLessThanOrEqual(3);
  });
});

describe('minimizeRecall', () => {
  const turns = [
    { id: 'a', entry: LONG_ENTRY },
    { id: 'b', entry: 'Something about the house and the paperwork. Unrelated line about tea.' },
    { id: 'c', entry: '   ' },
  ];

  it('excerpts every entry and drops ones with nothing to send', () => {
    const m = minimizeRecall(turns, (t) => t.entry, 'the house', { maxSentences: 1 });
    expect(m.entries).toBe(2);
    expect(m.items.map((r) => r.item.id)).toEqual(['a', 'b']);
    expect(m.reduced).toBe(true);
    expect(m.charsWithheld).toBeGreaterThan(0);
  });

  it('sends materially less than the whole entries did', () => {
    const whole = turns.reduce((n, t) => n + t.entry.length, 0);
    const m = minimizeRecall(turns, (t) => t.entry, 'the house');
    const sent = m.items.reduce((n, r) => n + r.excerpt.text.length, 0);
    expect(sent).toBeLessThan(whole / 2);
  });

  it('is empty and honest for no recall', () => {
    const m = minimizeRecall([], (t: { entry: string }) => t.entry, 'q');
    expect(m).toEqual({ items: [], entries: 0, charsWithheld: 0, reduced: false });
  });
});

describe('contextNotice', () => {
  it('says plainly when only the new entry is sent', () => {
    expect(contextNotice({ sessionTurns: 0, recalledEntries: 0, charsWithheld: 0 })).toBe(
      'This reflection sends only what you just wrote.',
    );
  });

  it('counts both kinds of context, and singularises', () => {
    const n = contextNotice({ sessionTurns: 1, recalledEntries: 1, charsWithheld: 0 });
    expect(n).toContain('your last entry');
    expect(n).toContain('an excerpt');
    expect(n).not.toContain('1 entries');
  });

  it('quotes what stayed behind, so the reduction is checkable', () => {
    const n = contextNotice({ sessionTurns: 6, recalledEntries: 4, charsWithheld: 1_240 });
    expect(n).toContain('excerpts from 4 earlier entries');
    expect(n).toContain('stay on this device');
  });

  it('never contains journal content — only counts', () => {
    // The whole point of this string is that it can be shown without becoming
    // one more copy of the thing it is describing.
    const n = contextNotice({ sessionTurns: 6, recalledEntries: 4, charsWithheld: 1_240 });
    expect(n).not.toMatch(/[""']/);
    expect(n.length).toBeLessThan(240);
  });

  it('does not claim a reduction that did not happen', () => {
    const n = contextNotice({ sessionTurns: 2, recalledEntries: 0, charsWithheld: 0 });
    expect(n).not.toContain('stay on this device');
  });
});

describe('scripts that do not use Latin sentence enders', () => {
  // The whole suite contained no non-Latin punctuation, so it passed green while
  // every recalled entry in these languages was forwarded WHOLE — the exact
  // behaviour this module exists to stop, silently skipped for a large fraction
  // of the world. Latin enders require trailing whitespace (so "3.14" and "e.g."
  // survive); CJK/Indic/Arabic enders must not, because those scripts commonly
  // write no space after the stop.
  const CASES: Array<[string, string, string]> = [
    [
      'Chinese',
      '今天早上我很早就起床了。我和我妈妈谈过了。她看起来不太好。我很担心。也许我应该回家看看她。',
      '妈妈 担心',
    ],
    [
      'Japanese',
      '今朝は早く起きた。母と話した。元気がなさそうだった。とても心配だ。家に帰るべきかもしれない。',
      '母 心配',
    ],
    [
      'Hindi',
      'आज सुबह मैं जल्दी उठा। मैंने अपनी माँ से बात की। वह ठीक नहीं लग रही थीं। मुझे चिंता हो रही है। शायद मुझे घर जाना चाहिए।',
      'माँ चिंता',
    ],
    [
      'Urdu',
      'آج صبح میں جلدی اٹھا۔ میں نے اپنی ماں سے بات کی۔ وہ ٹھیک نہیں لگ رہی تھیں۔ مجھے فکر ہو رہی ہے۔',
      'ماں فکر',
    ],
  ];

  it.each(CASES)('%s: splits into sentences rather than one blob', (_name, entry) => {
    expect(splitSentences(entry).length).toBeGreaterThan(1);
  });

  it.each(CASES)('%s: the entry is NOT forwarded whole', (_name, entry, query) => {
    const e = excerptEntry(entry, query, { maxSentences: 2 });
    expect(e.total).toBeGreaterThan(1);
    expect(e.text).not.toBe(entry);
    expect(e.reduced).toBe(true);
    expect(e.charsWithheld).toBeGreaterThan(0);
  });

  it('does not split a decimal — the reason Latin enders keep their whitespace rule', () => {
    expect(splitSentences('It cost 3.14 dollars.')).toHaveLength(1);
  });

  it('DOES split after an abbreviation, and that is acceptable', () => {
    // A known limitation, documented rather than pretended away: "e.g." ends in
    // a period followed by a space, so it splits. The consequence is only that
    // the entry has two smaller sentences instead of one — which if anything
    // sends LESS. It would matter for display; it does not matter for minimising.
    expect(splitSentences('Bring milk, e.g. oat milk.')).toHaveLength(2);
  });
});

describe('every gap is marked, including a hard cut', () => {
  it('marks a first sentence that had to be truncated', () => {
    // The system prompt tells the model "… marks where text was deliberately
    // withheld". A silent mid-word cut made that untrue for exactly the entries
    // that lost the most text.
    const e = excerptEntry('x'.repeat(2_000), 'x', { maxChars: 100 });
    expect(e.text.endsWith(ELISION)).toBe(true);
    expect(e.charsWithheld).toBeGreaterThan(1_800);
  });

  it('counts a sentence that IS the elision character', () => {
    // Recovering `kept` by filtering pieces for the marker undercounted here and
    // appended a trailing marker describing nothing. The query matches nothing,
    // so the fallback keeps the first N sentences IN ORDER — which is the only
    // way the marker-sentence gets chosen at all.
    const e = excerptEntry(`${ELISION} Second line. Third line.`, 'zzzz', { maxSentences: 3 });
    expect(e.total).toBe(3);
    expect(e.kept).toBe(3);
    expect(e.reduced).toBe(false);
  });
});

describe('contextNotice never prints a zero', () => {
  it('says it plainly rather than "About 0 characters"', () => {
    // Rounding to the nearest 100 printed "About 0 characters … stay on this
    // device" for every reduction under 50 — a sentence that reads as a bug and
    // undersells a real one.
    const n = contextNotice({ sessionTurns: 2, recalledEntries: 1, charsWithheld: 30 });
    expect(n).not.toContain('About 0');
    expect(n).toContain('stays on this device');
  });

  it('still quotes a real number when there is one', () => {
    expect(contextNotice({ sessionTurns: 2, recalledEntries: 1, charsWithheld: 640 })).toContain(
      'About 600 characters',
    );
  });
});
