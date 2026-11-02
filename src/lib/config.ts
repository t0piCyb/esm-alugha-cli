import { homedir } from "os";
import { join } from "path";

/** Application name */
export const APP_NAME = "esm-alugha";

/** CLI binary name */
export const APP_CLI = "esm-alugha-cli";

/** Alugha has a single GraphQL endpoint for login and everything else. */
export const GRAPHQL_URL = process.env.ALUGHA_GRAPHQL_URL?.trim() || "https://alugha.com/graphql";

/**
 * Alugha's web app sends a `clientid` header: one for the login mutation,
 * another for authenticated calls (same values as `esm_alugha_driver`).
 */
export const LOGIN_CLIENT_ID = "22f45784-b715-4bfa-a47e-9d3c828f0692";
export const MAIN_CLIENT_ID = "214bf54c-aa89-4f33-aaee-52d94f5715c4";

/** Profile used when nothing else selects one (one profile per Alugha account). */
export const FALLBACK_PROFILE = "default";

/**
 * One file per profile, `~/.config/tokens/esm-alugha-cli-<profile>.json`
 * (chmod 600): e-mail, password and the current session tokens. Alugha has no
 * personal API key, so the password is what lets the CLI log in again when the
 * refresh token expires. ALUGHA_EMAIL / ALUGHA_PASSWORD (same names as the
 * backend) override the profile for agents and CI.
 */
export const TOKEN_DIR = join(homedir(), ".config", "tokens");
export const STATE_FILE = join(homedir(), ".config", APP_CLI, "state.json");

/** Global state for output flags (set by root command) */
export const globalFlags = {
  json: false,
  format: "text" as "text" | "json" | "csv" | "yaml",
  verbose: false,
  noColor: false,
  noHeader: false,
  /** Resolved once by the root preAction hook: flag > env > active > fallback. */
  profile: "",
};
