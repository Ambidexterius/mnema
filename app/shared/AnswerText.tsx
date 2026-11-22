import { answerBlocks, answerMetric, CARD_SECTIONS, METRICS_SECTION } from '../answer-format.ts';
import { ArrowDown, Quote } from 'lucide-react';
import type { ChatSource } from '../types.ts';
import { plural } from './format.ts';

/** Longer answers are uncovered for longer, like a streamed reply; capped so nobody waits. */
export const revealMessage = (el: HTMLElement | null) => {
  if (el && !el.style.getPropertyValue('--reveal-ms'))
    el.style.setProperty(
      '--reveal-ms',
      Math.round(Math.min(3200, Math.max(900, el.scrollHeight * 3.5))) + 'ms',
    );
};

// Material titles read as "who said it"; «Тест чата · Респондент 1» keeps its last part.
export const materialCount = (list: ChatSource[]) => new Set(list.map((x) => x.studyId)).size;

export const sourcesHeading = (list: ChatSource[]) =>
  materialCount(list) === 1
    ? list[0].title
    : 'Цитаты из ' + plural(materialCount(list), 'материала', 'материалов', 'материалов');

export function AnswerText({
  id,
  text,
  sources,
  onCite,
  active,
  lead = false,
}: {
  id: string;
  text: string;
  sources?: ChatSource[];
  onCite: (list: ChatSource[], key: string) => void;
  active?: string;
  lead?: boolean;
}) {
  // All [N] of a block become one chip at its end; the chip shows how many materials, not citation numbers.
  const bare = (s: string) => s.replace(/\s*\[\d+\]/g, '');
  const chip = (s: string, k: string) => {
    const list = [...new Set([...s.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))]
      .map((n) => sources?.find((x) => x.number === n))
      .filter(Boolean) as ChatSource[];
    if (!list.length) return null;
    const key = id + '-' + k,
      names = [...new Set(list.map((x) => x.title))].join(', '),
      count = materialCount(list);
    return (
      <button
        key={key}
        type="button"
        className="footnote"
        aria-expanded={active === key}
        title={'Цитаты: ' + names}
        aria-label={'Цитаты: ' + names}
        onClick={() => onCite(list, key)}
      >
        <Quote size={12} aria-hidden="true" />
        {count > 1 ? <span>{count}</span> : null}
      </button>
    );
  };
  const blocks = answerBlocks(text),
    sectioned = blocks.some((b) => b.type === 'heading');
  // A theme in «Главное» whose bold lead names a section heading scrolls to that section.
  const norm = (s: string) =>
    s
      .replace(/[\s.:—–-]+$/, '')
      .trim()
      .toLocaleLowerCase('ru');
  const headingAt = new Map(
    blocks.flatMap((b, i) => (b.type === 'heading' ? [[norm(b.text), i] as const] : [])),
  );
  const goTo = (i: number) => {
    const el = document.getElementById(id + '-h' + i);
    if (!el) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
    if (!still)
      el.animate(
        [{ backgroundColor: 'var(--g-color-base-selection)' }, { backgroundColor: 'transparent' }],
        { duration: 1200 },
      );
  };
  const item = (it: { lead: string; text: string }, k: string, link = false) => {
    const target = link ? headingAt.get(norm(it.lead)) : undefined;
    const all = it.lead + ' ' + it.text;
    return (
      <>
        {target !== undefined ? (
          <>
            <button type="button" className="answer-topic-link" onClick={() => goTo(target)}>
              {bare(it.lead)}
              <ArrowDown size={14} aria-hidden="true" />
            </button>{' '}
          </>
        ) : it.lead ? (
          <>
            <strong>{bare(it.lead)}</strong>{' '}
          </>
        ) : null}
        {bare(it.text)}
        {chip(all, k)}
      </>
    );
  };
  // Item count after a topic heading, shown as a badge.
  const countAfter = (i: number) => {
    let n = 0;
    for (let j = i + 1; j < blocks.length && blocks[j].type !== 'heading'; j++) {
      const b = blocks[j];
      n += b.type === 'list' ? b.items.length : 1;
    }
    return n;
  };
  const render = (block: (typeof blocks)[number], i: number, badge = false) =>
    block.type === 'heading' ? (
      <h3 key={i} id={id + '-h' + i} tabIndex={-1}>
        {bare(block.text)}
        {badge ? <span className="answer-count">{countAfter(i)}</span> : null}
      </h3>
    ) : block.type === 'list' ? (
      <ul key={i}>
        {block.items.map((it, j) => (
          <li key={j}>{item(it, i + '-' + j)}</li>
        ))}
      </ul>
    ) : (
      <p key={i}>
        {bare(block.text)}
        {chip(block.text, String(i))}
      </p>
    );
  // A sectioned answer opens with «Главное»; «Выводы» and «Что осталось невыясненным» run until the next heading as cards.
  const groups: { kind?: string; items: [(typeof blocks)[number], number][] }[] = [];
  blocks.forEach((block, i) => {
    const kind =
      block.type === 'heading'
        ? block.text === METRICS_SECTION
          ? 'metrics'
          : CARD_SECTIONS[block.text]
        : undefined;
    if (kind || block.type === 'heading' || !groups.length) groups.push({ kind, items: [] });
    groups[groups.length - 1].items.push([block, i]);
  });
  const metrics = (g: (typeof groups)[number], n: number) => (
    <section key={n} className="answer-metrics">
      {g.items.map(([b, i]) =>
        b.type === 'heading' ? (
          render(b, i)
        ) : b.type === 'list' ? (
          <ul key={i} data-count={b.items.length}>
            {b.items.map((it, j) => {
              const m = it.lead
                ? { ...answerMetric(it.text), label: it.lead }
                : answerMetric(it.text);
              return (
                <li key={j}>
                  {m.label ? <span className="answer-metric-label">{bare(m.label)}</span> : null}
                  <strong
                    className={
                      'answer-metric-value' +
                      (bare(m.value).length > 16 ? ' answer-metric-value_long' : '')
                    }
                  >
                    {bare(m.value)}
                  </strong>
                  {m.note ? <span className="answer-metric-note">{bare(m.note)}</span> : null}
                  {chip(it.lead + ' ' + it.text, i + '-' + j)}
                </li>
              );
            })}
          </ul>
        ) : (
          render(b, i)
        ),
      )}
    </section>
  );
  const out = groups.map((g, n) =>
    g.kind === 'metrics' ? (
      metrics(g, n)
    ) : g.kind ? (
      <section key={n} className={'answer-card answer-card_' + g.kind}>
        {g.items.map(([b, i]) => render(b, i))}
      </section>
    ) : n === 0 && sectioned && g.items[0]?.[0].type === 'paragraph' ? (
      <div key="lead" className="answer-lead">
        <span>Главное</span>
        {g.items.map(([b, i]) =>
          b.type === 'list' ? (
            <ol key={i} className="answer-themes">
              {b.items.map((it, j) => (
                <li key={j}>{item(it, i + '-' + j, true)}</li>
              ))}
            </ol>
          ) : (
            render(b, i)
          ),
        )}
      </div>
    ) : (
      g.items.map(([b, i]) => render(b, i, b.type === 'heading'))
    ),
  );
  // The project summary has no headings, but its opening paragraph is still the main point.
  if (lead && !sectioned && blocks[0]?.type === 'paragraph')
    return (
      <div className="answer">
        <div className="answer-lead">
          <span>Главное</span>
          {render(blocks[0], 0)}
        </div>
        {blocks.slice(1).map((b, i) => render(b, i + 1))}
      </div>
    );
  return <div className={'answer' + (sectioned ? ' answer_sectioned' : '')}>{out}</div>;
}
