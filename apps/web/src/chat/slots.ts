import type { ComponentType } from 'react';
import type { ChatApi } from './api';
import type { ChatMessage, Proposal, Room } from './types';

/**
 * Where AI features plug into the chat UI. main.tsx passes components in; the chat
 * renders each one in place and works the same when a slot is empty. Vera's
 * `features/` components and Jin's proposals arrive through these props, so neither
 * needs to edit the chat components themselves.
 */

type Base = { room: Room; me: string; api: ChatApi };

/** Side panel opened from the conversation header (catch-up, search, actions). */
export type InsightsSlotProps = Base & {
  messages: ChatMessage[];
  tab: InsightsTab;
  onTab: (tab: InsightsTab) => void;
  /** Scroll the conversation to a message and highlight it, e.g. a search result. */
  onJump: (messageId: number) => void;
};
export type InsightsTab = 'catchup' | 'search' | 'actions';

/** Inline card in the conversation, one per proposal received as a `nudge` event. */
export type NudgeSlotProps = Base & {
  nudge: Proposal;
  onDismiss: () => void;
  onJump: (messageId: number) => void;
};

/** Shown on the "new messages" divider when the room is opened with unread messages. */
export type CatchUpSlotProps = Base & { unread: ChatMessage[] };

/** Row above the composer, e.g. smart reply chips. `insert` puts text in the composer. */
export type ComposerSlotProps = Base & { messages: ChatMessage[]; insert: (text: string) => void };

export type ChatSlots = {
  insights?: ComponentType<InsightsSlotProps>;
  nudge?: ComponentType<NudgeSlotProps>;
  catchUp?: ComponentType<CatchUpSlotProps>;
  composer?: ComponentType<ComposerSlotProps>;
};
