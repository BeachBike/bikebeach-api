import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import type { JwtPayload } from '../types/jwt-payload.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        unitId: true,
        isActive: true,
        passwordChangedAt: true,
        arenaAssignments:
          // INSTRUCTOR is the only role that uses the M2M for tenancy
          // checks; skip the join for everyone else.
          { select: { unitId: true } },
      },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException();
    }

    // Reject access tokens issued before the user's last password change.
    // `iat` is in seconds (JWT standard); compare with seconds-since-epoch
    // floor of `passwordChangedAt` (minus 1s slack to absorb rounding
    // between the DB write and the JWT-sign clock).
    if (payload.iat) {
      const passwordChangedSec = Math.floor(user.passwordChangedAt.getTime() / 1000) - 1;
      if (payload.iat < passwordChangedSec) {
        throw new UnauthorizedException('Token revogado pela troca de senha');
      }
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      unitId: user.unitId,
      instructorArenaIds:
        user.role === Role.INSTRUCTOR
          ? user.arenaAssignments.map((a) => a.unitId)
          : [],
    };
  }
}
