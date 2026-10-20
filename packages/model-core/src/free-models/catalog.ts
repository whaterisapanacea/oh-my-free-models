import type { FreeModelCapabilities } from "./types"

export const MODELS_DEV_URL = "https://models.dev/api.json"
export const OPENCODE_PROVIDER_ID = "opencode"

type RawModel = {
	readonly id?: unknown
	readonly name?: unknown
	readonly family?: unknown
	readonly reasoning?: unknown
	readonly tool_call?: unknown
	readonly attachment?: unknown
	readonly modalities?: {
		readonly input?: unknown
		readonly output?: unknown
	}
	readonly cost?: {
		readonly input?: unknown
		readonly output?: unknown
	}
	readonly limit?: {
		readonly context?: unknown
		readonly output?: unknown
	}
	readonly release_date?: unknown
	readonly last_updated?: unknown
}

type RawProvider = {
	readonly name?: unknown
	readonly models?: unknown
}

export type ModelsDevPayload = Record<string, unknown>

export type FreeModelExtraction = {
	readonly providerId: string
	readonly providerName: string
	readonly totalModels: number
	readonly freeModels: readonly FreeModelCapabilities[]
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined
}

function asNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value
	if (typeof value === "string" && value.trim().length > 0) {
		const parsed = Number(value)
		if (Number.isFinite(parsed)) return parsed
	}
	return undefined
}

function asBoolean(value: unknown): boolean {
	return value === true
}

function asStringArray(value: unknown): readonly string[] {
	if (!Array.isArray(value)) return []
	return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
}

function normalizeFreeModel(
	providerId: string,
	modelKey: string,
	raw: RawModel,
): FreeModelCapabilities | undefined {
	const id = asString(raw.id) ?? modelKey
	const cost = asRecord(raw.cost)
	if (cost === undefined) return undefined

	const inputCost = asNumber(cost.input)
	const outputCost = asNumber(cost.output)
	if (inputCost !== 0 || outputCost !== 0) return undefined

	const limit = asRecord(raw.limit)
	const modalities = asRecord(raw.modalities)
	const inputModalities = asStringArray(modalities?.input)
	const outputModalities = asStringArray(modalities?.output)
	const name = asString(raw.name) ?? id
	const family = asString(raw.family)
	const releaseDate = asString(raw.release_date)
	const lastUpdated = asString(raw.last_updated)

	return {
		id,
		name,
		provider: providerId,
		model: `${providerId}/${id}`,
		...(family === undefined ? {} : { family }),
		contextLimit: asNumber(limit?.context) ?? 128_000,
		outputLimit: asNumber(limit?.output) ?? 32_000,
		toolCall: asBoolean(raw.tool_call),
		reasoning: asBoolean(raw.reasoning),
		inputModalities,
		outputModalities,
		cost: {
			input: inputCost,
			output: outputCost,
		},
		...(releaseDate === undefined ? {} : { releaseDate }),
		...(lastUpdated === undefined ? {} : { lastUpdated }),
	}
}

/**
 * Extract zero-cost models for one provider from a models.dev payload.
 *
 * models.dev represents a provider as `{ [providerId]: { name, models } }`.
 * A model is considered free only when both input and output token costs are
 * explicitly zero; missing cost data is never treated as free.
 */
export function extractFreeModels(
	payload: ModelsDevPayload,
	providerId: string = OPENCODE_PROVIDER_ID,
): FreeModelExtraction {
	const provider = asRecord(payload[providerId]) as RawProvider | undefined
	const providerModels = asRecord(provider?.models)
	if (providerModels === undefined) {
		return {
			providerId,
			providerName: providerId,
			totalModels: 0,
			freeModels: [],
		}
	}

	const modelEntries = Object.entries(providerModels)
	const freeModels: FreeModelCapabilities[] = []
	for (const [modelKey, value] of modelEntries) {
		const raw = asRecord(value) as RawModel | undefined
		if (raw === undefined) continue
		const normalized = normalizeFreeModel(providerId, modelKey, raw)
		if (normalized !== undefined) freeModels.push(normalized)
	}

	freeModels.sort((left, right) => left.id.localeCompare(right.id))

	return {
		providerId,
		providerName: asString(provider?.name) ?? providerId,
		totalModels: modelEntries.length,
		freeModels,
	}
}

export function isFreeModelCapabilities(value: unknown): value is FreeModelCapabilities {
	const raw = asRecord(value)
	return (
		raw !== undefined &&
		typeof raw.id === "string" &&
		typeof raw.model === "string" &&
		typeof raw.provider === "string" &&
		typeof raw.contextLimit === "number" &&
		typeof raw.outputLimit === "number" &&
		typeof raw.toolCall === "boolean" &&
		typeof raw.reasoning === "boolean" &&
		Array.isArray(raw.inputModalities) &&
		Array.isArray(raw.outputModalities) &&
		asRecord(raw.cost) !== undefined
	)
}
