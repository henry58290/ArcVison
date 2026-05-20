import { useRef, useState } from 'react';

function truncate(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function ProfileHeader({
  address,
  username,
  setUsername,
  avatar,
  setAvatar,
  twitterConnected,
  setTwitterConnected,
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

  return (
    <section className="rounded-2xl bg-zinc-900/50 border border-zinc-800 p-6 sm:p-7">
      <div className="flex flex-col sm:flex-row gap-6 sm:gap-7 items-start sm:items-center">
        {/* Avatar — plain circle, no rings/halos */}
        <div className="shrink-0 flex flex-col items-center gap-2">
          <div className="w-20 h-20 rounded-full overflow-hidden bg-zinc-800 flex items-center justify-center">
            {avatar ? (
              <img src={avatar} alt="avatar" className="w-full h-full object-cover" />
            ) : (
              <span className="text-2xl font-semibold text-zinc-500">
                {(username || 'A').slice(0, 1).toUpperCase()}
              </span>
            )}
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-[11px] uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors font-medium"
          >
            Edit
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatar}
          />
        </div>

        {/* Identity */}
        <div className="flex-1 w-full min-w-0">
          {/* Username */}
          <div className="flex items-center gap-2 mb-1.5">
            {editing ? (
              <div className="flex items-center gap-2 w-full">
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveName()}
                  autoFocus
                  maxLength={32}
                  className="text-xl font-semibold bg-zinc-900 text-zinc-100 border border-zinc-700 rounded-md px-3 py-1.5 outline-none focus:border-zinc-500 transition-colors"
                  placeholder="Username"
                />
                <button
                  onClick={saveName}
                  className="px-3 py-1.5 text-sm font-medium text-zinc-100 bg-zinc-800 border border-zinc-700 rounded-md hover:bg-zinc-700 transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => { setDraftName(username); setEditing(false); }}
                  className="px-3 py-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <h2 className="text-xl sm:text-2xl font-semibold text-zinc-100 truncate">
                  {username || 'Anonymous'}
                </h2>
                <button
                  onClick={() => setEditing(true)}
                  className="text-[11px] uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors font-medium ml-1"
                >
                  Edit
                </button>
              </>
            )}
          </div>

          {/* Address */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm text-zinc-500">{truncate(address)}</span>
            <button
              onClick={copyAddress}
              className="text-[11px] uppercase tracking-wider font-medium text-zinc-600 hover:text-zinc-300 transition-colors"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          {/* Connect X — sleek secondary */}
          <button
            onClick={() => setTwitterConnected(!twitterConnected)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-sm font-medium bg-transparent border border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            {twitterConnected ? (
              <>
                <span>X Connected</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              </>
            ) : (
              <span>Connect X</span>
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
