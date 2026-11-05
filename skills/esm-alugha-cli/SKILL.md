---
name: esm-alugha-cli
description: "Operate Alugha (Encounter's video hosting) directly with esm-alugha-cli: list the account's videos, read a video's language tracks, export or import subtitles (SRT), upload voice-over audio, edit track titles, publish tracks and follow Alugha jobs, or run any Alugha GraphQL operation. Use when the user talks about Alugha videos, tracks or publishing outside the FTO app workflow (for the FTO translation workflow, use esm-fto-cli)."
category: "productivity"
---

# esm-alugha-cli

Direct CLI for Alugha (https://alugha.com), the platform hosting Encounter's
videos. It logs in with an Alugha **e-mail + password** (Alugha has no API
key) and acts with that account's rights.

**FTO app first.** For the translation workflow (statuses, validation, SRT kept
in Drive, voice-over), go through `esm-fto-cli`: its `alugha` upload keeps the
FTO app and Drive in sync. Use `esm-alugha-cli` to inspect Alugha, fix a track,
or for what the FTO app does not do.

## Setup

```bash
esm-alugha-cli auth test         # which Alugha account
esm-alugha-cli auth list         # stored accounts (* = active)
```

If no account is stored, ask the user to log in themselves (the password is
prompted, never typed in a chat):

```bash
esm-alugha-cli auth login --email <alugha-email> [--profile esm] [--use]
```

The account (e-mail, password, session) is stored in
`~/.config/tokens/esm-alugha-cli-<profile>.json` (chmod 600). The session is
refreshed, then reopened with the stored password, automatically.
`ALUGHA_EMAIL` / `ALUGHA_PASSWORD` (same names as the backend) override the
profiles, for agents and CI. Accounts with 2FA are not supported.

## References

- **Video**: Alugha video id (uuid). The FTO app knows it per video code:
  `esm-fto-cli videos get q1.c2.s3` shows its Alugha id.
- **Language**: Alugha track code (`fra`, `deu`, `spa`, `por`, `ita`, `hrv`,
  `ces`, `eng-us`) or ISO (`fr`, `de`, `en` → `eng-us`).

## Commands

```bash
# Videos
esm-alugha-cli videos list [--search q1.c2] [--limit 50] [--order MODIFIED_DESC]
esm-alugha-cli videos get <video-id>            # tracks (languages), audio, published subtitles, voices

# Tracks
esm-alugha-cli tracks list <video-id> [fr de] [--json]   # what is on the video and since when (UTC):
#   per language: track created, subtitles first/last publish, voice-over audio added,
#   closed captions, audio description ("-" = not on Alugha)
esm-alugha-cli tracks create <video-id> fra [--name "..."]
esm-alugha-cli tracks update <video-id> fra --title "Titre" [--description "..."]

# Subtitles (raw SRT on stdout, pipeable)
esm-alugha-cli subtitles get <video-id> fra [-o fra.srt] [--format srt|vtt|txt] [--source subtitle|dubbing]
esm-alugha-cli subtitles put <video-id> fra -f fra.srt [--replace] [--publish]

# Audio (voice-over)
esm-alugha-cli audio put <video-id> fra -f fra.mp3

# Publish + jobs
esm-alugha-cli publish <video-id> [fra deu ...] [--wait]
esm-alugha-cli jobs get <job-id> [--wait]

# Anything else (public schema: introspection on https://alugha.com/graphql)
esm-alugha-cli gql '{ viewer { id name videoCount } }'
esm-alugha-cli gql 'query($id: ID!) { track(id: $id) { title } }' --vars '{"id":"..."}'
```

Global flags: `-p/--profile`, `--json`, `--format <text|json|csv|yaml>`,
`--verbose`, `--no-color`, `--no-header`.

## Guard rails

- `subtitles put` refuses to import into a track that already has segments
  (Alugha **appends**, which would duplicate every subtitle) unless `--replace`,
  which deletes them first. Export the current SRT before replacing.
- `publish` makes subtitles visible to viewers: confirm the languages with the
  user first.
- SRT for Alugha keeps its line breaks (the FTO convention: stored without line
  breaks, exported with them).

## Updates

Once a day esm-alugha-cli checks GitHub for a newer version. When a command prints
**Update available** on stderr (or `meta.update` in `--json` output), or an
error says the CLI is too old: tell the user, run `esm-alugha-cli self-update`, re-read
this skill (it is updated with the CLI), then run the command again.
`esm-alugha-cli self-update --check` checks right away.
