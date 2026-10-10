// A deliberately small Markdown renderer for AI-written text: **bold**, *italic* and
// `code` inline, "- " lists and "Label: text" lines as blocks. It builds React nodes
// directly, so model output can never inject HTML.
import { Fragment, type ReactNode } from 'react';

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\s][^*\n]*\*)/g;

export function Inline({ text }: { text: string }) {
  const parts = text.split(INLINE).filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>;
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

/** Block-level rendering for plain-text summaries from older AI responses. */
export function Blocks({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`}>
        {list.map((item, i) => (
          <li key={i}>
            <Inline text={item} />
          </li>
        ))}
      </ul>,
    );
    list = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      list.push(bullet[1]);
      continue;
    }
    flush();
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    const label = line.match(/^([A-Z][^:]{0,32}):\s+(.+)$/);
    blocks.push(
      heading ? (
        <h4 key={blocks.length}>
          <Inline text={heading[1]} />
        </h4>
      ) : label ? (
        <p key={blocks.length}>
          <span className="md-label">{label[1]}</span> <Inline text={label[2]} />
        </p>
      ) : (
        <p key={blocks.length}>
          <Inline text={line} />
        </p>
      ),
    );
  }
  flush();
  return <div className="md">{blocks}</div>;
}
