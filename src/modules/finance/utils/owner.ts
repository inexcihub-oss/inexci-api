import { AuthenticatedUser } from 'src/shared/decorators/current-user.decorator';

export function ownerIdDe(
  user: Pick<AuthenticatedUser, 'userId' | 'ownerId'>,
): string {
  return user.ownerId ?? user.userId;
}
