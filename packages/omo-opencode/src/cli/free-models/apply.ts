import { join } from "node:path"

import { confirm as clackConfirm, isCancel } from "@clack/prompts"
import { ALL_WORK_PROFILES, recommendAssignments } from "@oh-my-opencode/model-core"
import { resolveUserOmoConfigPath } from "@oh-my-opencode/omo-config-core"

import { loadPluginConfig } from "../../plugin-config"
import { writeAssignmentsToOmoConfig, type WriteAssignmentsResult } from "./config-writes"
import { formatTable } from "./render"
import { loadFreeModelCatalog, type LoadCatalogOptions } from "./source"
import {
	resolveFreeModelsStatePath,
	writeFreeModelsState,
} from "./store"
import type { CommandErrorOutput, CommandOutput, FreeModelsState, StoredAssignment } from "./types"

export type ApplyOptions = {
	readonly directory?: string
	readonly json?: boolean
	readonly refresh?: boolean
	readonly sourceUrl?: string
	readonly offline?: boolean
	readonly chain?: number
	readonly spread?: boolean
	readonly yes?: boolean
	readonly dryRun?: boolean
	readonly scope?: "user" | "project"
}

export type ApplyDeps = {
	readonly loadCatalog?: (options: LoadCatalogOptions) => ReturnType<typeof loadFreeModelCatalog>
	readonly recommend?: typeof recommendAssignments
	readonly writeState?: typeof writeFreeModelsState
	readonly writeConfig?: typeof writeAssignmentsToOmoConfig
	readonly loadConfig?: typeof loadPluginConfig
	readonly confirm?: (message: string) => Promise<boolean>
	readonly stdout?: CommandOutput
	readonly stderr?: CommandErrorOutput
	readonly now?: () => Date
}

async function defaultConfirm(message: string): Promise<boolean> {
	if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) return false
	const answer = await clackConfirm({ message })
	return isCancel(answer) ? false : answer === true
}

function targetConfigPath(directory: string, scope: "user" | "project"): string {
	return scope === "user" ? resolveUserOmoConfigPath() : join(directory, ".omo", "omo.jsonc")
}

export async function applyFreeModels(options: ApplyOptions, deps: ApplyDeps = {}): Promise<number> {
	const stdout = deps.stdout ?? process.stdout
	const stderr = deps.stderr ?? process.stderr
	const loadCatalog = deps.loadCatalog ?? loadFreeModelCatalog
	const recommend = deps.recommend ?? recommendAssignments
	const writeState = deps.writeState ?? writeFreeModelsState
	const writeConfig = deps.writeConfig ?? writeAssignmentsToOmoConfig
	const loadConfig = deps.loadConfig ?? loadPluginConfig
	const confirm = deps.confirm ?? defaultConfirm
	const directory = options.directory ?? process.cwd()
	const scope = options.scope === "project" ? "project" : "user"
	const chainLength = Math.min(8, Math.max(1, Math.floor(options.chain ?? 3)))

	try {
		const catalog = await loadCatalog({
			refresh: options.refresh,
			sourceUrl: options.sourceUrl,
			offline: options.offline,
		})
		const snapshot = catalog.snapshot
		const recommendations = recommend(snapshot.freeModels, ALL_WORK_PROFILES, {
			chainLength,
			diversityPenalty: options.spread === false ? 0 : 0.03,
		})

		const assignments: Record<string, StoredAssignment> = {}
		for (const [profileId, assignment] of Object.entries(recommendations.assignments)) {
			assignments[profileId] = {
				kind: assignment.kind,
				chain: [...assignment.chain],
			}
		}

		let enableRuntimeFallback = false
		try {
			const currentConfig = loadConfig(directory, null)
			enableRuntimeFallback = currentConfig.runtime_fallback === undefined
		} catch {
			// A broken user config should not block applying free models; the writer
			// will refuse to edit malformed JSONC on its own.
		}

		const configPath = targetConfigPath(directory, scope)
		const statePath = resolveFreeModelsStatePath(scope, directory)
		const now = (deps.now ?? (() => new Date()))().toISOString()

		const roleRows = Object.entries(assignments).map(([profileId, assignment]) => [
			profileId,
			assignment.kind,
			assignment.chain[0] ?? "",
			assignment.chain.slice(1).join(", "),
		])

		if (options.dryRun === true) {
			if (options.json === true) {
				stdout.write(`${JSON.stringify({
					dryRun: true,
					configPath,
					statePath,
					freeModelCount: snapshot.freeModels.length,
					assignments,
					warnings: [...catalog.warnings, ...recommendations.warnings],
				}, null, 2)}\n`)
			} else {
				for (const warning of catalog.warnings) stderr.write(`warning: ${warning}\n`)
				stdout.write(`Dry run · ${snapshot.freeModels.length} free models · ${Object.keys(assignments).length} assignments\n`)
				stdout.write(`${formatTable(["ROLE", "KIND", "PRIMARY", "FALLBACKS"], roleRows)}\n`)
				stdout.write(`\nWould write: ${configPath}\nState file:  ${statePath}\n`)
				for (const warning of recommendations.warnings) stderr.write(`warning: ${warning}\n`)
			}
			return 0
		}

		if (options.yes !== true) {
			const confirmed = await confirm(
				`Apply ${Object.keys(assignments).length} free-model assignments to ${configPath}?`,
			)
			if (!confirmed) {
				if (options.json === true) {
					stdout.write(`${JSON.stringify({ applied: false, reason: "not-confirmed", configPath }, null, 2)}\n`)
				} else {
					stdout.write("Aborted. Re-run with --yes to apply the recommendations non-interactively.\n")
				}
				return process.stdin.isTTY === true ? 0 : 1
			}
		}

		let configResult: WriteAssignmentsResult
		try {
			configResult = writeConfig({
				assignments,
				scope,
				...(scope === "project" ? { projectDir: directory } : {}),
				enableRuntimeFallback,
			})
		} catch (error) {
			throw new Error(`Could not update ${configPath}: ${error instanceof Error ? error.message : String(error)}`)
		}

		const state: FreeModelsState = {
			version: 1,
			updatedAt: now,
			sourceUrl: snapshot.sourceUrl,
			providerId: snapshot.providerId,
			freeModels: snapshot.freeModels,
			assignments,
			keptExpired: [],
		}
		writeState(state, statePath)

		if (options.json === true) {
			stdout.write(`${JSON.stringify({
				applied: true,
				configPath: configResult.path,
				backupPath: configResult.backupPath,
				statePath,
				updatedAt: now,
				freeModelCount: snapshot.freeModels.length,
				assignments,
				warnings: [...catalog.warnings, ...recommendations.warnings],
			}, null, 2)}\n`)
			return 0
		}

		for (const warning of catalog.warnings) stderr.write(`warning: ${warning}\n`)
		stdout.write(`Applied ${Object.keys(assignments).length} free-model assignments.\n`)
		stdout.write(`${formatTable(["ROLE", "KIND", "PRIMARY", "FALLBACKS"], roleRows)}\n`)
		stdout.write(`\nConfig: ${configResult.path}\n`)
		if (configResult.backupPath !== undefined) stdout.write(`Backup: ${configResult.backupPath}\n`)
		stdout.write(`State:  ${statePath}\n`)
		if (enableRuntimeFallback) stdout.write("Enabled runtime_fallback so a failing free model can fall back inside its chain.\n")
		for (const warning of recommendations.warnings) stderr.write(`warning: ${warning}\n`)
		return 0
	} catch (error) {
		stderr.write(`Free-model apply failed: ${error instanceof Error ? error.message : String(error)}\n`)
		return 1
	}
}
