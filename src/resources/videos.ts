import { Command } from "commander";
import { getVideo } from "../lib/alugha.js";
import { gql } from "../lib/client.js";
import { globalFlags } from "../lib/config.js";
import { handleError } from "../lib/errors.js";
import { output } from "../lib/output.js";

export const videosResource = new Command("videos").description("Videos of the Alugha account");

const ORDERS = ["MODIFIED_DESC", "MODIFIED_ASC", "CREATED_DESC", "CREATED_ASC", "PUBLISHED_DESC", "PUBLISHED_ASC"];

videosResource
  .command("list")
  .description("List the account's videos (most recently modified first)")
  .option("--limit <n>", "Max results", "20")
  .option("--offset <n>", "Skip the first n videos", "0")
  .option("--order <order>", `Sort: ${ORDERS.join(", ")}`, "MODIFIED_DESC")
  .option("--search <text>", "Keep videos whose title contains this text (case-insensitive)")
  .addHelpText("after", "\nExample:\n  esm-alugha-cli videos list --search q1.c2 --limit 50")
  .action(async (opts: { limit: string; offset: string; order: string; search?: string }) => {
    try {
      const { viewer } = await gql<{ viewer: { id: string } }>(`query CliViewerId { viewer { id } }`);
      const { videos } = await gql<{
        videos: Array<{
          id: string;
          modified: string;
          published: string | null;
          duration: number | null;
          languages: string[] | null;
          defaultTrack: { title: string } | null;
        }>;
      }>(
        `query CliVideos($userIds: [String!], $limit: Int, $offset: Int, $orderBy: VideoOrder) {
          videos(userIds: $userIds, limit: $limit, offset: $offset, orderBy: $orderBy) {
            id modified published duration languages defaultTrack { title }
          }
        }`,
        {
          userIds: [viewer.id],
          limit: Number(opts.limit),
          offset: Number(opts.offset),
          orderBy: opts.order.toUpperCase(),
        },
      );
      const needle = opts.search?.toLowerCase();
      output(
        videos
          .filter((v) => !needle || v.defaultTrack?.title.toLowerCase().includes(needle))
          .map((v) => ({
            id: v.id,
            title: v.defaultTrack?.title ?? "",
            languages: (v.languages ?? []).join(","),
            duration: v.duration ? `${Math.round(v.duration)}s` : "",
            published: v.published ?? "",
            modified: v.modified,
          })),
      );
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

videosResource
  .command("get")
  .description("Show a video with its tracks (languages) and voices")
  .argument("<video-id>", "Alugha video id (uuid)")
  .addHelpText("after", "\nExample:\n  esm-alugha-cli videos get c945d630-615f-11f0-93ad-637e4d67dc1a")
  .action(async (id: string) => {
    try {
      const video = await getVideo(id);
      if (globalFlags.json || globalFlags.format !== "text") {
        output(video);
        return;
      }
      output({
        id: video.id,
        title: video.defaultTrack?.title ?? "",
        published: video.published ?? "",
        duration: video.duration ? `${Math.round(video.duration)}s` : "",
        canEdit: video.viewerCanEdit,
        voices: video.voices.map((v) => v.name).join(", "),
      });
      output(
        video.tracks.map((t) => ({
          lang: t.langCode,
          trackId: t.id,
          title: t.title,
          default: t.isDefaultTrack ? "*" : "",
          audio: t.assetId ? "yes" : "",
          subtitles: t.subtitleAssetId ? "published" : "",
          modified: t.modified,
        })),
      );
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

