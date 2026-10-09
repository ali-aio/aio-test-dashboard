// The lab's test types. In T7 these come from a CSV filename; here they come from a
// declaration on the Cycle plan screen (src/lib/plan.js), because MDM telemetry carries
// no test type at all. Same names, so the ported views and comparisons read identically.
import { TEST_TYPES } from './plan.js';

// shown as "Old cycles": discharges no Cycle plan entry claimed (mostly history from before planning)
export const FIELD_DISCHARGE = 'Old cycles';
export const FIELD_CHARGING = 'Field Charging';
export const FIELD_TEST_TYPES = new Set([FIELD_DISCHARGE, FIELD_CHARGING]);
// Declared names, in the fixed palette order, then the two "nobody declared this" buckets
// a run falls into when telemetry found it but no declaration covered the day.
export const TEST_TYPE_NAMES = TEST_TYPES.map(t => t.name);
export const ALL_TEST_TYPES = [...TEST_TYPE_NAMES, FIELD_DISCHARGE, FIELD_CHARGING];
export const CHARGING_TEST_TYPES = new Set(['Charging Cycle', FIELD_CHARGING]);
// Tests that run against a phone/load, where T7 also reports what the load gained. The
// MDM reports only the T7's own battery, so those figures stay unavailable here.
export const LOAD_TEST_TYPES = new Set(['WLC on Phone', 'WLC + Discharge on Ads', 'Restaurant Case']);
