import type { ChatMessage } from '@lumen/shared';

/**
 * Fold Lumen's persona and any client-supplied leading system messages (the
 * Wave 2 recall block) into exactly ONE leading system message.
 *
 * Some providers reject duplicate or non-leading system roles, and that
 * rejection would silently demote every recall-bearing reflection to the demo
 * fallback. The persona always comes first so recall context cannot override it.
 *
 * Used by both the gateway and — in Wave 3 — the browser-direct path, so the
 * two produce byte-identical request shapes.
 */
export function foldSystemMessages(
  messages: ChatMessage[],
  systemPrompt: string,
): ChatMessage[] {
  let leading = 0;
  while (leading < messages.length && messages[leading]!.role === 'system') leading++;

  const content = [systemPrompt, ...messages.slice(0, leading).map((m) => m.content)].join('\n\n');
  return [{ role: 'system', content }, ...messages.slice(leading)];
}
