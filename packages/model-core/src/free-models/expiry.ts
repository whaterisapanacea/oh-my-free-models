import type { CatalogDiff, FreeModelCapabilities, WorkKind } from "./types"

export type AssignmentSnapshot = {
	readonly kind: WorkKind
	readonly chain: readonly string[]
}

export type AssignmentStatus = "ok" | "degraded" | "expired" | "kept"

export type AssignmentHealth = {
	readonly profileId: string
	readonly kind: WorkKind
	readonly chain: readonly string[]
	readonly available: readonly string[]
	readonly expired: readonly string[]
	readonly status: AssignmentStatus
}

function toModelSet(models: readonly FreeModelCapabilities[]): Set<string> {
	return new Set(models.map((model) => model.model))
}

export function diffFreeModelCatalogs(
	previous: readonly FreeModelCapabilities[],
	current: readonly FreeModelCapabilities[],
): CatalogDiff {
	const previousIds = new Set(previous.map((model) => model.model))
	const currentIds = new Set(current.map((model) => model.model))
	return {
		added: current.filter((model) => !previousIds.has(model.model)),
		removed: previous.filter((model) => !currentIds.has(model.model)),
	}
}

/**
 * Check each configured chain against the models that are free right now.
 * A model that disappeared from the free catalog is reported as expired, even if
 * it may still be purchasable through a paid provider.
 */
export function evaluateAssignments(
	assignments: Readonly<Record<string, AssignmentSnapshot>>,
	currentModels: readonly FreeModelCapabilities[],
	keptExpired: readonly string[] = [],
): readonly AssignmentHealth[] {
	const currentIds = toModelSet(currentModels)
	const kept = new Set(keptExpired)

	return Object.entries(assignments)
		.map(([profileId, assignment]): AssignmentHealth => {
			const available = assignment.chain.filter((model) => currentIds.has(model))
			const expired = assignment.chain.filter((model) => !currentIds.has(model))
			const unkeptExpired = expired.filter((model) => !kept.has(model))
			const status: AssignmentStatus =
				unkeptExpired.length === 0
					? expired.length > 0
						? "kept"
						: "ok"
					: available.length === 0
						? "expired"
						: "degraded"
			return {
				profileId,
				kind: assignment.kind,
				chain: assignment.chain,
				available,
				expired,
				status,
			}
		})
		.sort((left, right) => {
			const order: Record<AssignmentStatus, number> = { expired: 0, degraded: 1, kept: 2, ok: 3 }
			const byStatus = order[left.status] - order[right.status]
			return byStatus !== 0 ? byStatus : left.profileId.localeCompare(right.profileId)
		})
}

export function hasExpiredAssignments(health: readonly AssignmentHealth[]): boolean {
	return health.some((entry) => entry.status === "expired" || entry.status === "degraded")
}

export function filterFreeModels(
	models: readonly FreeModelCapabilities[],
	provider?: string,
): readonly FreeModelCapabilities[] {
	if (provider === undefined) return models
	return models.filter((model) => model.provider === provider)
}
