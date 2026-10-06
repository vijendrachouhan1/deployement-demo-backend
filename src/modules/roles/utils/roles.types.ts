import { rolesValidators } from "@/modules/roles/utils/roles.validation";

export type TRoleController = typeof rolesValidators;

export interface IWorkOSRoleInput {
  slug: string;
  name: string;
  description?: string;
  permissions?: string[];
}

export interface IWorkOSRoleUpdateInput {
  name?: string;
  description?: string;
  permissions?: string[];
}
