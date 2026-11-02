import { Command } from "commander";
import { gql } from "../lib/client.js";
import { globalFlags } from "../lib/config.js";
import { handleError } from "../lib/errors.js";
import { readInput } from "../lib/io.js";
import { output } from "../lib/output.js";

/**
 * Any Alugha GraphQL operation with the stored session, for what the commands
 * do not cover. The schema is public: https://alugha.com/graphql (introspection).
 */
export const gqlCommand = new Command("gql")
  .description("Run any Alugha GraphQL query or mutation with the stored session")
  .argument("<query>", "GraphQL document, or @file.graphql, or - for stdin")
  .option("--vars <json>", "Variables as JSON", "{}")
  .addHelpText(
    "after",
    "\nExamples:\n  esm-alugha-cli gql '{ viewer { id name videoCount } }'\n  esm-alugha-cli gql 'query($id: ID!) { track(id: $id) { title } }' --vars '{\"id\":\"...\"}'",
  )
  .action(async (query: string, opts: { vars: string }) => {
    try {
      const document = query === "-" || query.startsWith("@") ? await readInput(query === "-" ? "-" : query.slice(1)) : query;
      output(await gql(document, JSON.parse(opts.vars) as Record<string, unknown>));
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });
