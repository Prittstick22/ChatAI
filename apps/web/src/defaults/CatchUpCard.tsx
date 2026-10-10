// "While you were away": when you open a room with a backlog, the catch-up comes to you
// at the "new messages" divider, cut down to what changed since you last read. It uses
// the room's automatic summary, and asks for a fresh one if that doesn't cover the
// backlog yet. Every line jumps to the messages it came from.
import { AtIcon, CheckIcon, QuestionMarkIcon, SparkleIcon, XIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Avatar } from '../chat/Avatar';
import { listNames, mentions } from '../chat/format';
import { colorFor } from '../chat/people';
import { Inline } from '../chat/markdown';
import type { CatchUpSlotProps } from '../chat/slots';
import type { Summary, SummaryItem } from '../chat/types';
import { SummarySkeleton } from './SummaryView';

/** A shorter backlog is quicker to read than a summary of it. */
const MIN_UNREAD = 4;
const MAX_LINES = 5;
/** Give the room's saved summary a moment to load before asking for a new one. */
const FETCH_GRACE_MS = 800;

const EASE = [0.2, 0.7, 0.2, 1] as const;
const list: Variants = { show: { transition: { staggerChildren: 0.05, delayChildren: 0.15 } } };
const row: Variants = { hidden: { opacity: 0, y: 5 }, show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE } } };

type Line = { key: string; mark: ReactNode; text: string; owner?: string | null; mine?: boolean; jump: number };

const newer = (a?: Summary, b?: Summary) => (!a ? b : !b ? a : Date.parse(b.created_at) > Date.parse(a.created_at) ? b : a);

export function CatchUpCard({ room, me, api, unread, summary, onJump, onOpenSummary }: CatchUpSlotProps) {
  const [hidden, setHidden] = useState(false);
  const [asked, setAsked] = useState<Summary>();
  const [status, setStatus] = useState<'idle' | 'busy' | 'failed'>('idle');
  const requested = useRef(false);

  const ids = unread.map((m) => m.id).filter((id) => id > 0);
  const since = ids.length ? Math.min(...ids) - 1 : 0;
  // The backlog as it was when you opened the room; later messages you see arrive.
  const [backlog] = useState(() => (ids.length ? Math.max(...ids) : 0));
  const current = newer(summary, asked);
  const covered = Boolean(current && current.upto_message_id >= backlog);
  const worth = unread.length >= MIN_UNREAD;

  useEffect(() => {
    if (!worth || covered || requested.current) return;
    const timer = setTimeout(() => {
      requested.current = true;
      setStatus('busy');
      api.digest(room.id).then(
        (result) => {
          // The same summary also reaches everyone as a `summary` event.
          if (result.created_at && result.upto_message_id) {
            setAsked({ ...(result as Omit<Summary, 'text'>), text: result.summary });
            setStatus('idle');
          } else setStatus('failed');
        },
        () => setStatus('failed'),
      );
    }, FETCH_GRACE_MS);
    return () => clearTimeout(timer);
  }, [worth, covered, api, room.id]);

  if (!worth) return null;

  const people = listNames([...new Set(unread.map((m) => m.user))]);
  const mentioned = unread.filter((m) => !m.deleted && mentions(m.text, me));
  const missed = (sources: number[]) => sources.some((id) => id > since);
  const latest = (sources: number[]) => Math.max(...sources);

  const lines: Line[] = [];
  if (current) {
    const item = (entry: SummaryItem, key: string, mark: ReactNode, owner?: string | null): Line => ({
      key,
      mark,
      text: entry.text,
      owner,
      mine: owner === me,
      jump: latest(entry.source_message_ids),
    });
    const actions = (current.actions ?? []).filter((a) => missed(a.source_message_ids));
    const own = actions.filter((a) => a.owner === me);
    const others = actions.filter((a) => a.owner !== me);
    const avatar = (owner: string | null) =>
      owner ? <Avatar name={owner} size={22} className="digest-mark" /> : <span className="digest-mark unassigned" />;
    own.forEach((a, i) => lines.push(item(a, `own-${i}`, avatar(a.owner), a.owner)));
    // What's yours first, then what was agreed, what's still open and what others took on.
    (current.decisions ?? [])
      .filter((d) => missed(d.source_message_ids))
      .slice(0, 2)
      .forEach((d, i) =>
        lines.push(item(d, `decision-${i}`, <span className="digest-mark decided"><CheckIcon size={12} weight="bold" /></span>)),
      );
    (current.questions ?? [])
      .filter((q) => missed(q.source_message_ids))
      .forEach((q, i) =>
        lines.push(item(q, `question-${i}`, <span className="digest-mark open"><QuestionMarkIcon size={12} weight="bold" /></span>)),
      );
    others.forEach((a, i) => lines.push(item(a, `action-${i}`, avatar(a.owner), a.owner)));
    // Nothing decided or asked: say what people talked about instead.
    if (!lines.length) {
      (current.topics ?? [])
        .filter((t) => missed(t.source_message_ids) && t.points.length)
        .forEach((t, i) =>
          lines.push({ key: `topic-${i}`, mark: <span className="digest-mark topic" />, text: `**${t.title}:** ${t.points[0]}`, jump: latest(t.source_message_ids) }),
        );
    }
  }

  const waiting = !covered && status !== 'failed';
  const headline = current?.headline && covered ? current.headline : null;

  return (
    <AnimatePresence initial={false}>
      {!hidden && (
        <motion.section
          className="away"
          aria-label="While you were away"
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0, transition: { duration: 0.22 } }}
          transition={{ duration: 0.35, ease: EASE }}
        >
          <div className="away-head">
            <span className="away-icon" aria-hidden="true">
              <SparkleIcon size={20} weight="fill" />
            </span>
            <div className="away-titles">
              <h2>While you were away</h2>
              <p className="away-meta">
                {unread.length} new messages from {people}
              </p>
            </div>
            <button type="button" className="icon-button small" aria-label="Hide catch-up" onClick={() => setHidden(true)}>
              <XIcon size={14} weight="bold" />
            </button>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {waiting ? (
              <motion.div key="loading" exit={{ opacity: 0, transition: { duration: 0.15 } }}>
                <SummarySkeleton />
              </motion.div>
            ) : (
              <motion.div key={current?.created_at ?? 'none'} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                {headline && (
                  <motion.p
                    className="away-headline"
                    initial={{ opacity: 0, filter: 'blur(6px)', y: 4 }}
                    animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
                    transition={{ duration: 0.5, ease: EASE }}
                  >
                    <Inline text={headline} />
                  </motion.p>
                )}
                {lines.length > 0 && (
                  <motion.ul className="away-lines" variants={list} initial="hidden" animate="show">
                    {lines.slice(0, MAX_LINES).map((line) => (
                      <motion.li key={line.key} variants={row}>
                        <button type="button" className="digest-item" onClick={() => onJump(line.jump)}>
                          {line.mark}
                          <span className="digest-text">
                            {line.owner !== undefined && (
                              <span
                                className={line.mine ? 'digest-owner you' : 'digest-owner'}
                                style={line.owner && !line.mine ? { color: colorFor(line.owner) } : undefined}
                              >
                                {line.mine ? 'For you' : line.owner ?? 'Unassigned'}
                              </span>
                            )}
                            <Inline text={line.text} />
                          </span>
                          <span className="sr-only">Show in chat</span>
                        </button>
                      </motion.li>
                    ))}
                  </motion.ul>
                )}
                {status === 'failed' && !current && <p className="away-note">The summary isn't available right now.</p>}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="away-foot">
            {mentioned.length > 0 && (
              <button type="button" className="away-link" onClick={() => onJump(mentioned[0].id)}>
                <AtIcon size={14} weight="bold" aria-hidden />
                {listNames([...new Set(mentioned.map((m) => m.user))])} mentioned you
              </button>
            )}
            {current && covered && (
              <button type="button" className="away-link" onClick={onOpenSummary}>
                See the full catch-up
              </button>
            )}
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
