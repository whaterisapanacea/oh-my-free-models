export function formatTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
	const widths = headers.map((header, index) =>
		Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
	)
	const renderRow = (row: readonly string[]): string =>
		headers.map((_, index) => (row[index] ?? "").padEnd(widths[index] ?? 0)).join("  ").trimEnd()
	const divider = widths.map((width) => "-".repeat(width)).join("  ")
	return [renderRow(headers), divider, ...rows.map(renderRow)].join("\n")
}

export function stripProvider(model: string): string {
	const separator = model.indexOf("/")
	return separator === -1 ? model : model.slice(separator + 1)
}

export function formatLimit(value: number): string {
	if (value >= 1_000_000) {
		const millions = value / 1_000_000
		return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`
	}
	if (value >= 1_000) return `${Math.round(value / 1_000)}k`
	return String(value)
}

export function formatScore(score: number): string {
	return `${Math.round(score * 100)}%`
}

export function formatModalities(modalities: readonly string[]): string {
	return modalities.length === 0 ? "-" : modalities.join("+")
}

export function formatTimestamp(value: string): string {
	const parsed = Date.parse(value)
	if (!Number.isFinite(parsed)) return value
	return new Date(parsed).toISOString().replace("T", " ").slice(0, 16)
}
