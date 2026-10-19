import { HomeExperienceService } from '../../src/modules/platform/dashboard/home-experience.service';

function service() {
  return new HomeExperienceService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { companyToday: () => '2026-10-19' } as any,
    {} as any,
  );
}

describe('Home workspace daily essential', () => {
  it('returns only the first saved essential from the former five-link format', () => {
    const result = (service() as any).workspaceEssentials([
      { id: 'one', label: 'Company mail', url: 'https://mail.example.com' },
      { id: 'two', label: 'Old second link', url: 'https://example.com/two' },
    ]);

    expect(result).toEqual([
      { id: 'one', label: 'Company mail', url: 'https://mail.example.com' },
    ]);
  });

  it('creates one empty essential for a workspace without saved links', () => {
    expect((service() as any).workspaceEssentials(null)).toEqual([
      { id: 'essential-1', label: 'Essential 1', url: '' },
    ]);
  });

  it('rejects attempts to save more than one essential', async () => {
    await expect(service().updateWorkspace('user-1', {
      essentials: [
        { id: 'one', label: 'One', url: 'https://example.com/one' },
        { id: 'two', label: 'Two', url: 'https://example.com/two' },
      ],
    })).rejects.toThrow('Workspace must contain exactly one essential');
  });
});

describe('Home workspace sticky notes', () => {
  it('upgrades the former three-text-note format into six dated note cards', () => {
    const result = (service() as any).workspaceNotes(
      JSON.stringify({ version: 1, items: ['Remember the review', '', 'Call the client'] }),
      new Date('2026-10-19T06:30:00.000Z'),
    );

    expect(result).toHaveLength(6);
    expect(result[0]).toMatchObject({ id: 'note-1', title: 'Note 1', content: 'Remember the review', createdAt: '2026-10-19T06:30:00.000Z' });
    expect(result[2]).toMatchObject({ id: 'note-3', content: 'Call the client' });
    expect(result[5]).toMatchObject({ id: 'note-6', content: '', createdAt: null });
  });

  it('rejects more than six notes', async () => {
    await expect(service().updateWorkspace('user-1', {
      notes: Array.from({ length: 7 }, (_, index) => `Note ${index + 1}`),
    })).rejects.toThrow('Workspace can contain up to six notes');
  });
});
