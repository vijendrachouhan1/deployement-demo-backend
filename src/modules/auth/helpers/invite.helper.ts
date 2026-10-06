import { InvitedUsers } from "@/db/models/invitedUsers";
import { AUTH_RESPONSE_MESSAGES } from "@/modules/auth/utils/auth.constant";
import { jwtHelper } from "@/helpers/jwt";
import { INVITED_USER_STATUS } from "@/enums";

interface IValidateInvitationParams {
  inviteToken: string;
  email: string;
}

export async function validateInvitation({
  inviteToken,
  email,
}: IValidateInvitationParams) {
  const decoded = jwtHelper.verifyToken(inviteToken);

  if (!decoded || decoded.email !== email) {
    throw new Error(AUTH_RESPONSE_MESSAGES.INVALID_TOKEN);
  }

  const invitation = await InvitedUsers.findOne({ invitedEmail: email }).sort({
    createdAt: -1,
  });

  if (!invitation) {
    throw new Error(`${AUTH_RESPONSE_MESSAGES.EMAIL_NOT_INVITED} '${email}'`);
  }

  if (invitation.status === INVITED_USER_STATUS.CANCELED) {
    throw new Error(AUTH_RESPONSE_MESSAGES.INVITATION_CANCELLED);
  }

  return invitation;
}
