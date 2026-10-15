import { describe, expect, test } from "bun:test";
import {
	applyViewFilters,
	getViewResults,
	resolveRecordField,
	snapshotAllEntities,
	type EntityRecord,
	type EntityType,
} from "../src/db.ts";

function record(
	type: EntityType,
	id: string,
	data: Record<string, unknown>,
): EntityRecord {
	return {
		type,
		id,
		title: String(data.title ?? id),
		status: typeof data.status === "string" ? data.status : null,
		owner: typeof data.owner === "string" ? data.owner : null,
		created_at: typeof data.created_at === "string" ? data.created_at : null,
		updated_at: typeof data.updated_at === "string" ? data.updated_at : null,
		data,
		relativePath: `data/v1/${type}/${id}.yaml`,
		absolutePath: `/tmp/${id}.yaml`,
		validation: { ok: true, errors: [] },
	};
}

describe("Mission Control filesystem DB query layer", () => {
	test("resolves top-level and YAML data fields for view filtering", () => {
		const issue = record("issue", "mci-2026-05-23-001", {
			title: "Filesystem DB issue",
			status: "todo",
			priority: "high",
			labels: ["label-mission-control"],
			planning: { plan_id: "plan-2026-05-23-009" },
		});

		expect(resolveRecordField(issue, "status")).toBe("todo");
		expect(resolveRecordField(issue, "priority")).toBe("high");
		expect(resolveRecordField(issue, "planning.plan_id")).toBe(
			"plan-2026-05-23-009",
		);
	});

	test("filters array-backed fields such as labels", () => {
		const matching = record("issue", "mci-2026-05-23-001", {
			status: "todo",
			labels: ["label-mission-control"],
		});
		const other = record("issue", "mci-2026-05-23-002", {
			status: "todo",
			labels: ["label-research"],
		});

		const result = applyViewFilters([matching, other], [
			{
				field: "labels",
				operator: "contains",
				value: "label-mission-control",
			},
		]);

		expect(result.map((item) => item.id)).toEqual(["mci-2026-05-23-001"]);
	});

	test("computes saved view results from full YAML records", async () => {
		const result = await getViewResults("view-active-issues");

		expect(result?.display).toBe("board");
		expect(result?.entity_type).toBe("issue");
		expect(result?.records.map((item) => item.id)).toContain(
			"mci-2026-05-23-001",
		);
		expect(result?.groups.some((group) => group.key === "todo")).toBe(true);
	});

	test("seed entity graph has no schema or referential integrity errors", async () => {
		const snapshots = await snapshotAllEntities();
		expect(snapshots.reduce((sum, snapshot) => sum + snapshot.invalid, 0)).toBe(0);
	});
});
