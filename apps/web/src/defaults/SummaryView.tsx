// Structured catch-up: a one-line headline, then tabs for the conversation's topics,
// what was agreed, who is doing what, and what is still open. Every line jumps to the
// messages it came from; lines that weren't in the previous summary get a dot.
import { ArrowClockwiseIcon, ChatTeardropTextIcon, CheckIcon, QuestionMarkIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Avatar } from '../chat/Avatar';
import { Blocks, Inline } from '../chat/markdown';
import { colorFor } from '../chat/people';
import type { Summary, SummaryAction, SummaryItem } from '../chat/types';

export type SummaryTab = 'overview' | 'decisions' | 'actions' | 'questions';

const TABS: { id: SummaryTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'actions', label: 'To-dos' },
  { id: 'questions', label: 'Questions' },
];

const EMPTY: Record<SummaryTab, string> = {
  overview: 'No topics yet.',
  decisions: 'Nothing has been agreed yet.',
  actions: 'Nobody has taken anything on yet.',
  questions: 'No open questions.',
};

const REASON: Record<string, string> = {
  messages: 'after 10 new messages',
  quiet: 'when the chat went quiet',
  manual: 'when someone asked',
};

const EASE = [0.2, 0.7, 0.2, 1] as const;

const slide: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 18 }),
  center: { opacity: 1, x: 0, transition: { duration: 0.24, ease: EASE } },
  exit: (dir: number) => ({ opacity: 0, x: dir * -18, transition: { duration: 0.16 } }),
};
const list: Variants = { show: { transition: { staggerChildren: 0.04, delayChildren: 0.12 } } };
const row: Variants = { hidden: { opacity: 0, y: 5 }, show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE } } };

const latestSource = (ids: number[]) => Math.max(...ids);
const clock = (at: string) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

type Props = {
  summary: Summary;
  previous?: Summary;
  tab: SummaryTab;
  direction: number;
  onTab: (tab: SummaryTab) => void;
  busy: boolean;
  onRefresh: () => void;
  onJump: (messageId: number) => void;
};

export function SummaryView({ summary, previous, tab, direction, onTab, busy, onRefresh, onJump }: Props) {
  const uid = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  // A tab switch slides in its direction; a new summary on the same tab (or opening
  // the panel) fades in place and staggers its lines instead.
  const lastTab = useRef(tab);
  const dir = lastTab.current === tab ? 0 : direction;
  useEffect(() => {
    lastTab.current = tab;
  });
  const stagger = dir === 0 ? 'hidden' : false;
  // New means it cites a message sent after the previous summary, however the model
  // happens to word it this time.
  const since = previous && previous.created_at !== summary.created_at ? previous.upto_message_id : null;
  const isNew = (ids: number[]) => since !== null && ids.some((id) => id > since);
  const structured = Boolean(summary.headline && (summary.topics?.length || summary.decisions?.length || summary.actions?.length || summary.questions?.length));
  const counts: Record<SummaryTab, number> = {
    overview: summary.topics?.length ?? 0,
    decisions: summary.decisions?.length ?? 0,
    actions: summary.actions?.length ?? 0,
    questions: summary.questions?.length ?? 0,
  };

  const onTabKeys = (e: KeyboardEvent) => {
    const index = TABS.findIndex((t) => t.id === tab);
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const target = TABS[(next + TABS.length) % TABS.length].id;
    onTab(target);
    tabRefs.current[target]?.focus();
  };

  const item = (entry: SummaryItem, index: number, mark: ReactNode, owner?: string | null) => (
    <motion.li key={`${index}-${entry.text}`} variants={row}>
      <button type="button" className="digest-item" onClick={() => onJump(latestSource(entry.source_message_ids))}>
        {mark}
        <span className="digest-text">
          {owner !== undefined && (
            <span className="digest-owner" style={owner ? { color: colorFor(owner) } : undefined}>
              {owner ?? 'Unassigned'}
            </span>
          )}
          <Inline text={entry.text} />
        </span>
        {isNew(entry.source_message_ids) && <span className="new-dot" title="New since the last summary" />}
        <ChatTeardropTextIcon className="digest-go" size={16} aria-hidden />
        <span className="sr-only">Show in chat{isNew(entry.source_message_ids) ? ', new since the last summary' : ''}</span>
      </button>
    </motion.li>
  );

  const ownedItem = (entry: SummaryAction, index: number) => {
    const owner = entry.owner ?? null;
    const mark = owner ? <Avatar name={owner} size={22} className="digest-mark" /> : <span className="digest-mark unassigned" />;
    return item(entry, index, mark, owner);
  };

  const body = () => {
    if (counts[tab] === 0) return <p className="digest-empty-tab">{EMPTY[tab]}</p>;
    if (tab === 'overview')
      return (
        <motion.div className="digest-topics" variants={list} initial={stagger} animate="show">
          {summary.topics!.map((topic) => (
            <motion.section key={topic.title} className="digest-topic" variants={row}>
              <div className="digest-topic-head">
                <h4>{topic.title}</h4>
                {isNew(topic.source_message_ids) && <span className="new-dot" title="Updated since the last summary" />}
                <button
                  type="button"
                  className="icon-button small digest-topic-go"
                  aria-label={`Show ${topic.title} in chat`}
                  onClick={() => onJump(latestSource(topic.source_message_ids))}
                >
                  <ChatTeardropTextIcon size={16} />
                </button>
              </div>
              <ul>
                {topic.points.map((point) => (
                  <li key={point}>
                    <Inline text={point} />
                  </li>
                ))}
              </ul>
            </motion.section>
          ))}
        </motion.div>
      );
    const entries = summary[tab] ?? [];
    return (
      <motion.ul className="digest-list" variants={list} initial={stagger} animate="show">
        {entries.map((entry, i) =>
          tab === 'decisions'
            ? item(entry, i, <span className="digest-mark decided"><CheckIcon size={12} weight="bold" /></span>)
            : tab === 'questions'
              ? item(entry, i, <span className="digest-mark open"><QuestionMarkIcon size={12} weight="bold" /></span>)
              : ownedItem(entry as SummaryAction, i),
        )}
      </motion.ul>
    );
  };

  return (
    <div className="digest">
      <div className="digest-meta">
        <p>
          Updated at {clock(summary.created_at)}
          {REASON[summary.trigger] ? `, ${REASON[summary.trigger]}` : ''}
        </p>
        <button type="button" className="icon-button small" aria-label="Summarise now" title="Summarise now" onClick={onRefresh} disabled={busy}>
          <ArrowClockwiseIcon size={16} className={busy ? 'spin' : undefined} />
        </button>
      </div>

      {structured ? (
        <>
          <motion.h3
            key={summary.created_at}
            className="digest-headline"
            initial={{ opacity: 0, filter: 'blur(6px)', y: 4 }}
            animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
            transition={{ duration: 0.5, ease: EASE }}
          >
            <Inline text={summary.headline!} />
          </motion.h3>

          <div className="digest-tabs" role="tablist" aria-label="Summary sections" onKeyDown={onTabKeys}>
            {TABS.map((t) => (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[t.id] = el;
                }}
                type="button"
                role="tab"
                id={`${uid}-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`${uid}-panel`}
                tabIndex={tab === t.id ? 0 : -1}
                className={tab === t.id ? 'digest-tab active' : 'digest-tab'}
                onClick={() => onTab(t.id)}
              >
                {t.label}
                {t.id !== 'overview' && counts[t.id] > 0 && (
                  <motion.span key={counts[t.id]} className="digest-count" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                    {counts[t.id]}
                  </motion.span>
                )}
                {tab === t.id && <motion.span layoutId={`${uid}-indicator`} className="digest-indicator" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
              </button>
            ))}
          </div>

          <div className="digest-body">
            <AnimatePresence mode="popLayout" initial={false} custom={dir}>
              <motion.div
                key={`${tab}-${summary.created_at}`}
                id={`${uid}-panel`}
                role="tabpanel"
                aria-labelledby={`${uid}-${tab}`}
                custom={dir}
                variants={slide}
                initial="enter"
                animate="center"
                exit="exit"
              >
                {body()}
              </motion.div>
            </AnimatePresence>
          </div>
        </>
      ) : (
        <Blocks text={summary.text} />
      )}

      <p className="digest-foot">Based on the last {summary.message_count} messages.</p>
    </div>
  );
}

export function SummarySkeleton() {
  return (
    <div className="digest-skeleton" aria-busy="true" aria-label="Summarising the conversation">
      {[88, 64, 0, 40, 92, 76, 0, 36, 84].map((width, i) => (width ? <span key={i} style={{ width: `${width}%` }} /> : <i key={i} />))}
    </div>
  );
}
