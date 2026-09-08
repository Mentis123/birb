/**
 * icons/index.js — the icon registry. Add a table, add a line.
 */
import copilot2023 from './copilot-2023.js';
import copilot2026 from './copilot-2026.js';
import aiFoundry from './ai-foundry.js';
import microsoftFabric from './microsoft-fabric.js';

export const ICONS = {
    'copilot-2023': copilot2023,
    'copilot-2026': copilot2026,
    'ai-foundry': aiFoundry,
    'microsoft-fabric': microsoftFabric,
};

export const PRODUCTS = [
    { id: 'copilot', name: 'Microsoft Copilot', kicker: 'AI companion', iconId: 'copilot-2023', variants: ['copilot-2023', 'copilot-2026'] },
    { id: 'foundry', name: 'Microsoft Foundry', kicker: 'AI platform', iconId: 'ai-foundry', variants: ['ai-foundry'] },
    { id: 'fabric', name: 'Microsoft Fabric', kicker: 'Data platform', iconId: 'microsoft-fabric', variants: ['microsoft-fabric'] },
];

export const PRODUCT_BY_ICON = Object.fromEntries(PRODUCTS.flatMap((product) => product.variants.map((id) => [id, product])));

export const DEFAULT_ICON = 'copilot-2023';

export function getIcon(id) {
    return ICONS[id] || ICONS[DEFAULT_ICON];
}
