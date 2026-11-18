export type Size = 'short' | 'tall' | 'grande' | 'venti' | 'trenta';
export type Temperature = 'hot' | 'iced' | 'blended';
export type Amount = 'none'|'light'|'regular'|'extra';
export interface Ingredient { id:string; quantity:number; }
export interface Topping { id:string; amount:Amount; }
export interface Drink {
  caffeine:'regular'|'half-caf'|'one-third-decaf'|'two-thirds-decaf'|'decaf';
  roast:'signature'|'blonde'; shotStyle:'standard'|'ristretto'|'long';
  heat:'warm'|'standard'|'extra-hot'; milkAmount:Amount; milkFoam:Amount;
  milkPreparation:'standard'|'cold'|'steamed'; water:Amount; room:Amount;
  preparation:'standard'|'upside-down'|'affogato'|'shaken'|'double-blended';
  cupSize:'standard'|Size; coldFoam:Topping; syrups:Ingredient[]; sauces:Ingredient[];
  sweeteners:Ingredient[]; inclusions:Ingredient[]; toppings:Topping[]; onSide:string[];
  id: string; productId: string; size: Size; temperature: Temperature;
  milk: string; syrup: string; pumps: number; shots: number;
  decaf: boolean; ice: 'none' | 'light' | 'regular' | 'extra'; whip: boolean;
  quantity: number; explicit: string[];
}
export interface MenuLine { id:`menu-${number}`; identity:string; name:string; size:string|null; quantity:number; instructions:string[]; }
export type MenuChanges = Partial<Pick<MenuLine,'identity'|'size'|'quantity'|'instructions'>>;
export interface Order { catalogVersion?:string; revision: number; items: Drink[]; menuItems?:MenuLine[]; confirmed: boolean; history: Array<{items: Drink[]; menuItems?:MenuLine[]; confirmed: boolean}>; nextId: number; }
export type Changes = Partial<Omit<Drink, 'id' | 'explicit'>>;
export type IngredientPath = `${'syrups'|'sauces'|'sweeteners'|'inclusions'|'toppings'}:${string}`;
export type Command = {type:'add'; productId:string; changes?:Changes; touched?:IngredientPath[]} | {type:'update'; itemId:string; changes:Changes; touched?:IngredientPath[]} | {type:'duplicate'; itemId:string; changes?:Changes|MenuChanges; touched?:IngredientPath[]} | {type:'remove'; itemId:string} | {type:'add-menu'; identity:string; size?:string|null; quantity?:number; instructions?:string[]} | {type:'update-menu'; itemId:string; changes:MenuChanges} | {type:'undo'|'clear'|'confirm'};
export interface DecisionMetrics { cacheHits?:number; inflightHits?:number; extractionFailures?:string[]; extractionRequests:number; decisionRequests:number; totalRequests:number; clauseCount:number; strategy:'single'|'batch'|'sequential'; extractionMs:number; decisionMs:number; totalMs:number; }
export interface ClarificationDiagnostics {policy:string;stage:'extraction'|'decision'|'compile'|'catalog'|'conversation';reason:string;mode:'retry'|'slot';field?:string;clauseIndex?:number;uncoveredSpans?:[number,number][];catalogVersion?:string;attempts?:number;}
export interface Interpretation { diagnostics?:ClarificationDiagnostics; clarificationMode?: 'retry'|'slot'; commands: Command[]; clarification: string|null; pending?: PendingClarification|null; source: string; metrics?:DecisionMetrics; }
export interface TurnInput { text: string; order: Order; activeItemId?:string; pending?: PendingClarification|null; }
export interface PriceLine { label:string; amountCents:number; }
export interface ItemQuote { itemId:string; quantity:number; unitCents:number|null; totalCents:number|null; lines: PriceLine[]; }
export interface Quote { currency:string; subtotalCents:number|null; taxCents:number|null; totalCents:number|null; pricedSubtotalCents?:number; unpricedItemCount?:number; items:ItemQuote[]; estimated:boolean; taxLabel:string; provenance:string; }
export interface AdapterTurnInput extends TurnInput { clarificationContext?:{ supersededField:'pumps'; originalText:string; question:string; answers:string[] }; }
export interface DecisionAdapter { interpretTurn(input:AdapterTurnInput,context?:{signal?:AbortSignal}):Promise<Interpretation>; }
// Adapter interpretation is wrapped by the HTTP boundary in a correlated response.
export interface PendingClarification {
  originalText: string; question: string; revision: number;
  answers: string[]; targetIds: string[];
}
export interface TurnRequest extends TurnInput { turnId: string; baseRevision: number; mode?: 'live'; }
export interface TurnResponse { turnId:string; baseRevision:number; commands:Command[]; clarification:string|null; pending:PendingClarification|null; source:string; diagnostics?:ClarificationDiagnostics; metrics?:DecisionMetrics; }
// ItemQuote.lines are PER UNIT. Sum(lines.amountCents) == unitCents;
// totalCents == unitCents * quantity. Tax remains null until a verified policy is supplied.
