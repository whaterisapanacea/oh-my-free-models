import {
	ALL_WORK_PROFILES,
	describeModelTraits,
	extractModelFeatures,
	rankProfilesForModel,
	recommendAssignments,
} from "@oh-my-opencode/model-core"

import {
	formatLimit,
	formatModalities,
	formatScore,
	formatTable,
	formatTimestamp,
	stripProvider,
} from "./render"
import { loadFreeModelCatalog, type LoadCatalogOptions } from "./source"
import type { CommandErrorOutput, CommandOutput } from "./types"

export type ScanOptions = {
	readonly json?: boolean
	readonly refresh?: boolean
	readonly sourceUrl?: string
	readonly offline?: boolean
	readonly top?: number
	readonly limit?: number
	readonly spread?: boolean
}

export type ScanDeps = {
	readonly loadCatalog?: (options: LoadCatalogOptions) => ReturnType<typeof loadFreeModelCatalog>
	readonly stdout?: CommandOutput
	readonly stderr?: CommandErrorOutput
}

export async function scanFreeModels(options: ScanOptions, deps: ScanDeps = {}): Promise<number> {
	const stdout = deps.stdout ?? process.stdout
	const stderr = deps.stderr ?? process.stderr
	const loadCatalog = deps.loadCatalog ?? loadFreeModelCatalog
	const top = Math.max(1, options.top ?? 3)
	const requestedModelLimit = options.limit ?? 20

	try {
		const catalog = await loadCatalog({
			refresh: options.refresh,
			sourceUrl: options.sourceUrl,
			offline: options.offline,
		})
		const snapshot = catalog.snapshot
		const recommendations = recommendAssignments(snapshot.freeModels, ALL_WORK_PROFILES, {
			chainLength: top,
			diversityPenalty: options.spread === false ? 0 : 0.03,
		})

		if (options.json === true) {
			stdout.write(`${JSON.stringify({
				sourceUrl: snapshot.sourceUrl,
				fetchedAt: snapshot.fetchedAt,
				fromCache: catalog.fromCache,
				provider: {
					id: snapshot.providerId,
					name: snapshot.providerName,
					totalModels: snapshot.totalModels,
				},
				freeModelCount: snapshot.freeModels.length,
				models: snapshot.freeModels,
				recommendations: recommendations.assignments,
				warnings: [...catalog.warnings, ...recommendations.warnings],
			}, null, 2)}\n`)
			return 0
		}

		for (const warning of catalog.warnings) stderr.write(`warning: ${warning}\n`)

		stdout.write("oh-my-free-models · free model scan\n")
		stdout.write(
			`Source: ${snapshot.sourceUrl} (${catalog.fromCache ? "cached" : "live"}) · fetched ${formatTimestamp(snapshot.fetchedAt)}\n`,
		)
		stdout.write(
			`Provider: ${snapshot.providerName} · ${snapshot.totalModels} models · ${snapshot.freeModels.length} free\n\n`,
		)

		const modelRows = snapshot.freeModels.map((model) => [
			model.id,
			formatLimit(model.contextLimit),
			formatLimit(model.outputLimit),
			model.toolCall ? "yes" : "no",
			model.reasoning ? "yes" : "no",
			formatModalities(model.inputModalities),
		])
		stdout.write(`FREE MODELS (${snapshot.freeModels.length})\n`)
		stdout.write(`${formatTable(["MODEL", "CTX", "OUT", "TOOLS", "REASON", "INPUT"], modelRows)}\n\n`)

		const byModel = new Map(snapshot.freeModels.map((model) => [model.model, model]))
		const roleRows = ALL_WORK_PROFILES.flatMap((profile) => {
			const assignment = recommendations.assignments[profile.id]
			if (assignment === undefined) return []
			const primary = assignment.chain[0]
			if (primary === undefined) return []
			const selectedModel = byModel.get(primary)
			const strengths = selectedModel === undefined
				? ""
				: describeModelTraits(extractModelFeatures(selectedModel), 0.7)
			return [[
				profile.id,
				profile.kind,
				primary,
				formatScore(assignment.scores[0] ?? 0),
				strengths,
			]]
		})
		stdout.write(`BEST MODEL BY WORK (${roleRows.length} roles)\n`)
		stdout.write(`${formatTable(["ROLE", "KIND", "PRIMARY", "SCORE", "STRENGTHS"], roleRows)}\n\n`)

		const modelLimit = requestedModelLimit <= 0 ? snapshot.freeModels.length : requestedModelLimit
		const modelWorkRows = snapshot.freeModels.slice(0, modelLimit).map((model) => {
			const best = rankProfilesForModel(model, ALL_WORK_PROFILES, 3)
			const work = best.map((entry) => `${entry.profile.id} ${formatScore(entry.score)}`).join(", ")
			return [stripProvider(model.model), work]
		})
		const suffix = snapshot.freeModels.length > modelLimit ? ` (${modelLimit} of ${snapshot.freeModels.length}; use --limit 0 for all)` : ""
		stdout.write(`MODEL → BEST WORK${suffix}\n`)
		stdout.write(`${formatTable(["MODEL", "BEST WORK"], modelWorkRows)}\n`)

		for (const warning of recommendations.warnings) stderr.write(`warning: ${warning}\n`)
		return 0
	} catch (error) {
		stderr.write(`Free-model scan failed: ${error instanceof Error ? error.message : String(error)}\n`)
		return 1
	}
}
