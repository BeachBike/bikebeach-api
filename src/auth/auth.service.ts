import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role } from '@prisma/client';
import { compare, hash } from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PASSWORD_RESET_TOKEN_TTL_MINUTES } from '../common/constants';
import { encryptCpf } from '../common/cpf-crypto';
import { MailerService } from '../mailer/mailer.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SignupDto } from './dto/signup.dto';
import type { JwtPayload } from './types/jwt-payload.type';

const BCRYPT_ROUNDS = 12;
const REFRESH_TOKEN_BYTES = 48;
const RESET_TOKEN_BYTES = 32;

/// Pre-computed bcrypt hash of a string that's not a valid password (random
/// bytes longer than the 72-char ceiling that the signup DTO accepts).
/// `login` runs `bcrypt.compare` against this when the user lookup fails,
/// so the response latency is the same whether the account exists or not —
/// closes the timing channel that would otherwise let an attacker enumerate
/// e-mails by measuring how fast `/auth/login` responds.
const DUMMY_BCRYPT_HASH =
  '$2b$12$abcdefghijklmnopqrstuOiQmoEzkA/4tzL35h5O.fX5UfMmgKDi6';

export interface UserForToken {
  id: string;
  email: string;
  role: Role;
  unitId: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  user: UserForToken;
}

export interface ForgotPasswordResult {
  /// Always present even when the e-mail isn't registered, to avoid leaking
  /// account existence. Truthy only when an actual token was issued.
  emailSent: boolean;
  /// Returned in dev for testing — never expose to the wire in production
  /// (Resend will deliver the e-mail). Gated by NODE_ENV.
  devToken?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mailer: MailerService,
  ) {}

  async signup(
    dto: SignupDto,
    ip?: string,
    userAgent?: string,
  ): Promise<TokenPair> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('E-mail já cadastrado');
    }

    // Encrypt CPF before any DB touch. The column stores the AES-GCM
    // ciphertext (LGPD); the encryption is deterministic, so the existing
    // `@unique` constraint still enforces no-duplicates. The pre-check
    // lookup must use the SAME ciphertext the insert will write.
    const encryptedCpf = dto.cpf ? encryptCpf(dto.cpf) : null;
    if (encryptedCpf) {
      const byCpf = await this.prisma.user.findFirst({
        where: { cpf: encryptedCpf },
        select: { id: true },
      });
      if (byCpf) {
        throw new ConflictException('CPF já cadastrado');
      }
    }

    const passwordHash = await hash(dto.password, BCRYPT_ROUNDS);
    
    // Parse "YYYY-MM-DD" as **UTC midnight** so the stored instant is the
    // same wall-clock date in every viewer's timezone. Previously this used
    // `new Date(y, m-1, d)` which anchors to the API process's local TZ —
    // on Railway (UTC) the stored value rendered as the previous day in
    // Brazilian browsers (off-by-one bug on birthDates).
    const birthDate = dto.birthDate
      ? (() => {
          const [year, month, day] = dto.birthDate.split('-');
          return new Date(
            Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)),
          );
        })()
      : undefined;

    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash,
          name: dto.name,
          phone: dto.phone,
          cpf: encryptedCpf,
          birthDate,
          goal: dto.goal,
          fitnessLevel: dto.fitnessLevel,
          role: Role.USER,
        },
      });
    } catch (err) {
      // Safety net for the race window between the pre-check above and the
      // insert (two near-simultaneous signups with the same CPF).
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const target = (err.meta?.target as string[] | undefined)?.[0];
        if (target === 'cpf') throw new ConflictException('CPF já cadastrado');
        if (target === 'email') throw new ConflictException('E-mail já cadastrado');
        throw new ConflictException('Valor já em uso');
      }
      throw err;
    }

    void this.mailer
      .send({
        template: 'WELCOME',
        to: user.email,
        userId: user.id,
        payload: {
          name: user.name,
          email: user.email,
          appUrl: this.appUrl(),
        },
      })
      .catch((err) =>
        this.logger.warn(`welcome email skipped for ${user.email}: ${(err as Error).message}`),
      );

    return this.issueTokenPair(user, ip, userAgent);
  }

  async login(
    dto: LoginDto,
    ip?: string,
    userAgent?: string,
  ): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    // Run bcrypt.compare unconditionally — when the user doesn't exist we
    // compare against a fixed dummy hash so the response latency leaks
    // nothing about which e-mails are registered. The result is ignored in
    // the "no user" branch; the unified UnauthorizedException below covers
    // both cases.
    const ok = await compare(
      dto.password,
      user?.passwordHash ?? DUMMY_BCRYPT_HASH,
    );
    if (!user || !user.isActive || !ok) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    return this.issueTokenPair(user, ip, userAgent);
  }

  async refresh(
    rawToken: string,
    ip?: string,
    userAgent?: string,
  ): Promise<Omit<TokenPair, 'user'>> {
    const tokenHash = this.hashToken(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!stored) {
      throw new UnauthorizedException('Refresh token inválido');
    }
    if (stored.revokedAt) {
      // Reuse of an already-rotated token => treat as compromise.
      this.logger.warn(
        `Refresh token reuse detected for user ${stored.userId}`,
      );
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token revogado');
    }
    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expirado');
    }
    if (!stored.user.isActive) {
      throw new UnauthorizedException();
    }

    const { accessToken, refreshToken, refreshExpiresAt } = await this.buildPair(
      stored.user,
    );

    await this.prisma.$transaction([
      this.prisma.refreshToken.create({
        data: {
          userId: stored.user.id,
          tokenHash: this.hashToken(refreshToken),
          expiresAt: refreshExpiresAt,
          createdByIp: ip,
          userAgent,
        },
      }),
      this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { accessToken, refreshToken };
  }

  async logout(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /// Always returns 200 even when the e-mail doesn't exist (don't leak account
  /// existence). When the user IS found, generates a single-use token, hashes
  /// it, persists with TTL. The raw token is what would be e-mailed to the
  /// user (Resend wiring deferred to Phase 6).
  async forgotPassword(
    dto: ForgotPasswordDto,
    ip?: string,
    userAgent?: string,
  ): Promise<ForgotPasswordResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || !user.isActive) {
      return { emailSent: false };
    }

    const rawToken = randomBytes(RESET_TOKEN_BYTES).toString('base64url');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(
      Date.now() + PASSWORD_RESET_TOKEN_TTL_MINUTES * 60_000,
    );

    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    this.logger.log(
      `Password reset token issued for ${user.email} (TTL ${PASSWORD_RESET_TOKEN_TTL_MINUTES}m)`,
    );

    void this.mailer
      .send({
        template: 'PASSWORD_RESET',
        to: user.email,
        userId: user.id,
        payload: {
          name: user.name,
          resetUrl: `${this.appUrl()}/conta?reset=${encodeURIComponent(rawToken)}`,
          expiresInMinutes: PASSWORD_RESET_TOKEN_TTL_MINUTES,
          requestedFromIp: ip ?? null,
          userAgent: userAgent ?? null,
        },
      })
      .catch((err) =>
        this.logger.warn(`password-reset email skipped for ${user.email}: ${(err as Error).message}`),
      );

    // In non-production we still expose the raw token in the response so the
    // frontend / tests can wire the flow without parsing e-mails.
    const devToken =
      process.env.NODE_ENV !== 'production' ? rawToken : undefined;

    return { emailSent: true, devToken };
  }

  private appUrl(): string {
    return (this.config.get<string>('APP_URL') ?? 'http://localhost:5173').replace(/\/$/, '');
  }

  /// Validates token + TTL + single-use, sets new password, marks token used,
  /// revokes all active refresh tokens (force re-login on every device).
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = this.hashToken(dto.token);
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Token inválido ou expirado');
    }
    if (!stored.user.isActive) {
      throw new UnauthorizedException();
    }

    const passwordHash = await hash(dto.password, BCRYPT_ROUNDS);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: stored.userId },
        // `passwordChangedAt = now` invalidates every outstanding access
        // token via the JWT strategy guard. Refresh tokens are revoked
        // below; together this kills every session on every device.
        data: {
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
        },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: stored.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  /// Authenticated change. Used for both: (a) routine password change, and
  /// (b) clearing the `mustChangePassword` flag for staff that the admin
  /// created with a temporary password. Revokes all sibling refresh tokens.
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException();
    }

    const ok = await compare(dto.currentPassword, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Senha atual incorreta');
    }

    const passwordHash = await hash(dto.newPassword, BCRYPT_ROUNDS);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  private async issueTokenPair(
    user: UserForToken,
    ip?: string,
    userAgent?: string,
  ): Promise<TokenPair> {
    const { accessToken, refreshToken, refreshExpiresAt } =
      await this.buildPair(user);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: refreshExpiresAt,
        createdByIp: ip,
        userAgent,
      },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        unitId: user.unitId,
      },
    };
  }

  private async buildPair(user: UserForToken) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      unitId: user.unitId,
    };
    const accessToken = await this.jwt.signAsync(payload);
    const refreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    const refreshExpiresAt = this.computeRefreshExpiry();
    return { accessToken, refreshToken, refreshExpiresAt };
  }

  private computeRefreshExpiry(): Date {
    const ttl = this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';
    const ms = this.parseDuration(ttl);
    return new Date(Date.now() + ms);
  }

  /// Minimal duration parser for `Ns | Nm | Nh | Nd`.
  private parseDuration(input: string): number {
    const match = /^(\d+)\s*([smhd])$/.exec(input.trim());
    if (!match) {
      throw new Error(`Invalid duration: ${input}`);
    }
    const value = Number(match[1]);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return value * multipliers[unit];
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
