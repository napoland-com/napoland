import { describe, expect, it } from 'vitest';
import { checkRoadmap, findCycles, formatRoadmap, parseFrontMatter } from '../validate-roadmap';

/** A roadmap file with this front matter and a body. */
const file = (name: string, front: string, body = 'What it is and why.') => ({ file: `roadmap/${name}.md`, text: `---\n${front}\n---\n\n${body}\n` });
/** A sound item; `extra` adds front matter lines. */
const item = (id: string, status = 'planned', order = 10, extra = '') =>
  file(id, [`id: ${id}`, `title: The ${id}`, `status: ${status}`, `order: ${order}`, extra].filter(Boolean).join('\n'));

const problems = (files: { file: string; text: string }[], level: 'error' | 'warning' = 'error') =>
  checkRoadmap(files).problems.filter(p => p.level === level).map(p => `${p.file}: ${p.message}`);

describe('parseFrontMatter', () => {
  it('reads plain and quoted values, both kinds of list and comments', () => {
    const { fields, body, errors } = parseFrontMatter([
      '---',
      '# a comment',
      'id: sign-in',
      'title: "Home: stash, XP and \\"levels\\""',
      "area: 'it''s'",
      'order: 10 # comment',
      'depends: [a, "b", c-d]',
      'other:',
      '  - x',
      '  - "y"',
      '---',
      'Body.',
    ].join('\r\n'));
    expect(errors).toEqual([]);
    expect(Object.fromEntries(fields)).toEqual({
      id: 'sign-in', title: 'Home: stash, XP and "levels"', area: "it's", order: '10', depends: ['a', 'b', 'c-d'], other: ['x', 'y'],
    });
    expect(body.trim()).toBe('Body.');
  });

  it('refuses a file without front matter, or with no end to it', () => {
    expect(parseFrontMatter('# Title\n').errors[0]).toMatch(/no front matter/);
    expect(parseFrontMatter('---\nid: a\n').errors[0]).toMatch(/never ends/);
  });

  it('asks for quotes where YAML would read a plain value as syntax', () => {
    expect(parseFrontMatter('---\ntitle: Home: the stash\n---\n').errors[0]).toMatch(/line 2: put Home: the stash in "quotes"/);
    expect(parseFrontMatter('---\ntitle: *star\n---\n').errors[0]).toMatch(/in "quotes"/);
    expect(parseFrontMatter('---\ntitle: https://www.napoland.com\n---\n').errors).toEqual([]);
  });

  it('refuses what it does not understand instead of guessing', () => {
    expect(parseFrontMatter('---\nid: a\nid: b\n---\n').errors).toEqual(['line 3: "id" is there twice']);
    expect(parseFrontMatter('---\n  id: a\n---\n').errors[0]).toMatch(/line 2: expected "field: value"/);
    expect(parseFrontMatter('---\n- a\n---\n').errors[0]).toMatch(/list item must come right under its field/);
    expect(parseFrontMatter('---\ndepends: [a, b\n---\n').errors[0]).toMatch(/must end with \]/);
    expect(parseFrontMatter('---\ntitle: "open\n---\n').errors[0]).toMatch(/never closed/);
  });
});

describe('checkRoadmap', () => {
  it('accepts a sound roadmap and sorts it by status, then order, then id', () => {
    const { items, problems: found } = checkRoadmap([
      item('chat', 'planned', 30, 'depends: [sign-in]'),
      item('sign-in', 'now', 10, 'area: tech'),
      item('finds', 'done', 50),
      item('equipment', 'planned', 10),
      item('seasons', 'idea', 10),
      item('home', 'next', 10, 'depends:\n  - finds'),
      item('creatures', 'planned', 10),
    ]);
    expect(found).toEqual([expect.objectContaining({ level: 'warning', message: 'order 10 is also used by creatures (both planned); ties sort by id' })]);
    expect(items.map(i => i.id)).toEqual(['finds', 'sign-in', 'home', 'creatures', 'equipment', 'chat', 'seasons']);
    expect(items.find(i => i.id === 'sign-in')).toEqual({ id: 'sign-in', title: 'The sign-in', status: 'now', order: 10, depends: [], area: 'tech', file: 'roadmap/sign-in.md' });
    expect(items.find(i => i.id === 'home')?.depends).toEqual(['finds']);
  });

  it('wants the id to be the file name, and the file name to be an id', () => {
    expect(problems([file('chat', 'id: talk\ntitle: Chat\nstatus: idea\norder: 10')])).toEqual(['roadmap/chat.md: id "talk" must be the file name without .md ("chat")']);
    expect(problems([file('Big Idea', 'id: big-idea\ntitle: Big\nstatus: idea\norder: 10')])[0]).toMatch(/file name must be the id/);
  });

  it('knows its fields, its statuses and that order is a number', () => {
    expect(problems([item('a', 'someday')])).toEqual(['roadmap/a.md: status "someday" is not one of done, now, next, planned, idea']);
    expect(problems([file('a', 'id: a\ntitle: A\nstatus: idea\norder: soon')])).toEqual(['roadmap/a.md: order "soon" must be a number, like 10']);
    expect(problems([item('a', 'idea', 10, 'owner: me')])[0]).toMatch(/unknown field "owner"/);
    expect(problems([file('a', 'id: a\nstatus: idea\norder: 10')])).toEqual(['roadmap/a.md: "title" is missing']);
    expect(problems([item('a', 'idea', 10, 'area: Game Play')])[0]).toMatch(/area "Game Play" must be a lowercase word/);
    expect(problems([file('a', 'id: a\ntitle: A\nstatus: idea\norder: 10', ' ')])[0]).toMatch(/body is empty/);
  });

  it('reports a value it cannot read once, not also as missing', () => {
    expect(problems([file('a', 'id: a\ntitle: Home: the stash\nstatus: idea\norder: 10')])).toEqual([
      'roadmap/a.md: line 3: put Home: the stash in "quotes" (YAML would read part of it as syntax)',
    ]);
  });

  it('finds dependencies on items that do not exist', () => {
    expect(problems([item('a', 'idea', 10, 'depends: [b, nowhere]'), item('b', 'idea', 20)])).toEqual([
      'roadmap/a.md: depends on "nowhere", which is not a roadmap item (no roadmap/nowhere.md)',
    ]);
  });

  it('does not blame the items that depend on a broken one', () => {
    expect(problems([item('a', 'idea', 10, 'depends: [b]'), file('b', 'id: b\ntitle: B\nstatus: someday\norder: 10')])).toEqual([
      'roadmap/b.md: status "someday" is not one of done, now, next, planned, idea',
    ]);
  });

  it('finds dependencies that go round in a circle', () => {
    expect(problems([
      item('a', 'idea', 10, 'depends: [b]'),
      item('b', 'idea', 20, 'depends: [c]'),
      item('c', 'idea', 30, 'depends: [a]'),
      item('d', 'idea', 40, 'depends: [a]'),
    ])).toEqual(['roadmap/a.md: dependencies go round in a circle: a -> b -> c -> a']);
    expect(problems([item('a', 'idea', 10, 'depends: [a]')])).toEqual(['roadmap/a.md: an item cannot depend on itself']);
  });

  it('warns when an item comes before something it depends on', () => {
    expect(problems([item('a', 'next', 10, 'depends: [b]'), item('b', 'planned', 10)], 'warning')).toEqual([
      'roadmap/a.md: a is next but depends on b, which is planned',
    ]);
  });
});

describe('findCycles', () => {
  it('finds each circle once and ignores unknown ids', () => {
    const graph = new Map([['a', ['b']], ['b', ['a', 'x']], ['c', ['c']], ['d', ['e']], ['e', ['d']]]);
    expect(findCycles(graph)).toEqual([['a', 'b', 'a'], ['d', 'e', 'd']]);
  });
});

describe('formatRoadmap', () => {
  it('prints one block per status with order, id, title, area and dependencies', () => {
    const { items } = checkRoadmap([item('home', 'next', 10, 'area: gameplay\ndepends: [finds]'), item('finds', 'done', 50)]);
    expect(formatRoadmap(items)).toBe([
      'Roadmap: 2 items (1 done, 0 now, 1 next, 0 planned, 0 idea)',
      '',
      'DONE',
      '  50  finds  The finds',
      '',
      'NEXT',
      '  10  home   The home  [gameplay]  after finds',
    ].join('\n'));
  });
});
