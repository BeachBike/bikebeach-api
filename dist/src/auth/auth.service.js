"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
const client_1 = require("@prisma/client");
const bcrypt_1 = require("bcrypt");
const crypto_1 = require("crypto");
const constants_1 = require("../common/constants");
const prisma_service_1 = require("../prisma/prisma.service");
const BCRYPT_ROUNDS = 12;
const REFRESH_TOKEN_BYTES = 48;
const RESET_TOKEN_BYTES = 32;
let AuthService = AuthService_1 = class AuthService {
    prisma;
    jwt;
    config;
    logger = new common_1.Logger(AuthService_1.name);
    constructor(prisma, jwt, config) {
        this.prisma = prisma;
        this.jwt = jwt;
        this.config = config;
    }
    async signup(dto, ip, userAgent) {
        const existing = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });
        if (existing) {
            throw new common_1.ConflictException('E-mail já cadastrado');
        }
        const passwordHash = await (0, bcrypt_1.hash)(dto.password, BCRYPT_ROUNDS);
        const user = await this.prisma.user.create({
            data: {
                email: dto.email,
                passwordHash,
                name: dto.name,
                phone: dto.phone,
                cpf: dto.cpf,
                birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
                goal: dto.goal,
                fitnessLevel: dto.fitnessLevel,
                role: client_1.Role.USER,
            },
        });
        return this.issueTokenPair(user, ip, userAgent);
    }
    async login(dto, ip, userAgent) {
        const user = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });
        if (!user || !user.isActive) {
            throw new common_1.UnauthorizedException('Credenciais inválidas');
        }
        const ok = await (0, bcrypt_1.compare)(dto.password, user.passwordHash);
        if (!ok) {
            throw new common_1.UnauthorizedException('Credenciais inválidas');
        }
        return this.issueTokenPair(user, ip, userAgent);
    }
    async refresh(rawToken, ip, userAgent) {
        const tokenHash = this.hashToken(rawToken);
        const stored = await this.prisma.refreshToken.findUnique({
            where: { tokenHash },
            include: { user: true },
        });
        if (!stored) {
            throw new common_1.UnauthorizedException('Refresh token inválido');
        }
        if (stored.revokedAt) {
            this.logger.warn(`Refresh token reuse detected for user ${stored.userId}`);
            await this.prisma.refreshToken.updateMany({
                where: { userId: stored.userId, revokedAt: null },
                data: { revokedAt: new Date() },
            });
            throw new common_1.UnauthorizedException('Refresh token revogado');
        }
        if (stored.expiresAt < new Date()) {
            throw new common_1.UnauthorizedException('Refresh token expirado');
        }
        if (!stored.user.isActive) {
            throw new common_1.UnauthorizedException();
        }
        const { accessToken, refreshToken, refreshExpiresAt } = await this.buildPair(stored.user);
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
    async logout(rawToken) {
        const tokenHash = this.hashToken(rawToken);
        await this.prisma.refreshToken.updateMany({
            where: { tokenHash, revokedAt: null },
            data: { revokedAt: new Date() },
        });
    }
    async forgotPassword(dto) {
        const user = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });
        if (!user || !user.isActive) {
            return { emailSent: false };
        }
        const rawToken = (0, crypto_1.randomBytes)(RESET_TOKEN_BYTES).toString('base64url');
        const tokenHash = this.hashToken(rawToken);
        const expiresAt = new Date(Date.now() + constants_1.PASSWORD_RESET_TOKEN_TTL_MINUTES * 60_000);
        await this.prisma.passwordResetToken.create({
            data: { userId: user.id, tokenHash, expiresAt },
        });
        this.logger.log(`Password reset token issued for ${user.email} (TTL ${constants_1.PASSWORD_RESET_TOKEN_TTL_MINUTES}m)`);
        const devToken = process.env.NODE_ENV !== 'production' ? rawToken : undefined;
        return { emailSent: true, devToken };
    }
    async resetPassword(dto) {
        const tokenHash = this.hashToken(dto.token);
        const stored = await this.prisma.passwordResetToken.findUnique({
            where: { tokenHash },
            include: { user: true },
        });
        if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
            throw new common_1.UnauthorizedException('Token inválido ou expirado');
        }
        if (!stored.user.isActive) {
            throw new common_1.UnauthorizedException();
        }
        const passwordHash = await (0, bcrypt_1.hash)(dto.password, BCRYPT_ROUNDS);
        await this.prisma.$transaction([
            this.prisma.user.update({
                where: { id: stored.userId },
                data: { passwordHash, mustChangePassword: false },
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
    async changePassword(userId, dto) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user || !user.isActive) {
            throw new common_1.UnauthorizedException();
        }
        const ok = await (0, bcrypt_1.compare)(dto.currentPassword, user.passwordHash);
        if (!ok) {
            throw new common_1.UnauthorizedException('Senha atual incorreta');
        }
        const passwordHash = await (0, bcrypt_1.hash)(dto.newPassword, BCRYPT_ROUNDS);
        await this.prisma.$transaction([
            this.prisma.user.update({
                where: { id: userId },
                data: { passwordHash, mustChangePassword: false },
            }),
            this.prisma.refreshToken.updateMany({
                where: { userId, revokedAt: null },
                data: { revokedAt: new Date() },
            }),
        ]);
    }
    async issueTokenPair(user, ip, userAgent) {
        const { accessToken, refreshToken, refreshExpiresAt } = await this.buildPair(user);
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
    async buildPair(user) {
        const payload = {
            sub: user.id,
            email: user.email,
            role: user.role,
            unitId: user.unitId,
        };
        const accessToken = await this.jwt.signAsync(payload);
        const refreshToken = (0, crypto_1.randomBytes)(REFRESH_TOKEN_BYTES).toString('base64url');
        const refreshExpiresAt = this.computeRefreshExpiry();
        return { accessToken, refreshToken, refreshExpiresAt };
    }
    computeRefreshExpiry() {
        const ttl = this.config.get('JWT_REFRESH_EXPIRES_IN') ?? '7d';
        const ms = this.parseDuration(ttl);
        return new Date(Date.now() + ms);
    }
    parseDuration(input) {
        const match = /^(\d+)\s*([smhd])$/.exec(input.trim());
        if (!match) {
            throw new Error(`Invalid duration: ${input}`);
        }
        const value = Number(match[1]);
        const unit = match[2];
        const multipliers = {
            s: 1_000,
            m: 60_000,
            h: 3_600_000,
            d: 86_400_000,
        };
        return value * multipliers[unit];
    }
    hashToken(token) {
        return (0, crypto_1.createHash)('sha256').update(token).digest('hex');
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = AuthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        jwt_1.JwtService,
        config_1.ConfigService])
], AuthService);
//# sourceMappingURL=auth.service.js.map