import { extractModelFeatures } from "./features"
import type {
	FreeModelCapabilities,
	ModelFeatures,
	ProfileRanking,
	RankedModel,
	RankedProfile,
	RecommendationSet,
	RecommendedChain,
	WorkProfile,
} from "./types"

export type RecommendationOptions = {
	/** Number of models in each role's primary + fallback chain. Defaults to 3. */
	readonly chainLength?: number
	/**
	 * Optional score penalty for a model that is already the primary of another
	 * role. Zero (the default) always picks the pure best fit; a small value
	 * spreads assignments across more of the free catalog.
	 */
	readonly diversityPenalty?: number
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0
	if (value <= 0) return 0
	if (value >= 1) return 1
	return value
}

export function isEligibleForProfile(model: FreeModelCapabilities, profile: WorkProfile): boolean {
	if (profile.requiresToolCall !== false && !model.toolCall) return false
	if (profile.minContext !== undefined && model.contextLimit < profile.minContext) return false
	if (profile.requiredInputModalities !== undefined) {
		for (const modality of profile.requiredInputModalities) {
			if (!model.inputModalities.includes(modality)) return false
		}
	}
	return true
}

/**
 * Weighted average of normalized model traits for a work profile.
 * Returns -1 when a hard requirement is not met.
 */
export function scoreModelForProfile(
	model: FreeModelCapabilities,
	profile: WorkProfile,
	features: ModelFeatures = extractModelFeatures(model),
): number {
	if (!isEligibleForProfile(model, profile)) return -1

	let weighted = 0
	let totalWeight = 0
	for (const [trait, weight] of Object.entries(profile.weights)) {
		if (weight === undefined || weight <= 0) continue
		weighted += weight * (features[trait as keyof ModelFeatures] ?? 0)
		totalWeight += weight
	}
	return totalWeight === 0 ? 0 : clamp01(weighted / totalWeight)
}

function compareRanked(left: RankedModel, right: RankedModel): number {
	if (right.score !== left.score) return right.score - left.score
	if (right.model.contextLimit !== left.model.contextLimit) {
		return right.model.contextLimit - left.model.contextLimit
	}
	if (right.model.outputLimit !== left.model.outputLimit) {
		return right.model.outputLimit - left.model.outputLimit
	}
	return left.model.id.localeCompare(right.model.id)
}

export function rankModelsForProfile(
	models: readonly FreeModelCapabilities[],
	profile: WorkProfile,
): ProfileRanking {
	const eligible: RankedModel[] = []
	const relaxed: RankedModel[] = []

	for (const model of models) {
		const features = extractModelFeatures(model)
		if (isEligibleForProfile(model, profile)) {
			eligible.push({ model, score: scoreModelForProfile(model, profile, features), features })
		} else {
			// Score the relaxed candidate on traits only; hard requirements are intentionally ignored.
			const relaxedScore = scoreRelaxed(model, profile, features)
			relaxed.push({ model, score: relaxedScore, features })
		}
	}

	if (eligible.length > 0) {
		eligible.sort(compareRanked)
		return { ranked: eligible, relaxed: false }
	}

	relaxed.sort(compareRanked)
	return { ranked: relaxed, relaxed: relaxed.length > 0 }
}

function scoreRelaxed(
	model: FreeModelCapabilities,
	profile: WorkProfile,
	features: ModelFeatures,
): number {
	let weighted = 0
	let totalWeight = 0
	for (const [trait, weight] of Object.entries(profile.weights)) {
		if (weight === undefined || weight <= 0) continue
		weighted += weight * (features[trait as keyof ModelFeatures] ?? 0)
		totalWeight += weight
	}
	const base = totalWeight === 0 ? 0 : clamp01(weighted / totalWeight)
	// Nudge models that at least support tools above ones that cannot call tools at all.
	return clamp01(base * (model.toolCall ? 1 : 0.75))
}

export function rankProfilesForModel(
	model: FreeModelCapabilities,
	profiles: readonly WorkProfile[],
	limit = 3,
): readonly RankedProfile[] {
	const features = extractModelFeatures(model)
	const ranked: RankedProfile[] = []
	for (const profile of profiles) {
		if (!isEligibleForProfile(model, profile)) continue
		ranked.push({ profile, score: scoreModelForProfile(model, profile, features) })
	}
	ranked.sort((left, right) => {
		if (right.score !== left.score) return right.score - left.score
		return left.profile.id.localeCompare(right.profile.id)
	})
	return ranked.slice(0, Math.max(0, limit))
}

/**
 * Pick the best primary + fallback chain for every work profile.
 *
 * The same model may be selected for multiple profiles when it is genuinely the
 * best fit. That is intentional: forcing one model per role would lower quality.
 */
export function recommendAssignments(
	models: readonly FreeModelCapabilities[],
	profiles: readonly WorkProfile[],
	options: RecommendationOptions = {},
): RecommendationSet {
	const chainLength = Math.max(1, Math.floor(options.chainLength ?? 3))
	const diversityPenalty = Math.max(0, options.diversityPenalty ?? 0)
	const primaryUsage = new Map<string, number>()
	const assignments: Record<string, RecommendedChain> = {}
	const warnings: string[] = []

	if (models.length === 0) {
		return { assignments, warnings: ["No free models were found; nothing to assign."] }
	}

	for (const profile of profiles) {
		const ranking = rankModelsForProfile(models, profile)
		if (ranking.ranked.length === 0) {
			warnings.push(`No model matched ${profile.id}; the role was left unchanged.`)
			continue
		}
		if (ranking.relaxed) {
			warnings.push(
				`No model satisfied the hard requirements for ${profile.id}; using the closest available model instead.`,
			)
		}
		const adjusted = diversityPenalty === 0
			? ranking.ranked
			: [...ranking.ranked]
				.map((entry) => ({
					...entry,
					score: Math.max(0, entry.score - diversityPenalty * (primaryUsage.get(entry.model.model) ?? 0)),
				}))
				.sort(compareRanked)
		const selected = adjusted.slice(0, chainLength)
		const primary = selected[0]?.model.model
		if (primary !== undefined) primaryUsage.set(primary, (primaryUsage.get(primary) ?? 0) + 1)
		assignments[profile.id] = {
			profileId: profile.id,
			kind: profile.kind,
			label: profile.label,
			chain: selected.map((entry) => entry.model.model),
			scores: selected.map((entry) => Number(entry.score.toFixed(4))),
			relaxed: ranking.relaxed,
		}
	}

	return { assignments, warnings }
}

export function bestModelForProfile(
	models: readonly FreeModelCapabilities[],
	profile: WorkProfile,
): RankedModel | undefined {
	return rankModelsForProfile(models, profile).ranked[0]
}
