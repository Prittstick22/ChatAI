import type { ChatMessage, Message, Proposal, Room } from './types';

export type LoadState = 'loading' | 'ready' | 'error';

export type History = { status: LoadState; error?: string; hasOlder: boolean; loadingOlder: boolean };

export type State = {
  me: string;
  roomsStatus: LoadState;
  roomsError?: string;
  /** Which identity the loaded rooms (unread counts, reads) were fetched for. */
  roomsFor?: string;
  rooms: Record<string, Room>;
  messages: Record<string, ChatMessage[]>;
  history: Record<string, History>;
  /** room -> user -> time (ms) their typing indicator expires */
  typing: Record<string, Record<string, number>>;
  /** user -> counter bumped each time they start typing, used for the
   * typing-bubble-becomes-message animation */
  typingSession: Record<string, number>;
  online: string[];
  nudges: Record<string, Proposal[]>;
};

export const PAGE = 100;
const TYPING_TTL = 6000;

export type Action =
  | { type: 'identity'; me: string }
  | { type: 'rooms/loading' }
  | { type: 'rooms/loaded'; rooms: Room[]; for: string }
  | { type: 'rooms/failed'; error: string }
  | { type: 'room/upsert'; room: Room }
  | { type: 'history/loading'; room: string }
  | { type: 'history/loaded'; room: string; messages: Message[]; older?: boolean }
  | { type: 'history/failed'; room: string; error: string }
  | { type: 'history/loadingOlder'; room: string; loading: boolean }
  | { type: 'message/received'; message: Message; live: boolean; countUnread: boolean; now: number }
  | { type: 'message/updated'; message: Message }
  | { type: 'message/pending'; message: ChatMessage }
  | { type: 'message/failed'; room: string; localId: string }
  | { type: 'message/discard'; room: string; localId: string }
  | { type: 'typing'; room: string; user: string; active: boolean; now: number }
  | { type: 'typing/expire'; now: number }
  | { type: 'presence'; online: string[] }
  | { type: 'read'; room: string; user: string; messageId: number }
  | { type: 'nudge'; room: string; nudge: Proposal }
  | { type: 'nudge/dismiss'; room: string; id: string };

export const initialState = (me: string): State => ({
  me,
  roomsStatus: 'loading',
  rooms: {},
  messages: {},
  history: {},
  typing: {},
  typingSession: {},
  online: [],
  nudges: {},
});

/** Confirmed messages in id order, then this tab's unsent ones in the order typed. */
function insert(list: ChatMessage[], message: ChatMessage): ChatMessage[] {
  if (message.id < 0) return [...list, message];
  let i = list.length;
  while (i > 0 && (list[i - 1].id < 0 || list[i - 1].id > message.id)) i--;
  return [...list.slice(0, i), message, ...list.slice(i)];
}

/** Adds or refreshes a message, matching an optimistic copy by client_id. Keeps local
 * fields (localId, fresh, morph) so React keys and animations stay stable. */
export function upsert(list: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const byClient = incoming.client_id ? list.findIndex((m) => m.localId === incoming.client_id) : -1;
  const byId = list.findIndex((m) => m.id === incoming.id);
  const index = byClient >= 0 ? byClient : byId;
  if (index < 0) return insert(list, incoming);
  const existing = list[index];
  const merged: ChatMessage = {
    ...existing,
    ...incoming,
    localId: existing.localId,
    fresh: existing.fresh,
    morph: existing.morph,
    status: undefined,
  };
  const rest = list.filter((m, i) => i !== index && m.id !== incoming.id);
  return insert(rest, merged);
}

function newer(a: Message | null, b: Message): Message {
  return !a || b.id >= a.id ? b : a;
}

function unreadFor(state: State, room: string, position: number): number | undefined {
  const list = state.messages[room];
  if (!list) return undefined;
  return list.filter((m) => m.id > position && m.user !== state.me && !m.deleted).length;
}

function withRoom(state: State, id: string, change: (room: Room) => Room): State {
  const room = state.rooms[id];
  return room ? { ...state, rooms: { ...state.rooms, [id]: change(room) } } : state;
}

function stopTyping(typing: State['typing'], room: string, user: string): State['typing'] {
  if (!typing[room]?.[user]) return typing;
  const { [user]: _gone, ...rest } = typing[room];
  return { ...typing, [room]: rest };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'identity':
      return { ...state, me: action.me, typing: {} };
    case 'rooms/loading':
      return { ...state, roomsStatus: state.roomsStatus === 'ready' ? 'ready' : 'loading', roomsError: undefined };
    case 'rooms/loaded':
      if (action.for !== state.me) return state;
      return { ...state, roomsStatus: 'ready', roomsFor: action.for, rooms: Object.fromEntries(action.rooms.map((r) => [r.id, r])) };
    case 'rooms/failed':
      return state.roomsStatus === 'ready' ? state : { ...state, roomsStatus: 'error', roomsError: action.error };
    case 'room/upsert': {
      const existing = state.rooms[action.room.id];
      const room = existing ? { ...existing, ...action.room, unread: existing.unread } : action.room;
      return { ...state, rooms: { ...state.rooms, [room.id]: room } };
    }

    case 'history/loading': {
      const current = state.history[action.room];
      if (current?.status === 'ready') return state;
      return { ...state, history: { ...state.history, [action.room]: { status: 'loading', hasOlder: false, loadingOlder: false } } };
    }
    case 'history/loaded': {
      const { room, messages, older } = action;
      const current = state.messages[room];
      const previous = state.history[room];
      let list: ChatMessage[];
      let hasOlder = previous?.status === 'ready' ? previous.hasOlder : messages.length >= PAGE;
      const newestCached = current?.filter((m) => m.id > 0).at(-1)?.id ?? 0;
      if (!current || (!older && messages.length >= PAGE && messages[0].id > newestCached)) {
        // First load, or a resync that jumped past everything cached: start fresh,
        // keeping unsent messages.
        list = [...messages, ...(current ?? []).filter((m) => m.id < 0)];
        hasOlder = messages.length >= PAGE;
      } else {
        list = messages.reduce(upsert, current);
        if (older) hasOlder = messages.length >= PAGE;
      }
      return {
        ...state,
        messages: { ...state.messages, [room]: list },
        history: { ...state.history, [room]: { status: 'ready', hasOlder, loadingOlder: false } },
      };
    }
    case 'history/failed': {
      const current = state.history[action.room];
      if (current?.status === 'ready') return state;
      return { ...state, history: { ...state.history, [action.room]: { status: 'error', error: action.error, hasOlder: false, loadingOlder: false } } };
    }
    case 'history/loadingOlder': {
      const current = state.history[action.room];
      if (!current) return state;
      return { ...state, history: { ...state.history, [action.room]: { ...current, loadingOlder: action.loading } } };
    }

    case 'message/received': {
      const { message, live, countUnread, now } = action;
      const room = message.room;
      const list = state.messages[room];
      const known = list?.some((m) => m.id === message.id || (message.client_id && m.localId === message.client_id));
      const typing = state.typing[room]?.[message.user];
      const incoming: ChatMessage = {
        ...message,
        fresh: live ? now : undefined,
        morph: live && typing ? `typing-${room}-${message.user}-${state.typingSession[message.user] ?? 0}` : undefined,
      };
      let next: State = {
        ...state,
        typing: stopTyping(state.typing, room, message.user),
        messages: list ? { ...state.messages, [room]: upsert(list, incoming) } : state.messages,
      };
      next = withRoom(next, room, (r) => {
        const isNew = !known && message.id > (r.last_message?.id ?? 0);
        return {
          ...r,
          last_message: newer(r.last_message, message),
          message_count: r.message_count + (isNew ? 1 : 0),
          unread: r.unread + (isNew && countUnread ? 1 : 0),
        };
      });
      return next;
    }
    case 'message/updated': {
      const { message } = action;
      const list = state.messages[message.room];
      let next = state;
      if (list?.some((m) => m.id === message.id)) {
        next = { ...state, messages: { ...state.messages, [message.room]: upsert(list, message) } };
      }
      return withRoom(next, message.room, (r) => (r.last_message?.id === message.id ? { ...r, last_message: message } : r));
    }
    case 'message/pending': {
      const { message } = action;
      const list = state.messages[message.room] ?? [];
      const exists = list.some((m) => m.localId === message.localId);
      const updated = exists ? list.map((m) => (m.localId === message.localId ? message : m)) : [...list, message];
      return { ...state, messages: { ...state.messages, [message.room]: updated } };
    }
    case 'message/failed':
    case 'message/discard': {
      const list = state.messages[action.room];
      if (!list) return state;
      const updated =
        action.type === 'message/discard'
          ? list.filter((m) => m.localId !== action.localId || m.id > 0)
          : list.map((m) => (m.localId === action.localId && m.id < 0 ? { ...m, status: 'failed' as const } : m));
      return { ...state, messages: { ...state.messages, [action.room]: updated } };
    }

    case 'typing': {
      const { room, user, active, now } = action;
      if (user === state.me) return state;
      if (!active) return { ...state, typing: stopTyping(state.typing, room, user) };
      const wasTyping = Boolean(state.typing[room]?.[user]);
      return {
        ...state,
        typing: { ...state.typing, [room]: { ...state.typing[room], [user]: now + TYPING_TTL } },
        typingSession: wasTyping ? state.typingSession : { ...state.typingSession, [user]: (state.typingSession[user] ?? 0) + 1 },
      };
    }
    case 'typing/expire': {
      let changed = false;
      const typing: State['typing'] = {};
      for (const [room, users] of Object.entries(state.typing)) {
        typing[room] = {};
        for (const [user, until] of Object.entries(users)) {
          if (until > action.now) typing[room][user] = until;
          else changed = true;
        }
      }
      return changed ? { ...state, typing } : state;
    }
    case 'presence':
      return { ...state, online: action.online };

    case 'read': {
      const { room, user, messageId } = action;
      return withRoom(state, room, (r) => {
        const reads = { ...r.reads, [user]: Math.max(r.reads[user] ?? 0, messageId) };
        if (user !== state.me) return { ...r, reads };
        const counted = unreadFor(state, room, reads[user]);
        const unread = counted ?? (messageId >= (r.last_message?.id ?? 0) ? 0 : r.unread);
        return { ...r, reads, unread };
      });
    }

    case 'nudge': {
      const current = (state.nudges[action.room] ?? []).filter((n) => n.id !== action.nudge.id);
      return { ...state, nudges: { ...state.nudges, [action.room]: [...current, action.nudge] } };
    }
    case 'nudge/dismiss':
      return { ...state, nudges: { ...state.nudges, [action.room]: (state.nudges[action.room] ?? []).filter((n) => n.id !== action.id) } };
  }
}

export function roomsByActivity(rooms: Record<string, Room>): Room[] {
  const activity = (r: Room) => r.last_message?.created_at ?? r.created_at;
  return Object.values(rooms).sort((a, b) => activity(b).localeCompare(activity(a)));
}
