import { select as clackSelect, isCancel } from "@clack/prompts"
import {
	diffFreeModelCatalogs,
	evaluateAssignments,
	findOfficialProviderHint,
	findWorkProfile,
	recommendAssignments,
	type AssignmentHealth,
} from "@oh-my-opencode/model-core"

import { writeAssignmentsToOmoConfig, type WriteAssignmentsResult } from "./config-writes"
import {
	formatScore,
	formatTable,
	formatTimestamp,
	stripProvider,
} from "./render"
import { loadFreeModelCatalog, type LoadCatalogOptions } from "./source"
import {
	readFreeModelsState,
	resolveFreeModelsStatePath,
	writeFreeModelsState,
} from "./store"
import type {
	CommandErrorOutput,
	CommandOutput,
	FreeModelsState,
	StoredAssignment,
} from "./types"

export type StatusOptions = {
	readonly directory?: string
	readonly json?: boolean
	readonly refresh?: boolean
	readonly sourceUrl?: string
	readonly offline?: boolean
	readonly fix?: boolean
	readonly replaceExpired?: boolean
	readonly keepExpired?: boolean
	readonly check?: boolean
	readonly top?: number
	readonly chain?: number
	readonly scope?: "user" | "project"
}

type FixChoice = "replace" | "keep" | "skip"

export type StatusDeps = {
	readonly loadCatalog?: (options: LoadCatalogOptions) => ReturnType<typeof loadFreeModelCatalog>
	readonly readState?: typeof readFreeModelsState
	readonly writeState?: typeof writeFreeModelsState
	readonly writeConfig?: typeof writeAssignmentsToOmoConfig
	readonly recommend?: typeof recommendAssignments
	readonly select?: (message: string, details: string) => Promise<FixChoice>
	readonly stdout?: CommandOutput
	readonly stderr?: CommandErrorOutput
	readonly now?: () => Date
}

async function defaultSelect(message: string, details: string): Promise<FixChoice> {
	if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) return "skip"
	process.stdout.write(`${details}\n`)
	const answer = await clackSelect({
		message,
		options: [
			{ value: "replace", label: "Use the recommended replacement" },
			{ value: "keep", label: "Keep it and add the official API key" },
			{ value: "skip", label: "Skip for now" },
		],
	})
	return isCancel(answer) ? "skip" : (answer as FixChoice)
}

function needsFix(entry: AssignmentHealth): boolean {
	return entry.status === "expired" || entry.status === "degraded"
}

function checkExitCode(health: readonly AssignmentHealth[]): number {
	return health.some(needsFix) ? 2 : 0
}

function printHealthTable(stdout: CommandOutput, health: readonly AssignmentHealth[]): void {
	const rows = health.map((entry) => [
		entry.profileId,
		entry.kind,
		entry.chain[0] ?? "",
		entry.status,
	])
	stdout.write(`${formatTable(["ROLE", "KIND", "PRIMARY", "STATUS"], rows)}\n`)
}

function printKeepInstructions(stdout: CommandOutput, model: string): void {
	const hint = findOfficialProviderHint(stripProvider(model))
	stdout.write(`Kept ${model}.\n`)
	if (hint !== undefined) {
		stdout.write(
			`  Official provider: ${hint.label} (${hint.provider}${hint.apiKeyEnv === undefined ? "" : `, API key env ${hint.apiKeyEnv}`})\n`,
		)
	}
	stdout.write("  Run `opencode auth login` and choose the official provider, then point the role at the official model id.\n")
	stdout.write("  The CLI never asks for or stores API keys.\n")
}

export async function statusFreeModels(options: StatusOptions, deps: StatusDeps = {}): Promise<number> {
	const stdout = deps.stdout ?? process.stdout
	const stderr = deps.stderr ?? process.stderr
	const loadCatalog = deps.loadCatalog ?? loadFreeModelCatalog
	const readState = deps.readState ?? readFreeModelsState
	const writeState = deps.writeState ?? writeFreeModelsState
	const writeConfig = deps.writeConfig ?? writeAssignmentsToOmoConfig
	const recommend = deps.recommend ?? recommendAssignments
	const select = deps.select ?? defaultSelect
	const now = (deps.now ?? (() => new Date()))().toISOString()
	const top = Math.max(1, options.top ?? 3)
	const chainLength = Math.min(8, Math.max(1, options.chain ?? 3))
	const scope = options.scope === "project" ? "project" : "user"
	const directory = options.directory ?? process.cwd()
	const statePath = resolveFreeModelsStatePath(scope, directory)

	const stateResult = readState(statePath)
	for (const warning of stateResult.warnings) stderr.write(`warning: ${warning}\n`)
	const state = stateResult.state
	if (state === undefined) {
		if (options.json === true) {
			stdout.write(`${JSON.stringify({ statePath, state: "missing" }, null, 2)}\n`)
		} else {
			stdout.write(`No free-model state found at ${statePath}.\n`)
			stdout.write("Run `oh-my-free-models free-models apply` first to assign free models.\n")
		}
		return options.check === true ? 2 : 0
	}

	try {
		const catalog = await loadCatalog({
			refresh: options.refresh,
			sourceUrl: options.sourceUrl,
			offline: options.offline,
		})
		const snapshot = catalog.snapshot
		const health = evaluateAssignments(state.assignments, snapshot.freeModels, state.keptExpired)
		const diff = diffFreeModelCatalogs(state.freeModels, snapshot.freeModels)
		const affected = health.filter(needsFix)

		if (options.json === true && options.fix !== true) {
			stdout.write(`${JSON.stringify({
				statePath,
				updatedAt: state.updatedAt,
				sourceUrl: snapshot.sourceUrl,
				fetchedAt: snapshot.fetchedAt,
				fromCache: catalog.fromCache,
				freeModelCount: snapshot.freeModels.length,
				health,
				added: diff.added,
				removed: diff.removed,
				warnings: catalog.warnings,
			}, null, 2)}\n`)
			return options.check === true ? checkExitCode(health) : 0
		}

		if (options.fix !== true) {
			for (const warning of catalog.warnings) stderr.write(`warning: ${warning}\n`)
			stdout.write("Free-model status\n")
			stdout.write(`State: ${statePath} · last applied ${formatTimestamp(state.updatedAt)}\n`)
			stdout.write(
				`Catalog: ${snapshot.freeModels.length} free models (${catalog.fromCache ? "cached" : "live"}) · ${snapshot.providerName}\n`,
			)
			stdout.write(`Assignments: ${health.length}`)
			for (const status of ["ok", "degraded", "expired", "kept"] as const) {
				const count = health.filter((entry) => entry.status === status).length
				if (count > 0) stdout.write(` · ${status} ${count}`)
			}
			stdout.write("\n\n")
			printHealthTable(stdout, health)

			if (diff.added.length > 0) {
				stdout.write(`\nNEW FREE MODELS SINCE LAST APPLY (${diff.added.length})\n`)
				for (const model of diff.added.slice(0, 15)) stdout.write(`  + ${model.model}\n`)
				if (diff.added.length > 15) stdout.write(`  ... and ${diff.added.length - 15} more\n`)
			}
			if (diff.removed.length > 0) {
				stdout.write(`\nNO LONGER FREE (${diff.removed.length})\n`)
				for (const model of diff.removed.slice(0, 15)) stdout.write(`  - ${model.model}\n`)
				if (diff.removed.length > 15) stdout.write(`  ... and ${diff.removed.length - 15} more\n`)
			}

			if (affected.length > 0) {
				stdout.write("\nEXPIRED ASSIGNMENTS\n")
				for (const entry of affected) {
					stdout.write(`  ${entry.profileId}: ${entry.expired.join(", ")}\n`)
					const profile = findWorkProfile(entry.profileId)
					if (profile !== undefined) {
						const rec = recommend(snapshot.freeModels, [profile], { chainLength: top })
						const chain = rec.assignments[profile.id]?.chain ?? []
						if (chain.length > 0) {
							const scores = rec.assignments[profile.id]?.scores ?? []
							stdout.write(`    recommended: ${chain[0]}${scores[0] === undefined ? "" : ` (${formatScore(scores[0])})`}\n`)
							if (chain.length > 1) stdout.write(`    alternatives: ${chain.slice(1).join(", ")}\n`)
						}
					}
				}
				stdout.write("\nRun `oh-my-free-models free-models status --fix` to choose replacements or keep a model with its official API key.\n")
			} else {
				stdout.write("\nAll assignments are healthy.\n")
			}
			return options.check === true ? checkExitCode(health) : 0
		}

		if (options.replaceExpired === true && options.keepExpired === true) {
			stderr.write("--replace-expired and --keep-expired are mutually exclusive.\n")
			return 1
		}
		if (affected.length === 0) {
			if (options.json === true) {
				stdout.write(`${JSON.stringify({ statePath, changes: [], health, freeModelCount: snapshot.freeModels.length }, null, 2)}\n`)
			} else {
				stdout.write("All assignments are healthy; nothing to fix.\n")
			}
			return 0
		}
		if (
			options.replaceExpired !== true &&
			options.keepExpired !== true &&
			(process.stdin.isTTY !== true || process.stdout.isTTY !== true)
		) {
			stderr.write("No interactive terminal available. Re-run with --replace-expired or --keep-expired.\n")
			return 1
		}

		const expiredGroups = new Map<string, string[]>()
		for (const entry of affected) {
			for (const model of entry.expired) {
				const profiles = expiredGroups.get(model) ?? []
				if (!profiles.includes(entry.profileId)) profiles.push(entry.profileId)
				expiredGroups.set(model, profiles)
			}
		}

		const assignments: Record<string, StoredAssignment> = { ...state.assignments }
		const kept = new Set(state.keptExpired)
		const changed: Record<string, StoredAssignment> = {}
		const replacements: Array<{ model: string; profiles: string[] }> = []
		const keptModels: string[] = []
		const skipped: string[] = []

		for (const [model, profiles] of [...expiredGroups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
			const recommendationLines: string[] = []
			const recommendationsByProfile = new Map<string, string[]>()
			for (const profileId of profiles) {
				const profile = findWorkProfile(profileId)
				if (profile === undefined) continue
				const rec = recommend(snapshot.freeModels, [profile], { chainLength })
				const chain = rec.assignments[profile.id]?.chain
				if (chain === undefined || chain.length === 0) continue
				recommendationsByProfile.set(profileId, [...chain])
				const scores = rec.assignments[profile.id]?.scores ?? []
				recommendationLines.push(
					`  ${profileId}: ${chain[0]}${scores[0] === undefined ? "" : ` (${formatScore(scores[0])})`}${
						chain.length > 1 ? `; alternatives: ${chain.slice(1).join(", ")}` : ""
					}`,
				)
			}

			let choice: FixChoice
			if (options.replaceExpired === true) choice = "replace"
			else if (options.keepExpired === true) choice = "keep"
			else {
				choice = await select(
					`${model} is no longer free. What should happen for ${profiles.join(", ")}?`,
					`Expired: ${model}\n${recommendationLines.join("\n")}`,
				)
			}

			if (choice === "keep") {
				kept.add(model)
				keptModels.push(model)
				continue
			}
			if (choice === "skip") {
				skipped.push(model)
				continue
			}

			let replacedAny = false
			for (const profileId of profiles) {
				const chain = recommendationsByProfile.get(profileId)
				const previous = assignments[profileId]
				if (chain === undefined || previous === undefined) continue
				assignments[profileId] = { kind: previous.kind, chain }
				changed[profileId] = assignments[profileId]
				replacedAny = true
			}
			if (replacedAny) replacements.push({ model, profiles: [...profiles] })
			else skipped.push(model)
		}

		let configResult: WriteAssignmentsResult | undefined
		if (Object.keys(changed).length > 0) {
			configResult = writeConfig({
				assignments: changed,
				scope,
				...(scope === "project" ? { projectDir: directory } : {}),
			})
		}

		const nextState: FreeModelsState = {
			...state,
			updatedAt: now,
			sourceUrl: snapshot.sourceUrl,
			providerId: snapshot.providerId,
			freeModels: snapshot.freeModels,
			assignments,
			keptExpired: [...kept],
		}
		writeState(nextState, statePath)

		const nextHealth = evaluateAssignments(assignments, snapshot.freeModels, [...kept])
		if (options.json === true) {
			stdout.write(`${JSON.stringify({
				statePath,
				configPath: configResult?.path,
				backupPath: configResult?.backupPath,
				replacements,
				kept: keptModels,
				skipped,
				health: nextHealth,
				warnings: catalog.warnings,
			}, null, 2)}\n`)
		} else {
			if (replacements.length > 0) {
				stdout.write(`Replaced ${replacements.length} expired free model${replacements.length === 1 ? "" : "s"}:\n`)
				for (const replacement of replacements) {
					stdout.write(`  ${replacement.model} → ${replacement.profiles.join(", ")}\n`)
				}
			}
			if (keptModels.length > 0) {
				for (const model of keptModels) printKeepInstructions(stdout, model)
			}
			if (skipped.length > 0) {
				stdout.write(`Skipped: ${skipped.join(", ")}\n`)
			}
			if (configResult !== undefined) {
				stdout.write(`Config: ${configResult.path}\n`)
				if (configResult.backupPath !== undefined) stdout.write(`Backup: ${configResult.backupPath}\n`)
			}
			stdout.write(`State:  ${statePath}\n`)
			if (configResult === undefined && keptModels.length > 0) {
				stdout.write("Configuration was left unchanged; only the kept-expired marker was recorded.\n")
			}
		}
		return options.check === true ? checkExitCode(nextHealth) : 0
	} catch (error) {
		stderr.write(`Free-model status failed: ${error instanceof Error ? error.message : String(error)}\n`)
		return 1
	}
}
