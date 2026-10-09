import { api, unwrap } from '@apex/shared-auth';

export const workdayNotesApi = {
  list: (page = 1, limit = 20) => unwrap(api.get('/workday-notes', { params: { page, limit } })),
  create: (content: string, idempotencyKey: string) =>
    unwrap(api.post('/workday-notes', { content, idempotencyKey })),
};
