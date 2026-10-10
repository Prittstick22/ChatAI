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
  /** Set when the message is a poll posted into the conversation; live results. */
  poll?: Poll | null;
  /** Only on POST responses and live events: the id the sender attached. */
  client_id?: string;
};

export type Room = {
  id: string;
  name: string;
  created_by: string | null;
  created_at: string;
  members?: string[];
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
  /** The AI proposal it was made from: a room gets one poll per proposal. */
  proposal_id?: string | null;
  /** The message showing it in the conversation. */
  message_id?: number | null;
};

/** A /search result: a Message plus which search found it and, for keyword hits,
 * the text split into segments with the matched words marked. */
export type SearchResult = Message & {
  match?: ('keyword' | 'semantic')[];
  highlight?: { text: string; match: boolean }[] | null;
};

export type SearchResponse = { results: SearchResult[]; mode: 'semantic' | 'keyword' | string };

/** Structured AI proposal (docs/CONTRACT_V1.md), pushed as a `nudge` event. */
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
  /** A changed plan: the id of the event card this one replaces, and its time. */
  replaces?: string;
  previous_start_at?: string | null;
};

/** One line of a structured summary, with the messages it came from. */
export type SummaryItem = { text: string; source_message_ids: number[] };
export type SummaryTopic = { title: string; points: string[]; source_message_ids: number[] };
export type SummaryAction = SummaryItem & { owner: string | null };

/** Catch-up summary from the chat API (summaries.py): made after 10 new messages, a
 * quiet spell or "Summarise now", and pushed as a `summary` event. Text fields may
 * contain **bold** for times and dates. */
export type Summary = {
  room: string;
  /** Plain-text version; the only content when the AI returned no structure. */
  text: string;
  headline?: string | null;
  topics?: SummaryTopic[];
  decisions?: SummaryItem[];
  actions?: SummaryAction[];
  questions?: SummaryItem[];
  /** The newest message the summary covers. */
  upto_message_id: number;
  message_count: number;
  trigger: 'messages' | 'quiet' | 'manual' | string;
  created_at: string;
};

export type ServerEvent =
  | { type: 'message'; message: Message }
  | { type: 'message_updated'; message: Message }
  | { type: 'typing'; room: string; user: string; active: boolean }
  | { type: 'presence'; online: string[] }
  | { type: 'read'; room: string; user: string; message_id: number }
  | { type: 'room'; room: Room }
  | { type: 'room_member_left'; room: string; user: string }
  | { type: 'poll'; poll: Poll }
  | { type: 'nudge'; room: string; nudge: Proposal }
  | { type: 'summary'; room: string; summary: Summary }
  | { type: 'reset'; note?: string; room?: string } // dev tools replaced messages: reload (and open room)
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
