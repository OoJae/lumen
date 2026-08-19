/**
 * "Take everything" — the whole journal, in formats that outlive Lumen.
 *
 * This is a credibility repair, not a feature. A product whose promise is "own
 * your mind" while offering no way to get your words out is contradicting
 * itself, and in this category export has become a trust signal precisely
 * because the incumbents' are unreliable. Obsidian's argument is the right one:
 * ownership has to be demonstrable as a FORMAT, not asserted as a policy.
 *
 * Two outputs, on purpose:
 *   - Markdown, so a human can read it in anything, forever, with no tool.
 *   - JSON, so a machine can — including the attestation proof references, which
 *     are what let someone re-verify months later that a reflection really was
 *     signed inside an enclave.
 *
 * Pure: no crypto, no I/O, no clock. After unlock `memory.turns` is already
 * decrypted plaintext, so an export serialises exactly what the app is showing
 * you — there is nothing to decrypt and no key to handle here.
 */
import type { JournalTurn, StorageReceipt } from '@lumen/shared';

import { canonicalJson } from '../crypto/canonical';

export const EXPORT_FORMAT_VERSION = 1;

export interface ExportManifest {
  app: 'lumen';
  formatVersion: number;
  exportedAt: string;
  /** Lowercase 0x, or null for an export made before connecting a wallet. */
  wallet: string | null;
  entryCount: number;
  /** The last snapshot this device saved to 0G, if any. */
  storage: {
    rootHash: string;
    txHash: string;
    seq: number;
    savedAt: string;
    network: string;
  } | null;
  note: string;
}

export interface ExportInput {
  turns: readonly JournalTurn[];
  wallet: string | null;
  receipt: StorageReceipt | null;
  /** ISO-8601. Injected so this stays pure and testable. */
  exportedAt: string;
}

export interface ExportBundle {
  manifest: ExportManifest;
  markdown: string;
  json: string;
  /** Suggested filenames, without a path. */
  markdownFilename: string;
  jsonFilename: string;
}

const NOTE =
  'Exported from Lumen. These entries were encrypted on the device that wrote them; ' +
  'this file is plaintext, so store it the way you would a paper journal.';

function chronological(turns: readonly JournalTurn[]): JournalTurn[] {
  // Oldest first: a journal reads forwards, even though the app shows newest first.
  return [...turns].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function heading(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/** One line summarising whether this reflection was verified, and how. */
export function attestationLine(turn: JournalTurn): string | null {
  const a = turn.attestation;
  if (!a) return null;
  const bits: string[] = [];
  if (a.model) bits.push(`model: ${a.model}`);
  bits.push(`verification: ${a.verificationStatus}`);
  if (a.proof?.chatId) bits.push(`proof: ${a.proof.chatId}`);
  if (a.proof?.responseSha256) bits.push(`sha256: ${a.proof.responseSha256}`);
  return bits.join(' · ');
}

export function buildManifest(input: ExportInput): ExportManifest {
  return {
    app: 'lumen',
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: input.exportedAt,
    wallet: input.wallet ? input.wallet.toLowerCase() : null,
    entryCount: input.turns.length,
    storage: input.receipt
      ? {
          rootHash: input.receipt.rootHash,
          txHash: input.receipt.txHash,
          seq: input.receipt.seq,
          savedAt: input.receipt.savedAt,
          network: input.receipt.network,
        }
      : null,
    note: NOTE,
  };
}

export function buildMarkdown(input: ExportInput, manifest: ExportManifest): string {
  const lines: string[] = ['# Lumen journal', ''];
  lines.push(`Exported ${manifest.exportedAt}`);
  lines.push(`${manifest.entryCount} ${manifest.entryCount === 1 ? 'entry' : 'entries'}`);
  if (manifest.wallet) lines.push(`Wallet: ${manifest.wallet}`);
  if (manifest.storage) {
    lines.push(
      `Last saved to 0G: ${manifest.storage.rootHash} (snapshot #${manifest.storage.seq}, ${manifest.storage.network})`,
    );
  }
  lines.push('', NOTE, '', '---', '');

  if (input.turns.length === 0) {
    lines.push('_No entries._', '');
    return lines.join('\n');
  }

  for (const turn of chronological(input.turns)) {
    lines.push(`## ${heading(turn.createdAt)}`, '');
    lines.push(turn.entry.trim(), '');
    if (turn.reflection.trim()) {
      // Blockquote so the companion's voice is visibly not the writer's.
      lines.push(
        ...turn.reflection
          .trim()
          .split('\n')
          .map((line) => `> ${line}`),
        '',
      );
    }
    const attested = attestationLine(turn);
    if (attested) lines.push(`_${attested}_`, '');
    lines.push('---', '');
  }

  return lines.join('\n');
}

export function buildExportBundle(input: ExportInput): ExportBundle {
  const manifest = buildManifest(input);
  const day = input.exportedAt.slice(0, 10);
  return {
    manifest,
    markdown: buildMarkdown(input, manifest),
    // Canonical so two exports of the same journal are byte-identical — which
    // is what makes "diff your export against your snapshot" a usable check.
    json: canonicalJson({ manifest, entries: chronological(input.turns) }),
    markdownFilename: `lumen-journal-${day}.md`,
    jsonFilename: `lumen-journal-${day}.json`,
  };
}
