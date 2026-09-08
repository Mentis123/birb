import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ICONS, PRODUCTS, PRODUCT_BY_ICON } from '../icon3d/src/icons/index.js';

test('catalogue exposes the three baseline products and valid variants', () => {
    assert.deepEqual(PRODUCTS.map((product) => product.id), ['copilot', 'foundry', 'fabric']);
    for (const product of PRODUCTS) {
        assert.ok(ICONS[product.iconId], `${product.id} has a preview icon`);
        for (const id of product.variants) {
            assert.ok(ICONS[id], `${product.id} variant ${id} exists`);
            assert.equal(PRODUCT_BY_ICON[id], product);
        }
    }
});
