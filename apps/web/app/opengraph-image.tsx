import { ImageResponse } from 'next/og';

/**
 * The share card.
 *
 * There was no OG image at all, so every link to this product — every post,
 * every DM, every submission — rendered a blank rectangle. Built with
 * `next/og` rather than a checked-in PNG so it stays in step with the palette
 * and needs no design tool to change.
 *
 * Drawn as the page is drawn: a lamp in a dark room, the mark lit inside it.
 * No webfonts loaded here on purpose — an ImageResponse that fetches a font is
 * an ImageResponse that can fail at share time, and a card that renders in the
 * fallback serif beats a card that does not render.
 */

export const alt = 'Lumen — Own your mind. Prove your privacy.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const MARK =
  'M50 10c1.6 25.6 8.8 37.2 40 40-25.6 1.6-37.2 8.8-40 40-1.6-25.6-8.8-37.2-40-40 25.6-1.6 37.2-8.8 40-40Z';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#100f0c',
          padding: 72,
          position: 'relative',
        }}
      >
        {/* The pool. Same shape as the page: a hot centre falling off warm. */}
        <div
          style={{
            position: 'absolute',
            top: -180,
            left: 300,
            width: 900,
            height: 900,
            borderRadius: 9999,
            background:
              'radial-gradient(circle, rgba(251,191,36,0.30) 0%, rgba(180,83,9,0.14) 42%, rgba(180,83,9,0) 70%)',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <svg width={26} height={26} viewBox="0 0 100 100">
            <path d={MARK} fill="#f59e0b" />
          </svg>
          <span style={{ fontSize: 26, color: '#ece5d8', letterSpacing: -0.2 }}>Lumen</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontSize: 82,
              lineHeight: 1.02,
              color: '#ece5d8',
              letterSpacing: -2.5,
              maxWidth: 900,
            }}
          >
            Write the thing you would not say out loud.
          </div>
          <div style={{ marginTop: 28, fontSize: 27, color: '#9a8f80', maxWidth: 760 }}>
            A private place to think. No wallet, no account, nothing to install.
          </div>
        </div>

        <div style={{ display: 'flex', fontSize: 21, color: '#9a8f80', letterSpacing: 2 }}>
          PRIVATE BY PROOF
        </div>
      </div>
    ),
    size,
  );
}
