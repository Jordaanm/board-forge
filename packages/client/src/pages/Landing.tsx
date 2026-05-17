import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnchorLayout } from '../components/AnchorLayout';
import { PreferencesModal } from '../components/PreferencesModal';
import { DisplayNamePromptModal } from '../components/DisplayNamePromptModal';
import { JoinPasswordModal } from '../components/JoinPasswordModal';
import { ProfileModal } from '../components/ProfileModal';
import { useDiscordAuth } from '../discord/DiscordAuthProvider';
import { hasPromptedDisplayName, loadDisplayName } from '../identity/displayName';
import './Landing.css';

const API_URL = import.meta.env.VITE_API_URL;

interface RoomInfo {
  roomId:      string;
  occupancy:   number;
  capacity:    number;
  name:        string;
  hasPassword: boolean;
}

const IconLock = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="11" width="16" height="9" rx="2"/>
    <path d="M8 11V8a4 4 0 0 1 8 0v3"/>
  </svg>
);

const IconUsers = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="9" cy="8" r="3.2"/>
    <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/>
    <circle cx="17" cy="9" r="2.6"/>
    <path d="M15 14c2.8 0 5 2.2 5 5"/>
  </svg>
);

const IconChevronR = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 6 6 6-6 6"/>
  </svg>
);

const IconSearch = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7"/>
    <path d="m20 20-3.5-3.5"/>
  </svg>
);

const IconHelp = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9"/>
    <path d="M9.5 9a2.5 2.5 0 0 1 4.9 0.6c0 1.6-2.4 1.9-2.4 3.4"/>
    <circle cx="12" cy="17" r="0.7" fill="currentColor" stroke="none"/>
  </svg>
);

const IconSettings = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6h0A1.7 1.7 0 0 0 10.03 3.04V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6h0a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9h0a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z"/>
  </svg>
);

export function Landing() {
  const navigate = useNavigate();
  const [rooms,        setRooms]        = useState<RoomInfo[]>([]);
  const [totalTables,  setTotalTables]  = useState(0);
  const [loading,      setLoading]      = useState(true);
  const [prefsOpen,    setPrefsOpen]    = useState(false);
  const [profileOpen,  setProfileOpen]  = useState(false);
  const [namePromptOpen, setNamePromptOpen] = useState(() => !hasPromptedDisplayName());
  const [passwordPromptRoomId, setPasswordPromptRoomId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(() => loadDisplayName());
  const { profile, isSignedIn } = useDiscordAuth();

  // Re-read the persisted name once a name-affecting surface closes (or the
  // Discord profile lands after a sign-in seed) so the avatar reflects
  // whatever the user just saved.
  useEffect(() => {
    if (!namePromptOpen && !profileOpen) setDisplayName(loadDisplayName());
  }, [namePromptOpen, profileOpen, profile]);

  const initial = (Array.from(displayName.trim())[0] ?? '?').toUpperCase();

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      fetch(`${API_URL}/rooms`)
        .then(r => r.json())
        .then(d => {
          if (cancelled) return;
          setRooms(d.rooms ?? []);
          setTotalTables(d.totalRoomsCreated ?? 0);
        })
        .catch(() => { /* ignore */ })
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    refresh();
    const id = setInterval(refresh, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const playersOnline = rooms.reduce((sum, r) => sum + r.occupancy, 0);
  const openRooms     = rooms.length;

  const createRoom = () => {
    const roomId = crypto.randomUUID();
    navigate(`/r/${roomId}?host=1`);
  };

  return (
    <AnchorLayout>
      <div className="landing">
        <header className="landing__header">
          <div className="landing__header-inner">
            <div className="landing__brand">
              <div className="landing__brand-mark">B</div>
              <span>Board Together</span>
            </div>
            <div className="landing__header-spacer"/>
            <div className="landing__header-right">
              {/* <div className="landing__search">
                <IconSearch size={16}/>
                <input placeholder="Search rooms, games, people" aria-label="Search"/>
                <kbd>⌘K</kbd>
              </div> */}
              <Link to="/docs" className="landing__icon-btn" aria-label="Help" title="Help">
                <IconHelp size={18}/>
              </Link>
              <button className="landing__icon-btn" type="button" aria-label="Preferences" title="Preferences"
                      onClick={() => setPrefsOpen(true)}>
                <IconSettings size={18}/>
              </button>
              <button
                type="button"
                className="landing__avatar landing__avatar--btn"
                title={isSignedIn && profile ? `${profile.displayNameSeed} · Profile` : `${displayName} · Profile`}
                aria-label="Profile"
                onClick={() => setProfileOpen(true)}
              >
                {isSignedIn && profile?.avatarUrl
                  ? <img src={profile.avatarUrl} alt="" className="landing__avatar-img" />
                  : initial}
              </button>
            </div>
          </div>
        </header>

        <div className="landing__card">
          <h1 className="landing__title">Board Together</h1>
          <p className="landing__subtitle">Right Now. Over the web.</p>
          <button className="landing__create-btn" onClick={createRoom}>Create Room</button>

          <div className="landing__stats">
            <div className="landing__stat">
              <b>{playersOnline.toLocaleString()}</b>
              <span>players online</span>
            </div>
            <div className="landing__stat-sep"/>
            <div className="landing__stat">
              <b>{openRooms.toLocaleString()}</b>
              <span>open rooms</span>
            </div>
            <div className="landing__stat-sep"/>
            <div className="landing__stat">
              <b>{totalTables.toLocaleString()}</b>
              <span>total tables</span>
            </div>
          </div>

          <div className="landing__rooms">
            <h2 className="landing__rooms-title">Open Rooms</h2>
            {loading ? (
              <p className="landing__muted">Loading...</p>
            ) : rooms.length === 0 ? (
              <p className="landing__muted">No open rooms</p>
            ) : (
              <div className="landing__rooms-grid">
                {rooms.map(r => {
                  const isFull = r.occupancy >= r.capacity;
                  return (
                  <Link key={r.roomId} className="landing__room-card"
                        to={`/r/${r.roomId}`}
                        onClick={(e) => {
                          if (r.hasPassword) {
                            e.preventDefault();
                            setPasswordPromptRoomId(r.roomId);
                          }
                        }}>
                    <div className="landing__room-top">
                      <span className="landing__room-name" title={r.name || r.roomId}>
                        {r.hasPassword && <span className="landing__room-lock" aria-label="Locked"><IconLock/></span>}
                        {r.name || r.roomId.slice(0, 8)}
                      </span>
                      <span className={`landing__chip ${isFull ? 'landing__chip--full' : ''}`}>
                        <span className="landing__chip-dot"/>{isFull ? 'Full' : 'Open'}
                      </span>
                    </div>
                    <div className="landing__room-meta">
                      <span className="landing__room-stat">
                        <IconUsers/> {r.occupancy} {r.occupancy === 1 ? 'player' : 'players'}
                      </span>
                    </div>
                    <div className="landing__room-foot">
                      <div className="landing__seats">
                        {Array.from({ length: r.capacity }, (_, i) => (
                          <span key={i}
                                className={`landing__seat ${i < r.occupancy ? 'landing__seat--on' : ''}`}/>
                        ))}
                      </div>
                      <span className="landing__join-cta">Join <IconChevronR/></span>
                    </div>
                  </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <footer className="landing__foot">
          <div className="landing__foot-inner">
            <span>Board Together &middot; an online sandbox for playing and prototyping tabletop games</span>
            <span>&middot; v0.1 &middot;</span>
          </div>
        </footer>
      </div>
      <PreferencesModal open={prefsOpen} onOpenChange={setPrefsOpen}/>
      <ProfileModal open={profileOpen} onOpenChange={setProfileOpen}/>
      <DisplayNamePromptModal open={namePromptOpen} onOpenChange={setNamePromptOpen}/>
      <JoinPasswordModal
        roomId={passwordPromptRoomId}
        open={passwordPromptRoomId !== null}
        onOpenChange={(o) => { if (!o) setPasswordPromptRoomId(null); }}
      />
    </AnchorLayout>
  );
}
