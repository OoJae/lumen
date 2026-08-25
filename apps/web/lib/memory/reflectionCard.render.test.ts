import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ReflectionCard } from '../../components/ReflectionCard';

/**
 * Renders ReflectionCard for real and asserts the accessibility contract.
 *
 * Before this, the only aria-live in the whole app was on the voice button. A
 * keyboard/screen-reader user pressed Cmd+Enter and heard nothing for the entire
 * round trip — not the start, not the tokens, not the completion — while the
 * focused textarea was disabled out from under them and focus fell to <body>.
 *
 * `.ts` not `.tsx` so it sits inside vitest's `lib/**\/*.test.ts` include;
 * createElement avoids needing JSX. ReflectionCard takes plain props and calls
 * no wagmi hooks, which is what makes this possible.
 */
function render(over: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(ReflectionCard, {
      entry: 'I keep thinking about the house.',
      reflection: null,
      attestation: null,
      streaming: false,
      onOpenAttestation: () => {},
      ...over,
    } as never),
  );
}

describe('the reflection is announced', () => {
  it('wraps the reply in a polite live region', () => {
    const html = render({ reflection: 'That sounds heavy.', streaming: true });
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  it('announces the pending state too, not just the finished text', () => {
    // The placeholder lives inside the same region, so "Reflecting…" is spoken
    // rather than the user waiting in silence to find out anything happened.
    const html = render({ reflection: null });
    expect(html).toContain('Reflecting…');
    expect(html).toContain('aria-live="polite"');
  });

  it('is not atomic — the stream is announced as it grows', () => {
    // aria-atomic="true" would re-read the entire reflection on every token.
    expect(render({ reflection: 'x', streaming: true })).toContain('aria-atomic="false"');
  });

  it('still renders what the writer wrote, outside the live region', () => {
    const html = render();
    expect(html).toContain('I keep thinking about the house.');
    // The entry must not be inside the announced region, or it gets read back
    // to the person who just typed it.
    const region = html.indexOf('role="status"');
    expect(html.indexOf('I keep thinking about the house.')).toBeLessThan(region);
  });
});
