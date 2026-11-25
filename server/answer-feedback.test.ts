import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createAnswerFeedback } from './answer-feedback.ts';

test('rating is optional, bound to the author and every source project, and removable', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(
      'CREATE TABLE mnema_workspaces(id TEXT PRIMARY KEY,name TEXT,data TEXT NOT NULL);CREATE TABLE user(id TEXT PRIMARY KEY,name TEXT)',
    );
    db.prepare("INSERT INTO user VALUES('u','Анна')").run();
    for (const id of ['a', 'b'])
      db.prepare('INSERT INTO mnema_workspaces VALUES(?,?,?)').run(
        id,
        'Проект ' + id,
        JSON.stringify({
          studies: [
            {
              id: 'material',
              title: 'Интервью 1',
              segments: [{ id: 's', text: 'Visible source' }],
            },
          ],
        }),
      );
    const api = createAnswerFeedback(db, 'fixture signing secret', 'fixture-build');
    const owner = {
      id: 'u',
      workspaces: [
        { id: 'a', role: 'view' },
        { id: 'b', role: 'full' },
      ],
    };
    const receipt = api.issue(owner, {
      scope: 'global',
      kind: 'generated',
      question: 'Вопрос?',
      answer: 'Ответ [1].',
      model: 'Test',
      projectIds: ['a', 'b'],
      references: [
        { workspaceId: 'a', studyId: 'material', segmentId: 's', text: 'Visible source' },
      ],
    });
    const rows = () => db.prepare('SELECT rating,example FROM mnema_answer_feedback').all();
    assert.equal(rows().length, 0);
    assert.throws(() => api.rate({ ...owner, id: 'other' }, receipt, 'up'));
    assert.throws(() =>
      api.rate({ ...owner, workspaces: owner.workspaces.slice(0, 1) }, receipt, 'up'),
    );
    assert.throws(() =>
      api.rate(
        { ...owner, workspaces: owner.workspaces.map((w) => ({ ...w, role: 'view' })) },
        receipt,
        'down',
      ),
    );
    assert.throws(() => api.rate(owner, receipt.replace(/^./, 'x'), 'up'));
    api.rate(owner, receipt, 'up');
    api.rate(owner, receipt, 'down');
    api.rate(owner, receipt, 'down');
    assert.equal(rows().length, 1);
    assert.equal(rows()[0].rating, 'down');
    assert.equal(JSON.parse(String(rows()[0].example)).answer, 'Ответ [1].');
    assert.deepEqual(
      api.list({ ...owner, workspaces: owner.workspaces.slice(0, 1) }),
      [],
      'review cannot reveal answers from a private project outside the reviewer membership',
    );
    assert.deepEqual(
      api.list({ ...owner, workspaces: owner.workspaces.map((w) => ({ ...w, role: 'view' })) }),
      [],
      'a full-access answer stays hidden after role downgrade',
    );
    const [item] = api.list(owner);
    assert.equal(item.rating, 'down');
    assert.equal(item.userName, 'Анна');
    assert.equal(item.question, 'Вопрос?');
    assert.deepEqual(
      item.projects.map((p) => p.name),
      ['Проект a', 'Проект b'],
    );
    assert.deepEqual(item.sources, [{ projectId: 'a', studyId: 'material', title: 'Интервью 1' }]);
    assert(
      !JSON.stringify(item).includes('fixture'),
      'No signature, build or author grants in the admin list',
    );
    api.rate(owner, receipt, null);
    assert.equal(rows().length, 0);
    api.rate(owner, receipt, 'up');
    api.forgetStudy('b', 'material');
    assert.equal(rows().length, 1);
    db.prepare('UPDATE mnema_workspaces SET data=? WHERE id=?').run('{"studies":[]}', 'a');
    api.forgetStudy('a', 'material');
    assert.equal(rows().length, 0);
    assert.throws(() => api.rate(owner, receipt, 'up'));
  } finally {
    db.close();
  }
});

test('feedback replay and review recheck currently visible source segments', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    "CREATE TABLE mnema_workspaces(id TEXT PRIMARY KEY,name TEXT,data TEXT NOT NULL);CREATE TABLE user(id TEXT PRIMARY KEY,name TEXT);INSERT INTO user VALUES('author','Author')",
  );
  db.prepare('INSERT INTO mnema_workspaces VALUES(?,?,?)').run(
    'project',
    'Project',
    JSON.stringify({
      studies: [
        {
          id: 'catalog',
          title: 'Imported title',
          segments: [{ id: 'visible', text: 'Synthetic source' }],
        },
      ],
    }),
  );
  let visible = true;
  const current = [
    {
      id: 'catalog',
      title: 'Imported title',
      segments: [{ id: 'visible', text: 'Synthetic source' }],
    },
  ];
  const api = createAnswerFeedback(db, 'fixture-secret', 'fixture', () => (visible ? current : [])),
    person = { id: 'author', workspaces: [{ id: 'project', role: 'view' }] };
  try {
    const token = api.issue(person, {
      scope: 'project',
      kind: 'generated',
      question: 'Question',
      answer: 'Restricted answer',
      model: 'Fixture',
      projectIds: ['project'],
      references: [
        {
          workspaceId: 'project',
          studyId: 'catalog',
          segmentId: 'visible',
          text: 'Synthetic source',
        },
      ],
    });
    api.rate(person, token, 'up');
    assert.equal(api.list(person).length, 1);
    visible = false;
    assert.deepEqual(api.list(person), []);
    assert.throws(() => api.rate(person, token, 'down'), /Источники или доступ/);
    api.rate(person, token, null);
    assert.equal(
      db.prepare('SELECT count(*) AS n FROM mnema_answer_feedback').get()!.n,
      0,
      'the author can still remove their rating after access changes',
    );
  } finally {
    db.close();
  }
});

test('feedback requires the current source text and retains unverifiable legacy rows', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(
      "CREATE TABLE mnema_workspaces(id TEXT PRIMARY KEY,name TEXT,data TEXT NOT NULL);CREATE TABLE user(id TEXT PRIMARY KEY,name TEXT);INSERT INTO user VALUES('author','Author')",
    );
    const source = {
      id: 'segment',
      text: 'Original fixture passage',
      correctedText: undefined as string | undefined,
    };
    const studies = [{ id: 'recording', title: 'Recording', segments: [source] }];
    db.prepare('INSERT INTO mnema_workspaces VALUES(?,?,?)').run(
      'project',
      'Project',
      JSON.stringify({ studies }),
    );
    const api = createAnswerFeedback(db, 'fixture-secret', 'fixture', () => studies);
    const person = { id: 'author', workspaces: [{ id: 'project', role: 'full' }] };
    const oldSource = { workspaceId: 'project', studyId: 'recording', segmentId: 'segment' };
    const example = {
      scope: 'project',
      kind: 'generated',
      question: 'Question',
      answer: 'Answer [1]',
      model: 'Fixture',
      projectIds: ['project'],
    } as const;
    const input = {
      ...example,
      projectIds: ['project'],
      references: [{ ...oldSource, text: source.text }],
    };
    const token = api.issue(person, input);
    api.rate(person, token, 'up');
    db.prepare('INSERT INTO mnema_answer_feedback VALUES(?,?,?,?,?)').run(
      'legacy',
      'author',
      'up',
      JSON.stringify({
        ...example,
        grants: [{ id: 'project', role: 'full' }],
        references: [oldSource],
      }),
      0,
    );
    assert.equal(
      api.list(person).length,
      1,
      'legacy answers without a source revision stay out of review',
    );
    source.correctedText = 'Updated fixture passage';
    assert.deepEqual(api.list(person), []);
    assert.throws(
      () => api.issue(person, input),
      { status: 409 },
      'cannot label an old model answer with the new text',
    );
    assert.throws(() => api.rate(person, token, 'down'), { status: 409 });
    const current = api.issue(person, {
      ...input,
      references: [{ ...oldSource, text: source.correctedText }],
    });
    api.rate(person, current, 'up');
    assert.equal(api.list(person).length, 1);
    api.rate(person, token, null);
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM mnema_answer_feedback WHERE answer_id='legacy'").get()!
        .n,
      1,
    );
  } finally {
    db.close();
  }
});
