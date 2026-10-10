import { CaretUpDownIcon, CheckIcon, PlusIcon, SidebarSimpleIcon, SignOutIcon, XIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Avatar, RoomBadge } from './Avatar';
import { listNames, listTime, preview } from './format';
import { PEOPLE } from './people';
import type { Room } from './types';
import { NewGroupChat } from '../features/NewGroupChat';

type Props = {
  me: string;
  rooms: Room[];
  activeRoom: string | null;
  collapsed: boolean;
  online: string[];
  typing: Record<string, Record<string, number>>;
  onOpen: (room: string) => void;
  onCreate: (name: string, members: string[]) => Promise<void>;
  onToggleCollapsed: () => void;
  onLeave: (room: string) => Promise<void>;
  onSwitchIdentity: (name: string) => void;
};

const spring = { type: 'spring', stiffness: 480, damping: 38 } as const;

function lastLine(room: Room, me: string, typing: string[]): { text: string; typing: boolean } {
  if (typing.length) return { text: `${listNames(typing)} ${typing.length === 1 ? 'is' : 'are'} typing…`, typing: true };
  const m = room.last_message;
  if (!m) return { text: 'No messages yet', typing: false };
  const who = m.user === me ? 'You' : m.user;
  const text = m.deleted ? 'Message deleted' : m.poll ? `Poll: ${preview(m.text, 54)}` : preview(m.text, 60);
  return { text: `${who}: ${text}`, typing: false };
}

export function Sidebar({ me, rooms, activeRoom, collapsed, online, typing, onOpen, onCreate, onToggleCollapsed, onLeave, onSwitchIdentity }: Props) {
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState(false);
  const [leavingRoom, setLeavingRoom] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const contacts = [...new Set([
    ...PEOPLE.map((person) => person.name),
    ...online,
    ...rooms.flatMap((room) => [...(room.members ?? []), room.created_by ?? '', room.last_message?.user ?? '']),
  ].filter(Boolean))];

  const leaveRoom = async (room: Room) => {
    if (leavingRoom || !window.confirm(`Leave ${room.name}? The chat and messages will remain for other members.`)) return;
    setLeavingRoom(room.id);
    try {
      await onLeave(room.id);
    } catch {
      // The parent reports API errors; keep the room visible when leaving fails.
    } finally {
      setLeavingRoom(null);
    }
  };

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

  useEffect(() => {
    if (!creating) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCreating(false);
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [creating]);

  return (
    <nav className={['sidebar', collapsed && 'sidebar-collapsed', creating && 'creating-group'].filter(Boolean).join(' ')} aria-label="Rooms">
      <div className="sidebar-top">
        <div className="sidebar-brand-row">
          <img className="wordmark" src="/brand/hai-logo.png" alt="H.AI" />
          {!creating && (
            <button
              type="button"
              className="icon-button sidebar-collapse"
              aria-label={collapsed ? 'Expand room list' : 'Collapse room list'}
              aria-expanded={!collapsed}
              title={collapsed ? 'Expand room list' : 'Collapse room list'}
              onClick={onToggleCollapsed}
            >
              <SidebarSimpleIcon size={20} mirrored={!collapsed} />
            </button>
          )}
          {creating && (
            <button type="button" className="button secondary sidebar-create-cancel" onClick={() => setCreating(false)}>
              <XIcon size={17} weight="bold" />
              Cancel
            </button>
          )}
        </div>
        {!creating && (
          <div className="sidebar-tools">
            <button
              type="button"
              className="icon-button"
              aria-label="New group"
              aria-expanded={false}
              title="New group"
              onClick={() => {
                if (collapsed) onToggleCollapsed();
                setCreating(true);
              }}
            >
              <PlusIcon size={20} weight="bold" />
              <span className="sidebar-tool-label">Add new chat</span>
            </button>
          </div>
        )}
      </div>

      <div className="room-selection">
        <ul className="room-list">
          {rooms.map((room) => {
            const typers = Object.keys(typing[room.id] ?? {}).filter((u) => u !== me);
            const line = lastLine(room, me, typers);
            const active = room.id === activeRoom;
            const unread = active ? 0 : room.unread;
            return (
              <motion.li key={room.id} className="room-entry">
                <button
                  type="button"
                  className={['room-item', active && 'active', unread > 0 && 'unread'].filter(Boolean).join(' ')}
                  aria-current={active ? 'page' : undefined}
                  aria-label={`${room.name}${unread ? `, ${unread} unread` : ''}`}
                  title={collapsed ? room.name : undefined}
                  onClick={() => onOpen(room.id)}
                >
                  {active && <motion.span layoutId="active-room" className="room-highlight" transition={spring} />}
                  <RoomBadge id={room.id} name={room.name} />
                  {unread > 0 && <span className="badge collapsed-badge">{unread > 99 ? '99+' : unread}</span>}
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
                <button
                  type="button"
                  className="room-leave"
                  aria-label={`Leave ${room.name} chat`}
                  title="Leave chat"
                  disabled={leavingRoom === room.id}
                  onClick={() => void leaveRoom(room)}
                >
                  <SignOutIcon size={17} aria-hidden="true" />
                </button>
              </motion.li>
            );
          })}
        </ul>
        <AnimatePresence initial={false}>
          {creating && (
            <motion.div
              className="new-room-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={(event) => {
                if (event.target === event.currentTarget) setCreating(false);
              }}
            >
              <motion.div
                className="new-room glass"
                role="dialog"
                aria-modal="true"
                aria-label="Create a group chat"
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={spring}
              >
                <NewGroupChat
                  me={me}
                  contacts={contacts}
                  online={online}
                  onCreate={onCreate}
                  onCancel={() => setCreating(false)}
                />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

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
        <button
          type="button"
          className="identity-button"
          aria-label={`Switch demo person, currently ${me}${online.includes(me) ? ', online' : ', connecting'}`}
          aria-haspopup="menu"
          aria-expanded={menu}
          title={collapsed ? `${me} · ${online.includes(me) ? 'Online' : 'Connecting'}` : undefined}
          onClick={() => setMenu((m) => !m)}
        >
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
