import type { PluginInput } from "@opencode-ai/plugin"
import { evaluateAssignments } from "@oh-my-opencode/model-core"

import { readCatalogCache, readFreeModelsState } from "../../../cli/free-models/store"
import { log } from "../../../shared/logger"
import { ignoreToastError } from "./ignore-toast-error"

/**
 * Warn once per OpenCode start when a configured role points at a model that
 * is no longer in the free catalog.
 *
 * This deliberately reads only the local catalog cache: startup must never wait
 * on models.dev. `free-models status --refresh` performs the authoritative live
 * scan and lets the user choose a replacement or keep the model with an
 * official provider key.
 */
export async function showFreeModelStatusIfNeeded(ctx: PluginInput): Promise<void> {
  try {
    const stateResult = readFreeModelsState()
    const state = stateResult.state
    if (state === undefined) return

    const catalog = readCatalogCache()
    if (catalog === undefined) return

    const health = evaluateAssignments(state.assignments, catalog.freeModels, state.keptExpired)
    const affected = health.filter((entry) => entry.status === "expired" || entry.status === "degraded")
    if (affected.length === 0) return

    const roles = affected.slice(0, 3).map((entry) => entry.profileId).join(", ")
    const suffix = affected.length > 3 ? ` and ${affected.length - 3} more` : ""
    await ctx.client.tui
      .showToast({
        body: {
          title: "Free Models Expired",
          message: `${roles}${suffix} use a model that is no longer free. Run 'oh-my-free-models free status --fix' to choose a replacement, or keep it with an official API key.`,
          variant: "warning" as const,
          duration: 15000,
        },
      })
      .catch(ignoreToastError)

    log("[auto-update-checker] Free model expiry warning shown", {
      affected: affected.map((entry) => entry.profileId),
    })
  } catch (error) {
    log("[auto-update-checker] Free model status check failed", { error: String(error) })
  }
}
