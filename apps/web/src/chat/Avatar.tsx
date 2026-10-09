import type { CSSProperties } from 'react';
import { colorFor, initials } from './people';

type Props = { name: string; size?: number; online?: boolean; className?: string; title?: string };

export function Avatar({ name, size = 32, online, className = '', title }: Props) {
  const style = { '--person': colorFor(name), '--size': `${size}px` } as CSSProperties;
  return (
    <span className={`avatar ${className}`} style={style} title={title} aria-hidden={title ? undefined : true}>
      {initials(name)}
      {online !== undefined && <span className={online ? 'presence on' : 'presence'} />}
    </span>
  );
}

const ROOM_TINTS = ['#4F6D7A', '#7A5C3E', '#5E7046', '#6B5B95', '#8A5A6E', '#3F6E8C'];

export function RoomBadge({ id, name, size = 40 }: { id: string; name: string; size?: number }) {
  let hash = 0;
  for (const ch of id) hash = (hash * 33 + ch.codePointAt(0)!) >>> 0;
  const style = { '--person': ROOM_TINTS[hash % ROOM_TINTS.length], '--size': `${size}px` } as CSSProperties;
  return (
    <span className="room-badge" style={style} aria-hidden>
      {initials(name)}
    </span>
  );
}
