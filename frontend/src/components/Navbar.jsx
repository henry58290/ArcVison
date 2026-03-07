import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useTheme } from "./ThemeProvider";

function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef(null);
  const location = useLocation();
  const { theme, setThemeMode } = useTheme();

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        setSettingsOpen(false);
      }
    };

    const handleClickOutside = (e) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setSettingsOpen(false);
      }
    };

    if (settingsOpen) {
      document.addEventListener('keydown', handleEscape);
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [settingsOpen]);

  useEffect(() => {
    setSettingsOpen(false);
  }, [location.pathname]);

  const navLinks = [
    { path: "/", label: "Markets" },
    { path: "/swap", label: "Swap" },
  ];

  return (
    <header 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        background: 'rgba(var(--color-bg-rgb, 8, 9, 10), 0.9)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <nav 
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          height: '72px',
          maxWidth: '1400px',
          margin: '0 auto',
          padding: '0 1rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '12px', textDecoration: 'none' }}>
            <img 
              src="/logos/arcvision.png" 
              alt="ArcVison" 
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
              }}
            />
            <span 
              style={{ 
                fontFamily: 'Bebas Neue, sans-serif',
                fontSize: '1.5rem', 
                color: 'var(--color-fg)',
                letterSpacing: '0.05em',
              }}
            >
              ArcVison
            </span>
          </Link>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="desktop-nav" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                style={{
                  padding: '0.5rem 1rem',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  color: location.pathname === link.path ? 'var(--color-accent)' : 'var(--color-fg-muted)',
                  textDecoration: 'none',
                  textTransform: 'uppercase',
                  letterSpacing: '0.02em',
                  background: location.pathname === link.path ? 'rgba(249, 115, 22, 0.1)' : 'transparent',
                  borderRadius: '8px',
                  transition: 'all 0.15s ease',
                }}
              >
                {link.label}
              </Link>
            ))}
          </div>

          <button
            className="mobile-menu-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            style={{
              display: 'none',
              padding: '0.5rem',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-fg)',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              {mobileMenuOpen ? (
                <path d="M6 6L18 18M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              ) : (
                <path d="M4 6H20M4 12H20M4 18H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              )}
            </svg>
          </button>

          <div ref={settingsRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setSettingsOpen(!settingsOpen)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '40px',
                height: '40px',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                cursor: 'pointer',
                color: 'var(--color-fg-muted)',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-fg-dim)';
                e.currentTarget.style.color = 'var(--color-fg)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-border)';
                e.currentTarget.style.color = 'var(--color-fg-muted)';
              }}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 12.5C11.3807 12.5 12.5 11.3807 12.5 10C12.5 8.61929 11.3807 7.5 10 7.5C8.61929 7.5 7.5 8.61929 7.5 10C7.5 11.3807 8.61929 12.5 10 12.5Z" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M16.1667 10C16.1667 10.35 16.1333 10.6917 16.075 11.0167L17.9 12.55C18.1167 12.7333 18.1667 13.05 18.0167 13.3L16.2667 16.1167C16.1167 16.3667 15.8167 16.4667 15.55 16.3333L13.3333 15.4C12.8333 15.9167 12.2667 16.3667 11.65 16.7333L11.2833 19.1667C11.2333 19.45 10.9833 19.65 10.6833 19.65H7.31667C7.01667 19.65 6.76667 19.45 6.71667 19.1667L6.35 16.7333C5.73333 16.3667 5.16667 15.9167 4.66667 15.4L2.45 16.3333C2.18333 16.4667 1.88333 16.3667 1.73333 16.1167L-0.0166667 13.3C-0.166667 13.05 -0.116667 12.7333 0.1 12.55L1.925 11.0167C1.86667 10.6917 1.83333 10.35 1.83333 10C1.83333 9.65 1.86667 9.30833 1.925 8.98333L0.1 7.45C-0.116667 7.26667 -0.166667 6.95 0.0166667 6.7L1.81667 3.88333C1.96667 3.63333 2.26667 3.53333 2.53333 3.66667L4.75 4.6C5.25 4.08333 5.81667 3.63333 6.43333 3.26667L6.8 0.833333C6.85 0.55 7.1 0.35 7.4 0.35H10.7667C11.0667 0.35 11.3167 0.55 11.3667 0.833333L11.7333 3.26667C12.35 3.63333 12.9167 4.08333 13.4167 4.6L15.6333 3.66667C15.9 3.53333 16.2 3.63333 16.35 3.88333L18.1 6.7C18.25 6.95 18.2 7.26667 17.9833 7.45L16.1583 8.98333C16.2167 9.30833 16.25 9.65 16.25 10H16.1667Z" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
            </button>

            {settingsOpen && (
              <div 
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  right: 0,
                  width: '160px',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '12px',
                  padding: '8px',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
                  zIndex: 200,
                  animation: 'scaleIn 0.15s ease',
                }}
              >
                <p style={{
                  fontSize: '0.6875rem',
                  fontWeight: '600',
                  color: 'var(--color-fg-dim)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  padding: '8px 12px 4px',
                  margin: 0,
                }}>
                  Theme
                </p>
                <button
                  onClick={() => { setThemeMode('light'); setSettingsOpen(false); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    width: '100%',
                    padding: '10px 12px',
                    background: theme === 'light' ? 'rgba(249, 115, 22, 0.15)' : 'transparent',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    color: theme === 'light' ? 'var(--color-accent)' : 'var(--color-fg-muted)',
                    fontSize: '0.875rem',
                    fontWeight: '500',
                    transition: 'all 0.1s ease',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => {
                    if (theme !== 'light') {
                      e.currentTarget.style.background = 'var(--color-surface-hover)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (theme !== 'light') {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M15.5 9.5C15.5 13.09 12.59 16 9 16C5.41 16 2.5 13.09 2.5 9.5C2.5 5.91 5.41 3 9 3C9.65 3 10.27 3.1 10.85 3.29C10.02 4.13 9.5 5.22 9.5 6.38C9.5 8.77 11.33 10.73 13.6 10.96C13.26 10.41 13 9.77 13 9.06C13 7.35 14.46 5.94 16.22 6.04C15.72 7.24 15.5 8.56 15.5 9.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Light
                  {theme === 'light' && (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginLeft: 'auto' }}>
                      <path d="M11.5 4L5.25 10.25L2.5 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
                <button
                  onClick={() => { setThemeMode('dark'); setSettingsOpen(false); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    width: '100%',
                    padding: '10px 12px',
                    background: theme === 'dark' ? 'rgba(249, 115, 22, 0.15)' : 'transparent',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    color: theme === 'dark' ? 'var(--color-accent)' : 'var(--color-fg-muted)',
                    fontSize: '0.875rem',
                    fontWeight: '500',
                    transition: 'all 0.1s ease',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => {
                    if (theme !== 'dark') {
                      e.currentTarget.style.background = 'var(--color-surface-hover)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (theme !== 'dark') {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M16 9.52727C16.213 10.7705 15.8124 12.0239 15.0002 12.9651C14.188 13.9063 13.0599 14.4613 11.8656 14.4613C10.6713 14.4613 9.54317 13.9063 8.731 12.9651C7.91883 12.0239 7.51824 10.7705 7.73124 9.52727C7.81963 8.93732 7.71456 8.33013 7.4358 7.80395C7.15703 7.27778 6.7207 6.86179 6.19606 6.62327C5.67142 6.38476 5.08923 6.33581 4.53313 6.48256C3.97703 6.62931 3.47752 6.96603 3.11181 7.44804C2.43867 8.27952 2.10656 9.32382 2.18607 10.3797C2.26559 11.4355 2.75083 12.4197 3.54167 13.1474C4.3325 13.8751 5.37313 14.2985 6.45279 14.3419C7.53245 14.3853 8.57295 14.0462 9.36779 13.3833C10.1626 12.7204 10.6666 11.7771 10.7899 10.7467C10.9132 9.71626 10.6475 8.67715 10.0402 7.83944C9.43295 7.00173 8.52072 6.41791 7.47058 6.17979C8.71462 5.18027 10.3296 4.78778 11.8656 5.08783C13.4016 5.38788 14.7299 6.35426 15.5357 7.74051C16.3414 9.12676 16.5627 10.7837 16.1583 12.2776C16.0493 11.9198 16 11.5503 16 11.1772V11.1772C16 10.5233 16.1403 9.88101 16.4067 9.29727L16 9.52727Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Dark
                  {theme === 'dark' && (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginLeft: 'auto' }}>
                      <path d="M11.5 4L5.25 10.25L2.5 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
              </div>
            )}
          </div>

          <ConnectButton.Custom>
            {({
              account,
              chain,
              openAccountModal,
              openChainModal,
              openConnectModal,
              mounted,
            }) => {
              const ready = mounted;
              const connected = ready && account && chain;

              return (
                <div
                  {...(!ready && {
                    'aria-hidden': true,
                    style: {
                      opacity: 0,
                      pointerEvents: 'none',
                      userSelect: 'none',
                    },
                  })}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  {(() => {
                    if (!connected) {
                      return (
                        <button
                          onClick={openConnectModal}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.5rem',
                            padding: '0.5rem 1.5rem',
                            fontFamily: 'IBM Plex Mono, monospace',
                            fontSize: '0.875rem',
                            fontWeight: '600',
                            letterSpacing: '0.02em',
                            textTransform: 'uppercase',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            background: 'var(--color-accent)',
                            color: '#08090a',
                            minHeight: '40px',
                          }}
                        >
                          Connect Wallet
                        </button>
                      );
                    }

                    if (chain.unsupported) {
                      return (
                        <button
                          onClick={openChainModal}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.5rem',
                            padding: '0.5rem 1.5rem',
                            fontFamily: 'IBM Plex Mono, monospace',
                            fontSize: '0.875rem',
                            fontWeight: '600',
                            letterSpacing: '0.02em',
                            textTransform: 'uppercase',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            background: 'var(--color-danger)',
                            color: 'white',
                            minHeight: '40px',
                          }}
                        >
                          Wrong Network
                        </button>
                      );
                    }

                    return (
                      <button
                        onClick={openAccountModal}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          padding: '0.5rem 1.5rem',
                          fontFamily: 'IBM Plex Mono, monospace',
                          fontSize: '0.875rem',
                          fontWeight: '600',
                          letterSpacing: '0.02em',
                          textTransform: 'uppercase',
                          border: '1px solid var(--color-border)',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          background: 'var(--color-surface-elevated)',
                          color: 'var(--color-fg)',
                          minHeight: '40px',
                        }}
                      >
                        <span
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: 'var(--color-success)',
                          }}
                          aria-hidden="true"
                        />
                        {account.displayName}
                        {account.displayBalance
                          ? ` (${account.displayBalance})`
                          : ''}
                      </button>
                    );
                  })()}
                </div>
              );
            }}
          </ConnectButton.Custom>
        </div>
      </nav>

      {mobileMenuOpen && (
        <div 
          className="mobile-menu"
          style={{
            display: 'none',
            position: 'absolute',
            top: '72px',
            left: 0,
            right: 0,
            background: 'rgba(var(--color-bg-rgb, 8, 9, 10), 0.98)',
            borderBottom: '1px solid var(--color-border-subtle)',
            padding: '1rem',
          }}
        >
          {navLinks.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              onClick={() => setMobileMenuOpen(false)}
              style={{
                display: 'block',
                padding: '0.75rem 1rem',
                fontSize: '1rem',
                fontWeight: '600',
                color: location.pathname === link.path ? 'var(--color-accent)' : 'var(--color-fg)',
                textDecoration: 'none',
                textTransform: 'uppercase',
                letterSpacing: '0.02em',
                background: location.pathname === link.path ? 'rgba(249, 115, 22, 0.1)' : 'transparent',
                borderRadius: '8px',
                marginBottom: '0.5rem',
              }}
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}

      <style>{`
        @keyframes scaleIn {
          from { 
            opacity: 0; 
            transform: scale(0.95); 
          }
          to { 
            opacity: 1; 
            transform: scale(1); 
          }
        }
        @media (max-width: 768px) {
          .desktop-nav {
            display: none !important;
          }
          .mobile-menu-btn {
            display: flex !important;
          }
          .mobile-menu {
            display: block !important;
          }
        }
      `}</style>
    </header>
  );
}

export default Navbar;
