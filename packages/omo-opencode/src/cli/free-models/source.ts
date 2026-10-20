import {
	extractFreeModels,
	MODELS_DEV_URL,
	OPENCODE_PROVIDER_ID,
} from "@oh-my-opencode/model-core"

import { readCatalogCache, resolveFreeModelsCachePath, writeCatalogCache } from "./store"
import type { CatalogLoadResult, CatalogSnapshot } from "./types"

const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 20_000

export type LoadCatalogOptions = {
	readonly sourceUrl?: string
	readonly refresh?: boolean
	readonly offline?: boolean
	readonly cachePath?: string
	readonly ttlMs?: number
	readonly now?: () => number
	readonly fetchImpl?: typeof fetch
}

function cacheAgeMs(snapshot: CatalogSnapshot, now: number): number {
	const fetchedAt = Date.parse(snapshot.fetchedAt)
	return Number.isFinite(fetchedAt) ? now - fetchedAt : Number.POSITIVE_INFINITY
}

function isFresh(snapshot: CatalogSnapshot, now: number, ttlMs: number): boolean {
	const age = cacheAgeMs(snapshot, now)
	return age >= 0 && age <= ttlMs
}

function staleWarning(snapshot: CatalogSnapshot, reason: string): string {
	return `${reason} Using the cached free-model catalog from ${snapshot.fetchedAt}.`
}

async function fetchCatalog(
	sourceUrl: string,
	now: () => number,
	fetchImpl: typeof fetch,
): Promise<CatalogSnapshot> {
	const response = await fetchImpl(sourceUrl, {
		headers: {
			accept: "application/json",
			"user-agent": "oh-my-free-models/free-model-scanner",
		},
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	})
	if (!response.ok) {
		throw new Error(`models.dev returned HTTP ${response.status}`)
	}

	let payload: unknown
	try {
		payload = await response.json()
	} catch (error) {
		throw new Error(`models.dev returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
	}
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
		throw new Error("models.dev returned an unexpected payload")
	}

	const extraction = extractFreeModels(payload as Record<string, unknown>, OPENCODE_PROVIDER_ID)
	if (extraction.totalModels === 0) {
		throw new Error(`models.dev did not contain the "${OPENCODE_PROVIDER_ID}" provider`)
	}

	return {
		fetchedAt: new Date(now()).toISOString(),
		sourceUrl,
		providerId: extraction.providerId,
		providerName: extraction.providerName,
		totalModels: extraction.totalModels,
		freeModels: extraction.freeModels,
	}
}

/**
 * Load the current free-model catalog from models.dev.
 *
 * A 6 hour cache keeps the TUI/CLI responsive and lets `status` work offline.
 * Pass `refresh: true` to force a live scan; `offline: true` never touches the
 * network. If a live scan fails, a cached catalog is used with a warning.
 */
export async function loadFreeModelCatalog(options: LoadCatalogOptions = {}): Promise<CatalogLoadResult> {
	const sourceUrl = options.sourceUrl ?? MODELS_DEV_URL
	const cachePath = options.cachePath ?? resolveFreeModelsCachePath()
	const ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS
	const now = options.now ?? Date.now
	const fetchImpl = options.fetchImpl ?? fetch
	const cached = readCatalogCache(cachePath)
	const warnings: string[] = []

	if (cached !== undefined && !options.refresh && isFresh(cached, now(), ttlMs)) {
		return { snapshot: cached, fromCache: true, warnings }
	}

	if (options.offline === true) {
		if (cached === undefined) {
			throw new Error("No cached free-model catalog exists yet. Run without --offline first.")
		}
		warnings.push(staleWarning(cached, "Offline mode: no live scan was performed."))
		return { snapshot: cached, fromCache: true, warnings }
	}

	try {
		const snapshot = await fetchCatalog(sourceUrl, now, fetchImpl)
		try {
			writeCatalogCache(snapshot, cachePath)
		} catch (error) {
			warnings.push(`Could not write the catalog cache: ${error instanceof Error ? error.message : String(error)}`)
		}
		if (snapshot.freeModels.length === 0) {
			warnings.push(
				`The "${OPENCODE_PROVIDER_ID}" provider currently reports zero free models. The catalog may be in transition.`,
			)
		}
		return { snapshot, fromCache: false, warnings }
	} catch (error) {
		const reason = `Live free-model scan failed: ${error instanceof Error ? error.message : String(error)}.`
		if (cached !== undefined) {
			warnings.push(staleWarning(cached, reason))
			return { snapshot: cached, fromCache: true, warnings }
		}
		throw new Error(`${reason} No cached catalog is available. Check your network connection or pass --source-url.`)
	}
}
