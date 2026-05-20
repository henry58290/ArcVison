import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import ProfileHeader from '../components/profile/ProfileHeader';
import StatsCards from '../components/profile/StatsCards';
import TradeHistory from '../components/profile/TradeHistory';
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
    window.addEventListener('arcvision:bets-changed', refresh);
    // Refresh on focus too — covers navigation back from MarketDetail.
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('arcvision:bets-changed', refresh);
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

  return (
    <main className="min-h-screen font-sans antialiased bg-zinc-950 text-zinc-100 pt-24 pb-16">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 flex flex-col gap-5">
        <div className="mb-1">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
            Account
          </div>
          <h1 className="mt-1 text-xl font-semibold text-zinc-100">
            Profile
          </h1>
        </div>

        <ProfileHeader
          address={address}
          username={username}
          setUsername={setUsername}
          avatar={avatar}
          setAvatar={setAvatar}
          twitterConnected={twitterConnected}
          setTwitterConnected={setTwitterConnected}
        />
        <StatsCards stats={stats} />
        <TradeHistory bets={bets} />
      </div>
    </main>
  );
}
