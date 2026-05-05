import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SignupDto } from './dto/signup.dto';
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
    emailSent: boolean;
    devToken?: string;
}
export declare class AuthService {
    private readonly prisma;
    private readonly jwt;
    private readonly config;
    private readonly logger;
    constructor(prisma: PrismaService, jwt: JwtService, config: ConfigService);
    signup(dto: SignupDto, ip?: string, userAgent?: string): Promise<TokenPair>;
    login(dto: LoginDto, ip?: string, userAgent?: string): Promise<TokenPair>;
    refresh(rawToken: string, ip?: string, userAgent?: string): Promise<Omit<TokenPair, 'user'>>;
    logout(rawToken: string): Promise<void>;
    forgotPassword(dto: ForgotPasswordDto): Promise<ForgotPasswordResult>;
    resetPassword(dto: ResetPasswordDto): Promise<void>;
    changePassword(userId: string, dto: ChangePasswordDto): Promise<void>;
    private issueTokenPair;
    private buildPair;
    private computeRefreshExpiry;
    private parseDuration;
    private hashToken;
}
