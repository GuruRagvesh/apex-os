import { MeetingService } from '../../src/modules/platform/workday/meeting.service';

describe('MeetingService meeting-history identity snapshots', () => {
  it('returns the captured names after linked user accounts have been deleted', async () => {
    const prisma: any = {
      meeting: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'meeting-1',
            organizerId: 'deleted-account',
            organizerNameSnapshot: 'Asha Rao',
            counterpartyId: 'deleted-account',
            counterpartyNameSnapshot: 'Vikram Sen',
            organizer: { id: 'deleted-account', name: 'Deleted account' },
            counterparty: { id: 'deleted-account', name: 'Deleted account' },
            participants: [
              {
                id: 'participant-1',
                userId: null,
                displayNameSnapshot: 'Neha Shah',
                user: null,
              },
            ],
          },
        ]),
      },
    };

    const result = await new MeetingService(prisma).list('viewer-1');

    expect(result[0].organizer.name).toBe('Asha Rao');
    expect(result[0].counterparty.name).toBe('Vikram Sen');
    expect(result[0].participants[0].user.name).toBe('Neha Shah');
  });

  it('captures organizer, counterparty and attendee names when a meeting is recorded', async () => {
    const actor = {
      id: 'organizer-1',
      name: 'Asha Rao',
      isActive: true,
      departmentId: 'department-1',
      department: { id: 'department-1', name: 'Retail' },
      role: { name: 'TEAM_LEAD' },
    };
    const counterparty = { id: 'counterparty-1', name: 'Vikram Sen', isActive: true };
    const startAt = new Date('2026-10-14T08:00:00.000Z');
    const endAt = new Date('2026-10-14T08:30:00.000Z');
    const meetingCreate = jest.fn().mockResolvedValue({ id: 'meeting-1' });
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue(actor),
        findFirst: jest.fn().mockResolvedValue(counterparty),
      },
      breakLog: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'break-1',
          startAt,
          endAt,
          meetingId: null,
        }),
      },
      $transaction: jest.fn(async (work: (tx: any) => Promise<unknown>) => work({
        meeting: {
          create: meetingCreate,
          findUnique: jest.fn().mockResolvedValue({
            id: 'meeting-1',
            organizerNameSnapshot: actor.name,
            counterpartyNameSnapshot: counterparty.name,
            organizer: actor,
            counterparty,
            participants: [],
          }),
        },
        breakLog: { update: jest.fn().mockResolvedValue({}) },
      })),
    };

    await new MeetingService(prisma).classify(actor.id, {
      breakLogId: 'break-1',
      mode: 'NEW',
      counterpartyId: counterparty.id,
      topic: 'Quarterly planning',
      meetingType: 'INTERNAL',
    });

    expect(meetingCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizerId: actor.id,
        organizerNameSnapshot: actor.name,
        counterpartyId: counterparty.id,
        counterpartyNameSnapshot: counterparty.name,
        participants: {
          create: [
            { userId: actor.id, displayNameSnapshot: actor.name },
            { userId: counterparty.id, displayNameSnapshot: counterparty.name },
          ],
        },
      }),
    });
  });
});
