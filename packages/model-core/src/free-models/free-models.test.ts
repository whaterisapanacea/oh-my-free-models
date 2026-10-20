import { describe, expect, test } from "bun:test"

import { extractFreeModels } from "./catalog"
import { diffFreeModelCatalogs, evaluateAssignments } from "./expiry"
import { describeModelTraits, extractModelFeatures } from "./features"
import { findOfficialProviderHint } from "./official-providers"
import { AGENT_WORK_PROFILES, ALL_WORK_PROFILES, CATEGORY_WORK_PROFILES, findWorkProfile } from "./profiles"
import { rankProfilesForModel, recommendAssignments } from "./selector"
import type { FreeModelCapabilities } from "./types"

function model(overrides: Partial<FreeModelCapabilities> & Pick<FreeModelCapabilities, "id">): FreeModelCapabilities {
	const { id, ...rest } = overrides
	return {
		id,
		name: id,
		provider: "opencode",
		model: `opencode/${id}`,
		contextLimit: 200_000,
		outputLimit: 32_000,
		toolCall: true,
		reasoning: true,
		inputModalities: ["text"],
		outputModalities: ["text"],
		cost: { input: 0, output: 0 },
		...rest,
	}
}

const MODELS: readonly FreeModelCapabilities[] = [
	model({
		id: "deepseek-v4.1-flash-free",
		contextLimit: 200_000,
		outputLimit: 32_000,
		inputModalities: ["text", "image"],
	}),
	model({
		id: "minimax-m3.1-flash-free",
		contextLimit: 1_048_576,
		outputLimit: 512_000,
		inputModalities: ["text", "image", "video"],
	}),
	model({
		id: "nemotron-3.5-super-vl-free",
		contextLimit: 1_048_576,
		outputLimit: 131_072,
		inputModalities: ["text", "image"],
	}),
	model({
		id: "longcat-2.5-preview-free",
		contextLimit: 1_048_576,
		outputLimit: 131_072,
		inputModalities: ["text", "image"],
	}),
	model({
		id: "quick-mini-free",
		contextLimit: 128_000,
		outputLimit: 16_000,
		reasoning: false,
	}),
	model({
		id: "no-tools-free",
		contextLimit: 1_048_576,
		outputLimit: 131_072,
		toolCall: false,
	}),
]

describe("extractFreeModels", () => {
	test("keeps only models whose input and output costs are explicitly zero", () => {
		const payload = {
			opencode: {
				name: "OpenCode Zen",
				models: {
					"free-model": {
						id: "free-model",
						name: "Free Model",
						cost: { input: 0, output: 0 },
						limit: { context: 200_000, output: 32_000 },
						tool_call: true,
						reasoning: true,
						modalities: { input: ["text", "image"], output: ["text"] },
					},
					"paid-model": {
						id: "paid-model",
						cost: { input: 1, output: 2 },
					},
					"unknown-cost": {
						id: "unknown-cost",
					},
				},
			},
		}

		const extraction = extractFreeModels(payload)
		expect(extraction.totalModels).toBe(3)
		expect(extraction.freeModels).toHaveLength(1)
		expect(extraction.freeModels[0]?.model).toBe("opencode/free-model")
		expect(extraction.freeModels[0]?.inputModalities).toEqual(["text", "image"])
	})

	test("returns an empty result for an unknown provider", () => {
		const extraction = extractFreeModels({}, "missing")
		expect(extraction.freeModels).toEqual([])
		expect(extraction.totalModels).toBe(0)
	})
})

describe("model features", () => {
	test("recognizes vision, speed, and long context", () => {
		const vision = extractModelFeatures(MODELS[0]!)
		expect(vision.vision).toBe(1)
		expect(vision.coding).toBeGreaterThan(0.7)

		const fast = extractModelFeatures(MODELS[4]!)
		expect(fast.speed).toBeGreaterThan(vision.speed)

		const longContext = extractModelFeatures(MODELS[1]!)
		expect(longContext.context).toBeGreaterThan(0.9)
	})

	test("describes the strongest traits", () => {
		const traits = describeModelTraits(extractModelFeatures(MODELS[0]!))
		expect(traits).toContain("coding")
		expect(traits).toContain("vision")
	})
})

describe("recommendAssignments", () => {
	test("picks a vision model for multimodal work", () => {
		const result = recommendAssignments(MODELS, ALL_WORK_PROFILES, { chainLength: 2 })
		const looker = result.assignments["multimodal-looker"]
		expect(looker).toBeDefined()
		expect(looker?.chain).toHaveLength(2)
		for (const selected of looker?.chain ?? []) {
			expect(["opencode/deepseek-v4.1-flash-free", "opencode/minimax-m3.1-flash-free", "opencode/nemotron-3.5-super-vl-free", "opencode/longcat-2.5-preview-free"]).toContain(selected)
		}
	})

	test("picks the fastest model for the quick category", () => {
		const result = recommendAssignments(MODELS, CATEGORY_WORK_PROFILES, { chainLength: 1 })
		expect(result.assignments["quick"]?.chain[0]).toBe("opencode/quick-mini-free")
	})

	test("never selects a model without tool support for an agent", () => {
		const result = recommendAssignments(MODELS, AGENT_WORK_PROFILES, { chainLength: 6 })
		for (const assignment of Object.values(result.assignments)) {
			expect(assignment.chain).not.toContain("opencode/no-tools-free")
		}
	})

	test("relaxes hard requirements and warns when no vision model exists", () => {
		const textOnly = MODELS.filter((entry) => !entry.inputModalities.includes("image"))
		const result = recommendAssignments(textOnly, ALL_WORK_PROFILES, { chainLength: 2 })
		expect(result.assignments["multimodal-looker"]?.relaxed).toBe(true)
		expect(result.warnings.some((warning) => warning.includes("multimodal-looker"))).toBe(true)
	})

	test("returns every requested role with a unique chain", () => {
		const result = recommendAssignments(MODELS, ALL_WORK_PROFILES, { chainLength: 3 })
		expect(Object.keys(result.assignments)).toHaveLength(ALL_WORK_PROFILES.length)
		for (const assignment of Object.values(result.assignments)) {
			expect(new Set(assignment.chain).size).toBe(assignment.chain.length)
		}
	})
})

describe("rankProfilesForModel", () => {
	test("ranks coding-heavy roles for a coding model", () => {
		const ranked = rankProfilesForModel(MODELS[0]!, ALL_WORK_PROFILES, 3)
		expect(ranked.length).toBeGreaterThan(0)
		expect(ranked.map((entry) => entry.profile.id)).toContain("hephaestus")
	})

	test("excludes vision roles for a text-only model", () => {
		const textOnly = model({ id: "text-only-free" })
		const ranked = rankProfilesForModel(textOnly, ALL_WORK_PROFILES, 20)
		expect(ranked.map((entry) => entry.profile.id)).not.toContain("multimodal-looker")
	})
})

describe("expiry", () => {
	test("diffs added and removed free models", () => {
		const previous = [MODELS[0]!, MODELS[1]!]
		const current = [MODELS[1]!, MODELS[2]!]
		const diff = diffFreeModelCatalogs(previous, current)
		expect(diff.added.map((entry) => entry.id)).toEqual(["nemotron-3.5-super-vl-free"])
		expect(diff.removed.map((entry) => entry.id)).toEqual(["deepseek-v4.1-flash-free"])
	})

	test("reports expired, degraded, kept, and healthy assignments", () => {
		const assignments = {
			sisyphus: { kind: "agent" as const, chain: ["opencode/minimax-m3.1-flash-free", "opencode/deepseek-v4.1-flash-free"] },
			oracle: { kind: "agent" as const, chain: ["opencode/deepseek-v4.1-flash-free"] },
			artistry: { kind: "category" as const, chain: ["opencode/quick-mini-free"] },
			writing: { kind: "category" as const, chain: ["opencode/no-tools-free"] },
		}
		const current = MODELS.filter((entry) => entry.id !== "deepseek-v4.1-flash-free")
		const health = evaluateAssignments(assignments, current, ["opencode/deepseek-v4.1-flash-free"])
		const byId = Object.fromEntries(health.map((entry) => [entry.profileId, entry]))
		expect(byId.sisyphus?.status).toBe("kept")
		expect(byId.oracle?.status).toBe("kept")
		expect(byId.artistry?.status).toBe("ok")
		expect(byId.writing?.status).toBe("ok")
	})

	test("marks a role expired when its whole chain disappeared", () => {
		const assignments = {
			sisyphus: { kind: "agent" as const, chain: ["opencode/gone-free"] },
		}
		const health = evaluateAssignments(assignments, MODELS)
		expect(health[0]?.status).toBe("expired")
		expect(health[0]?.expired).toEqual(["opencode/gone-free"])
	})
})

describe("official provider hints", () => {
	test("maps known families to official providers", () => {
		expect(findOfficialProviderHint("kimi-k2.5-free")?.provider).toBe("moonshotai")
		expect(findOfficialProviderHint("deepseek-v4.1-flash-free")?.provider).toBe("deepseek")
		expect(findOfficialProviderHint("unknown-model")).toBeUndefined()
	})
})

describe("profiles", () => {
	test("covers every built-in agent and category", () => {
		expect(AGENT_WORK_PROFILES).toHaveLength(11)
		expect(CATEGORY_WORK_PROFILES).toHaveLength(8)
		expect(findWorkProfile("visual-engineering")?.kind).toBe("category")
	})
})
