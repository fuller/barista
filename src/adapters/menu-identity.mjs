export function buildMenuIdentityPacket({ group, text }) {
    const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria });
    const identityQuestion = choice('Select the BASE MENU PRODUCT for the owning transcript only. Ignore count, size, and preparation/customization requests when identifying its base: those are retained separately and are not grounds to reject a known base product. Shaken Espresso means Iced Shaken Espresso (its standard base form). In coffee context American/Americana means Americano. Ordinary latte and Americano default Hot unless iced is explicitly requested. Select a known standard base confidently; unchanged only when no base menu product can be identified. Never let other cart products or unrelated clauses change the product of this owning transcript.', { unchanged: 'No unique exact menu match', ...Object.fromEntries(group.products.map(p => [p.identity, p.name + ' — ' + p.formCode])) });
    identityQuestion.instructions += ' Within this owning clause choose the LAST explicitly corrected base/form; earlier base mentions are superseded and explicitly negated forms are excluded. This remains one order unless a separate item count/action independently requests another item; extraction already separated independent requests. Preserve all original wording as notes, but select only the final corrected, non-negated base/form.';
    const identityState = { transcript: text };
    return { state: identityState, questions: { identity: identityQuestion } };
}
const words = text => new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => Array.from(word).length >= 4));
export function buildBeverageSchedulingHint(products, groups) {
    const excluded = words(products.filter(p => p.productType !== 'Beverage').map(p => p.name).join(' '));
    const distinctive = new Set([...words(products.filter(p => p.productType === 'Beverage').map(p => p.name).join(' '))].filter(word => !excluded.has(word)));
    const beverageGroups = groups.filter(g => g.products.every(p => p.productType === 'Beverage'));
    return ({ text, clauseIndex, initiallyEmpty, draftEmpty, requests, remainingClauses }) => clauseIndex === 0 && initiallyEmpty && draftEmpty && requests + 3 * remainingClauses + 1 <= 20 && beverageGroups.length === 1 && [...words(text)].some(word => distinctive.has(word)) ? beverageGroups[0] : null;
}
