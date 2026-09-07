/**
 * icons/index.js — the icon registry. Add a table, add a line.
 */
import copilot2023 from './copilot-2023.js';
import copilot2026 from './copilot-2026.js';

export const ICONS = {
    'copilot-2023': copilot2023,
    'copilot-2026': copilot2026,
};

export const DEFAULT_ICON = 'copilot-2023';

export function getIcon(id) {
    return ICONS[id] || ICONS[DEFAULT_ICON];
}
