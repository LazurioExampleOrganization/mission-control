import { readFile } from "node:fs/promises";
import path from "node:path";

export type ValidationError = {
	path: string;
	message: string;
};

export type ValidationResult = {
	ok: boolean;
	errors: ValidationError[];
};

export type SchemaNode = {
	type?: string | string[];
	required?: string[];
	properties?: Record<string, SchemaNode>;
	items?: SchemaNode;
	pattern?: string;
	enum?: unknown[];
	const?: unknown;
	minLength?: number;
	minItems?: number;
	minimum?: number;
	maximum?: number;
	additionalProperties?: boolean | SchemaNode;
};

const MODULE_ROOT = path.resolve(import.meta.dir, "..", "..", "..");
const SCHEMAS_DIR = path.join(MODULE_ROOT, "schemas");

const schemaCache = new Map<string, SchemaNode>();

export async function loadSchema(name: string): Promise<SchemaNode> {
	const cached = schemaCache.get(name);
	if (cached) return cached;
	const schemaPath = path.join(SCHEMAS_DIR, `${name}.schema.json`);
	const raw = await readFile(schemaPath, "utf8");
	const parsed = JSON.parse(raw) as SchemaNode;
	schemaCache.set(name, parsed);
	return parsed;
}

export async function loadFeaturePlanSchema(): Promise<SchemaNode> {
	return loadSchema("feature-plan");
}

export function validateAgainstSchema(
	value: unknown,
	schema: SchemaNode,
): ValidationResult {
	const errors: ValidationError[] = [];
	walk(value, schema, "", errors);
	return { ok: errors.length === 0, errors };
}

function typeOf(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	if (Number.isInteger(value)) return "integer";
	return typeof value;
}

function joinPath(parent: string, segment: string | number): string {
	if (typeof segment === "number") return `${parent}[${segment}]`;
	if (!parent) return segment;
	return `${parent}.${segment}`;
}

function walk(
	value: unknown,
	schema: SchemaNode,
	currentPath: string,
	errors: ValidationError[],
): void {
	if (schema.const !== undefined && value !== schema.const) {
		errors.push({
			path: currentPath || "(root)",
			message: `musí být ${JSON.stringify(schema.const)}`,
		});
		return;
	}

	if (schema.enum && !schema.enum.includes(value as never)) {
		errors.push({
			path: currentPath || "(root)",
			message: `musí být jedna z hodnot ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`,
		});
		return;
	}

	const types = schema.type
		? Array.isArray(schema.type)
			? schema.type
			: [schema.type]
		: [];
	const actualType = typeOf(value);
	if (types.length > 0) {
		const matches = types.some((t) => {
			if (t === "number") return actualType === "number" || actualType === "integer";
			if (t === "integer") return actualType === "integer";
			return t === actualType;
		});
		if (!matches) {
			errors.push({
				path: currentPath || "(root)",
				message: `musí být typ ${types.join(" nebo ")} (aktuálně ${actualType})`,
			});
			return;
		}
	}

	if (actualType === "string" && typeof value === "string") {
		if (schema.minLength !== undefined && value.length < schema.minLength) {
			errors.push({
				path: currentPath || "(root)",
				message: `musí mít alespoň ${schema.minLength} znak(ů)`,
			});
		}
		if (schema.pattern) {
			const re = new RegExp(schema.pattern);
			if (!re.test(value)) {
				errors.push({
					path: currentPath || "(root)",
					message: `musí odpovídat vzoru ${schema.pattern}`,
				});
			}
		}
	}

	if ((actualType === "number" || actualType === "integer") && typeof value === "number") {
		if (schema.minimum !== undefined && value < schema.minimum) {
			errors.push({
				path: currentPath || "(root)",
				message: `musí být >= ${schema.minimum}`,
			});
		}
		if (schema.maximum !== undefined && value > schema.maximum) {
			errors.push({
				path: currentPath || "(root)",
				message: `musí být <= ${schema.maximum}`,
			});
		}
	}

	if (actualType === "object" && value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		const required = schema.required ?? [];
		for (const key of required) {
			if (record[key] === undefined) {
				errors.push({
					path: joinPath(currentPath, key),
					message: "je povinné",
				});
			}
		}
		const props = schema.properties ?? {};
		for (const [key, child] of Object.entries(record)) {
			const childSchema = props[key];
			if (childSchema) {
				walk(child, childSchema, joinPath(currentPath, key), errors);
				continue;
			}
			if (schema.additionalProperties === false) {
				errors.push({
					path: joinPath(currentPath, key),
					message: "není povolené schématem",
				});
			} else if (
				schema.additionalProperties &&
				typeof schema.additionalProperties === "object"
			) {
				walk(
					child,
					schema.additionalProperties,
					joinPath(currentPath, key),
					errors,
				);
			}
		}
	}

	if (actualType === "array" && Array.isArray(value)) {
		if (schema.minItems !== undefined && value.length < schema.minItems) {
			errors.push({
				path: currentPath || "(root)",
				message: `musí obsahovat alespoň ${schema.minItems} položek`,
			});
		}
		if (schema.items) {
			value.forEach((item, index) => {
				walk(item, schema.items as SchemaNode, joinPath(currentPath, index), errors);
			});
		}
	}
}

export async function validateFeaturePlan(
	value: unknown,
): Promise<ValidationResult> {
	return validateAgainstSchema(value, await loadFeaturePlanSchema());
}

export async function validateEntity(
	schemaName: string,
	value: unknown,
): Promise<ValidationResult> {
	return validateAgainstSchema(value, await loadSchema(schemaName));
}
