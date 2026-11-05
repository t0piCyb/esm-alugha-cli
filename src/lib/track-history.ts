import { gql } from "./client.js";
import { CliError } from "./errors.js";

type DatedAsset = {
  id: string;
  created: string;
  modified: string;
  name: string | null;
  type: string | null;
  duration: number | null;
};

type HistoryTrack = {
  id: string;
  langCode: string;
  title: string;
  isDefaultTrack: boolean;
  created: string;
  modified: string;
  asset: DatedAsset | null;
  subtitleAsset: DatedAsset | null;
  closedCaptionsAsset: DatedAsset | null;
  audioDescriptionAsset: DatedAsset | null;
};

const ASSET_FIELDS = "id created modified name type duration";

const TRACK_HISTORY_QUERY = /* GraphQL */ `
  query CliTrackHistory($id: ID!) {
    video(id: $id) {
      id created modified published
      tracks {
        id langCode title isDefaultTrack created modified
        asset { ${ASSET_FIELDS} }
        subtitleAsset { ${ASSET_FIELDS} }
        closedCaptionsAsset { ${ASSET_FIELDS} }
        audioDescriptionAsset { ${ASSET_FIELDS} }
      }
    }
  }
`;

const dated = (asset: DatedAsset | null) =>
  asset
    ? { assetId: asset.id, added: asset.created, updated: asset.modified, name: asset.name, duration: asset.duration }
    : null;

/**
 * What is on a video, and since when. Per language track: when the track was
 * created, when its subtitles were first / last published (Alugha reuses the
 * subtitle file on every publish), when its voice-over audio was attached
 * (only `type: audio`: the source track's asset is the original video),
 * closed captions and audio description. `null` = not on Alugha.
 */
export async function getTrackHistory(videoId: string) {
  const { video } = await gql<{
    video: { id: string; created: string; modified: string; published: string | null; tracks: HistoryTrack[] } | null;
  }>(TRACK_HISTORY_QUERY, { id: videoId });
  if (!video) throw new CliError(404, `Video ${videoId} not found on Alugha (or not visible to this account)`);
  return {
    id: video.id,
    created: video.created,
    published: video.published,
    tracks: [...video.tracks]
      .sort((a, b) => a.langCode.localeCompare(b.langCode))
      .map((t) => ({
        lang: t.langCode,
        trackId: t.id,
        title: t.title,
        isDefault: t.isDefaultTrack,
        trackCreated: t.created,
        subtitles: t.subtitleAsset
          ? { assetId: t.subtitleAsset.id, firstPublished: t.subtitleAsset.created, lastPublished: t.subtitleAsset.modified }
          : null,
        audio: t.asset?.type === "audio" ? dated(t.asset) : null,
        sourceVideo: t.asset && t.asset.type !== "audio" ? dated(t.asset) : null,
        closedCaptions: dated(t.closedCaptionsAsset),
        audioDescription: dated(t.audioDescriptionAsset),
      })),
  };
}

export type TrackHistory = Awaited<ReturnType<typeof getTrackHistory>>;
