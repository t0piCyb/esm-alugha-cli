/** Alugha domain helpers shared by the commands: languages, tracks, SRT, uploads. */
import { readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { gql } from "./client.js";
import { CliError } from "./errors.js";

/**
 * ESM short codes -> Alugha track codes (same table as `esm_alugha_driver`).
 * English is `eng-us` on Alugha; anything else passes through unchanged.
 */
const LANGUAGE_CODES: Record<string, string> = {
  fr: "fra",
  en: "eng-us",
  eng: "eng-us",
  de: "deu",
  es: "spa",
  it: "ita",
  pt: "por",
  hr: "hrv",
  ru: "rus",
  tr: "tur",
  zh: "zho",
  ar: "ara",
  cs: "ces",
};

export const toAlughaLang = (lang: string): string => {
  const code = lang.trim().toLowerCase();
  return LANGUAGE_CODES[code] ?? code;
};

export type Track = {
  id: string;
  langCode: string;
  name: string;
  title: string;
  state: number;
  isDefaultTrack: boolean;
  assetId: string | null;
  subtitleAssetId: string | null;
  modified: string;
};

export type Voice = { id: string; name: string; color: string };

export type Video = {
  id: string;
  created: string;
  modified: string;
  published: string | null;
  state: number;
  duration: number | null;
  languages: string[] | null;
  viewerCanEdit: boolean;
  defaultTrack: { title: string; langCode: string } | null;
  tracks: Track[];
  voices: Voice[];
};

const TRACK_FIELDS = "id langCode name title state isDefaultTrack assetId subtitleAssetId modified";

export const VIDEO_QUERY = /* GraphQL */ `
  query CliVideo($id: ID!) {
    video(id: $id) {
      id created modified published state duration languages viewerCanEdit
      defaultTrack { title langCode }
      tracks { ${TRACK_FIELDS} }
      voices { id name color }
    }
  }
`;

export async function getVideo(id: string): Promise<Video> {
  const { video } = await gql<{ video: Video | null }>(VIDEO_QUERY, { id });
  if (!video) throw new CliError(404, `Video ${id} not found on Alugha (or not visible to this account)`);
  return video;
}

/** The video's track for a language; `null` when it does not exist yet. */
export async function findTrack(videoId: string, lang: string): Promise<{ video: Video; track: Track | null }> {
  const video = await getVideo(videoId);
  const code = toAlughaLang(lang);
  return { video, track: video.tracks.find((t) => t.langCode === code) ?? null };
}

export async function requireTrack(videoId: string, lang: string): Promise<{ video: Video; track: Track }> {
  const { video, track } = await findTrack(videoId, lang);
  if (!track) {
    throw new CliError(
      404,
      `No ${toAlughaLang(lang)} track on video ${videoId}`,
      `Existing tracks: ${video.tracks.map((t) => t.langCode).join(", ") || "none"}`,
    );
  }
  return { video, track };
}

export async function createTrack(videoId: string, lang: string, name?: string): Promise<Track> {
  const { createTrack } = await gql<{ createTrack: Track | null }>(
    `mutation CliCreateTrack($videoId: ID!, $langCode: String!, $name: String) {
      createTrack(videoId: $videoId, langCode: $langCode, name: $name) { ${TRACK_FIELDS} }
    }`,
    { videoId, langCode: toAlughaLang(lang), name },
  );
  if (!createTrack) throw new CliError(1, `Alugha did not create the ${toAlughaLang(lang)} track`);
  return createTrack;
}

export type Cue = { start: number; end: number; text: string };

const TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})/;
const toMs = (m: RegExpMatchArray) =>
  ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);

/** SRT -> cues in milliseconds; multi-line text is kept as is. */
export function parseSrt(content: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of content.replace(/\r\n?/g, "\n").trim().split(/\n{2,}/)) {
    const lines = block.split("\n");
    const timeIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeIndex < 0) continue;
    const [from, to] = lines[timeIndex]!.split("-->");
    const start = from?.match(TIME);
    const end = to?.match(TIME);
    const text = lines.slice(timeIndex + 1).join("\n").trim();
    if (start && end && text) cues.push({ start: toMs(start), end: toMs(end), text });
  }
  if (cues.length === 0) throw new CliError(2, "No subtitle found in the SRT content");
  return cues;
}

/**
 * Voice used for imported cues. Alugha needs every cue attached to a voice:
 * reuse the video's first voice, else create the driver's default one.
 */
export const DEFAULT_VOICE: Voice = { id: "688ca7fc-1f79-4ea2-be61-6e974f8d8d18", name: "Patrick", color: "#be0032" };

const ASSET_TYPES: Record<string, string> = {
  ".mp3": "audio",
  ".wav": "audio",
  ".m4a": "audio",
  ".aac": "audio",
  ".srt": "subtitle",
  ".vtt": "subtitle",
};

/** Creates an asset and uploads the file in one part (same flow as the web app). */
export async function uploadAsset(path: string, type?: string): Promise<string> {
  const filename = basename(path);
  const assetType = type ?? ASSET_TYPES[extname(filename).toLowerCase()];
  if (!assetType) throw new CliError(2, `Unknown file type for ${filename}; pass --type`);
  statSync(path);

  const { createAsset } = await gql<{ createAsset: { id: string } }>(
    `mutation CliCreateAsset($type: String!, $name: String!, $originalName: String) {
      createAsset(type: $type, name: $name, originalName: $originalName) { id }
    }`,
    { type: assetType, name: filename.replace(/\.[^.]+$/, ""), originalName: filename },
  );
  const assetId = createAsset.id;
  const { createMultipartUpload } = await gql<{ createMultipartUpload: { token: string } }>(
    `mutation CliCreateUpload($assetId: ID!) { createMultipartUpload(assetId: $assetId) { id token } }`,
    { assetId },
  );
  const { prepareUploadPart } = await gql<{ prepareUploadPart: string }>(
    `mutation CliPreparePart($token: String!, $number: Int!) { prepareUploadPart(token: $token, number: $number) }`,
    { token: createMultipartUpload.token, number: 1 },
  );
  const put = await fetch(prepareUploadPart, { method: "PUT", body: readFileSync(path) });
  if (!put.ok) throw new CliError(put.status, `${put.status}: upload of ${filename} failed`);
  await gql(`mutation CliCompleteUpload($assetId: ID!) { completeMultipartUpload(assetId: $assetId) }`, { assetId });
  return assetId;
}
