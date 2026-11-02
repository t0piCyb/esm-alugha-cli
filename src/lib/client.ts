import { GRAPHQL_URL, LOGIN_CLIENT_ID, MAIN_CLIENT_ID } from "./config.js";
import { CliError } from "./errors.js";
import { log } from "./logger.js";
import { type Account, readAccount, saveAccount } from "./session.js";

const TIMEOUT_MS = 60_000;

type GraphQLError = { message: string; extensions?: { code?: string } };
type GraphQLResponse<T> = { data?: T; errors?: GraphQLError[] };

/** Alugha answers an expired or missing session with a GraphQL error, not a 401. */
const isAuthError = (errors: GraphQLError[] = []) =>
  errors.some(
    (e) =>
      e.extensions?.code === "UNAUTHENTICATED" ||
      /not (authenticated|logged in|authorized)|unauthori[sz]ed|jwt|token (expired|invalid)/i.test(e.message),
  );

async function post<T>(
  query: string,
  variables: Record<string, unknown>,
  opts: { clientId: string; account?: Account },
): Promise<GraphQLResponse<T>> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    clientid: opts.clientId,
    origin: "https://alugha.com",
  };
  if (opts.account?.accessToken) {
    headers.cookie = [
      `authtoken=${opts.account.accessToken}`,
      opts.account.refreshToken ? `reftoken=${opts.account.refreshToken}` : "",
      opts.account.userId ? `user_id=${opts.account.userId}` : "",
    ]
      .filter(Boolean)
      .join("; ");
  }

  log.debug(`POST ${GRAPHQL_URL} ${query.match(/^\s*(query|mutation)\s+(\w+)/)?.[2] ?? ""}`);
  let res: Response;
  try {
    res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new CliError(1, `Cannot reach Alugha: ${err instanceof Error ? err.message : String(err)}`);
  }
  const body = (await res.json().catch(() => null)) as GraphQLResponse<T> | null;
  if (!body) throw new CliError(res.status >= 400 ? res.status : 500, `${res.status}: invalid response from Alugha`);
  return body;
}

const LOGIN = /* GraphQL */ `
  mutation CliLogin($input: LoginInput!) {
    login(input: $input, actions: []) {
      __typename
      ... on UserAndTokenSet {
        user { id name email role }
        tokens { accessToken refreshToken }
      }
    }
  }
`;

type LoginData = {
  login: {
    __typename: string;
    user?: { id: string; name: string; email: string; role: string };
    tokens?: { accessToken: string; refreshToken: string };
  };
};

/** Logs in with e-mail + password and returns the account with a fresh session. */
export async function login(email: string, password: string): Promise<Account> {
  const res = await post<LoginData>(
    LOGIN,
    { input: { email, password, contactLanguage: "en" } },
    { clientId: LOGIN_CLIENT_ID },
  );
  if (res.errors?.length) throw new CliError(401, `Alugha login failed: ${res.errors[0]?.message}`);
  const result = res.data?.login;
  if (result?.__typename === "Auth2FAPromptBasic") {
    throw new CliError(
      401,
      "This Alugha account has two-factor authentication, which the CLI does not handle.",
      "Use an account without 2FA for automation (e.g. a dedicated ESM account).",
    );
  }
  if (!result?.tokens || !result.user) throw new CliError(401, "Alugha login returned no session");
  return {
    email,
    password,
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
    userId: result.user.id,
    name: result.user.name,
  };
}

const REFRESH = /* GraphQL */ `
  mutation CliRefresh($refreshToken: String!) {
    refreshSession(refreshToken: $refreshToken) { accessToken refreshToken }
  }
`;

/** Refresh token first (no password sent), then a full login with the stored password. */
async function renewSession(account: Account): Promise<Account> {
  if (account.refreshToken) {
    const res = await post<{ refreshSession: { accessToken: string; refreshToken: string } }>(
      REFRESH,
      { refreshToken: account.refreshToken },
      { clientId: MAIN_CLIENT_ID },
    );
    if (res.data?.refreshSession) {
      log.debug("Alugha session refreshed");
      return { ...account, ...res.data.refreshSession };
    }
  }
  log.debug("Alugha session expired, logging in again");
  return login(account.email, account.password);
}

/**
 * Runs an authenticated GraphQL operation. Opens a session if none is stored,
 * renews it once when Alugha refuses it, and saves the new tokens.
 */
export async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  let account = readAccount();
  if (!account.accessToken) {
    account = await login(account.email, account.password);
    saveAccount(account);
  }

  let res = await post<T>(query, variables, { clientId: MAIN_CLIENT_ID, account });
  if (isAuthError(res.errors)) {
    account = await renewSession(account);
    saveAccount(account);
    res = await post<T>(query, variables, { clientId: MAIN_CLIENT_ID, account });
  }

  if (res.errors?.length) {
    const message = res.errors.map((e) => e.message).join("; ");
    const code = isAuthError(res.errors) ? 401 : /not found/i.test(message) ? 404 : /permission|forbidden|not allowed/i.test(message) ? 403 : 1;
    throw new CliError(code, `Alugha: ${message}`);
  }
  if (!res.data) throw new CliError(1, "Alugha returned no data");
  return res.data;
}
