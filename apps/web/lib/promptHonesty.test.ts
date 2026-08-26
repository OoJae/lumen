import { describe, expect, it } from 'vitest';

import { LUMEN_SYSTEM_PROMPT } from './prompts';

/**
 * The system prompt is a user-visible claim surface.
 *
 * It used to instruct the model: "the operator running it cannot read them, and
 * neither can the people who built you." The second half is false —
 * docs/privacy-model.md states that Lumen's own gateway is in the plaintext path
 * for the inference call and sees the prompt, including recalled excerpts. So
 * the model was being told to reassure the writer of something untrue, in the
 * moment they are most trusting. Every other honesty guard in this codebase
 * checks copy that ships in components; none of them looked here.
 */
describe('the system prompt may not overclaim privacy', () => {
  const p = LUMEN_SYSTEM_PROMPT.toLowerCase();

  it('does not claim Lumen itself cannot read the writer', () => {
    for (const phrase of [
      'neither can the people who built you',
      'nobody at lumen',
      'no one at lumen',
      'not even lumen',
    ]) {
      expect(p, phrase).not.toContain(phrase);
    }
  });

  it('explicitly forbids the model from making that claim', () => {
    expect(p).toContain('do not tell them lumen itself is unable to see');
  });

  it('still states the enclave property, in the form that is true', () => {
    // "hardware enclave" alone was the old assertion, and it went stale the day
    // the phrasing was corrected: for our centralized/aliyun provider the model
    // runs at an UPSTREAM HOST and the enclave attests the session around it.
    // Assert the property, not the retired wording.
    expect(p).toContain('attested enclave session');
    expect(p).toContain('cannot read them');
  });

  it('forbids the model from claiming it runs inside the enclave', () => {
    // The prompt is a claim surface: whatever it says here, the model can
    // repeat aloud to someone who asks how private this really is.
    expect(p).toContain('do not say the model itself runs inside the enclave');
    expect(p).toContain('upstream host');
  });

  it('discloses the gateway rather than omitting it', () => {
    expect(p).toContain('in the clear');
  });
});
