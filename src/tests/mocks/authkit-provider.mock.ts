import { beforeEach, vi } from "vitest";

import { DEFAULT_ENVIRONMENT_ROLES } from "@/modules/roles/utils/roles.constant";

function findRolePermissions(slug: string): string[] {
  const role = DEFAULT_ENVIRONMENT_ROLES.find((r) => r.slug === slug);
  return role ? [...role.permissions] : [];
}

/*
 * Stub of the raw WorkOS SDK client. The real authkit.provider module exports a
 * `workos` instance that the auth/roles helpers call directly (role lookup, org
 * + role CRUD, org membership, MFA factors), so the mock must cover every method
 * those helpers reach.
 */
export const workos = {
  authorization: {
    getEnvironmentRole: vi.fn(),
    getOrganizationRole: vi.fn(),
    createOrganizationRole: vi.fn(),
    updateOrganizationRole: vi.fn(),
    deleteOrganizationRole: vi.fn(),
    setOrganizationRolePermissions: vi.fn(),
    listOrganizationRoles: vi.fn(),
    listPermissions: vi.fn(),
    getPermission: vi.fn(),
    createPermission: vi.fn(),
    updatePermission: vi.fn(),
    createEnvironmentRole: vi.fn(),
    updateEnvironmentRole: vi.fn(),
    setEnvironmentRolePermissions: vi.fn(),
  },
  organizations: {
    createOrganization: vi.fn(),
    deleteOrganization: vi.fn(),
  },
  userManagement: {
    createOrganizationMembership: vi.fn(),
    deleteOrganizationMembership: vi.fn(),
    deleteUser: vi.fn(),
    enrollAuthFactor: vi.fn(),
  },
  mfa: {
    challengeFactor: vi.fn(),
    verifyChallenge: vi.fn(),
    deleteFactor: vi.fn(),
  },
};

/*
 * The suite runs with mockReset/restoreMocks enabled, which strips any
 * implementation set at module load, so defaults must be (re)installed in a
 * hook. Individual tests can still override any of these.
 */
beforeEach(() => {
  workos.authorization.getEnvironmentRole.mockImplementation(
    async (slug: string) => ({ slug, permissions: findRolePermissions(slug) }),
  );
  workos.authorization.getOrganizationRole.mockImplementation(
    async (_orgId: string, slug: string) => ({
      slug,
      permissions: findRolePermissions(slug),
    }),
  );
  workos.authorization.createOrganizationRole.mockImplementation(
    async (_orgId: string, { slug }: { slug: string }) => ({
      id: "role_test_mock",
      slug,
    }),
  );
  workos.authorization.updateOrganizationRole.mockResolvedValue({
    id: "role_test_mock",
  });
  workos.authorization.deleteOrganizationRole.mockResolvedValue(undefined);
  workos.authorization.setOrganizationRolePermissions.mockResolvedValue({
    id: "role_test_mock",
    permissions: [],
  });
  workos.authorization.listOrganizationRoles.mockResolvedValue({ data: [] });
  workos.authorization.listPermissions.mockResolvedValue({ data: [] });
  workos.authorization.getPermission.mockResolvedValue(null);
  workos.authorization.createPermission.mockResolvedValue({
    id: "perm_test_mock",
  });
  workos.authorization.updatePermission.mockResolvedValue({
    id: "perm_test_mock",
  });
  workos.authorization.createEnvironmentRole.mockResolvedValue({
    id: "role_test_mock",
  });
  workos.authorization.updateEnvironmentRole.mockResolvedValue({
    id: "role_test_mock",
  });
  workos.authorization.setEnvironmentRolePermissions.mockResolvedValue({
    id: "role_test_mock",
  });

  workos.organizations.createOrganization.mockImplementation(
    async ({ name }: { name: string; externalId?: string }) => ({
      id: "org_test_mock",
      name,
    }),
  );

  workos.userManagement.createOrganizationMembership.mockResolvedValue({
    id: "om_test_mock",
  });

  // Compensating deletes, used when registration unwinds a failed provisioning.
  workos.organizations.deleteOrganization.mockResolvedValue(undefined);
  workos.userManagement.deleteOrganizationMembership.mockResolvedValue(
    undefined,
  );
  workos.userManagement.deleteUser.mockResolvedValue(undefined);
  workos.userManagement.enrollAuthFactor.mockResolvedValue({
    authenticationFactor: {
      id: "auth_factor_test",
      totp: { qrCode: "qr_test", uri: "uri_test", secret: "secret_test" },
    },
    authenticationChallenge: { id: "auth_challenge_test" },
  });

  workos.mfa.challengeFactor.mockResolvedValue({ id: "mfa_challenge_test" });
  workos.mfa.verifyChallenge.mockResolvedValue({ valid: true });
  workos.mfa.deleteFactor.mockResolvedValue(undefined);
});

export const mockAuthKitProvider = {
  createUser: vi.fn(),
  updateUser: vi.fn(),
  authenticateWithPassword: vi.fn(),
  authenticateWithCode: vi.fn(),
  createMagicLinkSession: vi.fn(),
  verifyMagicLinkToken: vi.fn(),
  generateOAuthUrl: vi.fn(),
};

export class AuthKitProvider {
  createUser = mockAuthKitProvider.createUser;
  updateUser = mockAuthKitProvider.updateUser;
  authenticateWithPassword = mockAuthKitProvider.authenticateWithPassword;
  authenticateWithCode = mockAuthKitProvider.authenticateWithCode;
  createMagicLinkSession = mockAuthKitProvider.createMagicLinkSession;
  verifyMagicLinkToken = mockAuthKitProvider.verifyMagicLinkToken;
  generateOAuthUrl = mockAuthKitProvider.generateOAuthUrl;
}

vi.mock(
  "@/providers/auth/authkit.provider",
  () => import("@/tests/mocks/authkit-provider.mock.js"),
);
