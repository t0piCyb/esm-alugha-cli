# esm-alugha-cli

CLI for Alugha (Encounter's video hosting), built with the
[api2cli](https://api2cli.dev) structure. Second of the ESM CLIs:
`esm-fto-cli`, `esm-alugha-cli`, `esm-thinkific-cli`.

Alugha exposes one GraphQL endpoint (`https://alugha.com/graphql`) and no
personal API key, so the CLI logs in with an e-mail + password, keeps the
session tokens (`authtoken` / `reftoken` cookies, like the web app), refreshes
them, and logs in again with the stored password when they expire.

## Install

```bash
bun install && bun run build
ln -sf "$PWD/dist/index.js" ~/.local/bin/esm-alugha-cli
ln -s "$PWD/skills/esm-alugha-cli" ~/.claude/skills/esm-alugha-cli
```

## Configure

```bash
esm-alugha-cli auth login --email <alugha-email>   # password prompted, not echoed
esm-alugha-cli auth test
```

Accounts: `~/.config/tokens/esm-alugha-cli-<profile>.json` (chmod 600).
`ALUGHA_EMAIL` / `ALUGHA_PASSWORD` override them (agents, CI, MCP server).

## Usage

See `skills/esm-alugha-cli/SKILL.md` (also used by AI agents).

## Layout

- `src/lib/client.ts` - GraphQL client: login, session refresh, re-login
- `src/lib/session.ts` - accounts and profiles
- `src/lib/alugha.ts` - languages, tracks, SRT parsing, asset upload
- `src/resources/` - videos, tracks/subtitles/audio/publish/jobs
- `src/commands/` - auth, raw `gql`
