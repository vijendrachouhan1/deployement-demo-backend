import { LOGIN_METHOD } from "../../src/modules/auth/utils/auth.enum";
import "jsonwebtoken";

declare module "jsonwebtoken" {
  export interface JwtPayload {
    _id: string;
    email: string;
    role?: string;
    loginMethod?: LOGIN_METHOD;
  }
}
