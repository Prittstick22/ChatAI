// Shapes returned by the chat API (apps/chat-api). The first five Message fields are
// the stable v1 contract (docs/CONTRACT_V1.md); everything after them is additive.

export type Reaction = { emoji: string; users: string[] };

export type ReplyPreview = { id: number; user: string; text: string; deleted: boolean };

export type Message = {
  id: number;
  room: string;
  user: string;
  text: string;
  created_at: string;
  reply_to?: number | null;
  reply_preview?: ReplyPreview | null;
  edited_at?: string | null;
  deleted?: boolean;
  reactions?: Reaction[];
  /** Only on POST responses and live events: the id the sender attached. */
  client_id?: string;
};

export type Room = {
  id: string;
  name: string;
  created_by: string | null;
  created_at: string;
  last_message: Message | null;
  message_count: number;
  unread: number;
  /** user -> id of the last message they have read */
  reads: Record<string, number>;
};

export type Poll = {
  id: number;
  question: string;
  options: string[];
  room?: string;
  created_by?: string | null;
  created_at?: string | null;
  counts?: number[];
  votes?: Record<string, number>;
};

/** Structured AI proposal (docs/CONTRACT_V1.md). Not produced by any service yet. */
export type Proposal = {
  id: string;
  type: 'event' | 'poll' | string;
  title?: string;
  description?: string;
  question?: string;
  options?: string[] | null;
  source_message_ids?: number[];
  confidence?: number;
  needs_confirmation?: boolean;
  start_at?: string | null;
  timezone?: string;
};

export type ServerEvent =
  | { type: 'message'; message: Message }
  | { type: 'message_updated'; message: Message }
  | { type: 'typing'; room: string; user: string; active: boolean }
  | { type: 'presence'; online: string[] }
  | { type: 'read'; room: string; user: string; message_id: number }
  | { type: 'room'; room: Room }
  | { type: 'poll'; poll: Poll }
  | { type: 'nudge'; room: string; nudge: Proposal }
  | { type: 'pong' };

/** A message as the UI holds it: server data plus local delivery state. */
export type ChatMessage = Message & {
  /** Stable React key for messages this tab sent, so the optimistic copy and the
   * saved message are the same element. */
  localId?: string;
  status?: 'sending' | 'failed';
  /** When it arrived live (ms). History has none. Rows animate in only if this is
   * newer than when the list was opened, so switching rooms doesn't replay them. */
  fresh?: number;
  /** layoutId of the typing bubble this message grows out of, if its sender was typing. */
  morph?: string;
};
