export type ModelTrait =
	| "coding"
	| "reasoning"
	| "context"
	| "output"
	| "speed"
	| "lightweight"
	| "toolCall"
	| "vision"
	| "video"
	| "audio"
	| "writing"
	| "agentic"

export type WorkKind = "agent" | "category"

/**
 * A model that is currently offered at zero cost by a provider.
 *
 * The shape is intentionally provider-agnostic: the scanner normalizes models.dev
 * entries into this structure so selection code never has to deal with raw API data.
 */
export type FreeModelCapabilities = {
	readonly id: string
	readonly name: string
	readonly provider: string
	/** Fully qualified model id, e.g. `opencode/deepseek-v4.1-flash-free`. */
	readonly model: string
	readonly family?: string
	readonly contextLimit: number
	readonly outputLimit: number
	readonly toolCall: boolean
	readonly reasoning: boolean
	readonly inputModalities: readonly string[]
	readonly outputModalities: readonly string[]
	readonly cost: {
		readonly input: number
		readonly output: number
	}
	readonly releaseDate?: string
	readonly lastUpdated?: string
}

export type WorkProfile = {
	readonly id: string
	readonly kind: WorkKind
	readonly label: string
	readonly description: string
	readonly weights: Partial<Record<ModelTrait, number>>
	/** Hard requirement, e.g. multimodal work needs an image-capable model. */
	readonly requiredInputModalities?: readonly string[]
	readonly minContext?: number
	/** Agent and category work both need tool calling. Defaults to true. */
	readonly requiresToolCall?: boolean
}

export type ModelFeatures = Record<ModelTrait, number>

export type RankedModel = {
	readonly model: FreeModelCapabilities
	readonly score: number
	readonly features: ModelFeatures
}

export type RankedProfile = {
	readonly profile: WorkProfile
	readonly score: number
}

export type ProfileRanking = {
	readonly ranked: readonly RankedModel[]
	/** True when no model satisfied the profile's hard requirements and they were relaxed. */
	readonly relaxed: boolean
}

export type RecommendedChain = {
	readonly profileId: string
	readonly kind: WorkKind
	readonly label: string
	readonly chain: readonly string[]
	readonly scores: readonly number[]
	readonly relaxed: boolean
}

export type RecommendationSet = {
	readonly assignments: Readonly<Record<string, RecommendedChain>>
	readonly warnings: readonly string[]
}

export type CatalogDiff = {
	readonly added: readonly FreeModelCapabilities[]
	readonly removed: readonly FreeModelCapabilities[]
}
