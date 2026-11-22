import type { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { createChatHistory } from '../chat-history.ts';
import { chatEvidence, type collectGlobalResearch } from '../global-research.ts';
import { fail, handledJson, text } from '../http.ts';
import { answerSystem, requestChatAnswer } from '../model-connections.ts';
import type { Person, RequestServices } from '../request-context.ts';
import { selectEvidence } from '../retrieval.ts';
import { answerTemplate } from './prompt.ts';

interface ChatServices extends RequestServices {
  view: (person: Person) => { state: any };
  ratedReply: (
    person: Person,
    question: string,
    scope: 'global' | 'project',
    reply: any,
    modelId?: string,
  ) => any;
  callModel: (person: Person, model: any, payload: any, workspace?: string) => Promise<any>;
}
interface GlobalChatServices extends ChatServices {
  chats: ReturnType<typeof createChatHistory>;
  scopedPerson: (person: Person) => Person;
  wsStore: Pick<AsyncLocalStorage<string>, 'run'>;
  globalResearch: (person: Person) => ReturnType<typeof collectGlobalResearch>;
}
export function isGlobalChatPath(path: string) {
  return (
    path === '/api/chats' ||
    path.startsWith('/api/chats/') ||
    path === '/api/research-library' ||
    path === '/api/research-context' ||
    path === '/api/chat/global'
  );
}
export async function handleGlobalChat(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  person: Person,
  {
    chats,
    body,
    session,
    limit,
    scopedPerson,
    wsStore,
    view,
    globalResearch,
    ratedReply,
    callModel,
  }: GlobalChatServices,
) {
  if (path === '/api/chats' && req.method === 'GET')
    return handledJson(res, 200, { chats: chats.list(scopedPerson(person)) });
  if (path === '/api/chats' && req.method === 'POST') {
    const b = await body(req);
    const latest = await session(req);
    if (!latest) fail(401, 'Войдите в Мнемодак.');
    limit('create-chat:' + latest.id, 30);
    return handledJson(
      res,
      201,
      chats.create(scopedPerson(latest), typeof b?.projectId === 'string' ? b.projectId : null),
    );
  }
  if (/^\/api\/chats\/[^/]+$/.test(path)) {
    const id = path.split('/')[3];
    if (req.method === 'GET') return handledJson(res, 200, chats.get(scopedPerson(person), id));
    if (req.method === 'DELETE') {
      chats.remove(scopedPerson(person), id);
      return handledJson(res, 200, { ok: true });
    }
    fail(405, 'Метод недоступен.');
  }
  if (path === '/api/research-library' && req.method === 'GET') {
    const projects = person.workspaces.map((project) =>
      wsStore.run(project.id, () => {
        const state = view({
          ...person,
          workspaceId: project.id,
          role: project.role,
          admin: project.admin,
        }).state;
        return {
          ...project,
          studies: state.studies.map((study) => ({ ...study, segments: [], summary: [] })),
          findings: state.findings,
        };
      }),
    );
    return handledJson(res, 200, { projects });
  }
  if (path === '/api/research-context' && req.method === 'GET') {
    limit('global-context:' + person.id, 30);
    const research = globalResearch(person);
    return handledJson(res, 200, {
      projects: research.projects,
      materials: research.materials,
      model: research.model?.name || null,
    });
  }
  if (path === '/api/chat/global' && req.method === 'POST') {
    limit('chat:' + person.id, 10);
    const b = await body(req),
      question = text(b.question, 2000);
    if (!question) fail(400, 'Напишите вопрос.');
    const current = await session(req);
    if (!current) fail(401, 'Войдите в Мнемодак.');
    const chatId = typeof b.chatId === 'string' ? b.chatId : null;
    const chat = chatId ? chats.acquire(scopedPerson(current), chatId) : null;
    try {
      const prior = (chat?.messages || []).slice(-12).map((m) => ({
        role: m.role,
        content: String(m.role === 'user' ? m.text : m.answer).slice(0, 3000),
      }));
      const retrievalQuestion = [
        ...(chat?.messages || [])
          .filter((m) => m.role === 'user')
          .slice(-2)
          .map((m) => m.text),
        question,
      ].join(' ');
      const research = globalResearch(
        current.sharedProject && chat?.projectId === current.sharedProject.id
          ? { ...current, workspaces: [current.sharedProject] }
          : current,
      );
      const { sources, coverage, reviewedFindings } = chatEvidence(
        research,
        retrievalQuestion,
        chat?.projectId,
      );
      const finish = async (reply: any) => {
        const found = await session(req);
        if (!found) fail(401, 'Войдите в Мнемодак.');
        const latest = scopedPerson(found);
        if (
          current.workspaces.some((before) => {
            const access = latest.workspaces.find((w) => w.id === before.id);
            return !access || (before.role === 'full' && access.role !== 'full');
          })
        )
          fail(409, 'Доступ к проектам изменился. Начните новый чат.');
        const rated = ratedReply(latest, question, 'global', reply, research.model?.model);
        return handledJson(
          res,
          200,
          chatId ? { ...rated, chat: chats.append(latest, chatId, question, rated) } : rated,
        );
      };
      if (!sources.length)
        return await finish({
          answer: chat?.projectId
            ? 'В этом проекте ничего не найдено по этому вопросу.\n\nПопробуйте переформулировать вопрос или спросите в общем чате — он ищет по всем проектам.'
            : 'Прямых данных нет: в доступных исследованиях не найдено фрагментов по этому вопросу.\n\nЧто осталось невыясненным\n- Попробуйте другую формулировку или добавьте материалы в проект.',
          sources: [],
          coverage,
          model: research.model?.name || 'Мнемодак',
        });
      if (!research.model)
        fail(503, 'Модель ещё не подключена. Попросите владельца проекта настроить подключение.');
      const result = await requestChatAnswer(
        research.model,
        {
          model: research.model.model,
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content:
                answerSystem(answerTemplate, research.model.instructions) +
                ' Предыдущие сообщения нужны для понимания уточнений. Доказательства и номера сносок для нового ответа бери только из текущего набора sources; номера в прошлых ответах относятся к прошлым наборам. Материалы относятся к разным проектам. Учитывай названия проектов, аудиторию и тип источника; не переноси выводы между ними без оговорки. Не утверждай, что изучил все материалы целиком: предоставлены фрагменты.',
            },
            ...prior,
            {
              role: 'user',
              content: JSON.stringify({
                question,
                coverage,
                reviewed_findings: reviewedFindings,
                sources: sources.map((s) => ({
                  number: s.number,
                  project: s.workspaceName,
                  type: s.studyType,
                  basis: s.basis,
                  title: s.title,
                  time: s.time,
                  page: s.page,
                  speaker: s.speaker,
                  text: s.text,
                  ...(s.uncertain && s.correctedText === undefined ? { uncertain: true } : {}),
                })),
              }),
            },
          ],
        },
        async (payload) => {
          const current = await session(req);
          if (
            !current ||
            !scopedPerson(current).workspaces.some((w) => w.id === research.modelWorkspaceId) ||
            sources.some((source) => {
              const access = scopedPerson(current).workspaces.find(
                  (w) => w.id === source.workspaceId,
                ),
                before = person.workspaces.find((w) => w.id === source.workspaceId);
              return !access || (before?.role === 'full' && access.role !== 'full');
            })
          )
            fail(409, 'Доступ к проектам изменился. Обновите страницу и повторите вопрос.');
          return callModel(person, research.model, payload, research.modelWorkspaceId);
        },
      );
      const answer = result.choices?.[0]?.message?.content;
      if (typeof answer !== 'string')
        fail(502, 'Модель вернула неожиданный ответ. Повторите вопрос.');
      const latest = await session(req);
      if (
        !latest ||
        !scopedPerson(latest).workspaces.some((w) => w.id === research.modelWorkspaceId) ||
        sources.some((source) => {
          const access = scopedPerson(latest).workspaces.find((w) => w.id === source.workspaceId);
          const before = person.workspaces.find((w) => w.id === source.workspaceId);
          return !access || (before?.role === 'full' && access.role !== 'full');
        })
      )
        fail(409, 'Доступ к проектам изменился. Обновите страницу и повторите вопрос.');
      return await finish({
        answer,
        sources,
        coverage,
        model: (result.mnemaModel || research.model).name,
        usage: result.usage,
      });
    } finally {
      if (chatId) chats.release(chatId);
    }
  }
  return false;
}
interface ProjectChatServices extends ChatServices {
  getState: () => { state: any };
  reportOf: (study: any) => 'ready' | 'none';
  modelKey: (model: any) => string | null;
}
export async function handleProjectChat(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  person: Person,
  {
    limit,
    body,
    session,
    getState,
    view,
    reportOf,
    ratedReply,
    modelKey,
    callModel,
  }: ProjectChatServices,
) {
  if (path === '/api/chat' && req.method === 'POST') {
    limit('chat:' + person.id, 10);
    const b = await body(req),
      question = text(b.question, 2000);
    if (!question) fail(400, 'Напишите вопрос.');
    const { state } = getState();
    const model = state.models.find((m) => m.id === (b.modelId || state.modelId) && m.enabled);
    if (!model) fail(400, 'Выберите включённую модель.');
    const key = modelKey(model);
    if (!key || !model.model)
      fail(503, 'Модель ещё не подключена. Владелец должен указать её идентификатор и API-ключ.');
    const corpus = view(person).state;
    const { sources, coverage, reviewedFindings } = selectEvidence(
      corpus.studies,
      question,
      b.scope || 'all',
      corpus.findings,
    );
    if (!sources.length)
      return handledJson(
        res,
        200,
        ratedReply(
          person,
          question,
          'project',
          {
            answer:
              'Прямых данных нет: в доступных материалах не найдено фрагментов по этому вопросу.\n\nЧто осталось невыясненным\n- Возможно, вопрос сформулирован другими словами, чем в материалах. Попробуйте другую формулировку.\n- Возможно, такого исследования в Мнемодаке ещё нет.',
            sources: [],
            model: model.name,
          },
          model.model,
        ),
      );
    const result = await requestChatAnswer(
      model,
      {
        model: model.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: answerSystem(answerTemplate, model.instructions) },
          {
            role: 'user',
            content: JSON.stringify({
              question,
              coverage,
              reviewed_findings: reviewedFindings,
              instruction: coverage.sampled
                ? 'Доступна выборка фрагментов проекта. Не утверждай, что изучил все материалы целиком. Укажи ограничение выборки.'
                : undefined,
              sources: sources.map((s, i) => {
                const st = state.studies.find((x) => x.id === s.studyId);
                return {
                  number: i + 1,
                  type: st.type,
                  basis: reportOf(st) === 'ready' ? 'report' : 'raw',
                  title: s.title,
                  time: s.time,
                  page: s.page,
                  speaker: s.speaker,
                  text: s.text,
                  ...(s.uncertain && s.correctedText === undefined ? { uncertain: true } : {}),
                };
              }),
            }),
          },
        ],
      },
      async (payload) => {
        const current = await session(req);
        if (
          !current ||
          current.workspaceId !== person.workspaceId ||
          (person.role === 'full' && current.role !== 'full')
        )
          fail(409, 'Доступ к проекту изменился. Обновите страницу и повторите вопрос.');
        return callModel(person, model, payload);
      },
    );
    const answer = result.choices?.[0]?.message?.content;
    if (typeof answer !== 'string')
      fail(502, 'Модель вернула неожиданный ответ. Повторите вопрос.');
    const latest = await session(req);
    if (
      !latest ||
      latest.workspaceId !== person.workspaceId ||
      (person.role === 'full' && latest.role !== 'full')
    )
      fail(409, 'Доступ к проекту изменился. Обновите страницу и повторите вопрос.');
    return handledJson(
      res,
      200,
      ratedReply(
        person,
        question,
        'project',
        {
          answer,
          sources: sources.map(({ score, ...s }, i) => {
            const st = state.studies.find((x) => x.id === s.studyId);
            return {
              ...s,
              number: i + 1,
              segmentId: s.id,
              studyType: st.type,
              basis: reportOf(st) === 'ready' ? 'report' : 'raw',
            };
          }),
          model: (result.mnemaModel || model).name,
          coverage,
          usage: result.usage,
        },
        (result.mnemaModel || model).model,
      ),
    );
  }
  return false;
}
