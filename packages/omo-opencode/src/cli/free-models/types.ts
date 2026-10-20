import type { FreeModelCapabilities, WorkKind } from "@oh-my-opencode/model-core"

export type StoredAssignment = {
	readonly kind: WorkKind
	readonly chain: readonly string[]
}

export type FreeModelsState = {
	readonly version: 1
	readonly updatedAt: string
	readonly sourceUrl: string
	readonly providerId: string
	readonly freeModels: readonly FreeModelCapabilities[]
	readonly assignments: Readonly<Record<string, StoredAssignment>>
	readonly keptExpired: readonly string[]
}

export type CatalogSnapshot = {
	readonly fetchedAt: string
	readonly sourceUrl: string
	readonly providerId: string
	readonly providerName: string
	readonly totalModels: number
	readonly freeModels: readonly FreeModelCapabilities[]
}

export type CatalogLoadResult = {
	readonly snapshot: CatalogSnapshot
	readonly fromCache: boolean
	readonly warnings: readonly string[]
}

export type StateReadResult = {
	readonly state?: FreeModelsState
	readonly warnings: readonly string[]
}

export type CommandOutput = Pick<typeof process.stdout, "write">
export type CommandErrorOutput = Pick<typeof process.stderr, "write">
