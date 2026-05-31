/**
 * marketGlyphs — decorative thumbnail visuals for MarketCard.
 *
 * Maps a market's category (and a few well-known subcategory keywords) to a
 * line-art glyph + a dark gradient used behind the card thumbnail when the
 * market has no custom image. Purely cosmetic — no data semantics, no network.
 *
 * Category index matches CATEGORIES in Dashboard.jsx:
 *   0 Crypto · 1 Sports · 2 Politics · 3 Entertainment · 4 Science · 5 Other
 */

const GLYPHS = {
  btc: {
    gradient: 'linear-gradient(135deg,#1c1407,#0c0c12 72%)',
    svg: (
      <g stroke="#FFB347" strokeWidth="1.4">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.5 7v10M12 7v10M8 7h5.2a2.2 2.2 0 0 1 0 4.4H8M8 11.4h5.6a2.3 2.3 0 0 1 0 4.6H8" strokeLinecap="round" />
      </g>
    ),
  },
  eth: {
    gradient: 'linear-gradient(135deg,#0c1020,#0c0c12 72%)',
    svg: (
      <g stroke="#8FA2FF" strokeWidth="1.4" strokeLinejoin="round">
        <path d="M12 3 6 12l6 3.4L18 12z" />
        <path d="M6 13.6 12 21l6-7.4-6 3.4z" />
      </g>
    ),
  },
  sol: {
    gradient: 'linear-gradient(135deg,#06181a,#0c0c12 72%)',
    svg: (
      <g stroke="#27D5E5" strokeWidth="2" strokeLinecap="round">
        <g transform="skewX(-14) translate(4 0)">
          <path d="M2 7h12M2 12h12M2 17h12" />
        </g>
      </g>
    ),
  },
  base: {
    gradient: 'linear-gradient(135deg,#0a1124,#0c0c12 72%)',
    svg: (
      <g stroke="#5B8DEF" strokeWidth="1.6">
        <circle cx="12" cy="12" r="8" />
        <path d="M9 12h8" strokeLinecap="round" />
      </g>
    ),
  },
  coins: {
    gradient: 'linear-gradient(135deg,#181206,#0c0c12 72%)',
    svg: (
      <g stroke="#FFB347" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="9" cy="6" rx="5.5" ry="2.6" />
        <path d="M3.5 6v6c0 1.4 2.5 2.6 5.5 2.6" />
        <ellipse cx="15" cy="13" rx="5.5" ry="2.6" />
        <path d="M9.5 13v6c0 1.4 2.5 2.6 5.5 2.6s5.5-1.2 5.5-2.6v-6" />
      </g>
    ),
  },
  bank: {
    gradient: 'linear-gradient(135deg,#101120,#0c0c12 72%)',
    svg: (
      <g stroke="#A594FF" strokeWidth="1.4" strokeLinejoin="round">
        <path d="M3 9l9-5 9 5M4 9v9M20 9v9M3 21h18M8 9v8M12 9v8M16 9v8" />
      </g>
    ),
  },
  trophy: {
    gradient: 'linear-gradient(135deg,#08140f,#0c0c12 72%)',
    svg: (
      <g stroke="#2FE0A0" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M9 18h6M10 14v4M14 14v4M8 20h8" />
      </g>
    ),
  },
  film: {
    gradient: 'linear-gradient(135deg,#1a0c12,#0c0c12 72%)',
    svg: (
      <g stroke="#FF9DB0" strokeWidth="1.4" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 9h18M3 15h18M8 5v14M16 5v14" />
      </g>
    ),
  },
  music: {
    gradient: 'linear-gradient(135deg,#140c1e,#0c0c12 72%)',
    svg: (
      <g stroke="#C49DFF" strokeWidth="1.6" strokeLinecap="round">
        <path d="M9 17V6l9-2v9" />
        <circle cx="7" cy="17" r="2" />
        <circle cx="16" cy="15" r="2" />
      </g>
    ),
  },
  rocket: {
    gradient: 'linear-gradient(135deg,#100c20,#0c0c12 72%)',
    svg: (
      <g stroke="#A594FF" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3c3 1.6 4.5 4.6 4.5 8L12 15 7.5 11c0-3.4 1.5-6.4 4.5-8z" />
        <circle cx="12" cy="9" r="1.4" />
        <path d="M9 15l-2 4M15 15l2 4" />
      </g>
    ),
  },
  cpu: {
    gradient: 'linear-gradient(135deg,#06181a,#0c0c12 72%)',
    svg: (
      <g stroke="#27D5E5" strokeWidth="1.4" strokeLinejoin="round">
        <rect x="7" y="7" width="10" height="10" rx="2" />
        <path d="M10 3v3M14 3v3M10 18v3M14 18v3M3 10h3M3 14h3M18 10h3M18 14h3" />
      </g>
    ),
  },
  generic: {
    gradient: 'linear-gradient(135deg,#121219,#0c0c12 72%)',
    svg: (
      <g stroke="#8B8D9C" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="9" cy="6" rx="5.5" ry="2.6" />
        <path d="M3.5 6v6c0 1.4 2.5 2.6 5.5 2.6" />
        <ellipse cx="15" cy="13" rx="5.5" ry="2.6" />
        <path d="M9.5 13v6c0 1.4 2.5 2.6 5.5 2.6s5.5-1.2 5.5-2.6v-6" />
      </g>
    ),
  },
};

const DEFAULT_KEY = 'generic';

/** Pick a glyph key from subcategory keywords first, then the category index. */
function resolveKey(categoryId, subcategory) {
  const sub = (subcategory || '').toLowerCase();

  if (/bitcoin|btc/.test(sub)) return 'btc';
  if (/ethereum|\beth\b/.test(sub)) return 'eth';
  if (/solana|\bsol\b/.test(sub)) return 'sol';
  if (/\bbase\b/.test(sub)) return 'base';
  if (/film|movie|cinema|box office/.test(sub)) return 'film';
  if (/music|song|album|billboard/.test(sub)) return 'music';
  if (/space|rocket|spacex|nasa|orbit|starship/.test(sub)) return 'rocket';
  if (/\bai\b|artificial|model|benchmark|llm/.test(sub)) return 'cpu';

  switch (Number(categoryId)) {
    case 0: return 'coins';   // Crypto
    case 1: return 'trophy';  // Sports
    case 2: return 'bank';    // Politics
    case 3: return 'film';    // Entertainment
    case 4: return 'rocket';  // Science
    default: return 'generic'; // Other / unknown
  }
}

/** Dark gradient for the card thumbnail background. */
export function getCardGradient(categoryId, subcategory) {
  return (GLYPHS[resolveKey(categoryId, subcategory)] || GLYPHS[DEFAULT_KEY]).gradient;
}

/** Decorative category glyph rendered in the thumbnail corner. */
export function MarketGlyph({ categoryId, subcategory, size = 120 }) {
  const g = GLYPHS[resolveKey(categoryId, subcategory)] || GLYPHS[DEFAULT_KEY];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {g.svg}
    </svg>
  );
}
