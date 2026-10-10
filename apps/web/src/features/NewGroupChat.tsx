import { CheckIcon, MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react';
import { useMemo, useState, type FormEvent } from 'react';
import { Avatar } from '../chat/Avatar';
import './NewGroupChat.css';

type Props = {
  me: string;
  contacts: string[];
  online: string[];
  onCreate: (name: string, members: string[]) => Promise<void>;
  onCancel: () => void;
};

export function NewGroupChat({ me, contacts, online, onCreate, onCancel }: Props) {
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const available = useMemo(
    () =>
      contacts
        .filter((contact) => contact !== me)
        .sort((a, b) => a.localeCompare(b)),
    [contacts, me],
  );
  const selectedContacts = selected.filter((contact) => available.includes(contact));
  const matches = available.filter(
    (contact) => !selectedContacts.includes(contact) && contact.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );

  const toggle = (contact: string) => {
    setSelected((current) => (current.includes(contact) ? current.filter((name) => name !== contact) : [...current, contact]));
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || selectedContacts.length === 0 || busy) return;
    setBusy(true);
    setError('');
    try {
      await onCreate(name.trim(), selectedContacts);
      onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the group.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="new-group" onSubmit={create}>
      <div className="new-group-heading">
        <label htmlFor="new-group-name">New group</label>
      </div>
      <input
        id="new-group-name"
        autoFocus
        value={name}
        maxLength={60}
        placeholder="Name this chat"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => event.key === 'Escape' && onCancel()}
      />

      <label className="new-group-search-label" htmlFor="new-group-search">
        Add people
      </label>
      <div className="new-group-search">
        <MagnifyingGlassIcon size={17} aria-hidden="true" />
        <input
          id="new-group-search"
          type="search"
          value={search}
          placeholder="Search contacts"
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {selectedContacts.length > 0 && (
        <section className="new-group-selected" aria-label="Selected people">
          <span className="new-group-section-title">Selected · {selectedContacts.length}</span>
          <ul>
            {selectedContacts.map((contact) => (
              <li key={contact}>
                <Avatar name={contact} size={28} />
                <span>{contact}</span>
                <button type="button" aria-label={`Remove ${contact}`} onClick={() => toggle(contact)}>
                  <XIcon size={14} weight="bold" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="new-group-results" aria-label="Contacts">
        <span className="new-group-section-title">
          {search.trim() ? `Matches · ${matches.length}` : `Contacts · ${matches.length}`}
        </span>
        {matches.length ? (
          <ul>
            {matches.map((contact) => (
              <li key={contact}>
                <button type="button" aria-pressed={false} onClick={() => toggle(contact)}>
                  <Avatar name={contact} size={30} online={online.includes(contact)} />
                  <span>{contact}</span>
                  <span className="new-group-add" aria-hidden="true">
                    +
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="new-group-empty">{available.length ? 'No contacts match your search.' : 'No other contacts are available.'}</p>
        )}
      </section>

      {error && <p className="field-error" role="alert">{error}</p>}
      <button type="submit" className="button new-group-submit" disabled={!name.trim() || selectedContacts.length === 0 || busy}>
        <CheckIcon size={16} weight="bold" />
        {busy ? 'Creating…' : 'Create group'}
      </button>
    </form>
  );
}
