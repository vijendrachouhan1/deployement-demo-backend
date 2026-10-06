import { inviteUserValidators } from "@/modules/invite-user/utils/invite-user.validation";
import { TObjectId } from "@/types";
import { IBaseFilters } from "@/types/query.types";

// ==================== Controller Types ====================

export type TInviteUserController = typeof inviteUserValidators;

// ==================== Interface Types ====================

export interface IInviteUser {
  email: string;
  firstName: string;
  lastName: string;
}

export interface IFilterAndSaveBulkInvites {
  users: IInviteUser[];
  companyRef: TObjectId;
  userRef: TObjectId;
  role: string;
}

export interface IResendInvitation {
  email: string;
  companyRef: TObjectId;
}

export interface IFindUsersParams extends IBaseFilters {
  companyRef: TObjectId;
}

export interface IFindTeamMembersParams extends IBaseFilters {
  companyRef: TObjectId;
}
