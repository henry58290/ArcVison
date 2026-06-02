import { Link, useLocation } from "react-router-dom";
import "./BottomNav.css";

/**
 * BottomNav — mobile-only fixed bottom tab bar (Market / Swap / Profile).
 *
 * Rendered globally (see App.jsx) but display:none on desktop — every style
 * lives behind `@media (max-width: 768px)` in BottomNav.css, so it never
 * affects the desktop layout. Routes match the existing app paths; the Market
 * tab stays active on the market detail route too.
 */
const ITEMS = [
  {
    to: "/",
    label: "Market",
    isActive: (p) => p === "/" || p.startsWith("/market"),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 13l4-5 4 4 4-6 6 8" />
        <path d="M3 20h18" />
      </svg>
    ),
  },
  {
    to: "/swap",
    label: "Swap",
    isActive: (p) => p.startsWith("/swap"),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 4v15M7 4 4 7M7 4l3 3M17 20V5M17 20l3-3M17 20l-3-3" />
      </svg>
    ),
  },
  {
    to: "/profile",
    label: "Profile",
    isActive: (p) => p.startsWith("/profile"),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="8" r="3.6" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </svg>
    ),
  },
];

export default function BottomNav() {
  const { pathname } = useLocation();

  return (
    <nav className="bottom-nav" aria-label="Primary">
      {ITEMS.map((item) => {
        const active = item.isActive(pathname);
        return (
          <Link
            key={item.to}
            to={item.to}
            className={`bottom-nav__item${active ? " is-active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <span className="bottom-nav__ic">{item.icon}</span>
            <span className="bottom-nav__label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
