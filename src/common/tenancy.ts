import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from './types/authenticated-user.type';

/// True only for ADMIN with `unitId === null` (cross-unit admin).
export function isGlobalAdmin(user: AuthenticatedUser): boolean {
  return user.role === Role.ADMIN && user.unitId === null;
}

/// Asserts the user can read/write resources scoped to `unitId`.
/// - Global admins (ADMIN, no unitId): always pass.
/// - Unit-scoped ADMIN with matching `unitId`: pass.
/// - INSTRUCTOR whose `InstructorArena` set includes `unitId`: pass.
///   (2026-05 multi-arena — `user.unitId` is just the legacy primary
///   pointer, so we check the M2M list instead.)
/// - Anyone else (regular USER, staff of a different unit): 403.
export function assertCanAccessUnit(
  user: AuthenticatedUser,
  unitId: string,
): void {
  if (isGlobalAdmin(user)) return;
  if (user.role === Role.ADMIN && user.unitId === unitId) return;
  if (
    user.role === Role.INSTRUCTOR &&
    user.instructorArenaIds.includes(unitId)
  ) {
    return;
  }
  throw new ForbiddenException(
    'Você não tem permissão para acessar essa unidade',
  );
}

/// Asserts the user can manage a specific class slot (instructor of slot,
/// admin of unit, or global admin). Used by class-slot CRUD and waitlist
/// listing endpoints.
export function assertCanManageSlot(
  user: AuthenticatedUser,
  slot: { unitId: string; instructorId: string },
): void {
  if (isGlobalAdmin(user)) return;
  if (
    user.role === Role.INSTRUCTOR &&
    slot.instructorId === user.id &&
    user.instructorArenaIds.includes(slot.unitId)
  ) {
    return;
  }
  if (user.role === Role.ADMIN && user.unitId === slot.unitId) return;
  throw new ForbiddenException('Você não pode gerenciar essa aula');
}
