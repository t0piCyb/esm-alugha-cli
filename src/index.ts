#!/usr/bin/env bun
import { Command } from "commander";
import { authCommand } from "./commands/auth.js";
import { gqlCommand } from "./commands/gql.js";
import { globalFlags } from "./lib/config.js";
import { defaultProfile } from "./lib/session.js";
import {
  audioResource,
  jobsResource,
  publishCommand,
  subtitlesResource,
  tracksResource,
} from "./resources/tracks.js";
import { videosResource } from "./resources/videos.js";

// `esm-alugha-cli subtitles get ... | head` closes stdout early: exit quietly.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

const program = new Command();

program
  .name("esm-alugha-cli")
  .description(
    "Alugha CLI for Encounter ESM: videos, language tracks, subtitles (SRT), audio, publishing.\nLogs in with an Alugha e-mail + password (Alugha has no API key).",
  )
  .version("0.1.0")
  .option("-p, --profile <name>", "Account profile (default: ALUGHA_PROFILE, then the active profile)")
  .option("--json", "Output as JSON", false)
  .option("--format <fmt>", "Output format: text, json, csv, yaml", "text")
  .option("--verbose", "Enable debug logging", false)
  .option("--no-color", "Disable colored output")
  .option("--no-header", "Omit table/csv headers (for piping)")
  .addHelpText(
    "after",
    `
Videos are referenced by their Alugha id (uuid); languages by Alugha code (fra, deu, eng-us) or ISO (fr, de, en).

Quick start:
  esm-alugha-cli auth login --email ops@encounterschool.org
  esm-alugha-cli videos list --search q1.c2
  esm-alugha-cli videos get <video-id>
  esm-alugha-cli subtitles get <video-id> fra -o fra.srt
  esm-alugha-cli subtitles put <video-id> fra -f fra.srt --replace --publish
  esm-alugha-cli audio put <video-id> fra -f fra.mp3
  esm-alugha-cli publish <video-id> fra --wait`,
  )
  .hook("preAction", (_thisCmd, actionCmd) => {
    const root = actionCmd.optsWithGlobals();
    globalFlags.json = root.json ?? false;
    globalFlags.format = root.json ? "json" : (root.format ?? "text");
    globalFlags.verbose = root.verbose ?? false;
    globalFlags.noColor = root.color === false;
    globalFlags.noHeader = root.header === false;
    globalFlags.profile = root.profile ?? defaultProfile();
  });

program.addCommand(authCommand);
program.addCommand(videosResource);
program.addCommand(tracksResource);
program.addCommand(subtitlesResource);
program.addCommand(audioResource);
program.addCommand(publishCommand);
program.addCommand(jobsResource);
program.addCommand(gqlCommand);

program.parse();
