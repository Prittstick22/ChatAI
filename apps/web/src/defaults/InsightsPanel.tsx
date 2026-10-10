// Default insights panel: the scaffold's catch-up, search and actions tools, moved out
// of the main layout. Replace it in main.tsx with the features/ panels when they land.
import { CalendarPlusIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { InsightsSlotProps, InsightsTab } from '../chat/slots';
import type { Poll, SearchResponse, SearchResult } from '../chat/types';

const TABS: { id: InsightsTab; label: string }[] = [
  { id: 'catchup', label: 'Catch up' },
  { id: 'search', label: 'Search' },
  { id: 'actions', label: 'Actions' },
];

type Async<T> = { state: 'idle' } | { state: 'busy' } | { state: 'done'; value: T } | { state: 'error'; error: string };

const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

const clock = (at: string | number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function CatchUp({ room, api, summary }: InsightsSlotProps) {
  // The chat API pushes a summary after 10 new messages or a quiet spell; "Summarise
  // now" asks for one on demand. Whichever is newer is shown.
  const [manual, setManual] = useState<Async<{ text: string; at: number }>>({ state: 'idle' });
  useEffect(() => setManual({ state: 'idle' }), [room.id]);
  const run = async () => {
    setManual({ state: 'busy' });
    try {
      setManual({ state: 'done', value: { text: (await api.digest(room.id)).summary, at: Date.now() } });
    } catch (e) {
      setManual({ state: 'error', error: message(e) });
    }
  };
  const pushedAt = summary ? Date.parse(summary.created_at) : 0;
  const showManual = manual.state === 'done' && manual.value.at > pushedAt;
  const text = showManual ? manual.value.text : summary?.text;
  const note = showManual
    ? `Summarised at ${clock(manual.value.at)}`
    : summary
      ? `Updated at ${clock(summary.created_at)}, ${summary.trigger === 'quiet' ? 'when the chat went quiet' : 'after 10 new messages'}`
      : null;

  return (
    <section className="panel-section">
      {text ? (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={showManual ? `manual-${manual.state === 'done' && manual.value.at}` : summary?.created_at}
            className="summary"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22 }}
          >
            <p className="panel-note">{note}</p>
            <p className="panel-result">{text}</p>
          </motion.div>
        </AnimatePresence>
      ) : (
        <p className="panel-lede">
          A summary of {room.name} appears here on its own after a burst of messages, or when the chat goes quiet.
        </p>
      )}
      <button type="button" className="button secondary" onClick={run} disabled={manual.state === 'busy'}>
        {manual.state === 'busy' ? 'Summarising…' : 'Summarise now'}
      </button>
      {manual.state === 'error' && <p className="field-error">{manual.error}</p>}
    </section>
  );
}

function searchNote({ results, mode }: SearchResponse) {
  if (results.length === 0) return 'No matching messages.';
  const exact = results.some((r) => r.highlight);
  const byMeaning = mode === 'semantic' && results.some((r) => !r.highlight);
  if (exact && byMeaning) return 'Exact words highlighted, the rest matched by meaning';
  return byMeaning ? 'Matched by meaning' : 'Matched by keyword';
}

function ResultText({ result }: { result: SearchResult }) {
  if (!result.highlight) return <span>{result.text}</span>;
  return (
    <span>
      {result.highlight.map((part, i) => (part.match ? <mark key={i}>{part.text}</mark> : part.text))}
    </span>
  );
}

function Search({ room, api, onJump }: InsightsSlotProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Async<SearchResponse>>({ state: 'idle' });
  useEffect(() => setResults({ state: 'idle' }), [room.id]);
  const run = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setResults({ state: 'busy' });
    try {
      setResults({ state: 'done', value: await api.search(query.trim(), room.id) });
    } catch (err) {
      setResults({ state: 'error', error: message(err) });
    }
  };
  return (
    <section className="panel-section">
      <form className="panel-search" onSubmit={run}>
        <MagnifyingGlassIcon size={18} aria-hidden />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="When are we meeting?" aria-label={`Search ${room.name}`} />
        <button type="submit" className="button" disabled={!query.trim() || results.state === 'busy'}>
          Search
        </button>
      </form>
      {results.state === 'error' && <p className="field-error">{results.error}</p>}
      {results.state === 'done' && (
        <>
          <p className="panel-note">{searchNote(results.value)}</p>
          <ul className="panel-results">
            {results.value.results.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => onJump(m.id)}>
                  <strong>{m.user}</strong>
                  <ResultText result={m} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Actions({ room, me, api }: InsightsSlotProps) {
  const [suggestion, setSuggestion] = useState<Async<string>>({ state: 'idle' });
  const [polls, setPolls] = useState<Poll[]>([]);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    api.polls(room.id).then(setPolls, () => setPolls([]));
  }, [api, room.id]);
  useEffect(() => {
    setSuggestion({ state: 'idle' });
    refresh();
  }, [refresh]);

  const suggest = async () => {
    setSuggestion({ state: 'busy' });
    try {
      setSuggestion({ state: 'done', value: (await api.suggest(room.id)).suggestion });
    } catch (e) {
      setSuggestion({ state: 'error', error: message(e) });
    }
  };
  const create = async (e: FormEvent) => {
    e.preventDefault();
    const choices = options.split(',').map((o) => o.trim()).filter(Boolean);
    if (!question.trim() || choices.length < 2) return setError('Add a question and at least two options, separated by commas.');
    try {
      await api.createPoll({ question: question.trim(), options: choices, room: room.id, created_by: me });
      setQuestion('');
      setOptions('');
      setError('');
      refresh();
    } catch (err) {
      setError(message(err));
    }
  };
  const vote = async (poll: Poll, index: number) => {
    try {
      const result = await api.vote(poll.id, me, index);
      if (result.poll) setPolls((all) => all.map((p) => (p.id === poll.id ? result.poll! : p)));
      else refresh();
    } catch (err) {
      setError(message(err));
    }
  };

  return (
    <section className="panel-section">
      <p className="panel-lede">Spot the next thing the group needs to decide or schedule.</p>
      <button type="button" className="button" onClick={suggest} disabled={suggestion.state === 'busy'}>
        {suggestion.state === 'busy' ? 'Checking…' : 'Suggest a next step'}
      </button>
      {suggestion.state === 'done' && <p className="panel-result">{suggestion.value}</p>}
      {suggestion.state === 'error' && <p className="field-error">{suggestion.error}</p>}
      <a className="panel-link" href={api.calendarUrl('Team meeting', '20261010T120000Z')}>
        <CalendarPlusIcon size={18} /> Download example invite (.ics)
      </a>

      <h3 className="panel-heading">Polls</h3>
      {polls.length === 0 && <p className="panel-note">No polls in {room.name} yet.</p>}
      {polls.map((poll) => {
        const total = (poll.counts ?? []).reduce((a, b) => a + b, 0);
        const mine = poll.votes?.[me];
        return (
          <div key={poll.id} className="poll">
            <p className="poll-question">{poll.question}</p>
            {poll.options.map((option, i) => {
              const count = poll.counts?.[i] ?? 0;
              const share = total ? count / total : 0;
              return (
                <button key={i} type="button" className={mine === i ? 'poll-option chosen' : 'poll-option'} onClick={() => vote(poll, i)} aria-pressed={mine === i}>
                  <motion.span className="poll-bar" initial={false} animate={{ scaleX: share }} transition={{ type: 'spring', stiffness: 200, damping: 30 }} />
                  <span className="poll-label">{option}</span>
                  <span className="poll-count">{count}</span>
                </button>
              );
            })}
          </div>
        );
      })}
      <form className="poll-form" onSubmit={create}>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Poll question" aria-label="Poll question" />
        <input value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Options, separated by commas" aria-label="Poll options" />
        <button type="submit" className="button secondary">Create poll</button>
        {error && <p className="field-error">{error}</p>}
      </form>
    </section>
  );
}

export function InsightsPanel(props: InsightsSlotProps) {
  const { tab, onTab } = props;
  return (
    <div className="insights">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => onTab(t.id)}>
            {tab === t.id && <motion.span layoutId="insights-tab" className="tab-highlight" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }}>
          {tab === 'catchup' && <CatchUp {...props} />}
          {tab === 'search' && <Search {...props} />}
          {tab === 'actions' && <Actions {...props} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
