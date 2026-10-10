// Default insights panel: the scaffold's catch-up, search and actions tools, moved out
// of the main layout. Replace it in main.tsx with the features/ panels when they land.
import { CalendarPlusIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { InsightsSlotProps } from '../chat/slots';
import type { Poll, SearchResponse, SearchResult, Summary } from '../chat/types';
import { SummarySkeleton, SummaryView, type SummaryTab } from './SummaryView';

type Async<T> = { state: 'idle' } | { state: 'busy' } | { state: 'done'; value: T } | { state: 'error'; error: string };

const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

function CatchUp({ room, api, summary, previousSummary, onJump }: InsightsSlotProps) {
  // Summaries arrive on their own (after 10 messages or a quiet spell); Summarise now
  // asks for one, which the chat API also pushes to everyone in the room.
  const [manual, setManual] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [section, setSection] = useState<{ tab: SummaryTab; direction: number }>({ tab: 'overview', direction: 0 });
  useEffect(() => {
    setManual(null);
    setNote('');
  }, [room.id]);

  const run = async () => {
    setBusy(true);
    setNote('');
    try {
      const result = await api.digest(room.id);
      if (result.created_at) setManual({ ...(result as unknown as Summary), text: result.summary });
      else setNote(result.summary);
    } catch (e) {
      setNote(message(e));
    } finally {
      setBusy(false);
    }
  };
  const order = ['overview', 'decisions', 'actions', 'questions'];
  const onTab = (tab: SummaryTab) =>
    setSection((s) => ({ tab, direction: Math.sign(order.indexOf(tab) - order.indexOf(s.tab)) }));
  const current =
    manual && (!summary || Date.parse(manual.created_at) > Date.parse(summary.created_at)) ? manual : summary;

  return (
    <section className="panel-section">
      {current ? (
        <SummaryView
          summary={current}
          previous={current === summary ? previousSummary : summary}
          tab={section.tab}
          direction={section.direction}
          onTab={onTab}
          busy={busy}
          onRefresh={run}
          onJump={onJump}
        />
      ) : busy ? (
        <SummarySkeleton />
      ) : (
        <div className="digest-empty">
          <p className="digest-empty-title">Nothing to catch up on yet</p>
          <p className="panel-lede">A summary of {room.name} appears here after every 10 messages, or when the chat goes quiet.</p>
          <button type="button" className="button secondary" onClick={run}>
            Summarise now
          </button>
        </div>
      )}
      {note && <p className="field-error">{note}</p>}
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

function Actions({ room, me, api, messages }: InsightsSlotProps) {
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
  // Polls in the loaded conversation update live; the fetched list covers older ones.
  const live = useMemo(() => new Map(messages.flatMap((m) => (m.poll ? [[m.poll.id, m.poll] as const] : []))), [messages]);
  const unlisted = [...live.keys()].some((id) => !polls.some((p) => p.id === id));
  useEffect(() => {
    if (unlisted) refresh();
  }, [unlisted, refresh]);
  const shown = polls.map((p) => live.get(p.id) ?? p);

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
      {shown.length === 0 && <p className="panel-note">No polls in {room.name} yet.</p>}
      {shown.map((poll) => {
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
  const { tab } = props;
  return (
    <div className="insights">
      {tab === 'catchup' && <CatchUp {...props} />}
      {tab === 'search' && <Search {...props} />}
      {tab === 'actions' && <Actions {...props} />}
    </div>
  );
}
