import { useState, useEffect, useRef } from 'react';
import { useReadContract } from 'wagmi';
import { DEFAULT_TOKEN_LIST, ERC20_ABI, formatTokenBalance } from './utils/tokens';

function TokenSelector({ selectedToken, onSelect, label, style }) {
  const t = (key) => key;
  const [isOpen, setIsOpen] = useState(false);
  const [customToken, setCustomToken] = useState('');
  const [importError, setImportError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const modalRef = useRef(null);

  const filteredTokens = DEFAULT_TOKEN_LIST.filter(token => 
    token.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
    token.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (modalRef.current && !modalRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleImport = () => {
    if (!customToken || !customToken.startsWith('0x') || customToken.length !== 42) {
      setImportError('Invalid token address');
      return;
    }
    setImportError('');
    onSelect({
      address: customToken.toLowerCase(),
      symbol: 'UNKNOWN',
      name: 'Unknown Token',
      decimals: 18,
      logo: null,
    });
    setCustomToken('');
    setIsOpen(false);
  };

  const getTokenImage = (token) => {
    if (token.logo) return token.logo;
    if (token.symbol === 'USDC') return '/logos/usdc.png';
    if (token.symbol === 'wUSDC') return '/logos/wusdc.png';
    if (token.symbol === 'AVN') return '/logos/avn.png';
    return null;
  };

  return (
    <div style={{ position: 'relative', ...style }} ref={modalRef}>
      {label && (
        <label style={{
          display: 'block',
          fontSize: '0.75rem',
          color: 'var(--color-fg-dim)',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          marginBottom: '0.5rem',
        }}>
          {label}
        </label>
      )}
      
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          minWidth: '140px',
          padding: '0.625rem 0.875rem',
          background: 'var(--color-surface-elevated)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--color-fg-dim)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--color-border)';
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {selectedToken && getTokenImage(selectedToken) ? (
            <img
              src={getTokenImage(selectedToken)}
              alt={selectedToken.symbol}
              style={{ width: '22px', height: '22px', borderRadius: '50%', objectFit: 'cover' }}
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.nextSibling.style.display = 'flex';
              }}
            />
          ) : null}
          <div
            style={{
              width: '22px',
              height: '22px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-hover))',
              display: selectedToken && getTokenImage(selectedToken) ? 'none' : 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '10px',
              fontWeight: '700',
              color: 'var(--color-accent-fg)',
            }}
          >
            {selectedToken?.symbol?.[0] || '?'}
          </div>
          <span style={{ color: 'var(--color-fg)', fontWeight: '600', fontSize: '0.875rem' }}>
            {selectedToken?.symbol || 'Select'}
          </span>
        </div>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: 'var(--color-fg-muted)' }}>
          <path d="M3 5.5L7 9.5L11 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {isOpen && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          marginTop: '0.5rem',
          width: '320px',
          maxHeight: '420px',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '12px',
          zIndex: 100,
          overflow: 'hidden',
          boxShadow: '0 20px 40px var(--color-shadow)',
        }}>
          <div style={{ padding: '1rem', borderBottom: '1px solid var(--color-border-subtle)' }}>
            <input
              type="text"
              placeholder="Search tokens..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
              style={{
                width: '100%',
                padding: '0.625rem 0.875rem',
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                color: 'var(--color-fg)',
                fontSize: '0.875rem',
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 0.15s',
              }}
              onFocus={(e) => e.target.style.borderColor = 'var(--color-accent)'}
              onBlur={(e) => e.target.style.borderColor = 'var(--color-border)'}
            />
          </div>

          <div style={{ padding: '0.5rem', borderBottom: '1px solid var(--color-border-subtle)' }}>
            <p style={{ 
              color: 'var(--color-fg-dim)', 
              fontSize: '0.6875rem', 
              fontWeight: '600',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              margin: '0 0.5rem 0.5rem',
            }}>
              Popular Tokens
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
              {DEFAULT_TOKEN_LIST.map((token) => (
                <button
                  key={token.address}
                  onClick={() => {
                    onSelect(token);
                    setSearchQuery('');
                    setIsOpen(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.375rem',
                    padding: '0.375rem 0.625rem',
                    background: selectedToken?.address === token.address ? 'var(--color-accent-muted)' : 'var(--color-surface-elevated)',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <img
                    src={getTokenImage(token)}
                    alt={token.symbol}
                    style={{ width: '18px', height: '18px', borderRadius: '50%' }}
                    onError={(e) => e.target.style.display = 'none'}
                  />
                  <span style={{ color: 'var(--color-fg)', fontSize: '0.75rem', fontWeight: '500' }}>
                    {token.symbol}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ padding: '0.75rem' }}>
            <p style={{ 
              color: 'var(--color-fg-dim)', 
              fontSize: '0.6875rem', 
              fontWeight: '600',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              margin: '0 0.5rem 0.5rem',
            }}>
              All Tokens
            </p>
            <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
              {filteredTokens.map((token) => (
                <button
                  key={token.address}
                  onClick={() => {
                    onSelect(token);
                    setSearchQuery('');
                    setIsOpen(false);
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.625rem',
                    background: selectedToken?.address === token.address ? 'var(--color-accent-muted)' : 'transparent',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.15s',
                  }}
                  >
                    <img
                      src={getTokenImage(token)}
                      alt={token.symbol}
                      style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }}
                      onError={(e) => {
                        e.target.style.display = 'none';
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ color: 'var(--color-fg)', fontWeight: '600', fontSize: '0.875rem' }}>
                        {token.symbol}
                      </div>
                      <div style={{ color: 'var(--color-fg-dim)', fontSize: '0.6875rem' }}>{token.name}</div>
                    </div>
                    {selectedToken?.address === token.address && (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--color-accent)' }}>
                        <path d="M13.5 4.5L6 12L2.5 8.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ padding: '1rem', borderTop: '1px solid var(--color-border-subtle)', background: 'var(--color-bg)' }}>
              <p style={{ 
                color: 'var(--color-fg-dim)', 
                fontSize: '0.6875rem', 
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                margin: '0 0 0.5rem',
              }}>
                {t("importToken")}
              </p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  placeholder="0x..."
                  value={customToken}
                  onChange={(e) => {
                    setCustomToken(e.target.value);
                    setImportError('');
                  }}
                  style={{
                    flex: 1,
                    padding: '0.5rem 0.75rem',
                    background: 'var(--color-surface)',
                    border: `1px solid ${importError ? 'var(--color-danger)' : 'var(--color-border)'}`,
                    borderRadius: '6px',
                    color: 'var(--color-fg)',
                    fontSize: '0.8125rem',
                    outline: 'none',
                    fontFamily: 'monospace',
                  }}
                />
                <button
                  onClick={handleImport}
                  style={{
                    padding: '0.5rem 1rem',
                    background: 'var(--color-accent)',
              color: 'var(--color-accent-fg)',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Import
                </button>
              </div>
              {importError && (
                <p style={{ color: 'var(--color-danger)', fontSize: '0.6875rem', marginTop: '0.375rem' }}>
                  {t("invalidToken")}
                </p>
              )}
            </div>
          </div>
        )}
    </div>
  );
}

export default TokenSelector;
