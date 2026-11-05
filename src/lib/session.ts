/**
 * Alugha accounts: e-mail + password per profile, plus the session they open.
 *
 * Alugha has no personal API key. `login` returns an access token and a
 * refresh token, which the web app sends as the `authtoken` / `reftoken`
 * cookies. The CLI keeps both next to the credentials and, when a call is
 * refused, refreshes the session, then logs in again with the stored password.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { APP_CLI, FALLBACK_PROFILE, globalFlags, STATE_FILE, TOKEN_DIR } from "./config.js";
import { CliError } from "./errors.js";

export type Account = {
  email: string;
  password: string;
  accessToken?: string;
  refreshToken?: string;
  userId?: string;
  name?: string;
};

type State = { active?: string };

const FILE_PREFIX = `${APP_CLI}-`;
const FILE_SUFFIX = ".json";

/** Profile names become filenames, so restrict them to safe characters. */
export const sanitizeProfile = (profile: string) =>
  profile.trim().replace(/[^a-zA-Z0-9._-]/g, "_") || FALLBACK_PROFILE;

const accountPath = (profile: string) =>
  join(TOKEN_DIR, `${FILE_PREFIX}${sanitizeProfile(profile)}${FILE_SUFFIX}`);

const readState = (): State => {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as State;
  } catch {
    return {};
  }
};

const writePrivate = (path: string, content: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
};

export const defaultProfile = (): string =>
  process.env.ALUGHA_PROFILE?.trim() || readState().active?.trim() || FALLBACK_PROFILE;

export const resolveProfile = (explicit?: string): string =>
  sanitizeProfile(explicit?.trim() || globalFlags.profile.trim() || defaultProfile());

export const setActiveProfile = (profile: string): void =>
  writePrivate(STATE_FILE, `${JSON.stringify({ ...readState(), active: sanitizeProfile(profile) }, null, 2)}\n`);

/** Agents and CI pass the account through the same variables as the backend. */
const accountFromEnv = (): Account | null => {
  const email = process.env.ALUGHA_EMAIL?.trim();
  const password = process.env.ALUGHA_PASSWORD;
  return email && password ? { email, password } : null;
};

/**
 * Session tokens of an env-provided account, kept on disk (never the
 * password) so each command reuses them: Alugha rate-limits `login` and
 * refuses after a few logins in a row.
 */
const ENV_SESSION_FILE = join(TOKEN_DIR, `${APP_CLI}.env-session.json`);

type EnvSession = Omit<Account, "password">;

const readEnvSession = (email: string): EnvSession | null => {
  if (!existsSync(ENV_SESSION_FILE)) return null;
  try {
    const session = JSON.parse(readFileSync(ENV_SESSION_FILE, "utf-8")) as EnvSession;
    return session.email === email ? session : null;
  } catch {
    return null;
  }
};

export const usesEnvAccount = (): boolean => Boolean(accountFromEnv());

export function hasAccount(profile?: string): boolean {
  return usesEnvAccount() || existsSync(accountPath(resolveProfile(profile)));
}

export function readAccount(profile?: string): Account {
  const fromEnv = accountFromEnv();
  if (fromEnv) return { ...readEnvSession(fromEnv.email), ...fromEnv };
  const name = resolveProfile(profile);
  if (!existsSync(accountPath(name))) {
    throw new CliError(
      2,
      `No Alugha account for profile "${name}".`,
      `Run: ${APP_CLI} auth login --profile ${name}`,
    );
  }
  return JSON.parse(readFileSync(accountPath(name), "utf-8")) as Account;
}

/** Saves the account; env-provided accounts only keep their session tokens. */
export function saveAccount(account: Account, profile?: string): void {
  if (usesEnvAccount()) {
    const { password: _password, ...session } = account;
    writePrivate(ENV_SESSION_FILE, `${JSON.stringify(session, null, 2)}\n`);
    return;
  }
  writePrivate(accountPath(resolveProfile(profile)), `${JSON.stringify(account, null, 2)}\n`);
}

export function removeAccount(profile?: string): void {
  if (usesEnvAccount()) {
    if (existsSync(ENV_SESSION_FILE)) unlinkSync(ENV_SESSION_FILE);
    return;
  }
  const path = accountPath(resolveProfile(profile));
  if (existsSync(path)) unlinkSync(path);
}

export type StoredProfile = { name: string; active: boolean; email: string; user: string };

export const listProfiles = (): StoredProfile[] => {
  if (!existsSync(TOKEN_DIR)) return [];
  const active = defaultProfile();
  return readdirSync(TOKEN_DIR)
    .filter((file) => file.startsWith(FILE_PREFIX) && file.endsWith(FILE_SUFFIX))
    .map((file) => file.slice(FILE_PREFIX.length, file.length - FILE_SUFFIX.length))
    .sort()
    .map((name) => {
      const account = JSON.parse(readFileSync(accountPath(name), "utf-8")) as Account;
      return { name, active: name === active, email: account.email, user: account.name ?? "-" };
    });
};
