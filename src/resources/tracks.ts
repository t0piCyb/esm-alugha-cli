import { Command } from "commander";
import {
  createTrack,
  DEFAULT_VOICE,
  findTrack,
  getVideo,
  parseSrt,
  requireTrack,
  toAlughaLang,
  uploadAsset,
} from "../lib/alugha.js";
import { gql } from "../lib/client.js";
import { globalFlags } from "../lib/config.js";
import { CliError, handleError } from "../lib/errors.js";
import { readInput, writeOutput } from "../lib/io.js";
import { log } from "../lib/logger.js";
import { output } from "../lib/output.js";
import { getTrackHistory } from "../lib/track-history.js";

const LANG_HELP = "Language: Alugha code (fra, deu, eng-us...) or ISO (fr, de, en)";

// ---------------------------------------------------------------- tracks

export const tracksResource = new Command("tracks").description("Language tracks of a video");

tracksResource
  .command("create")
  .description("Create the track of a language (fails if it exists)")
  .argument("<video-id>", "Alugha video id")
  .argument("<lang>", LANG_HELP)
  .option("--name <name>", "Track name")
  .action(async (videoId: string, lang: string, opts: { name?: string }) => {
    try {
      const { track: existing } = await findTrack(videoId, lang);
      if (existing) throw new CliError(409, `The ${existing.langCode} track already exists (${existing.id})`);
      const track = await createTrack(videoId, lang, opts.name);
      output({ trackId: track.id, lang: track.langCode, title: track.title });
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

tracksResource
  .command("update")
  .description("Edit the title / description of a language track")
  .argument("<video-id>", "Alugha video id")
  .argument("<lang>", LANG_HELP)
  .option("--title <title>", "Track title (the video title in that language)")
  .option("--description <text>", "Track description")
  .action(async (videoId: string, lang: string, opts: { title?: string; description?: string }) => {
    try {
      if (opts.title === undefined && opts.description === undefined) {
        throw new CliError(2, "Nothing to update", "Pass --title and/or --description");
      }
      const { track } = await requireTrack(videoId, lang);
      const { updateTrack } = await gql<{ updateTrack: { id: string; title: string; description: string | null } }>(
        `mutation CliUpdateTrack($trackId: ID!, $input: UpdateTrackInput!) {
          updateTrack(trackId: $trackId, input: $input) { id title description }
        }`,
        { trackId: track.id, input: { title: opts.title, description: opts.description } },
      );
      output(updateTrack);
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

const shortDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 16).replace("T", " ") : "-");

tracksResource
  .command("list")
  .alias("history")
  .description("What is on a video, and since when: per language, subtitles, voice-over audio and other assets with their dates")
  .argument("<video-id>", "Alugha video id")
  .argument("[langs...]", "Only these languages")
  .addHelpText(
    "after",
    `
Dates are UTC. subtitles = first / last publish (Alugha reuses the subtitle file on
each publish); audio = when the current voice-over was attached; "-" = not on Alugha.

Examples:
  esm-alugha-cli tracks list <video-id>
  esm-alugha-cli tracks list <video-id> fr de --json`,
  )
  .action(async (videoId: string, langs: string[]) => {
    try {
      const history = await getTrackHistory(videoId);
      const codes = langs.map(toAlughaLang);
      const tracks = codes.length
        ? history.tracks.filter((t) => codes.some((c) => t.lang === c || t.lang.split("-")[0] === c.split("-")[0]))
        : history.tracks;
      if (globalFlags.json || globalFlags.format !== "text") {
        output({ ...history, tracks });
        return;
      }
      output(
        tracks.map((t) => ({
          lang: t.lang,
          track: shortDate(t.trackCreated),
          subtitlesFirst: shortDate(t.subtitles?.firstPublished),
          subtitlesLast: shortDate(t.subtitles?.lastPublished),
          audio: shortDate(t.audio?.added),
          closedCaptions: shortDate(t.closedCaptions?.added),
          audioDescription: shortDate(t.audioDescription?.added),
        })),
      );
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

// ---------------------------------------------------------------- subtitles

export const subtitlesResource = new Command("subtitles").description("Subtitles of a language track (SRT)");

subtitlesResource
  .command("get")
  .description("Export a track's subtitles (raw SRT on stdout, or -o file)")
  .argument("<video-id>", "Alugha video id")
  .argument("<lang>", LANG_HELP)
  .option("-o, --out <file>", "Write to a file")
  .option("--format <fmt>", "srt, vtt or txt", "srt")
  .option("--source <source>", "subtitle (default) or dubbing segments", "subtitle")
  .action(async (videoId: string, lang: string, opts: { out?: string; format: string; source: string }) => {
    try {
      const { track } = await requireTrack(videoId, lang);
      const format = { srt: "Srt", vtt: "Webvtt", txt: "Plaintext" }[opts.format.toLowerCase()];
      if (!format) throw new CliError(2, `Unknown format ${opts.format}`);
      const source = opts.source.toLowerCase() === "dubbing" ? "Dubbing" : "Subtitle";
      const { exportSubtitle } = await gql<{ exportSubtitle: string | null }>(
        `query CliExportSubtitle($trackId: ID!, $format: SubtitleFormat!, $source: SegmentSource!) {
          exportSubtitle(trackId: $trackId, format: $format, source: $source)
        }`,
        { trackId: track.id, format, source },
      );
      if (!exportSubtitle?.trim()) throw new CliError(404, `The ${track.langCode} track has no ${source.toLowerCase()} segments`);
      writeOutput(exportSubtitle, opts.out);
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

subtitlesResource
  .command("put")
  .description("Import an SRT into a language track (creates the track if needed)")
  .argument("<video-id>", "Alugha video id")
  .argument("<lang>", LANG_HELP)
  .requiredOption("-f, --file <path>", "SRT file, or - for stdin")
  .option("--replace", "Delete the track's existing subtitle segments first")
  .option("--publish", "Publish the track's subtitles after the import")
  .addHelpText(
    "after",
    "\nAlugha appends imported segments: use --replace on a track that already has subtitles.\n\nExample:\n  esm-alugha-cli subtitles put <video> fra -f q1.c2.s3_fra.srt --replace --publish",
  )
  .action(async (videoId: string, lang: string, opts: { file: string; replace?: boolean; publish?: boolean }) => {
    try {
      const cues = parseSrt(await readInput(opts.file));
      let { video, track } = await findTrack(videoId, lang);
      if (!track) {
        track = await createTrack(videoId, lang);
        log.info(`Created the ${track.langCode} track (${track.id})`);
      }

      const { track: withSegments } = await gql<{ track: { subtitleSegments: Array<{ id: string }> } }>(
        `query CliTrackSegments($id: ID!) { track(id: $id) { subtitleSegments { id } } }`,
        { id: track.id },
      );
      const existing = withSegments.subtitleSegments.length;
      if (existing > 0 && !opts.replace) {
        throw new CliError(
          409,
          `The ${track.langCode} track already has ${existing} subtitle segments; importing would duplicate them`,
          "Add --replace to delete them first",
        );
      }
      if (existing > 0) {
        await gql(
          `mutation CliClearSegments($input: RemoveAllSubtitleSegmentsInput!) { removeAllSubtitleSegments(input: $input) }`,
          { input: { trackId: track.id } },
        );
        log.info(`Deleted ${existing} existing segments`);
      }

      const voice = video.voices[0] ?? DEFAULT_VOICE;
      const { importSubtitleSegments } = await gql<{ importSubtitleSegments: Array<{ id: string }> }>(
        `mutation CliImportSegments($trackId: ID!, $newVoices: [ImportSegmentsVoice!]!, $cues: [ImportSegmentsCue!]!) {
          importSubtitleSegments(trackId: $trackId, newVoices: $newVoices, cues: $cues) { id }
        }`,
        {
          trackId: track.id,
          newVoices: video.voices.length > 0 ? [] : [DEFAULT_VOICE],
          cues: cues.map((c) => ({ ...c, voiceId: voice.id })),
        },
      );
      log.success(`Imported ${importSubtitleSegments.length} segments into ${track.langCode}`);

      if (opts.publish) await publishTracks(videoId, [track.id]);
      if (globalFlags.json) output({ trackId: track.id, lang: track.langCode, segments: importSubtitleSegments.length });
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

// ---------------------------------------------------------------- audio

export const audioResource = new Command("audio").description("Audio (voice-over) of a language track");

audioResource
  .command("put")
  .description("Upload an audio file as the track's audio (creates the track if needed)")
  .argument("<video-id>", "Alugha video id")
  .argument("<lang>", LANG_HELP)
  .requiredOption("-f, --file <path>", "Audio file (mp3, wav, m4a)")
  .action(async (videoId: string, lang: string, opts: { file: string }) => {
    try {
      let { track } = await findTrack(videoId, lang);
      if (!track) {
        track = await createTrack(videoId, lang);
        log.info(`Created the ${track.langCode} track (${track.id})`);
      }
      const assetId = await uploadAsset(opts.file, "audio");
      await gql(
        `mutation CliAttachAudio($trackId: ID!, $input: UpdateTrackInput!) {
          updateTrack(trackId: $trackId, input: $input) { id assetId }
        }`,
        { trackId: track.id, input: { assetId } },
      );
      log.success(`Audio attached to the ${track.langCode} track (asset ${assetId})`);
      if (globalFlags.json) output({ trackId: track.id, lang: track.langCode, assetId });
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

// ---------------------------------------------------------------- publish & jobs

type Job = { id: string; state: string; type: string; error: string | null; created: string; updatedAt: string };

async function publishTracks(videoId: string, trackIds: string[]): Promise<Job[]> {
  const { exportTrackSubtitles } = await gql<{ exportTrackSubtitles: Job[] }>(
    `mutation CliPublish($trackIds: [String!]!) {
      exportTrackSubtitles(trackIds: $trackIds, hasColoredSubtitles: false) { id state type error created updatedAt }
    }`,
    { trackIds },
  );
  log.success(`Publishing ${trackIds.length} track(s) of ${videoId}: job ${exportTrackSubtitles.map((j) => j.id).join(", ")}`);
  return exportTrackSubtitles;
}

export const publishCommand = new Command("publish")
  .description("Publish the subtitles of some or all language tracks (starts an Alugha export job)")
  .argument("<video-id>", "Alugha video id")
  .argument("[langs...]", "Languages to publish (default: every track)")
  .option("--wait", "Wait until the job completes")
  .addHelpText("after", "\nExamples:\n  esm-alugha-cli publish <video> fra deu --wait\n  esm-alugha-cli publish <video>")
  .action(async (videoId: string, langs: string[], opts: { wait?: boolean }) => {
    try {
      const video = await getVideo(videoId);
      const codes = langs.map(toAlughaLang);
      const tracks = codes.length ? video.tracks.filter((t) => codes.includes(t.langCode)) : video.tracks;
      const missing = codes.filter((c) => !tracks.some((t) => t.langCode === c));
      if (missing.length) throw new CliError(404, `No track for: ${missing.join(", ")}`);
      const jobs = await publishTracks(videoId, tracks.map((t) => t.id));
      output(opts.wait ? await Promise.all(jobs.map((j) => waitJob(j.id))) : jobs);
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

async function getJob(id: string): Promise<Job> {
  const { job } = await gql<{ job: Job | null }>(
    `query CliJob($id: ID!) { job(id: $id) { id state type error created updatedAt } }`,
    { id },
  );
  if (!job) throw new CliError(404, `Job ${id} not found`);
  return job;
}

async function waitJob(id: string, timeoutMs = 10 * 60_000): Promise<Job> {
  const started = Date.now();
  for (;;) {
    const job = await getJob(id);
    if (!["Enqueued", "Active"].includes(job.state)) return job;
    if (Date.now() - started > timeoutMs) throw new CliError(1, `Job ${id} still ${job.state} after 10 min`);
    await Bun.sleep(3000);
  }
}

export const jobsResource = new Command("jobs").description("Alugha background jobs (exports, encodings)");

jobsResource
  .command("get")
  .description("Show a job")
  .argument("<job-id>", "Job id")
  .option("--wait", "Wait until the job is no longer queued or running")
  .action(async (id: string, opts: { wait?: boolean }) => {
    try {
      output(opts.wait ? await waitJob(id) : await getJob(id));
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });
