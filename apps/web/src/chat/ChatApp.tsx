import { ArrowClockwiseIcon, CalendarDotsIcon, CaretLeftIcon, MagnifyingGlassIcon, NotePencilIcon, XIcon, type Icon } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { ApiError, chatApi } from './api';
import { RoomBadge } from './Avatar';
import { Composer, type ComposerHandle } from './Composer';
import { ConnectionBanner } from './ConnectionBanner';
import { DevPanel } from './DevPanel';
import { listNames } from './format';
import { MessageList } from './MessageList';
import type { RowActions } from './MessageRow';
import { Sidebar } from './Sidebar';
import type { ChatSlots, InsightsTab } from './slots';
import { initialState, reducer, roomsByActivity } from './state';
import type { ChatMessage, Reaction, ServerEvent } from './types';
import { useChatSocket } from './useChatSocket';

type Props = { me: string; slots: ChatSlots; onSwitchIdentity: (name: string) => void };

const errorText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.');
const localId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const RESET_NOTE = 'chatai:reset-note';
const INSIGHT_TABS: { id: InsightsTab; label: string; about: string; Icon: Icon }[] = [
  { id: 'catchup', label: 'Catch up', about: 'What happened, what was decided and who is doing what', Icon: NotePencilIcon },
  { id: 'search', label: 'Search', about: 'Find a message by its words or what it meant', Icon: MagnifyingGlassIcon },
  { id: 'actions', label: 'Actions', about: 'Polls, plans and calendar invites', Icon: CalendarDotsIcon },
];

function InsightTabs({
  active,
  onSelect,
  newSummary,
}: {
  active: InsightsTab | null;
  onSelect: (tab: InsightsTab) => void;
  newSummary: boolean;
}) {
  return (
    <div
      className="insight-tabs insight-tabs-header"
      role="group"
      aria-label="Conversation tools"
      onClick={(event) => event.stopPropagation()}
    >
      {INSIGHT_TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className={active === id ? 'tab active' : 'tab'}
          aria-label={id === 'catchup' && newSummary ? 'Catch up, new summary' : label}
          aria-pressed={active === id}
          onClick={() => onSelect(id)}
        >
          {active === id && <span className="tab-highlight" aria-hidden="true" />}
          <span className="tab-label">
            <Icon className={`insight-tab-icon insight-tab-icon-${id}`} size={id === 'search' ? 21 : 18} weight="regular" aria-hidden="true" />
            {label}
            {id === 'catchup' && newSummary && <span className="button-dot" aria-hidden="true" />}
          </span>
        </button>
      ))}
    </div>
  );
}

function readHash(): string | null {
  return decodeURIComponent(location.hash.replace(/^#\/?/, '')) || null;
}

/** The open room lives in the URL hash (#/demo) so a reload or a shared link keeps it. */
function useRoomHash(): [string | null, (room: string) => void] {
  const [room, setRoom] = useState(readHash);
  useEffect(() => {
    const changed = () => setRoom(readHash());
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  const open = useCallback((id: string) => {
    if (readHash() !== id) history.replaceState(null, '', `#/${encodeURIComponent(id)}`);
    setRoom(id);
  }, []);
  return [room, open];
}

function toggled(reactions: Reaction[], emoji: string, me: string): Reaction[] {
  const existing = reactions.find((r) => r.emoji === emoji);
  if (!existing) return [...reactions, { emoji, users: [me] }];
  const users = existing.users.includes(me) ? existing.users.filter((u) => u !== me) : [...existing.users, me];
  return users.length ? reactions.map((r) => (r.emoji === emoji ? { ...r, users } : r)) : reactions.filter((r) => r.emoji !== emoji);
}

export function ChatApp({ me, slots, onSwitchIdentity }: Props) {
  const [state, dispatch] = useReducer(reducer, me, initialState);
  const [activeRoom, openRoomHash] = useRoomHash();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showChat, setShowChat] = useState(() => readHash() !== null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [insights, setInsights] = useState<InsightsTab | null>(null);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [unreadAfter, setUnreadAfter] = useState<{ room: string | null; me: string; id: number | null }>({ room: null, me, id: null });
  const composer = useRef<ComposerHandle>(null);
  const atBottom = useRef(true);
  const lastMarked = useRef<Record<string, number>>({});
  const optimisticSeq = useRef(0);
  const summariesFetched = useRef(new Set<string>());
  const live = useRef({ me, activeRoom, state });
  live.current = { me, activeRoom, state };

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all.slice(-2), { id, text }]);
    window.setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), 4200);
  }, []);

  // The dev tools reload every tab after replacing messages; say what changed.
  useEffect(() => {
    try {
      const note = sessionStorage.getItem(RESET_NOTE);
      sessionStorage.removeItem(RESET_NOTE);
      if (note) toast(note);
    } catch {
      // storage unavailable
    }
  }, [toast]);

  // ---------------------------------------------------------------- identity and accent

  useEffect(() => {
    if (state.me !== me) dispatch({ type: 'identity', me });
    setReplyTo(null);
    setEditing(null);
    setUnreadAfter({ room: null, me, id: null });
  }, [me, state.me]);

  // ---------------------------------------------------------------- loading

  const loadRooms = useCallback(async () => {
    const who = live.current.me;
    dispatch({ type: 'rooms/loading' });
    try {
      dispatch({ type: 'rooms/loaded', rooms: await chatApi.rooms(who), for: who });
    } catch (e) {
      dispatch({ type: 'rooms/failed', error: errorText(e) });
    }
  }, []);

  const loadSummary = useCallback((room: string) => {
    chatApi.summary(room).then(
      ({ summary }) => summary && dispatch({ type: 'summary', room, summary }),
      () => {},
    );
  }, []);

  const loadHistory = useCallback(async (room: string) => {
    dispatch({ type: 'history/loading', room });
    try {
      dispatch({ type: 'history/loaded', room, messages: await chatApi.messages(room) });
    } catch (e) {
      dispatch({ type: 'history/failed', room, error: errorText(e) });
    }
  }, []);

  const loadOlder = useCallback(async () => {
    const room = live.current.activeRoom;
    if (!room) return;
    const oldest = live.current.state.messages[room]?.find((m) => m.id > 0);
    if (!oldest) return;
    dispatch({ type: 'history/loadingOlder', room, loading: true });
    try {
      dispatch({ type: 'history/loaded', room, messages: await chatApi.messages(room, { before_id: oldest.id }), older: true });
    } catch (e) {
      dispatch({ type: 'history/loadingOlder', room, loading: false });
      toast(errorText(e));
    }
  }, [toast]);

  useEffect(() => {
    loadRooms();
  }, [me, loadRooms]);

  // Pick a room once rooms arrive: the one in the URL if it exists, else the demo room.
  const roomList = useMemo(() => roomsByActivity(state.rooms), [state.rooms]);
  useEffect(() => {
    if (state.roomsStatus !== 'ready' || roomList.length === 0) return;
    if (activeRoom && state.rooms[activeRoom]) return;
    openRoomHash(state.rooms.demo ? 'demo' : roomList[0].id);
  }, [state.roomsStatus, roomList, activeRoom, state.rooms, openRoomHash]);

  const room = activeRoom ? state.rooms[activeRoom] : undefined;
  const summary = room ? state.summaries[room.id] : undefined;
  // room -> created_at of the newest summary seen in the catch-up tab, for the dot.
  const [summarySeen, setSummarySeen] = useState<Record<string, string>>({});
  const newSummary = Boolean(summary && insights !== 'catchup' && summarySeen[summary.room] !== summary.created_at);
  useEffect(() => {
    if (summary && insights === 'catchup') setSummarySeen((seen) => ({ ...seen, [summary.room]: summary.created_at }));
  }, [summary, insights]);

  useEffect(() => {
    if (room && !state.history[room.id]) loadHistory(room.id);
  }, [room, state.history, loadHistory]);

  useEffect(() => {
    if (!room || summariesFetched.current.has(room.id)) return;
    summariesFetched.current.add(room.id);
    loadSummary(room.id);
  }, [room, loadSummary]);

  // Remember where unread messages started when the room is opened, for the divider.
  useEffect(() => {
    if (!room || state.roomsFor !== me) return;
    if (unreadAfter.room === room.id && unreadAfter.me === me) return;
    setUnreadAfter({ room: room.id, me, id: room.unread > 0 ? room.reads[me] ?? 0 : null });
  }, [room, state.roomsFor, unreadAfter.room, unreadAfter.me, me]);

  // ---------------------------------------------------------------- read receipts

  const markRead = useCallback(() => {
    const { activeRoom: id, state: s, me: who } = live.current;
    if (!id || document.hidden || !atBottom.current) return;
    const latest = s.messages[id]?.findLast((m) => m.id > 0)?.id;
    if (!latest) return;
    const key = `${who}:${id}`;
    const known = Math.max(lastMarked.current[key] ?? 0, s.rooms[id]?.reads[who] ?? 0);
    if (latest <= known) return;
    lastMarked.current[key] = latest;
    dispatch({ type: 'read', room: id, user: who, messageId: latest });
    chatApi.markRead(id, who, latest).catch(() => {
      lastMarked.current[key] = known;
    });
  }, []);

  useEffect(() => {
    markRead();
  }, [state.messages, activeRoom, markRead]);

  useEffect(() => {
    document.addEventListener('visibilitychange', markRead);
    window.addEventListener('focus', markRead);
    return () => {
      document.removeEventListener('visibilitychange', markRead);
      window.removeEventListener('focus', markRead);
    };
  }, [markRead]);

  const onAtBottom = useCallback(
    (bottom: boolean) => {
      atBottom.current = bottom;
      if (bottom) markRead();
    },
    [markRead],
  );

  // ---------------------------------------------------------------- sending

  const deliver = useCallback(
    async (message: ChatMessage) => {
      dispatch({ type: 'message/pending', message: { ...message, status: 'sending' } });
      try {
        const saved = await chatApi.send({
          room: message.room,
          user: message.user,
          text: message.text,
          reply_to: message.reply_to,
          client_id: message.localId,
        });
        dispatch({ type: 'message/received', message: saved, live: true, countUnread: false, now: Date.now() });
      } catch (e) {
        dispatch({ type: 'message/failed', room: message.room, localId: message.localId! });
        if (!(e instanceof ApiError && e.status === 0)) toast(errorText(e));
      }
    },
    [toast],
  );

  // ---------------------------------------------------------------- live events

  const onEvent = useCallback((event: ServerEvent) => {
    const { me: who, activeRoom: open } = live.current;
    switch (event.type) {
      case 'message': {
        const m = event.message;
        dispatch({
          type: 'message/received',
          message: m,
          live: true,
          countUnread: m.user !== who && (m.room !== open || document.hidden),
          now: Date.now(),
        });
        break;
      }
      case 'message_updated':
        dispatch({ type: 'message/updated', message: event.message });
        break;
      case 'typing':
        dispatch({ type: 'typing', room: event.room, user: event.user, active: event.active, now: Date.now() });
        break;
      case 'presence':
        dispatch({ type: 'presence', online: event.online });
        break;
      case 'read':
        dispatch({ type: 'read', room: event.room, user: event.user, messageId: event.message_id });
        break;
      case 'room':
        dispatch({ type: 'room/upsert', room: event.room });
        break;
      case 'room_member_left':
        dispatch({ type: 'room/left', room: event.room, user: event.user });
        if (event.user === who && open === event.room) {
          setReplyTo(null);
          setEditing(null);
          setHighlight(null);
          setInsights(null);
        }
        break;
      case 'poll':
        dispatch({ type: 'poll', poll: event.poll });
        break;
      case 'nudge':
        dispatch({ type: 'nudge', room: event.room, nudge: event.nudge });
        break;
      case 'summary':
        dispatch({ type: 'summary', room: event.room, summary: event.summary });
        break;
      case 'reset':
        // The dev tools replaced messages: start again from what the server has now.
        try {
          sessionStorage.setItem(RESET_NOTE, event.note ?? 'The chats were reset.');
        } catch {
          // storage unavailable
        }
        if (event.room) location.hash = '#/' + encodeURIComponent(event.room);
        location.reload();
        break;
    }
  }, []);

  // Every (re)connect: refresh rooms and cached rooms, and resend anything that failed.
  const onOpen = useCallback(() => {
    const { state: s } = live.current;
    loadRooms();
    for (const [id, h] of Object.entries(s.history)) {
      if (h.status !== 'ready') continue;
      chatApi.messages(id).then((messages) => dispatch({ type: 'history/loaded', room: id, messages }), () => {});
    }
    for (const list of Object.values(s.messages)) {
      for (const m of list) if (m.status === 'failed' && m.user === live.current.me) deliver(m);
    }
    for (const id of summariesFetched.current) loadSummary(id);
  }, [loadRooms, deliver, loadSummary]);

  const { status, send } = useChatSocket(me, onEvent, onOpen);

  const typingActive = Object.values(state.typing).some((users) => Object.keys(users).length > 0);
  useEffect(() => {
    if (!typingActive) return;
    const timer = window.setInterval(() => dispatch({ type: 'typing/expire', now: Date.now() }), 1000);
    return () => window.clearInterval(timer);
  }, [typingActive]);

  // ---------------------------------------------------------------- actions

  const jumpTo = useCallback(
    (id: number) => {
      const el = document.querySelector<HTMLElement>(`.scroller [data-mid="${id}"]`);
      if (!el) {
        toast("That message is further back than what's loaded.");
        return;
      }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setHighlight(id);
      window.setTimeout(() => setHighlight((h) => (h === id ? null : h)), 1800);
    },
    [toast],
  );

  const actions: RowActions = useMemo(
    () => ({
      react: (m, emoji) => {
        dispatch({ type: 'message/updated', message: { ...m, reactions: toggled(m.reactions ?? [], emoji, me) } });
        chatApi.react(m.id, me, emoji).then(
          (saved) => dispatch({ type: 'message/updated', message: saved }),
          (e) => {
            dispatch({ type: 'message/updated', message: m });
            toast(errorText(e));
          },
        );
      },
      reply: (m) => {
        setEditing(null);
        setReplyTo(m);
      },
      edit: (m) => {
        setReplyTo(null);
        setEditing(m);
      },
      remove: (m) => {
        if (editing?.id === m.id) setEditing(null);
        chatApi.remove(m.id, me).then(
          (saved) => dispatch({ type: 'message/updated', message: saved }),
          (e) => toast(errorText(e)),
        );
      },
      retry: (m) => deliver(m),
      discard: (m) => m.localId && dispatch({ type: 'message/discard', room: m.room, localId: m.localId }),
      jump: jumpTo,
    }),
    [me, toast, deliver, jumpTo, editing?.id],
  );

  const sendMessage = (text: string) => {
    if (!room) return;
    const id = localId();
    const parent = replyTo;
    optimisticSeq.current += 1;
    const message: ChatMessage = {
      id: -optimisticSeq.current,
      room: room.id,
      user: me,
      text,
      created_at: new Date().toISOString(),
      reply_to: parent?.id ?? null,
      reply_preview: parent ? { id: parent.id, user: parent.user, text: parent.text, deleted: false } : null,
      reactions: [],
      deleted: false,
      localId: id,
      client_id: id,
      fresh: Date.now(),
      status: 'sending',
    };
    setReplyTo(null);
    deliver(message);
  };

  const saveEdit = async (m: ChatMessage, text: string) => {
    setEditing(null);
    dispatch({ type: 'message/updated', message: { ...m, text, edited_at: new Date().toISOString() } });
    try {
      dispatch({ type: 'message/updated', message: await chatApi.edit(m.id, me, text) });
    } catch (e) {
      dispatch({ type: 'message/updated', message: m });
      toast(errorText(e));
    }
  };

  const editLast = () => {
    if (!room) return;
    const mine = state.messages[room.id]?.findLast((m) => m.user === me && m.id > 0 && !m.deleted && !m.poll);
    if (mine) actions.edit(mine);
  };

  const openRoom = (id: string) => {
    if (id !== activeRoom) {
      setReplyTo(null);
      setEditing(null);
      setHighlight(null);
    }
    openRoomHash(id);
    setShowChat(true);
  };

  const createRoom = async (name: string, members: string[]) => {
    const created = await chatApi.createRoom({ name, created_by: me, members });
    dispatch({ type: 'room/upsert', room: created });
    openRoom(created.id);
  };

  const leaveRoom = async (id: string) => {
    try {
      await chatApi.leaveRoom(id, me);
      dispatch({ type: 'room/left', room: id, user: me });
    } catch (e) {
      toast(errorText(e));
      throw e;
    }
  };

  // ---------------------------------------------------------------- derived view data

  const messages = (room && state.messages[room.id]) || EMPTY;
  const typingUsers = useMemo(() => {
    if (!room) return [];
    return Object.keys(state.typing[room.id] ?? {})
      .filter((u) => u !== me)
      .sort()
      .map((user) => ({ user, layoutId: `typing-${room.id}-${user}-${state.typingSession[user] ?? 0}` }));
  }, [room, state.typing, state.typingSession, me]);

  const others = state.online.filter((u) => u !== me);
  const subtitle = typingUsers.length
    ? `${listNames(typingUsers.map((t) => t.user))} ${typingUsers.length === 1 ? 'is' : 'are'} typing…`
    : others.length
      ? `${listNames(others)} ${others.length === 1 ? 'is' : 'are'} online`
      : 'No one else is online';

  const totalUnread = roomList.reduce((sum, r) => sum + (r.id === activeRoom && !document.hidden ? 0 : r.unread), 0);
  useEffect(() => {
    document.title = totalUnread ? `(${totalUnread}) H.AI` : 'H.AI';
  }, [totalUnread]);

  const nudges = room ? state.nudges[room.id] : undefined;
  const Nudge = slots.nudge;
  const inserts = useMemo(() => {
    const map = new Map<number | 'end', ReactNode[]>();
    if (!room || !Nudge || !nudges?.length) return map;
    const loaded = new Set(messages.map((m) => m.id));
    for (const nudge of nudges) {
      const ids = new Set(nudge.source_message_ids ?? []);
      const anchor = Math.max(...[...ids].filter((id) => loaded.has(id)), -Infinity);
      const key = Number.isFinite(anchor) ? anchor : 'end';
      const node = (
        <Nudge
          key={nudge.id}
          nudge={nudge}
          sources={messages.filter((m) => ids.has(m.id))}
          room={room}
          me={me}
          api={chatApi}
          onDismiss={() => dispatch({ type: 'nudge/dismiss', room: room.id, id: nudge.id })}
          onJump={jumpTo}
        />
      );
      map.set(key, [...(map.get(key) ?? []), node]);
    }
    return map;
  }, [room, Nudge, nudges, messages, me, jumpTo]);

  const PollSlot = slots.poll;
  const renderPoll = useMemo(
    () =>
      PollSlot && room
        ? (m: ChatMessage) =>
            m.poll ? (
              <PollSlot room={room} me={me} api={chatApi} poll={m.poll} message={m} onChange={(poll) => dispatch({ type: 'poll', poll })} />
            ) : null
        : undefined,
    [PollSlot, room, me],
  );

  const CatchUp = slots.catchUp;
  const renderCatchUp = useMemo(
    () =>
      CatchUp && room
        ? (unread: ChatMessage[]) => (
            <CatchUp
              key={`${room.id}-${me}`}
              room={room}
              me={me}
              api={chatApi}
              unread={unread}
              summary={summary}
              onJump={jumpTo}
              onOpenSummary={() => setInsights('catchup')}
            />
          )
        : undefined,
    [CatchUp, room, me, summary, jumpTo],
  );

  const ComposerSlot = slots.composer;
  const Insights = slots.insights;
  const sheet = insights && INSIGHT_TABS.find((t) => t.id === insights);

  useEffect(() => {
    if (!insights) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setInsights(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [insights]);

  const jumpFromSheet = useCallback(
    (id: number) => {
      setInsights(null);
      jumpTo(id);
    },
    [jumpTo],
  );

  // ---------------------------------------------------------------- render

  if (state.roomsStatus !== 'ready') {
    return (
      <main className="fullscreen-state">
        {state.roomsStatus === 'loading' ? (
          <p className="loading-word">Loading H.AI…</p>
        ) : (
          <>
            <h1>Can't reach the chat server</h1>
            <p>{state.roomsError} Check the chat API is running, then try again.</p>
            <button type="button" className="button" onClick={loadRooms}>
              <ArrowClockwiseIcon size={16} weight="bold" /> Try again
            </button>
          </>
        )}
      </main>
    );
  }

  return (
    <div className={['app', showChat ? 'show-chat' : 'show-list', sidebarCollapsed && 'sidebar-collapsed'].filter(Boolean).join(' ')}>
      <Sidebar
        me={me}
        rooms={roomList}
        activeRoom={activeRoom}
        collapsed={sidebarCollapsed}
        online={state.online}
        typing={state.typing}
        onOpen={openRoom}
        onCreate={createRoom}
        onToggleCollapsed={() => setSidebarCollapsed((collapsed) => !collapsed)}
        onLeave={leaveRoom}
        onSwitchIdentity={onSwitchIdentity}
      />

      <section className="conversation glass" aria-label={room ? room.name : 'Conversation'}>
        {room ? (
          <>
            <header className="conv-header">
              <button type="button" className="icon-button back" aria-label="All rooms" onClick={() => setShowChat(false)}>
                <CaretLeftIcon size={22} weight="bold" />
              </button>
              <RoomBadge id={room.id} name={room.name} size={40} />
              <div className="conv-title">
                <span className="conv-title-name" role="heading" aria-level={1}>{room.name}</span>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={subtitle}
                    className={typingUsers.length ? 'conv-sub typing' : 'conv-sub'}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                  >
                    {subtitle}
                  </motion.span>
                </AnimatePresence>
              </div>
              {Insights && (
                <InsightTabs
                  active={insights}
                  newSummary={newSummary}
                  onSelect={(tab) => setInsights((current) => (current === tab ? null : tab))}
                />
              )}
            </header>
            <div className="conversation-content">
              <ConnectionBanner status={status} />
              <MessageList
                room={room}
                me={me}
                messages={messages}
                history={state.history[room.id]}
                typing={typingUsers}
                unreadAfter={unreadAfter.room === room.id ? unreadAfter.id : null}
                highlight={highlight}
                actions={actions}
                onLoadOlder={loadOlder}
                onRetry={() => loadHistory(room.id)}
                onAtBottom={onAtBottom}
                renderCatchUp={renderCatchUp}
                renderPoll={renderPoll}
                inserts={inserts}
              />
              <Composer
                ref={composer}
                room={room}
                replyTo={replyTo}
                editing={editing}
                accessory={
                  ComposerSlot && (
                    <ComposerSlot room={room} me={me} api={chatApi} messages={messages} insert={(text) => composer.current?.insert(text)} />
                  )
                }
                onSend={sendMessage}
                onSaveEdit={saveEdit}
                onCancel={() => {
                  setReplyTo(null);
                  setEditing(null);
                }}
                onTyping={(active) => send({ type: 'typing', room: room.id, active })}
                onEditLast={editLast}
              />
              <AnimatePresence>
                {sheet && Insights && (
                  <motion.div
                    key="sheet"
                    className="sheet-backdrop"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.2 } }}
                    transition={{ duration: 0.25 }}
                    onClick={() => setInsights(null)}
                  >
                    <motion.div
                      className="sheet glass"
                      tabIndex={-1}
                      autoFocus
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby="sheet-title"
                      initial={{ opacity: 0, y: 28, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 18, scale: 0.98, transition: { duration: 0.18 } }}
                      transition={{ type: 'spring', stiffness: 380, damping: 34 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <header className="sheet-head">
                        <span className="sheet-icon" aria-hidden="true">
                          <sheet.Icon size={22} weight="duotone" />
                        </span>
                        <div className="sheet-title">
                          <h2 id="sheet-title">{sheet.label}</h2>
                          <p>
                            {room.name} · {sheet.about}
                          </p>
                        </div>
                        <button type="button" className="icon-button" aria-label="Close" onClick={() => setInsights(null)}>
                          <XIcon size={18} weight="bold" />
                        </button>
                      </header>
                      <div className="sheet-body">
                        <Insights
                          room={room}
                          me={me}
                          api={chatApi}
                          messages={messages}
                          tab={insights}
                          onTab={setInsights}
                          onJump={jumpFromSheet}
                          summary={summary}
                          previousSummary={state.previousSummaries[room.id]}
                        />
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        ) : (
          <div className="fullscreen-state inline">
            <p>Pick a room to start chatting.</p>
          </div>
        )}
      </section>

      <DevPanel me={me} room={room} onSwitchIdentity={onSwitchIdentity} />

      <div className="toasts" aria-live="assertive">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              className="toast"
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 500, damping: 34 }}
            >
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

const EMPTY: ChatMessage[] = [];
