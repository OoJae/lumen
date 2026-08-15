import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '@lumen/shared';

/**
 * Mirrors the gateway's system-message folding (app/api/reflect/route.ts).
 * The client may prepend a recall system block; providers can reject duplicate
 * or non-leading system roles, and that rejection would silently demote every
 * recall-bearing reflection to the demo fallback — so the gateway folds all
 * leading system messages into exactly one.
 */
function foldSystems(messages: ChatMessage[], systemPrompt: string): ChatMessage[] {
  let leading = 0;
  while (leading < messages.length && messages[leading]!.role === 'system') leading++;
  const content = [systemPrompt, ...messages.slice(0, leading).map((m) => m.content)].join('\n\n');
  return [{ role: 'system', content }, ...messages.slice(leading)];
}

const PROMPT = 'SYSTEM_PROMPT';

describe('gateway system-message folding', () => {
  it('produces exactly one system message, always first', () => {
    const out = foldSystems(
      [
        { role: 'system', content: 'recall block' },
        { role: 'user', content: 'hello' },
      ],
      PROMPT,
    );
    expect(out.filter((m) => m.role === 'system')).toHaveLength(1);
    expect(out[0]!.role).toBe('system');
    expect(out[0]!.content).toBe(`${PROMPT}\n\nrecall block`);
    expect(out.slice(1)).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('keeps the persona first so recall context cannot override it', () => {
    const out = foldSystems([{ role: 'system', content: 'recall' }], PROMPT);
    expect(out[0]!.content.startsWith(PROMPT)).toBe(true);
  });

  it('is a no-op shape for recall-free requests', () => {
    const out = foldSystems([{ role: 'user', content: 'hi' }], PROMPT);
    expect(out).toEqual([
      { role: 'system', content: PROMPT },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('never reorders conversation turns', () => {
    const convo: ChatMessage[] = [
      { role: 'system', content: 'recall' },
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ];
    expect(foldSystems(convo, PROMPT).slice(1)).toEqual(convo.slice(1));
  });
});
