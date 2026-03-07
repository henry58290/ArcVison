import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

const EXPLORER_BASE = 'https://testnet.arcscan.app';
const NOTIFICATION_DURATION = 6000;

const NotificationContext = createContext(null);

export function useNotification() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotification must be used within NotificationProvider');
  return ctx;
}

let idCounter = 0;

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState([]);
  const timersRef = useRef({});

  const addNotification = useCallback((message, txHash, type = 'success') => {
    const id = ++idCounter;
    setNotifications((prev) => [...prev, { id, message, txHash, type, exiting: false }]);

    timersRef.current[id] = setTimeout(() => {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, exiting: true } : n))
      );
      setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        delete timersRef.current[id];
      }, 320);
    }, NOTIFICATION_DURATION);

    return id;
  }, []);

  const removeNotification = useCallback((id) => {
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, exiting: true } : n))
    );
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 320);
  }, []);

  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach(clearTimeout);
    };
  }, []);

  const handleClick = (txHash) => {
    if (txHash) {
      window.open(`${EXPLORER_BASE}/tx/${txHash}`, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <NotificationContext.Provider value={{ addNotification, removeNotification }}>
      {children}

      {/* Notification container */}
      <div
        style={{
          position: 'fixed',
          top: '80px',
          right: '20px',
          zIndex: 10000,
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          pointerEvents: 'none',
          maxWidth: '400px',
          width: '100%',
        }}
      >
        {notifications.map((n) => (
          <div
            key={n.id}
            onClick={() => handleClick(n.txHash)}
            style={{
              pointerEvents: 'auto',
              cursor: n.txHash ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '14px 18px',
              background: 'var(--color-surface-elevated)',
              border: `1px solid ${
                n.type === 'success'
                  ? 'var(--color-success)'
                  : n.type === 'error'
                    ? 'var(--color-danger)'
                    : 'var(--color-accent)'
              }`,
              borderRadius: '12px',
              boxShadow: '0 8px 32px var(--color-shadow)',
              animation: n.exiting
                ? 'notif-slide-out 0.3s ease-in forwards'
                : 'notif-slide-in 0.3s ease-out forwards',
              backdropFilter: 'blur(12px)',
              transition: 'opacity 0.3s ease',
            }}
          >
            {/* Icon */}
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background:
                  n.type === 'success'
                    ? 'var(--color-success-bg)'
                    : n.type === 'error'
                      ? 'var(--color-danger-bg)'
                      : 'var(--color-accent-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                fontSize: '16px',
              }}
            >
              {n.type === 'success' ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M13.5 4.5L6 12L2.5 8.5"
                    stroke="var(--color-success)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : n.type === 'error' ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M4 4L12 12M12 4L4 12"
                    stroke="var(--color-danger)"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M8 3V8L11 11"
                    stroke="var(--color-accent)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>

            {/* Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  color: 'var(--color-fg)',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  lineHeight: '1.4',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {n.message}
              </div>
              {n.txHash && (
                <div
                  style={{
                    color: 'var(--color-fg-dim)',
                    fontSize: '0.6875rem',
                    marginTop: '2px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  View on explorer
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path
                      d="M3 1H9V7M9 1L1 9"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              )}
            </div>

            {/* Close button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeNotification(n.id);
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-fg-dim)',
                cursor: 'pointer',
                padding: '4px',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M2 2L10 10M10 2L2 10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  );
}
