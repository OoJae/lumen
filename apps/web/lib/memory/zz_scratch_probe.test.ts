import { describe, it } from 'vitest';
import type { JournalTurn } from '@lumen/shared';
import { resurface } from './resurface';

const t = (id: string, day: string): JournalTurn => ({
  id, entry: `e ${id}`, reflection: `r ${id}`, attestation: null,
  createdAt: `${day}T12:00:00.000Z`,
});
const TODAY = '2026-08-19';
const days = (d: string) =>
  Math.round((Date.parse(`${TODAY}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000);

describe('probe', () => {
  it('single-entry ages', () => {
    for (const d of ['2025-08-24','2025-08-25','2025-08-19','2025-08-18','2025-08-15','2025-09-01','2025-11-19','2025-12-19','2026-02-19','2023-08-19','2024-01-01']) {
      const r = resurface([t('x', d)], TODAY);
      console.log(d, `age=${days(d)}`, '->', r ? `${r.kind} / "${r.label}"` : 'null');
    }
  });
  it('coverage sweep: which ages produce a months-ago label', () => {
    const hits: number[] = [];
    for (let age = 1; age <= 400; age++) {
      const day = new Date(Date.parse(`${TODAY}T00:00:00Z`) - age * 86400000).toISOString().slice(0,10);
      // add a same-day-anchor decoy? no: single entry only
      const r = resurface([t('x', day)], TODAY);
      if (r?.kind === 'months-ago') hits.push(age);
    }
    console.log('months-ago hit ages 1..400:', JSON.stringify(hits));
    console.log('count', hits.length, 'of 400');
  });
  it('exact calendar-month anniversaries', () => {
    for (let m = 1; m <= 24; m++) {
      const dt = new Date(Date.UTC(2026, 7, 19));
      dt.setUTCMonth(dt.getUTCMonth() - m);
      const day = dt.toISOString().slice(0,10);
      const r = resurface([t('x', day)], TODAY);
      console.log(`${m}mo ago = ${day} age=${days(day)} ->`, r ? `${r.kind} / "${r.label}"` : 'null');
    }
  });
  it('non-first older entry (older anchor present)', () => {
    const anchor = t('anchor', '2025-01-05');
    for (const d of ['2025-08-15','2025-09-01','2025-11-19']) {
      const r = resurface([anchor, t('x', d)], TODAY);
      console.log('with anchor 2025-01-05, entry', d, '->', r ? `${r.kind} / "${r.label}" / turn=${r.turn.id}` : 'null');
    }
  });
});
