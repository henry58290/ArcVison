import { useRef, useState } from 'react';
import './profile.css';

function truncate(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * ProfileHeader — identity card + season/rank card.
 *
 * Identity (avatar upload, username edit, copy address, Connect X) is fully
 * wired to the existing localStorage-backed handlers.
 *
 * The rank card is a PLACEHOLDER — Verdict has no points/rank system yet.
 * To wire it, pass a `rank` prop: { tier, points, rank, total, nextTier, progressPct }.
 */
export default function ProfileHeader({
  address,
  username,
  setUsername,
  avatar,
  setAvatar,
  twitterConnected,
  setTwitterConnected,
  joined,
  rank,
}) {
  const [draftName, setDraftName] = useState(username);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef(null);

  const handleAvatar = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setAvatar(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const saveName = () => {
    setUsername(draftName.trim() || 'Anonymous');
    setEditing(false);
  };

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* ignore */ }
  };

  const hasPoints = rank?.points != null;
  const progressPct = Math.max(0, Math.min(100, rank?.progressPct ?? 0));

  return (
    <section className="pf-card">
      <div className="pf-card__glow" />
      <div className="pf-card__inner">
        {/* Avatar */}
        <div className="pf-avatar-col">
          <div
            className="pf-avatar"
            onClick={() => fileInputRef.current?.click()}
            title="Change avatar"
          >
            {avatar
              ? <img src={avatar} alt="avatar" />
              : (username || 'A').slice(0, 1).toUpperCase()}
          </div>
          <button className="pf-mini" onClick={() => fileInputRef.current?.click()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M14 6l4 4" />
            </svg>
            Edit
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleAvatar}
          />
        </div>

        {/* Identity */}
        <div className="pf-identity">
          <div className="pf-name-row">
            {editing ? (
              <>
                <input
                  className="pf-name-input"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveName()}
                  autoFocus
                  maxLength={32}
                  placeholder="Username"
                />
                <button className="pf-name-save" onClick={saveName}>Save</button>
                <button
                  className="pf-name-cancel"
                  onClick={() => { setDraftName(username); setEditing(false); }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <h2 className="pf-name">{username || 'Anonymous'}</h2>
                <button className="pf-mini" onClick={() => setEditing(true)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M14 6l4 4" />
                  </svg>
                  Edit
                </button>
              </>
            )}
          </div>

          <div className="pf-addr">
            {truncate(address)}
            <button className="pf-mini" onClick={copyAddress}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" />
              </svg>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <div className="pf-actions">
            <button
              className="pf-connectx"
              onClick={() => setTwitterConnected(!twitterConnected)}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              {twitterConnected ? (
                <>X Connected<span className="pf-connectx__dot" /></>
              ) : (
                'Connect X'
              )}
            </button>
            {joined && (
              <span className="pf-joined">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 9h16M8 3v4M16 3v4" />
                </svg>
                Joined {joined}
              </span>
            )}
          </div>
        </div>

        {/* Rank card — placeholder until a points system exists */}
        <div className="pf-rank">
          <span className="pf-tier">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
              <path d="M12 3 3 9l9 12 9-12z" />
            </svg>
            {rank?.tier || 'Season 1'}
          </span>
          <div className="pf-rank__pts">
            {hasPoints ? rank.points.toLocaleString() : '—'} <span>pts</span>
          </div>
          <div className="pf-rank__rank">
            {hasPoints && rank.rank != null
              ? `Rank #${rank.rank.toLocaleString()}${rank.total ? ` of ${rank.total.toLocaleString()}` : ''}`
              : 'Ranking coming soon'}
          </div>
          <div className="pf-pbar"><i style={{ width: `${progressPct}%` }} /></div>
          <div className="pf-rank__next">
            {hasPoints && rank.nextTier
              ? `${rank.toNext ?? ''} pts to ${rank.nextTier}`
              : 'Earn points by trading — launching soon'}
          </div>
        </div>
      </div>
    </section>
  );
}
