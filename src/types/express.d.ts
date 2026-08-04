import type { Request } from 'express';
import type { JwtAccessPayload } from './common.js';
import type { IUser, UserRole } from './models.js';

export type AuthUser = Partial<IUser> & {
  _id?: string | import('mongoose').Types.ObjectId;
  id?: string;
  email?: string;
  role?: UserRole | string | null;
  permissions?: string[];
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      accessToken?: string;
      tokenPayload?: JwtAccessPayload;
      requestId?: string;
      requestTime?: Date;
      startTime?: bigint;
      durationMs?: number;
      file?: Express.Multer.File;
      files?:
        | Express.Multer.File[]
        | { [fieldname: string]: Express.Multer.File[] };
    }
  }
}

export type AuthenticatedRequest = Request & {
  user: AuthUser;
  accessToken?: string;
  tokenPayload?: JwtAccessPayload;
};

export {};
