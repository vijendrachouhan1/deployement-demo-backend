import { IUserWithCompany } from "../../src/modules/users/utils/users.types";
import { TPendingMfaClaims } from "../../src/modules/auth/utils/auth.types";
import { LOGIN_METHOD } from "../../src/modules/auth/utils/auth.enum";

declare global {
  namespace Express {
    interface Request {
      user?: IUserWithCompany;
      isMobile?: boolean;
      pendingMfa?: TPendingMfaClaims;
      loginMethod?: LOGIN_METHOD;
    }
  }
}

export {};
