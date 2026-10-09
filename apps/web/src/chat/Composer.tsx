import { ArrowBendUpLeftIcon, PaperPlaneRightIcon, PencilSimpleIcon, SmileyIcon, XIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { EmojiPicker } from './EmojiPicker';
import { preview } from './format';
import { colorFor } from './people';
import type { ChatMessage, Room } from './types';

const MAX = 2000;
const TYPING_EVERY = 2500;

type Props = {
  room: Room;
  replyTo: ChatMessage | null;
  editing: ChatMessage | null;
  disabled?: boolean;
  accessory?: ReactNode;
  onSend: (text: string) => void;
  onSaveEdit: (message: ChatMessage, text: string) => void;
  onCancel: () => void;
  onTyping: (active: boolean) => void;
  onEditLast: () => void;
};

export type ComposerHandle = { focus: () => void; insert: (text: string) => void };

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { room, replyTo, editing, disabled, accessory, onSend, onSaveEdit, onCancel, onTyping, onEditLast },
  handle,
) {
  const input = useRef<HTMLTextAreaElement>(null);
  const drafts = useRef<Record<string, string>>({});
  const [value, setValue] = useState('');
  const [picker, setPicker] = useState(false);
  const typingSent = useRef(0);
  const roomRef = useRef(room.id);
  const valueRef = useRef(value);
  valueRef.current = value;
  // True while the box holds a message being edited rather than this room's draft.
  const editMode = useRef(false);

  const insert = (text: string) => {
    const el = input.current;
    if (!el) return setValue((v) => v + text);
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  };

  useImperativeHandle(handle, () => ({ focus: () => input.current?.focus(), insert }));

  // One draft per room.
  useEffect(() => {
    if (roomRef.current === room.id) return;
    if (!editMode.current) drafts.current[roomRef.current] = valueRef.current;
    roomRef.current = room.id;
    editMode.current = false;
    setValue(drafts.current[room.id] ?? '');
    typingSent.current = 0;
  }, [room.id]);

  // Editing loads the message into the box; leaving edit mode restores the draft.
  useEffect(() => {
    if (editing) {
      if (!editMode.current) drafts.current[roomRef.current] = valueRef.current;
      editMode.current = true;
      setValue(editing.text);
      requestAnimationFrame(() => {
        const el = input.current;
        el?.focus();
        el?.setSelectionRange(editing.text.length, editing.text.length);
      });
    } else if (editMode.current) {
      editMode.current = false;
      setValue(drafts.current[roomRef.current] ?? '');
    }
  }, [editing]);

  useEffect(() => {
    if (replyTo) input.current?.focus();
  }, [replyTo]);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value]);

  const trimmed = value.trim();
  const tooLong = value.length > MAX;
  const canSend = trimmed.length > 0 && !tooLong && !disabled && (!editing || trimmed !== editing.text);

  const change = (next: string) => {
    setValue(next);
    if (editing) return;
    const now = Date.now();
    if (next.trim() && now - typingSent.current > TYPING_EVERY) {
      typingSent.current = now;
      onTyping(true);
    } else if (!next.trim() && typingSent.current) {
      typingSent.current = 0;
      onTyping(false);
    }
  };

  const submit = () => {
    if (!canSend) return;
    if (editing) {
      onSaveEdit(editing, trimmed);
    } else {
      onSend(trimmed);
      drafts.current[room.id] = '';
      setValue('');
      // No "stopped typing" here: the message itself clears the indicator for
      // everyone else, which lets their typing bubble turn into the message.
      typingSent.current = 0;
    }
  };

  const banner = editing
    ? { key: 'edit', icon: <PencilSimpleIcon size={16} weight="bold" />, title: 'Editing message', text: editing.text, color: undefined }
    : replyTo
      ? { key: `reply-${replyTo.id}`, icon: <ArrowBendUpLeftIcon size={16} weight="bold" />, title: `Replying to ${replyTo.user}`, text: replyTo.text, color: colorFor(replyTo.user) }
      : null;

  return (
    <div className="composer-wrap">
      {accessory}
      <div className={editing ? 'composer editing' : 'composer'}>
        <AnimatePresence initial={false}>
          {banner && (
            <motion.div
              key={banner.key}
              className="composer-banner"
              style={banner.color ? ({ '--person': banner.color } as CSSProperties) : undefined}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 40 }}
            >
              <div className="composer-banner-inner">
                <span className="composer-banner-icon">{banner.icon}</span>
                <span className="composer-banner-copy">
                  <strong>{banner.title}</strong>
                  <span>{preview(banner.text, 120)}</span>
                </span>
                <button type="button" className="icon-button small" aria-label={editing ? 'Cancel editing' : 'Cancel reply'} onClick={onCancel}>
                  <XIcon size={16} weight="bold" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <form
          className="composer-row"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="composer-emoji">
            <button type="button" className="icon-button" aria-label="Insert emoji" aria-expanded={picker} data-picker-toggle onClick={() => setPicker((p) => !p)}>
              <SmileyIcon size={22} />
            </button>
            <AnimatePresence>
              {picker && (
                <EmojiPicker
                  label="Insert emoji"
                  className="for-composer"
                  onPick={(emoji) => {
                    setPicker(false);
                    insert(emoji);
                  }}
                  onClose={() => setPicker(false)}
                />
              )}
            </AnimatePresence>
          </div>
          <textarea
            ref={input}
            rows={1}
            value={value}
            placeholder={editing ? 'Edit your message' : `Message ${room.name}`}
            aria-label={editing ? 'Edit your message' : `Message ${room.name}`}
            onChange={(e) => change(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape' && (editing || replyTo)) {
                e.preventDefault();
                onCancel();
              } else if (e.key === 'ArrowUp' && !value && !editing) {
                e.preventDefault();
                onEditLast();
              }
            }}
          />
          {value.length > MAX - 200 && (
            <span className={tooLong ? 'counter over' : 'counter'} aria-live="polite">
              {MAX - value.length}
            </span>
          )}
          <motion.button
            type="submit"
            className="send"
            disabled={!canSend}
            aria-label={editing ? 'Save changes' : 'Send message'}
            animate={{ scale: canSend ? 1 : 0.86, opacity: canSend ? 1 : 0.45 }}
            whileTap={canSend ? { scale: 0.88 } : undefined}
            transition={{ type: 'spring', stiffness: 600, damping: 24 }}
          >
            {editing ? <PencilSimpleIcon size={20} weight="bold" /> : <PaperPlaneRightIcon size={20} weight="fill" />}
          </motion.button>
        </form>
      </div>
    </div>
  );
});
