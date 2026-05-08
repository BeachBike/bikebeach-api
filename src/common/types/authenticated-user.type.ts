import type { Role } from '@prisma/client';

/// Shape attached to `req.user` by JwtStrategy.validate.
/// Does NOT include the password hash or refresh-token data.
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  unitId: string | null;
  /// 2026-05 — INSTRUCTOR multi-arena. Mirrors the `InstructorArena`
  /// rows for the user. Empty for ADMIN/USER. Tenancy checks for
  /// instructors look here first; the legacy `unitId` is just the
  /// primary arena pointer.
  instructorArenaIds: string[];
}
