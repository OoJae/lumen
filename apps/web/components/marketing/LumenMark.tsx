/**
 * The mark, in its two optical cuts.
 *
 * `display` has a tighter waist and reads as a glint of light; `icon` is the
 * shipped favicon geometry, whose fatter arms survive 16px. They are not
 * interchangeable — scaling the icon cut up gives you a fat diamond, and scaling
 * the display cut down gives you four hairlines. The rule is the prop.
 */
const ICON =
  'M50 10c4.5 23 17 35.5 40 40-23 4.5-35.5 17-40 40-4.5-23-17-35.5-40-40 23-4.5 35.5-17 40-40Z';
const DISPLAY =
  'M50 10c1.6 25.6 8.8 37.2 40 40-25.6 1.6-37.2 8.8-40 40-1.6-25.6-8.8-37.2-40-40 25.6-1.6 37.2-8.8 40-40Z';

export function LumenMark({
  cut = 'icon',
  size = 20,
  className,
  title,
}: {
  cut?: 'icon' | 'display';
  size?: number;
  className?: string;
  /** Omit for decorative use — the mark is then hidden from assistive tech. */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path d={cut === 'display' ? DISPLAY : ICON} fill="currentColor" />
    </svg>
  );
}
