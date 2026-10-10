import { CaretUpDownIcon, CheckIcon, PlusIcon, XIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Avatar, RoomBadge } from './Avatar';
import { listNames, listTime, preview } from './format';
import { PEOPLE } from './people';
import type { Room } from './types';

type Props = {
  me: string;
  rooms: Room[];
  activeRoom: string | null;
  online: string[];
  typing: Record<string, Record<string, number>>;
  onOpen: (room: string) => void;
  onCreate: (name: string) => Promise<void>;
  onSwitchIdentity: (name: string) => void;
};

const spring = { type: 'spring', stiffness: 480, damping: 38 } as const;

function lastLine(room: Room, me: string, typing: string[]): { text: string; typing: boolean } {
  if (typing.length) return { text: `${listNames(typing)} ${typing.length === 1 ? 'is' : 'are'} typing…`, typing: true };
  const m = room.last_message;
  if (!m) return { text: 'No messages yet', typing: false };
  const who = m.user === me ? 'You' : m.user;
  return { text: `${who}: ${m.deleted ? 'Message deleted' : preview(m.text, 60)}`, typing: false };
}

export function Sidebar({ me, rooms, activeRoom, online, typing, onOpen, onCreate, onSwitchIdentity }: Props) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', escape);
    };
  }, [menu]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await onCreate(name.trim());
      setName('');
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the room.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <nav className="sidebar" aria-label="Rooms">
      <div className="sidebar-top">
        <span className="wordmark">ChatAI</span>
        <button
          type="button"
          className={creating ? 'icon-button pressed' : 'icon-button'}
          aria-label={creating ? 'Cancel new room' : 'New room'}
          aria-expanded={creating}
          onClick={() => {
            setCreating((c) => !c);
            setError('');
          }}
        >
          <motion.span animate={{ rotate: creating ? 45 : 0 }} transition={spring} style={{ display: 'flex' }}>
            <PlusIcon size={20} weight="bold" />
          </motion.span>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {creating && (
          <motion.form
            className="new-room"
            onSubmit={create}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
          >
            <div className="new-room-inner">
              <label htmlFor="new-room-name">New room</label>
              <div className="new-room-row">
                <input
                  id="new-room-name"
                  autoFocus
                  value={name}
                  maxLength={60}
                  placeholder="e.g. Food run"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setCreating(false)}
                />
                <button type="submit" className="button" disabled={!name.trim() || busy}>
                  Create
                </button>
              </div>
              {error && <p className="field-error">{error}</p>}
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      <ul className="room-list">
        {rooms.map((room) => {
          const typers = Object.keys(typing[room.id] ?? {}).filter((u) => u !== me);
          const line = lastLine(room, me, typers);
          const active = room.id === activeRoom;
          const unread = active ? 0 : room.unread;
          return (
            <motion.li key={room.id} layout transition={spring}>
              <button
                type="button"
                className={['room-item', active && 'active', unread > 0 && 'unread'].filter(Boolean).join(' ')}
                aria-current={active ? 'page' : undefined}
                onClick={() => onOpen(room.id)}
              >
                {active && <motion.span layoutId="active-room" className="room-highlight" transition={spring} />}
                <RoomBadge id={room.id} name={room.name} />
                <span className="room-text">
                  <span className="room-name-line">
                    <span className="room-name">{room.name}</span>
                    {room.last_message && <time className="room-time">{listTime(room.last_message.created_at)}</time>}
                  </span>
                  <span className="room-preview-line">
                    <span className={line.typing ? 'room-preview typing' : 'room-preview'}>{line.text}</span>
                    <AnimatePresence>
                      {unread > 0 && (
                        <motion.span
                          key="badge"
                          className="badge"
                          aria-label={`${unread} unread`}
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          exit={{ scale: 0 }}
                          transition={{ type: 'spring', stiffness: 700, damping: 22 }}
                        >
                          <motion.span key={unread} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
                            {unread > 99 ? '99+' : unread}
                          </motion.span>
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </span>
                </span>
              </button>
            </motion.li>
          );
        })}
      </ul>

      <div className="identity" ref={menuRef}>
        <AnimatePresence>
          {menu && (
            <motion.div
              className="identity-menu"
              role="menu"
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98, transition: { duration: 0.12 } }}
              transition={spring}
            >
              <p className="identity-menu-note">Switch demo person</p>
              {PEOPLE.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  role="menuitemradio"
                  aria-checked={p.name === me}
                  className="identity-option"
                  onClick={() => {
                    setMenu(false);
                    if (p.name !== me) onSwitchIdentity(p.name);
                  }}
                >
                  <Avatar name={p.name} size={28} online={online.includes(p.name)} />
                  <span>{p.name}</span>
                  {p.name === me && <CheckIcon size={16} weight="bold" className="identity-check" />}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        <button type="button" className="identity-button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          <Avatar name={me} size={34} online={online.includes(me)} />
          <span className="identity-copy">
            <span className="identity-name">{me}</span>
            <span className="identity-sub">{online.includes(me) ? 'Online' : 'Connecting…'}</span>
          </span>
          {menu ? <XIcon size={16} /> : <CaretUpDownIcon size={16} />}
        </button>
      </div>
    </nav>
  );
}
