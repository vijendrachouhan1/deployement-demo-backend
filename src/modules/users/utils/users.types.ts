import { ICompany } from "@/db/models/company";
import { IUser } from "@/db/models/user";
import { userValidators } from "@/modules/users/utils/users.validation";

export type TUserController = typeof userValidators;

export interface IUserGrowthResult {
  totalUsers: number;
  percentageGrowth: number;
  newSignUpsThisMonth?: number;
}

export interface IUserWithCompany extends IUser {
  company?: ICompany;
  permissions?: string[];
}
