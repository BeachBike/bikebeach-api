import type { Role } from '@prisma/client';

/// Shape attached to `req.user` by JwtStrategy.validate.
/// Does NOT include the password hash or refresh-token data.
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  unitId: string | null;
}
