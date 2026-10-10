import type { Message, Poll, Proposal, Room, SearchResponse, Summary } from './types';

const configured = import.meta.env.VITE_CHAT_API_URL?.trim();

/** Chat API base URL. Defaults to this page's host on port 8000, so a laptop that opens
 * http://<host-ip>:5173 on the LAN talks to that host's API without extra config. */
export const CHAT_API_URL = (configured || `${location.protocol}//${location.hostname}:8000`).replace(/\/+$/, '');
/** WebSocket URL derived from the HTTP one (http -> ws, https -> wss). */
export const CHAT_WS_URL = CHAT_API_URL.replace(/^http/, 'ws') + '/ws';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function describe(status: number, detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (status === 422) return 'Check what you entered and try again.';
  return `The chat server returned an error (${status}).`;
}

type Init = Omit<RequestInit, 'body'> & { json?: unknown };

async function request<T>(path: string, { json, headers, ...init }: Init = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(CHAT_API_URL + path, {
      ...init,
      headers: json === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
  } catch {
    throw new ApiError(`Can't reach the chat server at ${CHAT_API_URL}.`, 0);
  }
  if (!response.ok) {
    let detail: unknown;
    try {
      detail = (await response.json()).detail;
    } catch {
      // not JSON
    }
    throw new ApiError(describe(response.status, detail), response.status);
  }
  return response.json() as Promise<T>;
}

function query(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? '?' + text : '';
}

export type NewMessage = { room: string; user: string; text: string; reply_to?: number | null; client_id?: string };
export type NewPoll = { question: string; options: string[]; room?: string; created_by?: string; proposal_id?: string };
export type NewRoom = { name: string; created_by: string; members: string[] };

export const chatApi = {
  rooms: (user: string) => request<Room[]>('/rooms' + query({ user })),
  createRoom: (room: NewRoom) => request<Room>('/rooms', { method: 'POST', json: room }),
  markRead: (room: string, user: string, messageId: number) =>
    request<{ room: string; user: string; message_id: number }>(`/rooms/${encodeURIComponent(room)}/read`, {
      method: 'POST',
      json: { user, message_id: messageId },
    }),

  messages: (room: string, cursor: { before_id?: number; after_id?: number; limit?: number } = {}) =>
    request<Message[]>('/messages' + query({ room, ...cursor })),
  send: (message: NewMessage) => request<Message>('/messages', { method: 'POST', json: message }),
  edit: (id: number, user: string, text: string) => request<Message>(`/messages/${id}`, { method: 'PATCH', json: { user, text } }),
  remove: (id: number, user: string) => request<Message>(`/messages/${id}` + query({ user }), { method: 'DELETE' }),
  react: (id: number, user: string, emoji: string) => request<Message>(`/messages/${id}/reactions`, { method: 'POST', json: { user, emoji } }),

  // AI gateway. The chat API answers with a fallback whenever the AI service is down.
  summary: (room: string) => request<{ summary: Summary | null }>(`/rooms/${encodeURIComponent(room)}/summary`),
  /** Summarise now: the result is also pushed to the room as a `summary` event. */
  digest: (room: string) => request<{ summary: string } & Partial<Omit<Summary, 'text'>>>('/digest' + query({ room })),
  search: (text: string, room: string) => request<SearchResponse>('/search' + query({ query: text, room })),
  suggest: (room: string) => request<{ suggestion: string; proposals?: Proposal[] }>('/suggest' + query({ room })),

  polls: (room?: string) => request<Poll[]>('/polls' + query({ room })),
  createPoll: (poll: NewPoll) => request<Poll>('/polls', { method: 'POST', json: poll }),
  vote: (pollId: number, user: string, optionIndex: number) =>
    request<{ ok: boolean; poll?: Poll }>(`/polls/${pollId}/votes`, { method: 'POST', json: { user, option_index: optionIndex } }),
  calendarUrl: (title: string, date: string) => CHAT_API_URL + '/calendar.ics' + query({ title, date }),
};

export type ChatApi = typeof chatApi;
