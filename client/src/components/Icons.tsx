// components/Icons.tsx
//
// A small inline-SVG icon set. The system we use elsewhere (Linear,
// Raycast, Arc) prefers 1.5px stroke icons at 16x16 in a 24x24
// viewBox — the slightly larger viewBox gives icons "air" without
// forcing a min-height on the surrounding control.
//
// Every icon is a stateless component that takes:
//   - className: styling (size, color)
//   - strokeWidth: override the default 1.5
// The default stroke uses currentColor so an icon's color is
// driven by the parent's text color, the way Linear's icons work.
//
// We do not use icons as decoration. Each one is a control that
// earns its space.

import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function svg(
  path: React.ReactNode,
  { size = 16, strokeWidth = 1.5, ...rest }: IconProps
) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {path}
    </svg>
  );
}

export const CopyIcon = (p: IconProps) =>
  svg(
    <>
      <rect x="9" y="9" width="11" height="11" rx="1.5" />
      <path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H15" />
    </>,
    p
  );

export const LinkIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.5 1.5" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.5-1.5" />
    </>,
    p
  );

export const VideoIcon = (p: IconProps) =>
  svg(
    <>
      <rect x="3" y="6" width="13" height="12" rx="1.5" />
      <path d="M16 10.5l5-3v9l-5-3" />
    </>,
    p
  );

export const VideoOffIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H14l-2 2H5" />
      <path d="M16 10.5l5-3v9l-3-1.8" />
      <path d="M3 3l18 18" />
      <path d="M5 18a1.5 1.5 0 0 0 1.5 1.5H16" />
    </>,
    p
  );

export const MicIcon = (p: IconProps) =>
  svg(
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </>,
    p
  );

export const MicOffIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M9 9v2a3 3 0 0 0 4.74 2.45" />
      <path d="M15 11V6a3 3 0 0 0-5.94-.6" />
      <path d="M5 11a7 7 0 0 0 11.13 5.67" />
      <path d="M19 11a7 7 0 0 1-.34 2.16" />
      <path d="M12 18v3" />
      <path d="M3 3l18 18" />
    </>,
    p
  );

export const ScreenIcon = (p: IconProps) =>
  svg(
    <>
      <rect x="3" y="4" width="18" height="13" rx="1.5" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </>,
    p
  );

export const HangupIcon = (p: IconProps) =>
  // A rotated phone receiver. We use the 24° rotation inline so the
  // icon reads as "end call" without the caller having to apply a
  // transform.
  svg(
    <g transform="rotate(135 12 12)">
      <path d="M5.5 4.78a2 2 0 0 1 2.32-.42l2.4 1.2a2 2 0 0 1 1.06 2.16l-.6 2.4a2 2 0 0 0 .55 1.95l3.4 3.4a2 2 0 0 0 1.95.55l2.4-.6a2 2 0 0 1 2.16 1.06l1.2 2.4a2 2 0 0 1-.42 2.32l-1.5 1.34a3 3 0 0 1-3.4.36 16 16 0 0 1-7.6-7.6 3 3 0 0 1 .36-3.4z" />
    </g>,
    p
  );

// Phone-in-call icon: a tilted receiver with two short sound waves.
// Used by the participant sidebar to indicate the user is actively
// in the call (mirrors HangupIcon's tilt so the two read as a pair).
export const PhoneIcon = (p: IconProps) =>
  svg(
    <g transform="rotate(135 12 12)">
      <path d="M5.5 4.78a2 2 0 0 1 2.32-.42l2.4 1.2a2 2 0 0 1 1.06 2.16l-.6 2.4a2 2 0 0 0 .55 1.95l3.4 3.4a2 2 0 0 0 1.95.55l2.4-.6a2 2 0 0 1 2.16 1.06l1.2 2.4a2 2 0 0 1-.42 2.32l-1.5 1.34a3 3 0 0 1-3.4.36 16 16 0 0 1-7.6-7.6 3 3 0 0 1 .36-3.4z" />
      <path d="M16 4l2 2" />
      <path d="M19 7l1.5 1.5" />
    </g>,
    p
  );

// Phone-off: receiver at the same tilt as PhoneIcon, with a strike
// through it. Used to indicate the participant is *not* in an
// active call (e.g. dialed in but not yet connected, or briefly
// disconnected mid-call).
export const PhoneOffIcon = (p: IconProps) =>
  svg(
    <g transform="rotate(135 12 12)">
      <path d="M5.5 4.78a2 2 0 0 1 2.32-.42l2.4 1.2a2 2 0 0 1 1.06 2.16l-.6 2.4a2 2 0 0 0 .55 1.95l3.4 3.4a2 2 0 0 0 1.95.55l2.4-.6a2 2 0 0 1 2.16 1.06l1.2 2.4a2 2 0 0 1-.42 2.32l-1.5 1.34a3 3 0 0 1-3.4.36 16 16 0 0 1-7.6-7.6 3 3 0 0 1 .36-3.4z" />
    </g>,
    p
  );

export const HandIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M11 11V4.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M14 11V5.5a1.5 1.5 0 0 1 3 0V13" />
      <path d="M17 11.5a1.5 1.5 0 0 1 3 0V16a6 6 0 0 1-6 6h-1a6 6 0 0 1-5.66-4l-2.2-5.5a1.5 1.5 0 0 1 2.66-1.4L8 13" />
    </>,
    p
  );

export const ChatIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4 4v-4H5.5A1.5 1.5 0 0 1 4 14.5z" />
    </>,
    p
  );

export const PeopleIcon = (p: IconProps) =>
  svg(
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M15 14.5a4 4 0 0 1 6 3.5" />
    </>,
    p
  );

export const PlusIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>,
    p
  );

export const CloseIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6l-12 12" />
    </>,
    p
  );

export const ChevronDownIcon = (p: IconProps) =>
  svg(<path d="M6 9l6 6 6-6" />, p);

export const ChevronRightIcon = (p: IconProps) =>
  svg(<path d="M9 6l6 6-6 6" />, p);

export const RefreshIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M4 12a8 8 0 0 1 14-5.3" />
      <path d="M18 4v4h-4" />
      <path d="M20 12a8 8 0 0 1-14 5.3" />
      <path d="M6 20v-4h4" />
    </>,
    p
  );

export const BlurIcon = (p: IconProps) =>
  // Three nested circles, the outer two partial — a quiet visual
  // reference to a defocused subject.
  svg(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M5.5 8.5a8 8 0 0 1 13 0" />
      <path d="M2.5 5.5a13 13 0 0 1 19 0" />
    </>,
    p
  );

export const CheckIcon = (p: IconProps) =>
  svg(<path d="M5 12l5 5L20 7" />, p);

export const ArrowRightIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </>,
    p
  );
