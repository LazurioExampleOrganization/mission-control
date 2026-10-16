import { listPlanRecordsForValidation } from './store.ts';
import { validatePlanRecords } from './validate.ts';

const { records, errors: fileErrors } = await listPlanRecordsForValidation();
const validation = validatePlanRecords(records);
const result = {
	ok: fileErrors.length === 0 && validation.ok,
	errors: [...fileErrors, ...validation.errors],
};

if (!result.ok) {
	console.error('Mission Control v3 validation failed:');
	for (const error of result.errors) {
		console.error(`- ${error.path}: ${error.message}`);
	}
	process.exit(1);
}

console.log('Mission Control v3 plans are valid.');
