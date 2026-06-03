/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    // Wipe defaults that fight a "premium through restraint" aesthetic:
    // no rounded-md, no ring-3, no shadow-md. Components opt into
    // exact values rather than grabbing the closest preset.
    extend: {
      colors: {
        // Field — the page background, slightly cooler than #000.
        field: '#0A0A0B',
        // Surface — a single step up. Used for the few elements that
        // need to feel elevated (control bar pill, slide-in panels).
        surface: '#111114',
        // Hairline — for borders. 1px rgba-white-6% is more refined
        // than slate-700 in this range.
        hairline: 'rgba(255, 255, 255, 0.06)',
        // Ink scale. We use these for text and a few subtle surfaces.
        // z-* instead of slate-* to signal the palette has been chosen
        // rather than inherited from Tailwind defaults.
        ink: {
          50: '#FAFAF9',
          200: '#E4E4E7',
          400: '#A1A1AA',
          500: '#71717A',
          700: '#3F3F46',
        },
        // The single accent. Used for the primary underline, the
        // "live" dot, and the focus ring. Never as a button background.
        accent: {
          DEFAULT: '#E8C47A',
          soft: 'rgba(232, 196, 122, 0.14)',
        },
        // Desaturated state colors. Replaces red-400/emerald-400.
        state: {
          success: '#7FB685',
          error: '#D88A86',
        },
      },
      fontFamily: {
        // Single family for sans — Inter — across display and body.
        // The OpticalSize axis and full weight range do the work
        // that a second family would.
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
        // Geist Mono for system-y values: room ids, invite codes,
        // durations, timestamps. We never use mono for prose.
        mono: [
          'Geist Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'monospace',
        ],
      },
      fontSize: {
        // Display scale is small on purpose. Three steps of display,
        // two of body. Anything smaller than 14 is for micro-labels.
        'display-lg': ['64px', { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '500' }],
        'display-md': ['40px', { lineHeight: '1.1',  letterSpacing: '-0.02em', fontWeight: '500' }],
        'display-sm': ['24px', { lineHeight: '1.2',  letterSpacing: '-0.01em', fontWeight: '500' }],
        'body':       ['14px', { lineHeight: '1.5' }],
        'small':      ['12px', { lineHeight: '1.4' }],
        'micro':      ['11px', { lineHeight: '1.4', letterSpacing: '0.06em' }],
      },
      // Spacing stays default. Components reference 4/8/12/24/48/64
      // from the default scale rather than custom names, so a
      // quick `p-6` reads as "24px" without context.
      transitionTimingFunction: {
        // Linear / Vercel / Raycast converge on this curve. The
        // `0.2, 0, 0, 1` quintic out has a fast acceleration off
        // the start and a soft settle — feels mechanical, not bouncy.
        out: 'cubic-bezier(0.2, 0, 0, 1)',
      },
      transitionDuration: {
        180: '180ms',
        240: '240ms',
        480: '480ms',
      },
    },
  },
  plugins: [],
};
