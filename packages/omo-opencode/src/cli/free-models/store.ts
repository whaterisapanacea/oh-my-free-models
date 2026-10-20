import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { isFreeModelCapabilities, type FreeModelCapabilities } from "@oh-my-opencode/model-core"
import { resolveUserOmoConfigDirectory, type OmoConfigEnv } from "@oh-my-opencode/omo-config-core"

import type { CatalogSnapshot, FreeModelsState, StateReadResult, StoredAssignment } from "./types"

const STATE_FILE = "free-models.json"
const CACHE_FILE = "free-models-cache.json"

export function resolveFreeModelsDirectory(env: OmoConfigEnv = process.env): string {
	return resolveUserOmoConfigDirectory(env)
}

export function resolveFreeModelsStatePath(
	scope: "user" | "project" = "user",
	projectDir: string = process.cwd(),
	env: OmoConfigEnv = process.env,
): string {
	const directory = scope === "project" ? join(projectDir, ".omo") : resolveFreeModelsDirectory(env)
	return join(directory, STATE_FILE)
}

export function resolveFreeModelsCachePath(env: OmoConfigEnv = process.env): string {
	return join(resolveFreeModelsDirectory(env), CACHE_FILE)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readJson(path: string): { value?: unknown; warning?: string } {
	if (!existsSync(path)) return {}
	try {
		return { value: JSON.parse(readFileSync(path, "utf-8")) as unknown }
	} catch (error) {
		return { warning: `Could not read ${path}: ${error instanceof Error ? error.message : String(error)}` }
	}
}

function isStoredAssignment(value: unknown): value is StoredAssignment {
	if (!isRecord(value)) return false
	if (value.kind !== "agent" && value.kind !== "category") return false
	return Array.isArray(value.chain) && value.chain.length > 0 && value.chain.every((entry) => typeof entry === "string")
}

function parseAssignments(value: unknown): Record<string, StoredAssignment> | undefined {
	if (!isRecord(value)) return undefined
	const assignments: Record<string, StoredAssignment> = {}
	for (const [profileId, assignment] of Object.entries(value)) {
		if (!isStoredAssignment(assignment)) return undefined
		assignments[profileId] = assignment
	}
	return assignments
}

function parseFreeModels(value: unknown): FreeModelCapabilities[] | undefined {
	if (!Array.isArray(value)) return undefined
	const models = value.filter(isFreeModelCapabilities)
	return models.length === value.length ? models : undefined
}

export function readFreeModelsState(path: string = resolveFreeModelsStatePath()): StateReadResult {
	const { value, warning } = readJson(path)
	if (value === undefined) {
		return warning === undefined ? { warnings: [] } : { warnings: [warning] }
	}
	if (!isRecord(value) || value.version !== 1) {
		return { warnings: [`Ignoring ${path}: unsupported free-model state format.`] }
	}
	const assignments = parseAssignments(value.assignments)
	const freeModels = parseFreeModels(value.freeModels)
	const keptExpired = Array.isArray(value.keptExpired)
		? value.keptExpired.filter((entry): entry is string => typeof entry === "string")
		: []

	if (assignments === undefined || freeModels === undefined) {
		return { warnings: [`Ignoring ${path}: the free-model state is incomplete or corrupt.`] }
	}

	return {
		state: {
			version: 1,
			updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
			sourceUrl: typeof value.sourceUrl === "string" ? value.sourceUrl : "",
			providerId: typeof value.providerId === "string" ? value.providerId : "opencode",
			freeModels,
			assignments,
			keptExpired,
		},
		warnings: [],
	}
}

export function writeFreeModelsState(state: FreeModelsState, path: string = resolveFreeModelsStatePath()): void {
	writeJsonAtomic(path, state)
}

export function readCatalogCache(path: string = resolveFreeModelsCachePath()): CatalogSnapshot | undefined {
	const { value } = readJson(path)
	if (!isRecord(value)) return undefined
	if (typeof value.fetchedAt !== "string" || typeof value.sourceUrl !== "string") return undefined
	if (typeof value.providerId !== "string" || typeof value.providerName !== "string") return undefined
	if (typeof value.totalModels !== "number") return undefined
	const freeModels = parseFreeModels(value.freeModels)
	if (freeModels === undefined) return undefined
	return {
		fetchedAt: value.fetchedAt,
		sourceUrl: value.sourceUrl,
		providerId: value.providerId,
		providerName: value.providerName,
		totalModels: value.totalModels,
		freeModels,
	}
}

export function writeCatalogCache(snapshot: CatalogSnapshot, path: string = resolveFreeModelsCachePath()): void {
	writeJsonAtomic(path, snapshot)
}

export function clearCatalogCache(path: string = resolveFreeModelsCachePath()): void {
	if (existsSync(path)) unlinkSync(path)
}

function writeJsonAtomic(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true })
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf-8")
	renameSync(temporary, path)
}
