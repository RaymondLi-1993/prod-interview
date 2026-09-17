import type { Queryable } from "../../db/types.ts";
import { type User, type Providers, userSchema } from "./user.schemas.ts";

export interface CreateUser {
  id: string;
  authProvider: Providers;
  authProviderId: string;
  email: string;
  displayName: string | null;
}

const COLUMN = `
    id, auth_provider, auth_provider_id, email,
    display_name, created_at, updated_at, deleted_at
  `;

export const createUser = async (
  db: Queryable,
  input: CreateUser,
): Promise<User> => {
  const { id, authProvider, authProviderId, email, displayName } = input;
  const { rows } = await db.query(
    `INSERT INTO users(id, auth_provider, auth_provider_id, email, display_name)
         VALUES($1, $2, $3, $4, $5)
     RETURNING ${COLUMN}
    `,
    [id, authProvider, authProviderId, email, displayName],
  );

  return userSchema.parse(rows[0]);
};

export const findUserById = async (
  db: Queryable,
  id: string,
): Promise<User | null> => {
  const { rows, rowCount } = await db.query(
    `SELECT ${COLUMN} from users WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );

  return rowCount ? userSchema.parse(rows[0]) : null;
};

export const findUserByProvider = async (
  db: Queryable,
  provider: Providers,
  providerId: string,
): Promise<User | null> => {
  const { rows, rowCount } = await db.query(
    `SELECT ${COLUMN} from users WHERE auth_provider = $1 AND auth_provider_id = $2 AND deleted_at IS NULL`,
    [provider, providerId],
  );

  return rowCount ? userSchema.parse(rows[0]) : null;
};
