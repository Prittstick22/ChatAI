import {
  ArrowBendUpLeftIcon,
  CheckIcon,
  ClockIcon,
  PencilSimpleIcon,
  SmileyIcon,
  TrashIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import { forwardRef, memo, useState, type CSSProperties, type ReactNode } from 'react';
import { Avatar } from './Avatar';
import { EmojiPicker, QUICK_REACTIONS } from './EmojiPicker';
import { fullTime, isJumboEmoji, listNames, mentions, segments, time } from './format';
import { colorFor } from './people';
import type { ChatMessage, ReplyPreview } from './types';

export type Position = 'single' | 'first' | 'middle' | 'last';

export type RowActions = {
  react: (message: ChatMessage, emoji: string) => void;
  reply: (message: ChatMessage) => void;
  edit: (message: ChatMessage) => void;
  remove: (message: ChatMessage) => void;
  retry: (message: ChatMessage) => void;
  discard: (message: ChatMessage) => void;
  jump: (messageId: number) => void;
};

type Props = {
  message: ChatMessage;
  me: string;
  room: string;
  position: Position;
  /** Fresher than message.reply_preview when the parent is loaded (edits, deletes). */
  parent?: ChatMessage;
  seenBy: string[];
  /** Play the entrance (and typing-bubble morph): it arrived while this list was open. */
  entering: boolean;
  highlighted: boolean;
  selected: boolean;
  pickerOpen: boolean;
  onSelect: (id: number | null) => void;
  onPicker: (id: number | null) => void;
  actions: RowActions;
  renderPoll?: (message: ChatMessage) => ReactNode;
};

const spring = { type: 'spring', stiffness: 520, damping: 34, mass: 0.8 } as const;

function Text({ text, me }: { text: string; me: string }) {
  return (
    <>
      {segments(text).map((s, i) =>
        s.kind === 'link' ? (
          <a key={i} href={s.value} target="_blank" rel="noopener noreferrer">
            {s.value}
          </a>
        ) : s.kind === 'mention' ? (
          <span key={i} className={s.value.slice(1).toLowerCase() === me.toLowerCase() ? 'mention me' : 'mention'}>
            {s.value}
          </span>
        ) : (
          <span key={i}>{s.value}</span>
        ),
      )}
    </>
  );
}

function Quote({ preview, onJump }: { preview: ReplyPreview; onJump: () => void }) {
  return (
    <button type="button" className="quote" style={{ '--person': colorFor(preview.user) } as CSSProperties} onClick={onJump}>
      <span className="quote-name">{preview.user}</span>
      <span className="quote-text">{preview.deleted ? 'Message deleted' : preview.text}</span>
    </button>
  );
}

const MessageRowView = forwardRef<HTMLDivElement, Props>(function MessageRowView(
  { message: m, me, room, position, parent, seenBy, entering, highlighted, selected, pickerOpen, onSelect, onPicker, actions, renderPoll },
  ref,
) {
  const mine = m.user === me;
  const [confirming, setConfirming] = useState(false);
  const confirmed = m.id > 0;
  const live = confirmed && !m.deleted;
  const poll = m.poll && !m.deleted && renderPoll ? renderPoll(m) : null;
  const jumbo = !m.deleted && !poll && isJumboEmoji(m.text);
  const showName = !mine && (position === 'single' || position === 'first');
  const showAvatar = !mine && (position === 'single' || position === 'last');
  const preview: ReplyPreview | null | undefined = parent
    ? { id: parent.id, user: parent.user, text: parent.text, deleted: Boolean(parent.deleted) }
    : m.reply_preview;
  const reactions = m.reactions ?? [];

  const classes = [
    'row',
    mine ? 'mine' : 'theirs',
    `pos-${position}`,
    highlighted && 'highlighted',
    selected && 'selected',
    !mine && !m.deleted && mentions(m.text, me) && 'mentions-me',
    reactions.length > 0 && 'has-reactions',
    seenBy.length > 0 && 'has-seen',
  ].filter(Boolean).join(' ');

  const morph = entering ? m.morph : undefined;
  const bubbleClass = ['bubble', poll && 'poll-bubble', jumbo && 'jumbo', m.deleted && 'deleted', m.status === 'failed' && 'failed', morph && 'morphing']
    .filter(Boolean)
    .join(' ');

  return (
    <motion.div
      ref={ref}
      className={classes}
      data-mid={m.id}
      initial={entering && !morph ? { opacity: 0, y: 14, scale: 0.97 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.16 } }}
      transition={spring}
      style={{ originX: mine ? 1 : 0, originY: 1 }}
    >
      {!mine && <div className="row-avatar">{showAvatar && <Avatar name={m.user} size={30} />}</div>}
      <motion.div className="row-body" layout="position" transition={spring}>
        {showName && (
          <div className="sender" style={{ '--person': colorFor(m.user) } as CSSProperties}>
            {m.user}
          </div>
        )}
        <div className="bubble-line">
          <motion.div
            layoutId={morph}
            className={bubbleClass}
            tabIndex={live ? 0 : undefined}
            aria-label={live ? `Message from ${m.user}: ${m.text}` : undefined}
            aria-expanded={live ? selected : undefined}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('a, button')) return;
              if (live) onSelect(selected ? null : m.id);
            }}
            onKeyDown={(e) => {
              if (live && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                onSelect(selected ? null : m.id);
              }
            }}
            transition={spring}
          >
            {preview && !m.deleted && <Quote preview={preview} onJump={() => actions.jump(preview.id)} />}
            {m.deleted ? (
              <p className="text">Message deleted</p>
            ) : poll ? (
              poll
            ) : (
              <p className="text">
                <Text text={m.text} me={me} />
                <span className={m.edited_at ? 'meta-spacer wide' : 'meta-spacer'} />
              </p>
            )}
            {!m.deleted && (
              <span className="meta" title={confirmed ? fullTime(m.created_at) : undefined}>
                {m.edited_at && <span>edited</span>}
                <time dateTime={m.created_at}>{time(m.created_at)}</time>
                {mine && m.status === 'sending' && <ClockIcon size={12} weight="bold" aria-label="Sending" />}
                {mine && m.status === 'failed' && <WarningCircleIcon size={13} weight="fill" aria-label="Not sent" />}
                {mine && !m.status && <CheckIcon size={12} weight="bold" aria-label="Sent" />}
              </span>
            )}
          </motion.div>

          {live && (
            <div className="toolbar" role="toolbar" aria-label="Message actions">
              {confirming ? (
                <>
                  <span className="toolbar-ask">Delete for everyone?</span>
                  <button type="button" className="tool danger-text" onClick={() => { setConfirming(false); actions.remove(m); }}>
                    Delete
                  </button>
                  <button type="button" className="tool" onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  {QUICK_REACTIONS.slice(0, 4).map((emoji) => (
                    <button key={emoji} type="button" className="tool emoji" aria-label={`React with ${emoji}`} onClick={() => actions.react(m, emoji)}>
                      {emoji}
                    </button>
                  ))}
                  <button type="button" className="tool" aria-label="More reactions" data-picker-toggle onClick={() => onPicker(pickerOpen ? null : m.id)}>
                    <SmileyIcon size={18} />
                  </button>
                  <button type="button" className="tool" aria-label="Reply" onClick={() => actions.reply(m)}>
                    <ArrowBendUpLeftIcon size={18} />
                  </button>
                  {mine && (
                    <>
                      {!m.poll && (
                        <button type="button" className="tool" aria-label="Edit" onClick={() => actions.edit(m)}>
                          <PencilSimpleIcon size={18} />
                        </button>
                      )}
                      <button type="button" className="tool" aria-label="Delete" onClick={() => setConfirming(true)}>
                        <TrashIcon size={18} />
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          <AnimatePresence>
            {pickerOpen && (
              <EmojiPicker
                label="React to message"
                className={mine ? 'for-row mine' : 'for-row'}
                onPick={(emoji) => {
                  onPicker(null);
                  actions.react(m, emoji);
                }}
                onClose={() => onPicker(null)}
              />
            )}
          </AnimatePresence>
        </div>

        {reactions.length > 0 && (
          <div className="reactions">
            <AnimatePresence initial={false}>
              {reactions.map((r) => {
                const reacted = r.users.includes(me);
                return (
                  <motion.button
                    key={r.emoji}
                    type="button"
                    layout
                    className={reacted ? 'chip reacted' : 'chip'}
                    title={`${listNames(r.users)} reacted with ${r.emoji}`}
                    aria-pressed={reacted}
                    onClick={() => actions.react(m, r.emoji)}
                    initial={{ opacity: 0, scale: 0.4 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.4 }}
                    transition={{ type: 'spring', stiffness: 700, damping: 26 }}
                  >
                    <span className="chip-emoji">{r.emoji}</span>
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.span
                        key={r.users.length}
                        className="chip-count"
                        initial={{ y: -10, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 10, opacity: 0 }}
                        transition={{ duration: 0.18 }}
                      >
                        {r.users.length}
                      </motion.span>
                    </AnimatePresence>
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        {m.status === 'failed' && (
          <div className="failed-note">
            Not sent.
            <button type="button" onClick={() => actions.retry(m)}>Try again</button>
            <button type="button" onClick={() => actions.discard(m)}>Discard</button>
          </div>
        )}

        {seenBy.length > 0 && (
          <div className="seen" title={`Seen by ${listNames(seenBy)}`}>
            {seenBy.map((name) => (
              <motion.span key={name} layoutId={`seen-${room}-${name}`} className="seen-avatar" transition={spring}>
                <Avatar name={name} size={18} />
              </motion.span>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
});

export const MessageRow = memo(MessageRowView);
