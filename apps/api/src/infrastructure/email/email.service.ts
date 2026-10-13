import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';
import { SmtpConfig } from '../../config/configuration';
import { EmailDeliveryError, EmailNotConfiguredError } from './email.errors';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * The ONLY place allowed to talk SMTP (mirrors FeishuProvider for webhooks,
 * AGENTS.md §52 spirit). Transactional auth emails are sent synchronously:
 * the dev stack runs no standalone worker, and callers must surface delivery
 * failures immediately instead of silently queueing them.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  /** True when SMTP_HOST / SMTP_USER / SMTP_PASSWORD are all set. */
  isConfigured(): boolean {
    const smtp = this.smtpConfig();
    return smtp.host !== '' && smtp.user !== '' && smtp.password !== '';
  }

  async send(email: OutgoingEmail): Promise<void> {
    if (!this.isConfigured()) {
      throw new EmailNotConfiguredError();
    }
    const smtp = this.smtpConfig();
    const transporter = this.getTransporter(smtp);
    try {
      await transporter.sendMail({
        from: `"${smtp.fromName}" <${smtp.user}>`,
        to: email.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
    } catch (error) {
      // Never log mail bodies; the reason string is transport-level only.
      this.logger.warn(`SMTP delivery failed: ${String(error)}`);
      throw new EmailDeliveryError(String(error));
    }
    this.logger.debug(`verification email sent to ${email.to} (${email.subject})`);
  }

  private smtpConfig(): SmtpConfig {
    return {
      host: this.config.get<string>('app.smtp.host') ?? '',
      port: this.config.get<number>('app.smtp.port') ?? 465,
      secure: this.config.get<boolean>('app.smtp.secure') ?? true,
      user: this.config.get<string>('app.smtp.user') ?? '',
      password: this.config.get<string>('app.smtp.password') ?? '',
      fromName: this.config.get<string>('app.smtp.fromName') ?? 'WCIES',
    };
  }

  private getTransporter(smtp: SmtpConfig): Transporter {
    if (this.transporter === null) {
      this.transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: { user: smtp.user, pass: smtp.password },
        // Feishu SMTP can stall on bad networks; fail fast so callers retry.
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      });
    }
    return this.transporter;
  }
}
