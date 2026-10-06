import { DEFAULT_ENVIRONMENT_ROLES } from "@/modules/roles/utils/roles.constant";
import { workos } from "@/providers/auth/authkit.provider";
import { PERMISSIONS } from "@/enums";
import { NotFoundException } from "@workos-inc/node";

function titleCase(value: string) {
  return value
    .split(/[-:_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildPermissionDefinition(slug: PERMISSIONS) {
  const [resource, action] = slug.split(":");

  return {
    slug,
    name: `${titleCase(action)} ${titleCase(resource)}`,
    description: `Allows ${action} access for ${resource}.`,
  };
}

async function upsertPermission(slug: PERMISSIONS) {
  const permission = buildPermissionDefinition(slug);

  try {
    await workos.authorization.getPermission(slug);
    await workos.authorization.updatePermission(slug, {
      name: permission.name,
      description: permission.description,
    });
    console.log(`Updated permission: ${slug}`);
  } catch (error) {
    if (!(error instanceof NotFoundException)) {
      throw error;
    }

    await workos.authorization.createPermission(permission);
    console.log(`Created permission: ${slug}`);
  }
}

async function upsertEnvironmentRole(
  role: (typeof DEFAULT_ENVIRONMENT_ROLES)[number],
) {
  try {
    await workos.authorization.getEnvironmentRole(role.slug);
    await workos.authorization.updateEnvironmentRole(role.slug, {
      name: role.name,
      description: role.description,
    });
    console.log(`Updated environment role: ${role.slug}`);
  } catch (error) {
    if (!(error instanceof NotFoundException)) {
      throw error;
    }

    await workos.authorization.createEnvironmentRole({
      slug: role.slug,
      name: role.name,
      description: role.description,
    });
    console.log(`Created environment role: ${role.slug}`);
  }

  await workos.authorization.setEnvironmentRolePermissions(role.slug, {
    permissions: [...role.permissions],
  });

  console.log(
    `Synced environment role permissions: ${role.slug} (${role.permissions.length})`,
  );
}

async function syncRolesAndPermissions() {
  const permissions = Object.values(PERMISSIONS);

  for (const permission of permissions) {
    await upsertPermission(permission);
  }

  for (const role of DEFAULT_ENVIRONMENT_ROLES) {
    await upsertEnvironmentRole(role);
  }

  console.log("Roles and permissions synced successfully.");
}

syncRolesAndPermissions().catch((error) => {
  console.error("Failed to sync roles and permissions.", error);
  process.exit(1);
});
