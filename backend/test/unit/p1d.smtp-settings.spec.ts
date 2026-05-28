import { BadRequestException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { EmailService } from '../../src/modules/platform/email/email.service';

const mockSendMail = jest.fn();

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

describe('P1-D SMTP settings source of truth', () => {
  const prisma: any = {
    appSetting: { findUnique: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMail.mockResolvedValue({});
  });

  it('creates the transporter from persisted SMTP settings for test email', async () => {
    prisma.appSetting.findUnique.mockResolvedValue({
      value: { host: 'smtp.example.com', port: '587', email: 'ops@example.com', password: 'secret' },
    });
    const service = new EmailService(prisma);

    const result = await service.sendTestEmail();

    expect(result.ok).toBe(true);
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'ops@example.com', pass: 'secret' },
    });
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ops@example.com',
      subject: 'Apex OS SMTP test',
    }));
  });

  it('fails cleanly when persisted SMTP settings are incomplete', async () => {
    prisma.appSetting.findUnique.mockResolvedValue({
      value: { host: 'smtp.example.com', port: '587', email: '', password: '' },
    });
    const service = new EmailService(prisma);

    await expect(service.sendTestEmail()).rejects.toThrow(BadRequestException);
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });
});
