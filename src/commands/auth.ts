import { Command } from "commander";
import { gql, login } from "../lib/client.js";
import { globalFlags } from "../lib/config.js";
import { CliError, handleError } from "../lib/errors.js";
import { log } from "../lib/logger.js";
import { output } from "../lib/output.js";
import {
  defaultProfile,
  hasAccount,
  listProfiles,
  readAccount,
  removeAccount,
  resolveProfile,
  saveAccount,
  setActiveProfile,
  usesEnvAccount,
} from "../lib/session.js";

/** Reads a line from the terminal without echoing it. */
async function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) throw new CliError(2, "No terminal to type the password", "Use --password-stdin");
  process.stderr.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stderr.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          stdin.setRawMode(false);
          reject(new CliError(2, "Cancelled"));
          return;
        }
        value = char === "\u007f" ? value.slice(0, -1) : value + char;
      }
    };
    stdin.on("data", onData);
  });
}

const useProfileForThisRun = (profile?: string): string => {
  const name = resolveProfile(profile);
  globalFlags.profile = name;
  return name;
};

const VIEWER = /* GraphQL */ `
  query CliViewer { viewer { id name email role videoCount } }
`;
type Viewer = { viewer: { id: string; name: string; email: string; role: string; videoCount: number } | null };

export const authCommand = new Command("auth").description(
  "Alugha account (e-mail + password per profile; Alugha has no API key)",
);

authCommand
  .command("login")
  .description("Log in to Alugha and store the account (chmod 600)")
  .requiredOption("--email <email>", "Alugha account e-mail")
  .option("--profile <name>", "Profile name, one per Alugha account (default: default)")
  .option("--password-stdin", "Read the password from stdin instead of prompting")
  .option("--use", "Also make this profile the active one")
  .addHelpText(
    "after",
    "\nExamples:\n  esm-alugha-cli auth login --email ops@encounterschool.org\n  printf '%s' \"$ALUGHA_PASSWORD\" | esm-alugha-cli auth login --email ops@encounterschool.org --password-stdin --profile esm",
  )
  .action(async (opts: { email: string; profile?: string; passwordStdin?: boolean; use?: boolean }) => {
    try {
      const profile = useProfileForThisRun(opts.profile);
      const password = opts.passwordStdin
        ? (await Bun.stdin.text()).replace(/\r?\n$/, "")
        : await promptHidden(`Alugha password for ${opts.email}: `);
      if (!password) throw new CliError(2, "Empty password");

      const account = await login(opts.email.trim(), password);
      saveAccount(account, profile);
      if (opts.use || listProfiles().length === 1) setActiveProfile(profile);
      log.success(`Logged in as ${account.name} <${account.email}> (profile "${profile}")`);
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

authCommand
  .command("test")
  .alias("whoami")
  .description("Check the session and show the Alugha account")
  .action(async () => {
    try {
      const { viewer } = await gql<Viewer>(VIEWER);
      if (!viewer) throw new CliError(401, "Alugha does not recognise this session");
      output({ profile: usesEnvAccount() ? "(ALUGHA_EMAIL)" : resolveProfile(), ...viewer });
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

authCommand
  .command("list")
  .alias("ls")
  .description("List stored accounts (* = active)")
  .action(() => {
    const profiles = listProfiles();
    if (profiles.length === 0 && !globalFlags.json) {
      log.warn("No account yet. Run: esm-alugha-cli auth login --email <email>");
      return;
    }
    output(profiles.map((p) => ({ active: p.active ? "*" : "", profile: p.name, email: p.email, user: p.user })));
    if (!globalFlags.json && usesEnvAccount()) {
      log.warn("ALUGHA_EMAIL / ALUGHA_PASSWORD are set in this shell and override every profile above.");
    }
  });

authCommand
  .command("use")
  .description("Switch the active profile")
  .argument("<profile>", "Profile name")
  .action((profile: string) => {
    try {
      if (!hasAccount(profile)) throw new CliError(2, `No account stored for profile "${profile}"`);
      setActiveProfile(profile);
      log.success(`Active profile is now "${profile}"`);
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

authCommand
  .command("show")
  .description("Show the selected account (never the password or tokens)")
  .action(() => {
    try {
      const account = readAccount();
      output({
        profile: usesEnvAccount() ? "(ALUGHA_EMAIL)" : resolveProfile(),
        default: defaultProfile(),
        email: account.email,
        user: account.name ?? "-",
        session: account.accessToken ? "open" : "none",
      });
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

authCommand
  .command("logout")
  .description("Close the Alugha session and delete the stored account of the profile")
  .action(async () => {
    try {
      const profile = resolveProfile();
      if (hasAccount(profile) && readAccount(profile).accessToken) {
        await gql(`mutation CliLogout { logout }`).catch(() => undefined);
      }
      removeAccount(profile);
      log.success(`Profile "${profile}" logged out and removed`);
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });
