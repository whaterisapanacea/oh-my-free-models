import type { FreeModelCapabilities, ModelFeatures, ModelTrait } from "./types"

const CODING_KEYWORD = /(?:^|[-_.])(?:code|coder|coding|dev)(?:[-_.]|$)/i
const WRITING_KEYWORD = /(?:^|[-_.])(?:writer|writing|prose|story|novel)(?:[-_.]|$)/i
const QUICK_KEYWORD = /(?:^|[-_.])quick(?:[-_.]|$)/i
const FAST_KEYWORD = /flash|lightning|turbo|speed|spark|highspeed|instant/i
const SMALL_KEYWORD = /(?:^|[-_.])(?:mini|tiny|lite|air|nano|small)(?:[-_.]|$)/i
const SLOW_KEYWORD = /(?:^|[-_.])(?:pro|max|ultra|reason|think|opus|large)(?:[-_.]|$)/i
const PREVIEW_KEYWORD = /preview|alpha|beta|experimental/i

const CODING_FAMILIES = [
	"deepseek",
	"qwen",
	"kimi",
	"glm",
	"minimax",
	"mimo",
	"grok",
	"longcat",
	"north",
	"pickle",
	"step",
	"nemotron",
]

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0
	if (value <= 0) return 0
	if (value >= 1) return 1
	return value
}

function logScore(value: number, minimum: number, maximum: number): number {
	if (!Number.isFinite(value) || value <= minimum) return 0
	return clamp01(Math.log(value / minimum) / Math.log(maximum / minimum))
}

function textOf(model: FreeModelCapabilities): string {
	return `${model.id} ${model.name} ${model.family ?? ""}`.toLowerCase()
}

function codingPrior(model: FreeModelCapabilities): number {
	const text = textOf(model)
	let prior = 0.55
	if (CODING_KEYWORD.test(text)) prior = 1
	else if (CODING_FAMILIES.some((family) => text.includes(family))) prior = 0.8
	if (prior >= 0.8) {
		if (model.reasoning) prior += 0.03
		if (model.contextLimit >= 200_000) prior += 0.03
	}
	return clamp01(prior)
}

function writingPrior(model: FreeModelCapabilities, coding: number): number {
	const text = textOf(model)
	if (WRITING_KEYWORD.test(text)) return 0.95
	const base = 0.6 + (1 - coding) * 0.2
	return clamp01(base + (model.contextLimit >= 200_000 ? 0.05 : 0))
}

function speedPrior(model: FreeModelCapabilities): number {
	const text = textOf(model)
	if (QUICK_KEYWORD.test(text)) return 1
	if (FAST_KEYWORD.test(text)) return model.contextLimit >= 1_000_000 ? 0.75 : 0.9
	if (SMALL_KEYWORD.test(text)) return 0.95
	if (SLOW_KEYWORD.test(text)) return 0.3
	if (PREVIEW_KEYWORD.test(text)) return 0.6
	if (model.contextLimit >= 1_000_000) return 0.45
	return 0.55
}

function lightweightPrior(model: FreeModelCapabilities): number {
	const text = textOf(model)
	if (model.contextLimit <= 256_000 && SMALL_KEYWORD.test(text)) return 1
	if (model.contextLimit <= 128_000) return 0.6
	if (model.contextLimit >= 1_000_000) return 0
	return 0.2
}

function hasModality(model: FreeModelCapabilities, modality: string): number {
	return model.inputModalities.includes(modality) ? 1 : 0
}

/**
 * Turn raw catalog metadata into normalized 0..1 traits used by the scorer.
 * Everything here is deterministic so the same catalog always yields the same
 * recommendations.
 */
export function extractModelFeatures(model: FreeModelCapabilities): ModelFeatures {
	const coding = codingPrior(model)
	const context = logScore(model.contextLimit, 16_000, 1_048_576)
	const output = logScore(model.outputLimit, 4_000, 256_000)
	const toolCall = model.toolCall ? 1 : 0
	const reasoning = model.reasoning ? 1 : 0
	const agentic = clamp01(0.4 * toolCall + 0.2 * reasoning + 0.2 * context + 0.2 * coding)

	return {
		coding,
		reasoning,
		context,
		output,
		speed: speedPrior(model),
		lightweight: lightweightPrior(model),
		toolCall,
		vision: hasModality(model, "image"),
		video: hasModality(model, "video"),
		audio: hasModality(model, "audio"),
		writing: writingPrior(model, coding),
		agentic,
	}
}

export function describeModelTraits(features: ModelFeatures, minimum = 0.6): string {
	const labels: Array<[ModelTrait, string]> = [
		["coding", "coding"],
		["reasoning", "reasoning"],
		["context", "long-context"],
		["output", "long-output"],
		["speed", "fast"],
		["lightweight", "lightweight"],
		["toolCall", "tools"],
		["vision", "vision"],
		["video", "video"],
		["audio", "audio"],
		["writing", "writing"],
		["agentic", "agentic"],
	]
	return labels
		.filter(([trait]) => features[trait] >= minimum)
		.sort((left, right) => features[right[0]] - features[left[0]])
		.map(([, label]) => label)
		.join(", ")
}
