import { Command, Option } from "commander"

import { applyFreeModels, type ApplyOptions } from "./apply"
import { scanFreeModels, type ScanOptions } from "./scan"
import { statusFreeModels, type StatusOptions } from "./status"

type ScanCommandOptions = Omit<ScanOptions, "top" | "limit"> & { top?: number; limit?: number }
type ApplyCommandOptions = Omit<ApplyOptions, "chain"> & { chain?: number }
type StatusCommandOptions = Omit<StatusOptions, "top" | "chain"> & { top?: number; chain?: number }

export function configureFreeModelsCommands(program: Command): void {
	const freeModels = program
		.command("free-models")
		.alias("free")
		.description("Scan OpenCode's free models and assign the best fit to every agent and category")

	freeModels
		.command("scan")
		.description("Scan the current free models and show the best work for each")
		.option("-d, --directory <path>", "Working directory (used for config context)")
		.option("--json", "Output machine-readable JSON")
		.option("--refresh", "Force a live scan instead of using the 6 hour cache")
		.option("--offline", "Use the cached catalog without touching the network")
		.option("--source-url <url>", "Override the models.dev source URL")
		.option("--top <n>", "Models per role chain (default: 3)", (value) => Number.parseInt(value, 10))
		.option("--limit <n>", "Rows in the model-to-work table; 0 shows all (default: 20)", (value) => Number.parseInt(value, 10))
		.option("--no-spread", "Always pick the single best model per role instead of spreading roles across the catalog")
		.action(async (options: ScanCommandOptions) => {
			process.exit(await scanFreeModels(options))
		})

	freeModels
		.command("apply")
		.description("Recommend free models for every role and write them to ~/.omo/omo.jsonc")
		.option("-d, --directory <path>", "Project directory (for --scope project)")
		.option("--json", "Output machine-readable JSON")
		.option("--refresh", "Force a live scan instead of using the 6 hour cache")
		.option("--offline", "Use the cached catalog without touching the network")
		.option("--source-url <url>", "Override the models.dev source URL")
		.option("--chain <n>", "Models per role chain (default: 3)", (value) => Number.parseInt(value, 10))
		.option("--no-spread", "Always pick the single best model per role instead of spreading roles across the catalog")
		.option("--yes", "Apply without an interactive confirmation")
		.option("--dry-run", "Show the assignments and target paths without writing")
		.addOption(new Option("--scope <scope>", "Where to write the config").choices(["user", "project"]).default("user"))
		.addHelpText("after", `
Examples:
  $ oh-my-free-models free-models scan
  $ oh-my-free-models free-models scan --refresh --json
  $ oh-my-free-models free-models apply --dry-run
  $ oh-my-free-models free-models apply --yes
  $ oh-my-free-models free-models apply --yes --scope project
`)
		.action(async (options: ApplyCommandOptions) => {
			process.exit(await applyFreeModels(options))
		})

	freeModels
		.command("status")
		.description("Check whether assigned free models expired and offer replacements")
		.option("-d, --directory <path>", "Project directory (for --scope project)")
		.option("--json", "Output machine-readable JSON")
		.option("--refresh", "Force a live scan instead of using the 6 hour cache")
		.option("--offline", "Use the cached catalog without touching the network")
		.option("--source-url <url>", "Override the models.dev source URL")
		.option("--fix", "Interactively replace expired models or keep them with an official key")
		.option("--replace-expired", "Replace every expired assignment without prompting")
		.option("--keep-expired", "Keep expired models and print official API key instructions")
		.option("--check", "Exit with code 2 when any assignment is expired")
		.option("--top <n>", "Replacement alternatives to show (default: 3)", (value) => Number.parseInt(value, 10))
		.option("--chain <n>", "Models per replacement chain (default: 3)", (value) => Number.parseInt(value, 10))
		.addOption(new Option("--scope <scope>", "Where to write config fixes").choices(["user", "project"]).default("user"))
		.addHelpText("after", `
Examples:
  $ oh-my-free-models free-models status
  $ oh-my-free-models free-models status --check
  $ oh-my-free-models free-models status --fix
  $ oh-my-free-models free-models status --replace-expired
  $ oh-my-free-models free-models status --keep-expired

Expiry flow:
  1. A configured free model disappears from the free catalog.
  2. status rescans models.dev and ranks the current free models for that role.
  3. Choose the recommended replacement, or keep the old model and add its
     official provider API key with 'opencode auth login'.
`)
		.action(async (options: StatusCommandOptions) => {
			process.exit(await statusFreeModels(options))
		})

	freeModels.action(() => {
		freeModels.outputHelp()
	})
}
