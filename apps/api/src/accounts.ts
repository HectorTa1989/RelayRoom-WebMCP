import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { openDatabase, demoEnabled, requireRule } from "@relayroom/operations";

export type AppUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "operator";
  plan: "free" | "pro" | "admin";
};
type Account = Omit<AppUser, "plan"> & { salt: string; hash: string };
export const accountDb = openDatabase("workspace-v2");
accountDb.exec(`CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS subscriptions (user_id TEXT PRIMARY KEY, active INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, owner TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'approved', created_at TEXT NOT NULL);`);

export function createAccount(
  email: string,
  password: string,
  name: string,
  role: AppUser["role"] = "operator",
) {
  requireRule(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
      email.length <= 254 &&
      password.length >= 12 &&
      password.length <= 128 &&
      name.trim().length > 0 &&
      name.length <= 100,
    "INVALID_ACCOUNT",
    "Use a valid email, a name, and a 12–128 character password",
    400,
  );
  requireRule(
    !accountDb
      .prepare("SELECT id FROM accounts WHERE email=?")
      .get(email.toLowerCase()),
    "ACCOUNT_EXISTS",
    "An account with this email exists",
  );
  const salt = randomBytes(16).toString("hex");
  const user = {
    id: randomUUID(),
    email: email.toLowerCase(),
    name,
    role,
    salt,
    hash: scryptSync(password, salt, 64).toString("hex"),
  };
  accountDb
    .prepare("INSERT INTO accounts VALUES (?,?,?,?,?,?)")
    .run(user.id, user.email, user.name, role, salt, user.hash);
  return publicUser(user);
}
function publicUser(account: Account): AppUser {
  const paid = accountDb
    .prepare("SELECT active FROM subscriptions WHERE user_id=?")
    .get(account.id) as { active: number } | undefined;
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    role: account.role,
    plan: account.role === "admin" ? "admin" : paid?.active ? "pro" : "free",
  };
}
export function findUser(id: string) {
  const row = accountDb.prepare("SELECT * FROM accounts WHERE id=?").get(id) as
    Account | undefined;
  return row ? publicUser(row) : undefined;
}
export function checkPassword(email: string, password: string) {
  if (password.length > 128) return undefined;
  const row = accountDb
    .prepare("SELECT * FROM accounts WHERE email=?")
    .get(email.toLowerCase()) as Account | undefined;
  const hash = scryptSync(password, row?.salt ?? "dummy-account-salt", 64);
  if (!row || !timingSafeEqual(hash, Buffer.from(row.hash, "hex")))
    return undefined;
  return publicUser(row);
}
export function setPaid(
  userId: string,
  active: boolean,
  at = Date.now(),
  eventId?: string,
) {
  accountDb.exec("BEGIN IMMEDIATE");
  try {
    if (
      eventId &&
      accountDb.prepare("SELECT id FROM webhook_events WHERE id=?").get(eventId)
    ) {
      accountDb.exec("COMMIT");
      return;
    }
    accountDb
      .prepare(
        "INSERT INTO subscriptions VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET active=excluded.active,updated_at=excluded.updated_at WHERE excluded.updated_at >= subscriptions.updated_at",
      )
      .run(userId, active ? 1 : 0, at);
    if (eventId)
      accountDb.prepare("INSERT INTO webhook_events VALUES (?)").run(eventId);
    accountDb.exec("COMMIT");
  } catch (error) {
    accountDb.exec("ROLLBACK");
    throw error;
  }
}
const adminEmail = (
  process.env.ADMIN_EMAIL ||
  (process.env.NODE_ENV !== "production" ? "admin@relayroom.local" : "")
).toLowerCase();
const adminPassword =
  process.env.ADMIN_PASSWORD ||
  (process.env.NODE_ENV !== "production" ? "relay-admin-local" : "");
if (process.env.NODE_ENV === "production")
  requireRule(
    Boolean(process.env.ADMIN_EMAIL) &&
      adminPassword.length >= 12 &&
      !adminPassword.startsWith("relay-admin"),
    "ADMIN_SETUP_REQUIRED",
    "Production requires your own admin email and a strong password",
  );
if (!accountDb.prepare("SELECT id FROM accounts WHERE role='admin'").get()) {
  requireRule(
    adminEmail && adminPassword,
    "ADMIN_SETUP_REQUIRED",
    "Configure ADMIN_EMAIL and ADMIN_PASSWORD before first start",
  );
  // Preserve existing development credentials on first boot, but never allow short production passwords.
  if (process.env.NODE_ENV !== "production" && adminPassword.length < 12) {
    const salt = randomBytes(16).toString("hex");
    accountDb
      .prepare("INSERT INTO accounts VALUES (?,?,?,?,?,?)")
      .run(
        randomUUID(),
        adminEmail,
        "Hector Ta",
        "admin",
        salt,
        scryptSync(adminPassword, salt, 64).toString("hex"),
      );
  } else createAccount(adminEmail, adminPassword, "Hector Ta", "admin");
}
if (
  demoEnabled() &&
  !accountDb
    .prepare("SELECT id FROM accounts WHERE email=?")
    .get("operator@relayroom.local")
)
  createAccount(
    "operator@relayroom.local",
    "relay-demo-local",
    "Demo Operator",
  );
