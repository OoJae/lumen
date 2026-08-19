import { describe, expect, it } from 'vitest';

import type { AttestationInfo, JournalTurn, StorageReceipt } from '@lumen/shared';

import {
  attestationLine,
  buildExportBundle,
  buildManifest,
  buildMarkdown,
  EXPORT_FORMAT_VERSION,
  type ExportInput,
} from './bundle';

const WALLET = '0xB5609C73784Aa81De2eBe01cCC04Eb7ea4ce1a52';
const EXPORTED_AT = '2026-08-19T21:30:00.000Z';

function turn(id: string, entry: string, createdAt: string, reflection = ''): JournalTurn {
  return { id, entry, reflection, attestation: null, createdAt };
}

const ATTESTATION = {
  verificationStatus: 'verified',
  trustMode: 'private',
  teeType: 'Intel TDX',
  teeHardware: 'NVIDIA H100',
  model: 'glm-5.1',
  timestamp: '2026-08-19T10:00:00.000Z',
  learnMoreUrl: 'https://example.test',
  note: 'n',
  proof: { chatId: 'chat-123', responseSha256: '0xabc' },
} as unknown as AttestationInfo;

const RECEIPT: StorageReceipt = {
  seq: 3,
  rootHash: '0x94f51264d5288f3359020eb37be3008445f0ca61591a414c46d814bdf6fd4e5d',
  txHash: '0xtx',
  paddedBytes: 8192,
  turnCount: 2,
  savedAt: '2026-08-19T12:00:00.000Z',
  network: 'mainnet',
};

function input(over: Partial<ExportInput> = {}): ExportInput {
  return {
    turns: [
      turn('a', 'First thing I wrote.', '2026-08-01T10:00:00.000Z', 'A gentle reflection.'),
      turn('b', 'Second thing.', '2026-08-09T10:00:00.000Z'),
    ],
    wallet: WALLET,
    receipt: RECEIPT,
    exportedAt: EXPORTED_AT,
    ...over,
  };
}

describe('manifest', () => {
  it('records the format version, count and lowercased wallet', () => {
    const m = buildManifest(input());
    expect(m.app).toBe('lumen');
    expect(m.formatVersion).toBe(EXPORT_FORMAT_VERSION);
    expect(m.entryCount).toBe(2);
    expect(m.wallet).toBe(WALLET.toLowerCase());
  });

  it('carries the last 0G snapshot so the export can be tied back to a root', () => {
    expect(buildManifest(input()).storage).toEqual({
      rootHash: RECEIPT.rootHash,
      txHash: '0xtx',
      seq: 3,
      savedAt: RECEIPT.savedAt,
      network: 'mainnet',
    });
  });

  it('has no storage or wallet for an anonymous, never-saved journal', () => {
    const m = buildManifest(input({ wallet: null, receipt: null }));
    expect(m.storage).toBeNull();
    expect(m.wallet).toBeNull();
  });

  it('warns that the exported file is plaintext', () => {
    expect(buildManifest(input()).note).toContain('plaintext');
  });
});

describe('markdown', () => {
  it('reads forwards — oldest entry first', () => {
    const md = buildMarkdown(input(), buildManifest(input()));
    expect(md.indexOf('First thing I wrote.')).toBeLessThan(md.indexOf('Second thing.'));
  });

  it('renders the companion voice as a blockquote, not as the writer', () => {
    const md = buildMarkdown(input(), buildManifest(input()));
    expect(md).toContain('> A gentle reflection.');
    expect(md).not.toContain('\nA gentle reflection.');
  });

  it('quotes every line of a multi-line reflection', () => {
    const i = input({
      turns: [turn('a', 'entry', '2026-08-01T10:00:00.000Z', 'line one\nline two')],
    });
    const md = buildMarkdown(i, buildManifest(i));
    expect(md).toContain('> line one');
    expect(md).toContain('> line two');
  });

  it('omits the reflection block entirely when there is none', () => {
    const i = input({ turns: [turn('a', 'entry only', '2026-08-01T10:00:00.000Z')] });
    expect(buildMarkdown(i, buildManifest(i))).not.toContain('>');
  });

  it('dates each entry in UTC', () => {
    const md = buildMarkdown(input(), buildManifest(input()));
    expect(md).toContain('## 2026-08-01 10:00 UTC');
  });

  it('handles an empty journal without producing a broken document', () => {
    const i = input({ turns: [] });
    const md = buildMarkdown(i, buildManifest(i));
    expect(md).toContain('# Lumen journal');
    expect(md).toContain('_No entries._');
  });

  it('names the last 0G root in the header', () => {
    expect(buildMarkdown(input(), buildManifest(input()))).toContain(RECEIPT.rootHash);
  });
});

describe('attestation line', () => {
  it('summarises model, status and proof reference', () => {
    const t = { ...turn('a', 'e', '2026-08-01T10:00:00.000Z'), attestation: ATTESTATION };
    const line = attestationLine(t)!;
    expect(line).toContain('glm-5.1');
    expect(line).toContain('verification: verified');
    expect(line).toContain('chat-123');
    expect(line).toContain('0xabc');
  });

  it('is absent for a turn with no attestation', () => {
    expect(attestationLine(turn('a', 'e', '2026-08-01T10:00:00.000Z'))).toBeNull();
  });
});

describe('bundle', () => {
  it('produces both formats with dated filenames', () => {
    const b = buildExportBundle(input());
    expect(b.markdownFilename).toBe('lumen-journal-2026-08-19.md');
    expect(b.jsonFilename).toBe('lumen-journal-2026-08-19.json');
  });

  it('round-trips every entry through the JSON', () => {
    const b = buildExportBundle(input());
    const parsed = JSON.parse(b.json) as { manifest: unknown; entries: JournalTurn[] };
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(parsed.entries[0]!.entry).toBe('First thing I wrote.');
  });

  it('preserves the attestation proof so a reflection can be re-verified later', () => {
    const i = input({
      turns: [{ ...turn('a', 'e', '2026-08-01T10:00:00.000Z'), attestation: ATTESTATION }],
    });
    const parsed = JSON.parse(buildExportBundle(i).json) as { entries: JournalTurn[] };
    expect(parsed.entries[0]!.attestation!.proof!.chatId).toBe('chat-123');
  });

  it('is byte-identical for the same journal, so exports can be diffed', () => {
    expect(buildExportBundle(input()).json).toBe(buildExportBundle(input()).json);
  });

  it('is order-independent — a differently ordered input exports the same bytes', () => {
    const forwards = input();
    const backwards = input({ turns: [...forwards.turns].reverse() });
    expect(buildExportBundle(backwards).json).toBe(buildExportBundle(forwards).json);
  });

  it('exports an empty journal without throwing', () => {
    const b = buildExportBundle(input({ turns: [], wallet: null, receipt: null }));
    expect(JSON.parse(b.json).entries).toEqual([]);
  });
});
