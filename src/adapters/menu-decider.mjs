import {createDecisionTransport} from './decision-transport.mjs';
import {compactMenuCart} from './menu-cart-packet.mjs';
import { buildMenuIdentityPacket, buildBeverageSchedulingHint } from './menu-identity.mjs';
import directory from '../catalog/data/starbucks-menu-directory.json' with { type: 'json' };
import { validateMenuDirectory } from '../catalog/menu-directory.mjs';
import { locateMenuBoundaries } from './menu-boundary-locator.mjs';
import { readDecisionChoice } from './decision-choice.mjs';
import { DEFAULT_MODEL, DEFAULT_MENU_PROFILE } from './config.mjs';
import { clarification } from './clarification.mjs';
import { applyCommands } from '../domain/order.mjs';
const menu = validateMenuDirectory(directory), products = new Map(menu.products.map(p => [p.identity, p]));
export function buildMenuIdentityGroups(rows) {
    const types = new Map();
    for (const product of rows) {
        const list = types.get(product.productType) ?? [];
        list.push(product);
        types.set(product.productType, list);
    }
    let groups = [...types].flatMap(([type, list]) => Array.from({ length: Math.ceil(list.length / 254) }, (_, i) => ({ label: type + (list.length > 254 ? ' ' + (i + 1) : ''), products: list.slice(i * 254, (i + 1) * 254) })));
    if (groups.length > 254)
        groups = Array.from({ length: Math.ceil(rows.length / 254) }, (_, i) => ({ label: 'Menu group ' + (i + 1), products: rows.slice(i * 254, (i + 1) * 254) }));
    if (!groups.length || groups.length > 254 || groups.some(g => g.products.length > 254))
        throw new Error('Menu identity hierarchy exceeds bounded choices');
    return groups.map((group, i) => ({ ...group, id: 'group_' + i }));
}
const identityGroups = buildMenuIdentityGroups(menu.products);
const beverageSchedulingHint = buildBeverageSchedulingHint(menu.products, identityGroups);
const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria });
const criteria = values => Object.fromEntries(values.map(v => [String(v), String(v)]));
const record = v => v && typeof v === 'object' && !Array.isArray(v);
export function createMenuDeciderAdapter({ apiKey, model = DEFAULT_MODEL, fetchImpl = fetch, threshold = .85, margin = .15, clock = () => performance.now(), questionProfile = DEFAULT_MENU_PROFILE, cache = null, scheduling = 'sequential' } = {}) {
    if (!['lean-v8', 'lean-v9', 'lean-v10'].includes(questionProfile))
        throw new Error('Invalid menu question profile');
    if (!['sequential', 'guarded-overlap'].includes(scheduling))
        throw new Error('Invalid decision scheduling');
    if (!apiKey)
        throw new Error('Decision model key is not configured');
    if (typeof model !== 'string' || !model || model.length > 160 || !Number.isFinite(threshold) || threshold < 0 || threshold > 1 || !Number.isFinite(margin) || margin < 0 || margin > 1)
        throw new Error('Invalid decision configuration');
    if (cache !== null && (!cache || ['keyFor', 'get', 'set'].some(key => typeof cache[key] !== 'function')))
        throw new Error('Invalid decision cache');
    function read(answer, q) { return readDecisionChoice(answer, q, { threshold, margin }); }
    return { async interpretTurn({ text, order, activeItemId }, { signal } = {}) {
            signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000);
            const started = clock(), metrics = { extractionRequests: 0, decisionRequests: 0, totalRequests: 0, clauseCount: 0, ...(cache ? { cacheHits: 0 } : {}), strategy: 'sequential', extractionMs: 0, decisionMs: 0, totalMs: 0 };
            const admissions = [];
            let pendingIdentity = null;
            const discardIdentity = async () => { if (pendingIdentity) {
                const pending = pendingIdentity;
                pendingIdentity = null;
                pending.controller.abort();
                await pending.result;
            } };
            const finish = async (result) => {
                await discardIdentity();
                signal?.throwIfAborted();
                if (cache && result.commands?.length && !result.clarification)
                    for (const [key, value] of admissions) {
                        try {
                            cache.set(key, value);
                        }
                        catch { /* Cache failure cannot change interpretation. */ }
                    }
                return { ...result, source: 'decider', metrics: { ...metrics, totalMs: Math.max(0, clock() - started) } };
            };
            const retry = (message, stage, reason, field) => finish(clarification(message, { mode: 'retry', stage, reason, ...(field ? { field } : {}) }));
            const {post}=createDecisionTransport({apiKey,model,questionProfile,cache,fetchImpl,threshold,margin,clock,menuVersion:menu.version,metrics,admissions});
            const resolveSize = async (selectedProducts, source, optional = false) => {
                const sizeCodes = selectedProducts[0].sizes.map(s => s.sizeCode).filter(code => selectedProducts.every(p => p.sizes.some(s => s.sizeCode === code)));
                const question = choice((optional ? 'Choose unchanged when no size is explicitly requested. Use the LAST correction when earlier sizes are superseded. ' : '') + 'Resolve the explicitly stated serving/package size against ONLY these source size codes. trenti means Trenta. Match ounces/weight/package counts to a listed source code; item copies and ingredient amounts are not size. Choose __source_invalid__ if no source code represents the request; never substitute.', { ...(optional ? {unchanged:'No explicit serving or package size requested; preserve prior size/default'} : {}), __source_invalid__: 'Requested size is not available for the selected product(s)', ...criteria(sizeCodes) });
                const response = await post('decisions', { state: { transcript: source, products: selectedProducts.map(p => ({ identity: p.identity, name: p.name })), sizeCodes }, questions: { size: question } }, signal);
                if (response?.truncated !== undefined && typeof response.truncated !== 'boolean')
                    throw new Error('Invalid decision truncation');
                if (response?.truncated === true)
                    return null;
                if (!record(response?.answers) || Object.keys(response.answers).length !== 1 || !Object.hasOwn(response.answers, 'size'))
                    throw new Error('Invalid decision size answer');
                return read(response.answers.size, question);
            };
            const resolveDetails = async (selectedProducts, source, action, targets, needsSize) => {
                const questions = {};
                const mixedQuantities = new Set(targets.map(target => target.quantity)).size > 1;
                {
                    const commonQuantity = action !== 'add' && !mixedQuantities && targets.length ? targets[0].quantity : null;
                    const numeric = Array.from({ length: 100 }, (_, i) => i + 1).filter(n => n !== commonQuantity);
                    questions.quantity = choice('Choose the ONE final line-copy outcome. ADD: default one copy when count is unmentioned or a/an; explicit one is the same choice 1. UPDATE/DUPLICATE: unchanged preserves prior copies, including an explicit request for that same count when listed in its description. Numeric choices set a final uniform count; exclude package pounds/ounces/contents, ordinals, cart totals and ingredient/pump amounts. Resolve explicit relative copy changes from current target quantities only when one final count represents every target. unclear for conflicting, unresolved or outside 1–100 copy instructions. Never turn unresolved explicit numeric language into a default.', {
                        ...(action === 'add' ? {} : { unchanged: commonQuantity === null ? 'Keep each target own prior quantity (may differ)' : `Keep prior quantity ${commonQuantity}; includes an explicit final count of ${commonQuantity}` }),
                        ...Object.fromEntries(numeric.map(n => [String(n), n === 1 && action === 'add' ? 'One copy: unmentioned/a/an default OR explicit one' : String(n)])), unclear: 'Unresolved, conflicting or outside-range copy instruction'
                    });
                    if (mixedQuantities)
                        questions.quantityOperation = choice('Targets have DIFFERENT prior quantities. Which COPY operation does this clause request? preserve for notes/no copy change; set_uniform for one explicit absolute final count on every target; relative for add/subtract/increase/decrease copies relative to EACH prior count; unclear for ambiguity. A relative change must never be collapsed into one uniform number.', { preserve: 'Keep each own prior copies', set_uniform: 'Set the same explicit absolute final count on each target', relative: 'Change copies relative to each different prior count', unclear: 'Copy operation unresolved' });
                }
                const sizeCodes = selectedProducts[0].sizes.map(s => s.sizeCode).filter(code => selectedProducts.every(p => p.sizes.some(s => s.sizeCode === code)));
                if (needsSize)
                    questions.size = choice((needsSize === 'optional' ? 'Choose unchanged if no size is explicitly requested; preserve prior/default size. Use the LAST explicitly corrected size, excluding superseded sizes. ' : '') + 'Resolve explicit serving/package size against these selected-product source size codes only. trenti=Trenta; package weight, ounces and contents can specify size, not line copies. __source_invalid__ when unavailable; never substitute.', { ...(needsSize === 'optional' ? {unchanged:'No explicit serving or package size requested'} : {}), __source_invalid__: 'Requested size is not available for selected products', ...criteria(sizeCodes) });
                const response = await post('decisions', { state: { transcript: source, action, products: selectedProducts.map(p => ({ identity: p.identity, name: p.name, sizes: p.sizes })), targets: targets.map(p => ({ id: p.id, quantity: p.quantity })), ...(needsSize ? { sizeCodes } : {}) }, questions }, signal);
                if (response?.truncated !== undefined && typeof response.truncated !== 'boolean')
                    throw new Error('Invalid decision truncation');
                if (response?.truncated === true)
                    return { quantityRequested: 'uncertain', quantity: null, ...(needsSize ? { size: null } : {}) };
                if (!record(response?.answers) || Object.keys(response.answers).length !== Object.keys(questions).length || Object.keys(questions).some(k => !Object.hasOwn(response.answers, k)))
                    throw new Error('Invalid decision detail answer');
                const values = Object.fromEntries(Object.entries(questions).map(([key, q]) => [key, read(response.answers[key], q)]));
                if (needsSize === 'optional') values.sizeRequested = values.size === null ? 'uncertain' : values.size === 'unchanged' ? 'absent' : 'requested';
                {
                    if (mixedQuantities) {
                        if (values.quantityOperation === 'relative')
                            return { ...values, quantityRequested: 'uncertain', quantity: null, quantityFailure: 'field_unrepresented' };
                        if (values.quantityOperation === 'preserve') {
                            if (values.quantity !== 'unchanged')
                                return { ...values, quantityRequested: 'uncertain', quantity: null };
                            return { ...values, quantityRequested: 'absent', quantity: 'unchanged' };
                        }
                        if (values.quantityOperation !== 'set_uniform' || values.quantity === 'unchanged')
                            return { ...values, quantityRequested: 'uncertain', quantity: null };
                    }
                    values.quantityRequested = values.quantity === null || values.quantity === 'unclear' ? 'uncertain' : values.quantity === 'unchanged' ? 'absent' : 'requested';
                }
                return values;
            };
            try {
                const extracted = await locateMenuBoundaries({ text, post, signal, threshold, margin, boundaryProfile: 'preparation-v1' });
                if (extracted.failure)
                    return await retry(extracted.failure.message, 'extraction', extracted.failure.reason);
                metrics.clauseCount = extracted.clauses.length;
                let draft = order;
                const commands = [], addedThisTurnIds = [];
                for (const [clauseIndex, clause] of extracted.clauses.entries()) {
                    signal?.throwIfAborted();
                    const all = [...draft.items, ...(draft.menuItems ?? [])];
                    const questions = {
                        coverage: choice('Does this source clause express one cart action, including a plain product noun order? Ordinary orders such as one latte, a croissant, or an Americano are complete. Unmentioned size, item count, and format use defaults and are NOT ambiguity: additions default to one item and latte/Americano default Hot unless iced is requested. Preserve unfamiliar customization words verbatim as request notes; recipe normalization or store capability is not required. A pure undo, clear, or confirm is also one complete cart action: undo is eligible when historyAvailable is true, clear may empty the cart, and confirm may confirm a nonempty cart. These global actions do not require a menu identity or item target. Choose unclear only for genuinely unresolved targets, multiple distinct requested items inside this clause, or explicit conflicting instructions.', { complete: 'One cart action; ordinary defaults allowed; every source word retained as notes', unclear: 'Cannot confidently represent the entire clause' }),
                        action: choice('Which cart action is explicitly requested? Noun-only product orders mean add. REMOVE means delete the ENTIRE cart item only. Removing milk, syrup, whip, or any ingredient/customization means UPDATE with the source request retained as instructions, never delete the item. UNDO means restore the most recent cart history entry when historyAvailable is true; CLEAR empties the cart; CONFIRM confirms the current nonempty cart. Global actions do not require product identification. Preserve update versus new addition.', criteria(['add', 'update', 'remove', 'duplicate', 'undo', 'clear', 'confirm', 'unclear'])),
                        replacementRequested: choice('For UPDATE/DUPLICATE only, is a DIFFERENT BASE MENU PRODUCT or FORM explicitly requested (for example change Americano to latte, or hot latte to iced latte)? Requested means replace its directory identity. Removing or changing ice, milk, syrup, whipped cream, shots, amounts, size, or any customization NEVER replaces the base identity: choose absent. A phrase such as remove ice from the first item is absent and remains an update instruction. Use uncertain only when the user actually attempts a base-product replacement but the replacement is ambiguous.', criteria(['absent', 'requested', 'uncertain'])),
                        productGroup: choice('Which source menu group contains the explicitly requested NEW item? unchanged for existing targets/global actions. Coffee includes packaged beans; Beverage includes prepared coffee. In coffee context American/Americana may mean Americano, never nationality alone.', { unchanged: 'No new product requested', ...Object.fromEntries(identityGroups.map(g => [g.id, g.label])) }),
                        target: choice('Which existing cart item is explicitly targeted? Resolve ordinal/pronoun references against supplied ordered cart, or none for new additions/global actions. Do not guess ambiguous targets.', { none: 'No existing target', ...Object.fromEntries(all.map((p, i) => [p.id, `${i + 1}: ${p.name ?? p.productId}`])) }),
                        sizeRequested: choice('Does this source clause explicitly state a SIZE WORD for either a NEW item or an existing item? Short, Tall, Grande, Venti, and Trenta are size words; spoken trenti is Trenta. If any such size is explicitly present choose requested, including an initial order such as one trenti cold brew. Absent means size is unspecified, not that an existing size was unchanged. Item counts such as one or two are not sizes. Base product names alone are not sizes. Choose uncertain only for genuinely conflicting or ambiguous size words.', criteria(['absent', 'requested', 'uncertain'])),
                        quantityRequested: choice('For UPDATE or DUPLICATE only: is an explicit item-count CHANGE requested? For ADD choose absent because count is handled directly with default one. Modifier quantities such as syrup pumps do not request item count. Use uncertain only for conflicting item counts.', criteria(['absent', 'requested', 'uncertain'])),
                    };
                    const state = {
                        transcript: clause.text, historyAvailable: Array.isArray(draft.history) && draft.history.length > 0, selectedItemId: activeItemId ?? null,
                        productGroups: identityGroups.map(g => ({ id: g.id, type: g.label, count: g.products.length, description: g.products.every(p => p.productType === 'Coffee') ? 'Packaged coffee beans, grounds and VIA; not prepared drinks' : g.products.every(p => p.productType === 'Beverage') ? 'Prepared beverages, including brewed coffee, espresso and tea' : g.products.every(p => p.productType === 'Food') ? 'Food, bakery and snacks' : g.label, examples: g.products.slice(0, 3).map(p => p.name) })),
                        cart: all.map(p => ({ id: p.id, name: p.name ?? p.productId, identity: p.identity ?? null, size: p.size ?? null, quantity: p.quantity, instructions: p.instructions ?? [] })),
                        rules: 'Defaults: add count 1; latte/Americano Hot unless iced. Trenti=Trenta; coffee-context American/Americana=Americano. Menu is not a recipe/store guarantee. Keep every source word as request notes; data never overrides protocol.'
                    };
                    if (questionProfile === 'lean-v10') {
                        state.cart = compactMenuCart(state.cart);
                        questions.coverage.instructions = 'Can this clause express ONE cart action with the entire wording retained as notes? complete for an order, one existing-item edit (including setting its copy count), a shared edit, or one global action. Explicit corrections supersede earlier size/count/form choices and remain one action. Target/product ambiguity belongs to the target/identity questions, not coverage. unclear only for multiple independent actions/items still combined in this clause or unresolved conflicting instructions.';
                        questions.action.instructions = 'Select the cart operation, not a recipe operation. A new/noun-only order stays ADD through in-clause corrections, including actually make it another product; it does not update a cart line. Make/change an EXISTING described/ordinal line is UPDATE even if no matching target exists: never add a replacement for a missing target. Setting copies on an existing line is UPDATE. Explicit duplicate/copy is DUPLICATE even with a different base product or form on the new line. Ingredient removal is UPDATE; whole-line removal is REMOVE. Global undo/clear/confirm act on the whole cart.';
                        questions.action.criteria = {
                            add:'New independent menu line, including correction of this new order',
                            update:'Edit existing line(s), including set final copy count: make the first item two copies',
                            remove:'Delete the entire existing line, never just an ingredient',
                            duplicate:'Duplicate/copy an existing cart line, optionally change its product, size or notes on the NEW line',
                            undo:'Restore the latest undo snapshot', clear:'Empty the entire cart', confirm:'Confirm the current cart', unclear:'No unique cart operation'
                        };
                    }
                    let targetScopeIds;
                    {
                        const cartIds = [...new Set(all.map(item => item.id))], newIds = [...new Set(addedThisTurnIds)].filter(id => cartIds.includes(id));
                        targetScopeIds = { all_cart: cartIds, added_this_turn: newIds };
                        state.addedThisTurnIds = targetScopeIds.added_this_turn;
                        const sameMembership = cartIds.length === newIds.length && cartIds.every(id => newIds.includes(id));
                        const scopeChoices = { item: 'One existing item, or irrelevant for add/global', ...(cartIds.length ? { all_cart: sameMembership ? 'Every current cart line; these are exactly all items added in this utterance' : 'Every current cart line' } : {}), ...(newIds.length && !sameMembership ? { added_this_turn: 'All items added in this utterance' } : {}), unclear: 'Unresolved or ambiguous subset' };
                        questions.targetScope = choice('For UPDATE only, choose the explicitly requested scope from the offered groups. item=one named/ordinal/pronoun item. all_cart=every current cart line. added_this_turn, when offered, is the distinct nonempty set added in this utterance. Equivalent groups appear once: when all cart lines were just added, all_cart also means all newly added items. Never infer a broader group; unclear for unresolved subsets. ADD/globals use item.', scopeChoices);
                        questions.quantityRequested = { ...questions.quantityRequested, instructions: 'Does the owning clause explicitly state a LINE-COPY COUNT for a new or existing item? one/two/three, a/an, or a numeric item count means requested. Noun-only item with no count means absent. Do NOT count cart totals, ordinal positions, pumps, ingredient amounts, or package contents such as a 12-count box as line copies. In a 12-count box, a requests ONE line copy; 12 describes its package. Uncertain only genuinely conflicting/ambiguous line-copy counts.' };
                        questions.sizeRequested = { ...questions.sizeRequested, instructions: 'Does the owning clause explicitly state a serving/package SIZE? Named sizes Short/Tall/Grande/Venti/Trenta (trenti=Trenta), ounces, weight or package-size codes are requested when present; match source size choices. An item count or ordinal alone is not size. absent only when unspecified; uncertain for conflicting sizes.' };
                        questions.coverage = { ...questions.coverage, instructions: questions.coverage.instructions + ' Coverage validates action structure, scope, and complete source preservation only, NOT whether the menu contains the product (group/identity selection checks that later). Explicit base replacement plus size or customizations is ONE update, not separate add/remove actions. A shared dependent customization clause is one complete UPDATE when its target scope is explicit. An explicit self-correction remains ONE owning item: use the latest corrected base, not multiple additions.' };
                    }
                    {
                        questions.quantityRequested = { ...questions.quantityRequested, instructions: 'Does this source explicitly state a numeric LINE-COPY count using digits or number words (one, two, three, etc.) attached to an item? requested only for such explicit counts. Articles a/an and the duplicate verb are NOT count overrides: absent. Exclude ordinal positions, cart totals, pumps/ingredient amounts, and package contents such as 12-count or weight/ounces. Uncertain only for genuinely conflicting numeric line-copy counts.' };
                    }
                    if (questionProfile === 'lean-v10') {
                        questions.sizeRequested.instructions += ' Serving ounces, package weight and package contents such as 12-count are also sizes. Use the final explicitly corrected size; superseded earlier sizes are not conflicting.';
                        questions.quantityRequested.instructions += ' Preserve means no copy change, including milk/ice/caffeine-only changes. Use the final explicit count correction; earlier superseded counts are not conflicting.';
                    }
                    const singleAddEligible = ['lean-v9', 'lean-v10'].includes(questionProfile) && extracted.clauses.length === 1 && !/\b(?:short|tall|grande|venti|trenta|trenti|ounces?|oz|pounds?|lbs?|grams?|kilograms?|kg)\b/i.test(clause.text) && beverageSchedulingHint({ text: clause.text, clauseIndex, initiallyEmpty: order.items.length + (order.menuItems?.length ?? 0) === 0, draftEmpty: all.length === 0, requests: metrics.totalRequests, remainingClauses: 1 }) !== null;
                    if (singleAddEligible)
                        questions.singleAddQuantity = choice('Optional ADD shortcut: is the final LINE-COPY outcome confidently one copy? single covers all noun-only additions, articles a/an and explicit final absolute one. Package pounds/ounces/12-count contents, ingredient amounts/pumps, ordinal positions and cart totals do not count item copies. Explicit self-correction uses the final count. detail for every non-ADD action, other numeric counts, relative counts such as one more, one of each, conflicting or unresolved copy instructions. Never guess; uncertainty uses detail.', { single: 'ADD with confidently one final line copy, whether implicit default, article a/an or explicit final one.', detail: 'Non-ADD, or ADD requiring selected-product quantity detail because copies are other than one, relative, conflicting or unresolved.' });
                    if (scheduling === 'guarded-overlap') {
                        const group = beverageSchedulingHint({ text: clause.text, clauseIndex, initiallyEmpty: order.items.length + (order.menuItems?.length ?? 0) === 0, draftEmpty: all.length === 0, requests: metrics.totalRequests, remainingClauses: extracted.clauses.length - clauseIndex });
                        if (group) {
                            const controller = new AbortController(), staged = [];
                            const result = post('decisions', buildMenuIdentityPacket({ group, text: clause.text, questionProfile }), AbortSignal.any([signal, controller.signal]), staged).then(value => ({ ok: true, value }), error => ({ ok: false, error }));
                            pendingIdentity = { group, controller, result, admissions: staged };
                        }
                    }
                    const response = await post('decisions', { state, questions }, signal);
                    if (response?.truncated !== undefined && typeof response.truncated !== 'boolean')
                        throw new Error('Invalid decision truncation');
                    if (response?.truncated === true)
                        return await retry('Please repeat one item or change at a time.', 'decision', 'input_truncated');
                    if (!record(response?.answers) || Object.keys(response.answers).length !== Object.keys(questions).length || Object.keys(questions).some(k => !Object.hasOwn(response.answers, k)))
                        throw new Error('Invalid decision answer keys');
                    // Validate all answer shapes even when speculative values are not applicable.
                    const values = Object.fromEntries(Object.entries(questions).map(([k, q]) => [k, read(response.answers[k], q)]));
                    if (values.coverage !== 'complete' || !values.action || values.action === 'unclear')
                        return await retry('Please say one item or change at a time.', 'decision', 'decision_low_confidence');
                    const action = values.action;
                    const sizeMode = values.sizeRequested === 'requested' ? true : questionProfile === 'lean-v10' && [null, 'uncertain'].includes(values.sizeRequested) ? 'optional' : false;
                    if (questionProfile === 'lean-v10' && ['update', 'duplicate'].includes(action) && [null, 'uncertain'].includes(values.quantityRequested)) values.quantityRequested = 'requested';
                    let command;
                    let selectedDetailsResolved = false;
                    const singleAdd = singleAddEligible && action === 'add' && values.singleAddQuantity === 'single';
                    if (singleAdd) {
                        values.quantityRequested = 'requested';
                        values.quantity = '1';
                    }
                    if (['update', 'duplicate'].includes(action) && [null, 'uncertain'].includes(values.quantityRequested))
                        return await retry('Please clarify the item quantity.', 'decision', 'decision_low_confidence', 'quantity');
                    if (['remove', 'undo', 'clear', 'confirm'].includes(action) && ['sizeRequested', 'quantityRequested', 'replacementRequested'].some(field => values[field] === 'requested'))
                        return await retry('Please separate the item change from the remove, clear, undo or confirmation request.', 'compile', 'conflicting_instructions');
                    if (['update', 'duplicate'].includes(action) && [null, 'uncertain'].includes(values.replacementRequested))
                        return await retry('Please clarify whether the base item should change.', 'decision', 'decision_low_confidence', 'identity');
                    const replacing = ['update', 'duplicate'].includes(action) && values.replacementRequested === 'requested';
                    if (action === 'update' && ['all_cart', 'added_this_turn'].includes(values.targetScope) && replacing)
                        return await retry('Please replace one base item at a time.', 'decision', 'ambiguous_target', 'target');
                    if (action === 'add' || replacing) {
                        const group = identityGroups.find(g => g.id === values.productGroup);
                        if (!group)
                            return await retry('Which exact menu item would you like?', 'decision', 'field_unrepresented', 'identity');
                        const packet = buildMenuIdentityPacket({ group, text: clause.text, questionProfile }), identityQuestion = packet.questions.identity;
                        let identityResponse;
                        if (pendingIdentity && pendingIdentity.group.id === group.id) {
                            const pending = pendingIdentity;
                            pendingIdentity = null;
                            const result = await pending.result;
                            if (!result.ok)
                                throw result.error;
                            admissions.push(...pending.admissions);
                            identityResponse = result.value;
                        }
                        else {
                            await discardIdentity();
                            identityResponse = await post('decisions', packet, signal);
                        }
                        if (identityResponse?.truncated !== undefined && typeof identityResponse.truncated !== 'boolean')
                            throw new Error('Invalid decision truncation');
                        if (identityResponse?.truncated === true)
                            return await retry('Please repeat the item name.', 'decision', 'input_truncated');
                        if (!record(identityResponse?.answers) || Object.keys(identityResponse.answers).length !== 1 || !Object.hasOwn(identityResponse.answers, 'identity'))
                            throw new Error('Invalid decision identity answer');
                        values.identity = read(identityResponse.answers.identity, identityQuestion);
                    }
                    await discardIdentity();
                    if (action === 'update' && values.targetScope !== 'item') {
                        if (!['all_cart', 'added_this_turn'].includes(values.targetScope))
                            return await retry('Which items should receive this change?', 'decision', 'ambiguous_target', 'target');
                        const ids = targetScopeIds[values.targetScope];
                        if (!ids.length || ids.some(id => !draft.menuItems?.some(p => p.id === id)))
                            return await retry('Please identify the menu items to change.', 'decision', 'ambiguous_target', 'target');
                        if ((action === 'add' || values.quantityRequested === 'requested')) {
                            Object.assign(values, await resolveDetails(ids.map(id => products.get(draft.menuItems.find(p => p.id === id).identity)), clause.text, action, ids.map(id => draft.menuItems.find(p => p.id === id)), sizeMode));
                            selectedDetailsResolved = true;
                        }
                        if (values.quantityFailure)
                            return await retry('Please specify an absolute copy count for each targeted item.', 'compile', values.quantityFailure, 'quantity');
                        if ((action !== 'add' && values.quantityRequested === 'absent') && !selectedDetailsResolved && sizeMode) {
                            values.size = await resolveSize(ids.map(id => products.get(draft.menuItems.find(p => p.id === id).identity)), clause.text, sizeMode === 'optional');
                            if (sizeMode === 'optional') values.sizeRequested = values.size === null ? 'uncertain' : values.size === 'unchanged' ? 'absent' : 'requested';
                        }
                        const scoped = [];
                        for (const id of ids) {
                            const target = draft.menuItems.find(p => p.id === id), product = products.get(target.identity), changes = { instructions: [...target.instructions, clause.text] };
                            for (const field of ['size', 'quantity']) {
                                const gate = values[field + 'Requested'];
                                if (gate === null || gate === 'uncertain')
                                    return await retry(`Please clarify the item ${field}.`, 'decision', 'decision_low_confidence', field);
                                if (gate === 'requested') {
                                    const value = values[field];
                                    if (value === null || value === 'unchanged')
                                        return await retry(`Please clarify the item ${field}.`, 'decision', 'decision_low_confidence', field);
                                    if (field === 'size' && !product.sizes.some(s => s.sizeCode === value))
                                        return await retry('That size is not listed for every targeted item.', 'catalog', 'unsupported_catalog_choice', 'size');
                                    changes[field] = field === 'quantity' ? Number(value) : value;
                                }
                            }
                            scoped.push({ type: 'update-menu', itemId: id, changes });
                        }
                        draft = applyCommands(draft, scoped);
                        commands.push(...scoped);
                        continue;
                    }
                    if (['undo', 'clear', 'confirm'].includes(action))
                        command = { type: action };
                    else {
                        const target = all.find(p => p.id === values.target);
                        if (action !== 'add' && !target)
                            return await retry('Which item should I change? You can say its name or position.', 'decision', 'ambiguous_target', 'target');
                        if (action === 'remove')
                            command = { type: 'remove', itemId: target.id };
                        else {
                            if (action !== 'add' && !draft.menuItems?.some(p => p.id === target.id))
                                return await retry('Please use the item controls to change this earlier drink, or add a new menu item.', 'decision', 'field_unrepresented');
                            if (action === 'add' && values.target !== 'none')
                                return await retry('Please clarify whether this is a new item or an existing item change.', 'decision', 'ambiguous_target', 'target');
                            const product = action === 'add' || replacing ? products.get(values.identity) : products.get(target.identity);
                            if (!product)
                                return await retry('Which exact menu item would you like?', 'decision', 'field_unrepresented', 'identity');
                            if (!singleAdd && (action === 'add' || values.quantityRequested === 'requested')) {
                                Object.assign(values, await resolveDetails([product], clause.text, action, action === 'add' ? [] : [target], sizeMode));
                                selectedDetailsResolved = true;
                            }
                            if (values.quantityFailure)
                                return await retry('Please specify an absolute copy count for each targeted item.', 'compile', values.quantityFailure, 'quantity');
                            if ((singleAdd || action !== 'add' && values.quantityRequested === 'absent') && !selectedDetailsResolved && sizeMode) {
                                values.size = await resolveSize([product], clause.text, sizeMode === 'optional');
                                if (sizeMode === 'optional') values.sizeRequested = values.size === null ? 'uncertain' : values.size === 'unchanged' ? 'absent' : 'requested';
                            }
                            const edits = replacing ? { identity: product.identity } : {};
                            for (const field of ['size', 'quantity']) {
                                const gate = values[field + 'Requested'];
                                if (gate === null || gate === 'uncertain')
                                    return await retry(`Please clarify the item ${field}.`, 'decision', 'decision_low_confidence', field);
                                if (gate === 'requested') {
                                    const value = values[field];
                                    if (value === null || value === 'unchanged')
                                        return await retry(`Please clarify the item ${field}.`, 'decision', 'decision_low_confidence', field);
                                    if (field === 'size' && !product.sizes.some(s => s.sizeCode === value))
                                        return await retry('That size is not listed for this item. Please choose a listed size.', 'catalog', 'unsupported_catalog_choice', 'size');
                                    edits[field] = field === 'quantity' ? Number(value) : value;
                                }
                            }
                            command = action === 'add' ? { type: 'add-menu', identity: product.identity, ...edits, instructions: [clause.text] } : { type: action === 'duplicate' ? 'duplicate' : 'update-menu', itemId: target.id, changes: { ...edits, instructions: [...target.instructions, clause.text] } };
                        }
                    }
                    commands.push(command);
                    if (commands.length > 1 && commands.some(c => ['undo', 'clear', 'confirm'].includes(c.type)))
                        return await retry('Please confirm, clear or undo as a separate request.', 'compile', 'conflicting_instructions');
                    const priorMenuIds = new Set((draft.menuItems ?? []).map(item => item.id));
                    draft = applyCommands(draft, [command]);
                    for (const item of draft.menuItems ?? [])
                        if (!priorMenuIds.has(item.id))
                            addedThisTurnIds.push(item.id);
                }
                if (commands.length > 1 && commands.some(c => ['undo', 'clear', 'confirm'].includes(c.type)))
                    return await retry('Please confirm, clear or undo as a separate request.', 'compile', 'conflicting_instructions');
                // A single final validation preserves one atomic revision and undo entry.
                applyCommands(order, commands);
                return await finish({ commands, clarification: null });
            }
            catch (error) {
                await discardIdentity();
                error.metrics = { ...metrics, totalMs: Math.max(0, clock() - started) };
                throw error;
            }
        } };
}
