import { ArrowDownIcon, ArrowClockwiseIcon } from '@phosphor-icons/react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Avatar } from './Avatar';
import { dayLabel, groupsWith, sameDay } from './format';
import { MessageRow, type Position, type RowActions } from './MessageRow';
import type { History } from './state';
import type { ChatMessage, Room } from './types';

type Props = {
  room: Room;
  me: string;
  messages: ChatMessage[];
  history: History | undefined;
  typing: { user: string; layoutId: string }[];
  /** Messages after this id (from other people) were unread when the room was opened. */
  unreadAfter: number | null;
  highlight: number | null;
  actions: RowActions;
  onLoadOlder: () => void;
  onRetry: () => void;
  onAtBottom: (atBottom: boolean) => void;
  renderCatchUp?: (unread: ChatMessage[]) => ReactNode;
  /** Renders a poll message's card; without it a poll shows as its question. */
  renderPoll?: (message: ChatMessage) => ReactNode;
  /** Cards to show after a given message id (or at the end, keyed by 'end'). */
  inserts: Map<number | 'end', ReactNode[]>;
};

type Item =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'unread'; key: 'unread'; messages: ChatMessage[] }
  | { kind: 'message'; key: string; message: ChatMessage; position: Position }
  | { kind: 'insert'; key: string; node: ReactNode };

const PIN_GAP = 72;

export function MessageList(props: Props) {
  const { room, me, messages, history, typing, unreadAfter, highlight, actions, onLoadOlder, onRetry, onAtBottom, renderCatchUp, renderPoll, inserts } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const topSentinel = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const olderAnchor = useRef<{ height: number; top: number } | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [picker, setPicker] = useState<number | null>(null);

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  // Only messages that arrive after the room was opened animate in.
  const openedAt = useMemo(() => Date.now(), [room.id]);

  const items = useMemo(() => {
    let firstUnread = unreadAfter === null ? -1 : messages.findIndex((m) => m.id > unreadAfter && m.user !== me && !m.deleted);
    // If the first loaded message is already unread, the real start is further back.
    if (firstUnread === 0 && history?.hasOlder && (messages[0]?.id ?? 0) - 1 > (unreadAfter ?? 0)) firstUnread = -1;
    const out: Item[] = [];
    messages.forEach((m, i) => {
      const prev = messages[i - 1];
      const next = messages[i + 1];
      const newDay = !prev || !sameDay(prev.created_at, m.created_at);
      if (newDay) out.push({ kind: 'day', key: `day-${m.created_at.slice(0, 10)}-${m.id}`, label: dayLabel(m.created_at) });
      if (i === firstUnread) out.push({ kind: 'unread', key: 'unread', messages: messages.slice(i).filter((u) => u.user !== me && !u.deleted) });
      const joinsPrev = !newDay && i !== firstUnread && !inserts.has(prev?.id ?? NaN) && groupsWith(prev, m);
      const joinsNext = !!next && sameDay(m.created_at, next.created_at) && i + 1 !== firstUnread && !inserts.has(m.id) && groupsWith(m, next);
      const position: Position = joinsPrev ? (joinsNext ? 'middle' : 'last') : joinsNext ? 'first' : 'single';
      out.push({ kind: 'message', key: m.localId ?? String(m.id), message: m, position });
      inserts.get(m.id)?.forEach((node, n) => out.push({ kind: 'insert', key: `insert-${m.id}-${n}`, node }));
    });
    inserts.get('end')?.forEach((node, n) => out.push({ kind: 'insert', key: `insert-end-${n}`, node }));
    return out;
  }, [messages, unreadAfter, me, inserts, history?.hasOlder]);

  // Each reader's avatar sits under the latest loaded message they've read, unless it's their own.
  const seenBy = useMemo(() => {
    const confirmed = messages.filter((m) => m.id > 0);
    const out = new Map<number, string[]>();
    for (const [reader, position] of Object.entries(room.reads ?? {})) {
      if (reader === me) continue;
      let target: ChatMessage | undefined;
      for (let i = confirmed.length - 1; i >= 0; i--) {
        if (confirmed[i].id <= position) {
          target = confirmed[i];
          break;
        }
      }
      if (!target || target.user === reader) continue;
      out.set(target.id, [...(out.get(target.id) ?? []), reader].sort());
    }
    return out;
  }, [messages, room.reads, me]);

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setSelected(null);
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_GAP;
    pinned.current = bottom;
    setAtBottom(bottom);
    if (bottom) setUnseen(0);
  }, []);

  useEffect(() => {
    if (selected === null) return;
    const dismissOnOutsideClick = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      const target = event.target;
      const row = target.closest<HTMLElement>('.row[data-mid]');
      const inSelectedRow = row?.dataset.mid === String(selected);
      const inToolbar = inSelectedRow && target.closest('.toolbar, .emoji-picker');
      const onMessageText = inSelectedRow && target.closest('.bubble') && !target.closest('a, button');
      if (inToolbar || onMessageText) return;
      setSelected(null);
    };
    document.addEventListener('pointerdown', dismissOnOutsideClick, true);
    return () => document.removeEventListener('pointerdown', dismissOnOutsideClick, true);
  }, [selected]);

  useEffect(() => onAtBottom(atBottom), [atBottom, onAtBottom]);

  // Stay pinned to the bottom while content grows (new messages, animations, images).
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner) return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(inner);
    observer.observe(el); // the composer growing (reply banner, long draft) shrinks the list
    return () => observer.disconnect();
  }, []);

  // Opening a room: start at the first unread message, otherwise at the bottom.
  const ready = history?.status === 'ready';
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !ready) return;
    setSelected(null);
    setPicker(null);
    setUnseen(0);
    const divider = el.querySelector<HTMLElement>('.unread-divider');
    if (divider) {
      el.scrollTop = Math.max(0, divider.offsetTop - 96);
    } else {
      el.scrollTop = el.scrollHeight;
    }
    measure();
  }, [room.id, ready, measure]);

  // New messages at the bottom: follow them if pinned or if they're mine, else count them.
  const last = messages.at(-1);
  const lastKey = last ? last.localId ?? last.id : null;
  const previousLast = useRef<{ room: string; key: string | number | null; count: number }>({ room: room.id, key: lastKey, count: messages.length });
  useLayoutEffect(() => {
    const el = scroller.current;
    const before = previousLast.current;
    previousLast.current = { room: room.id, key: lastKey, count: messages.length };
    if (!el || before.room !== room.id || before.key === lastKey || !last) return;
    if (last.user === me && last.fresh) {
      pinned.current = true;
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else if (pinned.current) {
      el.scrollTop = el.scrollHeight;
    } else if (last.fresh) {
      setUnseen((n) => n + Math.max(1, messages.length - before.count));
    }
  }, [lastKey, room.id, messages.length, last, me]);

  // Typing bubbles appearing at the bottom keep a pinned view pinned.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [typing.length]);

  // Older history: load when the top comes into view, then keep the visible messages still.
  const first = messages[0];
  const firstKey = first ? first.localId ?? first.id : null;
  useLayoutEffect(() => {
    const el = scroller.current;
    const anchor = olderAnchor.current;
    if (!el || !anchor) return;
    el.scrollTop = anchor.top + (el.scrollHeight - anchor.height);
    olderAnchor.current = null;
  }, [firstKey]);

  const canLoadOlder = ready && Boolean(history?.hasOlder) && !history?.loadingOlder;
  useEffect(() => {
    const el = scroller.current;
    const sentinel = topSentinel.current;
    if (!el || !sentinel || !canLoadOlder) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        olderAnchor.current = { height: el.scrollHeight, top: el.scrollTop };
        onLoadOlder();
      },
      { root: el, rootMargin: '240px 0px 0px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canLoadOlder, onLoadOlder, room.id]);

  const jumpToLatest = () => {
    const el = scroller.current;
    if (!el) return;
    pinned.current = true;
    setUnseen(0);
    // From far back, skip most of the way so the glide stays short.
    const far = el.scrollHeight - el.clientHeight * 2.5;
    if (el.scrollTop < far) el.scrollTop = far;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  let body: ReactNode;
  if (!history || history.status === 'loading') {
    body = (
      <div className="skeleton" aria-label="Loading messages">
        {['w60', 'w40 mine', 'w75', 'w30 mine', 'w50'].map((c, i) => (
          <div key={i} className={`skeleton-bubble ${c}`} style={{ animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
    );
  } else if (history.status === 'error') {
    body = (
      <div className="list-state">
        <p className="list-state-title">Couldn't load messages</p>
        <p>{history.error}</p>
        <button type="button" className="button" onClick={onRetry}>
          <ArrowClockwiseIcon size={16} weight="bold" /> Try again
        </button>
      </div>
    );
  } else if (messages.length === 0 && typing.length === 0) {
    body = (
      <div className="list-state empty">
        <motion.span
          className="wave"
          aria-hidden
          initial={{ rotate: 0 }}
          animate={{ rotate: [0, 18, -8, 18, -4, 10, 0] }}
          transition={{ duration: 1.6, delay: 0.3, ease: 'easeInOut' }}
        >
          👋
        </motion.span>
        <p className="list-state-title">No messages yet</p>
        <p>Say hello to get {room.name} started.</p>
      </div>
    );
  } else {
    body = (
      <LayoutGroup id={`room-${room.id}`}>
        <div ref={topSentinel} className="history-edge">
          {history.loadingOlder ? (
            <span className="history-note">Loading earlier messages…</span>
          ) : !history.hasOlder ? (
            <span className="history-note start">This is the start of {room.name}.</span>
          ) : null}
        </div>
        <AnimatePresence initial={false}>
          {items.map((item) => {
            if (item.kind === 'day') {
              return (
                <div key={item.key} className="day-divider">
                  <span>{item.label}</span>
                </div>
              );
            }
            if (item.kind === 'unread') {
              return (
                <div key={item.key} className="unread-block">
                  <div className="unread-divider">
                    <span>{item.messages.length === 1 ? '1 new message' : `${item.messages.length} new messages`}</span>
                  </div>
                  {renderCatchUp?.(item.messages)}
                </div>
              );
            }
            if (item.kind === 'insert') {
              return (
                <motion.div
                  key={item.key}
                  className="insert"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0 }}
                >
                  {item.node}
                </motion.div>
              );
            }
            const m = item.message;
            const parent = m.reply_to ? byId.get(m.reply_to) : undefined;
            return (
              <MessageRow
                key={item.key}
                message={m}
                me={me}
                room={room.id}
                position={item.position}
                parent={parent}
                seenBy={seenBy.get(m.id) ?? NONE}
                entering={(m.fresh ?? 0) > openedAt}
                highlighted={highlight === m.id}
                selected={selected === m.id}
                pickerOpen={picker === m.id}
                onSelect={setSelected}
                onPicker={setPicker}
                actions={actions}
                renderPoll={renderPoll}
              />
            );
          })}
        </AnimatePresence>
        <AnimatePresence mode="popLayout" initial={false}>
          {typing.map(({ user, layoutId }) => (
            <motion.div
              key={`typing-${user}`}
              className="row theirs pos-single typing-row"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              aria-label={`${user} is typing`}
            >
              <div className="row-avatar">
                <Avatar name={user} size={30} />
              </div>
              <div className="row-body">
                <motion.div layoutId={layoutId} className="bubble typing-bubble">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </motion.div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </LayoutGroup>
    );
  }

  return (
    <div className="list-frame">
      <motion.div
        ref={scroller}
        className="scroller"
        onScroll={measure}
        layoutScroll
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={`Messages in ${room.name}`}
      >
        <div ref={content} className="list-content">
          {body}
        </div>
      </motion.div>
      <AnimatePresence>
        {!atBottom && ready && messages.length > 0 && (
          <motion.button
            type="button"
            className={unseen > 0 ? 'jump has-unseen' : 'jump'}
            onClick={jumpToLatest}
            initial={{ opacity: 0, y: 16, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            aria-label="Jump to latest message"
          >
            {unseen > 0 && <span>{unseen === 1 ? '1 new message' : `${unseen} new messages`}</span>}
            <ArrowDownIcon size={16} weight="bold" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

const NONE: string[] = [];
