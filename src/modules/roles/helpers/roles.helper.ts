import { Company } from "@/db/models/company";
import { workos } from "@/providers/auth/authkit.provider";
import {
  IWorkOSRoleInput,
  IWorkOSRoleUpdateInput,
} from "@/modules/roles/utils/roles.types";
import {
  PRIVILEGED_USER_ROLES,
  ROLES_MESSAGES,
} from "@/modules/roles/utils/roles.constant";

class RolesHelper {
  private async ensureOrganizationId(companyRef: string) {
    const company = await Company.findById(companyRef);

    if (!company) {
      const error = new Error(ROLES_MESSAGES.COMPANY_NOT_FOUND) as Error & {
        statusCode?: number;
      };
      error.statusCode = 404;
      throw error;
    }

    if (company.externalId) {
      return company.externalId;
    }

    const organization = await workos.organizations.createOrganization({
      name: company.name,
      externalId: company._id.toString(),
    });

    company.externalId = organization.id;
    await company.save();

    return organization.id;
  }

  async createRole(companyRef: string, input: IWorkOSRoleInput) {
    const organizationId = await this.ensureOrganizationId(companyRef);
    const slug = input.slug.startsWith("org-")
      ? input.slug
      : `org-${input.slug}`;
    const role = await workos.authorization.createOrganizationRole(
      organizationId,
      {
        slug,
        name: input.name,
        description: input.description,
      },
    );

    return workos.authorization.setOrganizationRolePermissions(
      organizationId,
      role.slug,
      {
        permissions: input.permissions ?? [],
      },
    );
  }

  async updateRole(
    companyRef: string,
    slug: string,
    input: IWorkOSRoleUpdateInput,
  ) {
    const organizationId = await this.ensureOrganizationId(companyRef);

    await workos.authorization.updateOrganizationRole(organizationId, slug, {
      name: input.name,
      description: input.description,
    });

    if (input.permissions !== undefined) {
      return workos.authorization.setOrganizationRolePermissions(
        organizationId,
        slug,
        {
          permissions: input.permissions,
        },
      );
    }

    return workos.authorization.getOrganizationRole(organizationId, slug);
  }

  async deleteRole(companyRef: string, slug: string) {
    const organizationId = await this.ensureOrganizationId(companyRef);
    await workos.authorization.deleteOrganizationRole(organizationId, slug);
  }

  async listPermissions() {
    return workos.authorization.listPermissions({
      limit: 100,
    });
  }

  async listRoles(companyRef: string) {
    const organizationId = await this.ensureOrganizationId(companyRef);
    return workos.authorization.listOrganizationRoles(organizationId);
  }

  // What the role picker offers and what a role change accepts have to be the
  // same set, or a role the UI lists is one the assign endpoint rejects.
  async listAssignableRoles(companyRef: string) {
    const roles = await this.listRoles(companyRef);
    return roles.data.filter(
      (role) => !PRIVILEGED_USER_ROLES.includes(role.slug),
    );
  }
}

export const rolesHelper = new RolesHelper();
