import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
	extractFreeModels,
	type FreeModelCapabilities,
} from "@oh-my-opencode/model-core"

import { applyFreeModels } from "./apply"
import { writeAssignmentsToOmoConfig, type WriteAssignmentsOptions } from "./config-writes"
import { scanFreeModels } from "./scan"
import { loadFreeModelCatalog } from "./source"
import { statusFreeModels } from "./status"
import type { CatalogLoadResult, FreeModelsState } from "./types"

const tempDirs: string[] = []

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "omfm-"))
	tempDirs.push(dir)
	return dir
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

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
	model({ id: "deepseek-v4.1-flash-free", inputModalities: ["text", "image"] }),
	model({ id: "minimax-m3.1-flash-free", contextLimit: 1_048_576, outputLimit: 512_000, inputModalities: ["text", "image", "video"] }),
	model({ id: "north-mini-code-free", contextLimit: 256_000, outputLimit: 64_000 }),
	model({ id: "beam-free", contextLimit: 1_048_576, outputLimit: 131_072 }),
	model({ id: "space-bunny-free", contextLimit: 1_048_576, outputLimit: 524_000, inputModalities: ["text", "image", "video"] }),
	model({ id: "quick-mini-free", contextLimit: 128_000, outputLimit: 16_000, reasoning: false }),
]

function catalog(models: readonly FreeModelCapabilities[] = MODELS): CatalogLoadResult {
	return {
		snapshot: {
			fetchedAt: "2026-10-20T00:00:00.000Z",
			sourceUrl: "https://models.dev/api.json",
			providerId: "opencode",
			providerName: "OpenCode",
			totalModels: 128,
			freeModels: models,
		},
		fromCache: false,
		warnings: [],
	}
}

function capture() {
	let text = ""
	return {
		stream: { write: (chunk: string) => { text += chunk; return true } },
		read: () => text,
	}
}

describe("scanFreeModels", () => {
	test("prints the free catalog and JSON recommendations", async () => {
		const stdout = capture()
		const stderr = capture()
		const code = await scanFreeModels(
			{ json: true, limit: 0 },
			{ loadCatalog: async () => catalog(), stdout: stdout.stream, stderr: stderr.stream },
		)
		expect(code).toBe(0)
		const parsed = JSON.parse(stdout.read()) as {
			freeModelCount: number
			recommendations: Record<string, { chain: string[] }>
		}
		expect(parsed.freeModelCount).toBe(MODELS.length)
		expect(Object.keys(parsed.recommendations)).toHaveLength(19)
		expect(parsed.recommendations["multimodal-looker"]?.chain[0]).toBe("opencode/space-bunny-free")
	})

	test("prints a human readable table", async () => {
		const stdout = capture()
		const stderr = capture()
		const code = await scanFreeModels(
			{ limit: 3 },
			{ loadCatalog: async () => catalog(), stdout: stdout.stream, stderr: stderr.stream },
		)
		expect(code).toBe(0)
		expect(stdout.read()).toContain("FREE MODELS (6)")
		expect(stdout.read()).toContain("BEST MODEL BY WORK (19 roles)")
		expect(stdout.read()).toContain("MODEL → BEST WORK")
	})
})

describe("applyFreeModels", () => {
	test("writes every role, enables runtime fallback, and records state", async () => {
		const stateWrites: FreeModelsState[] = []
		let configWrite: WriteAssignmentsOptions | undefined
		const stdout = capture()
		const stderr = capture()

		const code = await applyFreeModels(
			{ yes: true, directory: tempDir(), chain: 2 },
			{
				loadCatalog: async () => catalog(),
				loadConfig: (() => ({})) as never,
				writeConfig: ((options: WriteAssignmentsOptions) => {
					configWrite = options
					return { path: "C:/tmp/omo.jsonc", backupPath: "C:/tmp/omo.jsonc.bak", edits: [] }
				}) as never,
				writeState: ((state: FreeModelsState) => { stateWrites.push(state) }) as never,
				stdout: stdout.stream,
				stderr: stderr.stream,
				now: () => new Date("2026-10-20T12:00:00.000Z"),
			},
		)

		expect(code).toBe(0)
		expect(configWrite?.assignments).toBeDefined()
		expect(Object.keys(configWrite?.assignments ?? {})).toHaveLength(19)
		expect(configWrite?.enableRuntimeFallback).toBe(true)
		expect(stateWrites).toHaveLength(1)
		expect(stateWrites[0]?.updatedAt).toBe("2026-10-20T12:00:00.000Z")
		expect(Object.keys(stateWrites[0]?.assignments ?? {})).toHaveLength(19)
		expect(stdout.read()).toContain("Applied 19 free-model assignments.")
	})

	test("writes runtime_fallback inside the [opencode] block", () => {
		const directory = tempDir()
		writeAssignmentsToOmoConfig({
			assignments: {
				sisyphus: { kind: "agent", chain: ["opencode/deepseek-v4.1-flash-free"] },
			},
			scope: "project",
			projectDir: directory,
			enableRuntimeFallback: true,
		})

		const text = readFileSync(join(directory, ".omo", "omo.jsonc"), "utf8")
		const json = JSON.parse(text.split("\n").filter((line) => !line.trimStart().startsWith("//")).join("\n")) as {
			"[opencode]"?: { runtime_fallback?: boolean }
			runtime_fallback?: boolean
		}
		expect(json["[opencode]"]?.runtime_fallback).toBe(true)
		expect(json.runtime_fallback).toBeUndefined()
	})

	test("does not write when confirmation is declined", async () => {
		const stdout = capture()
		const stderr = capture()
		let wrote = false
		const code = await applyFreeModels(
			{ directory: tempDir() },
			{
				loadCatalog: async () => catalog(),
				confirm: async () => false,
				writeConfig: (() => { wrote = true; return { path: "", edits: [] } }) as never,
				writeState: (() => { wrote = true }) as never,
				loadConfig: (() => ({})) as never,
				stdout: stdout.stream,
				stderr: stderr.stream,
			},
		)
		expect(code).toBe(1)
		expect(wrote).toBe(false)
		expect(stdout.read()).toContain("Aborted")
	})
})

const STATE: FreeModelsState = {
	version: 1,
	updatedAt: "2026-10-01T00:00:00.000Z",
	sourceUrl: "https://models.dev/api.json",
	providerId: "opencode",
	freeModels: [MODELS[0]!, MODELS[1]!],
	assignments: {
		sisyphus: { kind: "agent", chain: ["opencode/deepseek-v4.1-flash-free"] },
		oracle: { kind: "agent", chain: ["opencode/gone-free"] },
		writing: { kind: "category", chain: ["opencode/beam-free"] },
	},
	keptExpired: [],
}

describe("statusFreeModels", () => {
	test("reports expiry and exits 2 with --check", async () => {
		const stdout = capture()
		const stderr = capture()
		const code = await statusFreeModels(
			{ check: true, json: true },
			{
				loadCatalog: async () => catalog([MODELS[1]!, MODELS[3]!]),
				readState: () => ({ state: STATE, warnings: [] }),
				stdout: stdout.stream,
				stderr: stderr.stream,
			},
		)
		expect(code).toBe(2)
		const parsed = JSON.parse(stdout.read()) as {
			health: Array<{ profileId: string; status: string }>
			removed: FreeModelCapabilities[]
		}
		expect(parsed.health.find((entry) => entry.profileId === "sisyphus")?.status).toBe("expired")
		expect(parsed.removed.map((entry) => entry.id)).toEqual(["deepseek-v4.1-flash-free"])
	})

	test("replaces expired assignments and writes state", async () => {
		const stdout = capture()
		const stderr = capture()
		const stateWrites: FreeModelsState[] = []
		const configWrites: Array<{ assignments: unknown }> = []
		const code = await statusFreeModels(
			{ fix: true, replaceExpired: true, check: true },
			{
				loadCatalog: async () => catalog([MODELS[1]!, MODELS[3]!, MODELS[2]!]),
				readState: () => ({ state: STATE, warnings: [] }),
				writeState: ((state: FreeModelsState) => stateWrites.push(state)) as never,
				writeConfig: ((options: { assignments: unknown }) => {
					configWrites.push(options)
					return { path: "C:/tmp/omo.jsonc", backupPath: "C:/tmp/omo.jsonc.bak", edits: [] }
				}) as never,
				stdout: stdout.stream,
				stderr: stderr.stream,
			},
		)
		expect(code).toBe(0)
		expect(configWrites).toHaveLength(1)
		expect(Object.keys(configWrites[0]?.assignments ?? {})).toContain("sisyphus")
		expect(stateWrites).toHaveLength(1)
		expect(stateWrites[0]?.assignments.sisyphus?.chain).not.toContain("opencode/deepseek-v4.1-flash-free")
	})

	test("keeps an expired model without rewriting config", async () => {
		const stdout = capture()
		const stderr = capture()
		const stateWrites: FreeModelsState[] = []
		let wroteConfig = false
		const code = await statusFreeModels(
			{ fix: true, keepExpired: true, check: true },
			{
				loadCatalog: async () => catalog([MODELS[1]!, MODELS[3]!]),
				readState: () => ({ state: STATE, warnings: [] }),
				writeState: ((state: FreeModelsState) => stateWrites.push(state)) as never,
				writeConfig: (() => { wroteConfig = true; return { path: "", edits: [] } }) as never,
				stdout: stdout.stream,
				stderr: stderr.stream,
			},
		)
		expect(code).toBe(0)
		expect(wroteConfig).toBe(false)
		expect(stateWrites[0]?.keptExpired).toContain("opencode/gone-free")
		expect(stdout.read()).toContain("opencode/gone-free")
	})

	test("prints a missing-state hint", async () => {
		const stdout = capture()
		const stderr = capture()
		const code = await statusFreeModels(
			{ check: true },
			{
				readState: () => ({ warnings: [] }),
				stdout: stdout.stream,
				stderr: stderr.stream,
			},
		)
		expect(code).toBe(2)
		expect(stdout.read()).toContain("No free-model state found")
	})
})

describe("loadFreeModelCatalog", () => {
	const payload = {
		opencode: {
			name: "OpenCode",
			models: {
				"free-one": {
					id: "free-one",
					name: "Free One",
					cost: { input: 0, output: 0 },
					limit: { context: 200_000, output: 32_000 },
					tool_call: true,
					reasoning: true,
					modalities: { input: ["text"], output: ["text"] },
				},
				"paid-one": {
					id: "paid-one",
					cost: { input: 5, output: 10 },
				},
			},
		},
	}

	test("fetches, normalizes, and caches the catalog", async () => {
		const cachePath = join(tempDir(), "cache.json")
		let calls = 0
		const fetchImpl = (async () => {
			calls += 1
			return { ok: true, json: async () => payload }
		}) as unknown as typeof fetch

		const first = await loadFreeModelCatalog({ cachePath, fetchImpl, now: () => 1_000 })
		expect(first.fromCache).toBe(false)
		expect(first.snapshot.freeModels.map((entry) => entry.id)).toEqual(["free-one"])

		const second = await loadFreeModelCatalog({ cachePath, fetchImpl, now: () => 2_000, ttlMs: 10_000 })
		expect(second.fromCache).toBe(true)
		expect(calls).toBe(1)
	})

	test("falls back to the cache when a refresh fails", async () => {
		const cachePath = join(tempDir(), "cache.json")
		const goodFetch = (async () => ({ ok: true, json: async () => payload })) as unknown as typeof fetch
		await loadFreeModelCatalog({ cachePath, fetchImpl: goodFetch, now: () => 1_000 })

		const badFetch = (async () => { throw new Error("network down") }) as unknown as typeof fetch
		const result = await loadFreeModelCatalog({ cachePath, fetchImpl: badFetch, refresh: true, now: () => 9_999 })
		expect(result.fromCache).toBe(true)
		expect(result.warnings.join(" ")).toContain("network down")
		expect(result.snapshot.freeModels[0]?.id).toBe("free-one")
	})

	test("throws when the provider is missing and no cache exists", async () => {
		const fetchImpl = (async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch
		await expect(loadFreeModelCatalog({ cachePath: join(tempDir(), "cache.json"), fetchImpl, now: () => 1_000 }))
			.rejects.toThrow('did not contain the "opencode" provider')
	})

	test("extracts models with the shared normalizer", () => {
		const extraction = extractFreeModels(payload)
		expect(extraction.freeModels[0]?.model).toBe("opencode/free-one")
		expect(extraction.freeModels[0]?.toolCall).toBe(true)
	})
})
