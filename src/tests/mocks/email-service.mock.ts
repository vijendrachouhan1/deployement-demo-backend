import { vi } from "vitest";

export const mockEmailService = {
  sendEmail: vi.fn(),
  sendTemplateEmail: vi.fn(),
};

class EmailService {
  sendEmail = mockEmailService.sendEmail;
  sendTemplateEmail = mockEmailService.sendTemplateEmail;
}

vi.mock("@/providers/email", () => ({
  EmailService,
  emailService: mockEmailService,
}));
