import type { Request } from 'express';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SignupDto } from './dto/signup.dto';
export declare class AuthController {
    private readonly auth;
    constructor(auth: AuthService);
    signup(dto: SignupDto, req: Request): Promise<import("./auth.service").TokenPair>;
    login(dto: LoginDto, req: Request): Promise<import("./auth.service").TokenPair>;
    refresh(dto: RefreshDto, req: Request): Promise<Omit<import("./auth.service").TokenPair, "user">>;
    logout(dto: RefreshDto): Promise<void>;
    forgotPassword(dto: ForgotPasswordDto): Promise<import("./auth.service").ForgotPasswordResult>;
    resetPassword(dto: ResetPasswordDto): Promise<void>;
    changePassword(dto: ChangePasswordDto, user: AuthenticatedUser): Promise<void>;
}
