import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import ProfileHeader from '../components/profile/ProfileHeader';
import StatsCards from '../components/profile/StatsCards';
import PnlChart from '../components/profile/PnlChart';
import TradeHistory from '../components/profile/TradeHistory';
import '../components/profile/profile.css';
import {
  BETS_STORAGE_KEY,
  loadBets,
  computeStats,
} from '../components/profile/mockBets';

const LS_KEYS = {
  username: 'arc.profile.username',
  avatar: 'arc.profile.avatar',
  twitter: 'arc.profile.twitter',
};

function readLS(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

export default function Profile() {
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();

  const [username, setUsernameState] = useState(() => readLS(LS_KEYS.username, 'Anonymous'));
  const [avatar, setAvatarState] = useState(() => readLS(LS_KEYS.avatar, ''));
  const [twitterConnected, setTwitterState] = useState(
    () => readLS(LS_KEYS.twitter, '0') === '1',
  );

  // Live-bound bet list — re-reads from localStorage on storage events.
  const [bets, setBets] = useState(() => loadBets());

  useEffect(() => {
    const refresh = () => setBets(loadBets());
    // `storage` fires for changes from other tabs/windows.
    const handleStorage = (e) => {
      if (!e.key || e.key === BETS_STORAGE_KEY) refresh();
    };
    // Custom event fired by `appendBet` for same-tab updates.
    window.addEventListener('storage', handleStorage);
    window.addEventListener('Verdict:bets-changed', refresh);
    // Refresh on focus too — covers navigation back from MarketDetail.
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('Verdict:bets-changed', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const setUsername = (v) => {
    setUsernameState(v);
    try { localStorage.setItem(LS_KEYS.username, v); } catch { /* ignore */ }
  };
  const setAvatar = (v) => {
    setAvatarState(v);
    try { localStorage.setItem(LS_KEYS.avatar, v); } catch { /* ignore */ }
  };
  const setTwitterConnected = (v) => {
    setTwitterState(v);
    try { localStorage.setItem(LS_KEYS.twitter, v ? '1' : '0'); } catch { /* ignore */ }
  };

  useEffect(() => {
    if (!isConnected) {
      const t = setTimeout(() => {
        if (!isConnected) navigate('/');
      }, 800);
      return () => clearTimeout(t);
    }
  }, [isConnected, navigate]);

  const stats = computeStats(bets);

  // Real "joined" label derived from the earliest bet date, if any.
  const joined = useMemo(() => {
    const dates = bets.map((b) => b.date).filter(Boolean).sort();
    if (!dates.length) return undefined;
    const d = new Date(`${dates[0]}T00:00:00`);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }, [bets]);

  return (
    <main className="pf-page page--with-bottom-nav">
      <div className="pf-wrap">
        <div>
          <div className="pf-eyebrow">Account</div>
          <h1 className="pf-h1">Profile</h1>
        </div>

        <ProfileHeader
          address={address}
          username={username}
          setUsername={setUsername}
          avatar={avatar}
          setAvatar={setAvatar}
          twitterConnected={twitterConnected}
          setTwitterConnected={setTwitterConnected}
          joined={joined}
        />
        <StatsCards stats={stats} />
        <PnlChart bets={bets} since={joined} />
        <TradeHistory bets={bets} />
      </div>
    </main>
  );
}
