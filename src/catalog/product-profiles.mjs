import {CATALOG,getDefaults} from './legacy-recipes.mjs';

export const SOURCE_ONLY_PROFILES=[{id:'shaken-espresso',name:'Iced Shaken Espresso',description:'Source-verified standard Iced Shaken Espresso.',temperatures:['iced'],sizes:['tall','grande','venti'],sizesByTemperature:{iced:['tall','grande','venti']}}];
export const PRODUCT_PROFILES=[...CATALOG,...SOURCE_ONLY_PROFILES];
export function getRecipeTemplate(productId,size,temperature){if(productId!=='shaken-espresso')return getDefaults(productId,size,temperature);const profile=SOURCE_ONLY_PROFILES[0];if(temperature!=='iced'||!profile.sizes.includes(size))throw new Error('Invalid product, size or temperature');return {...getDefaults('latte',size,'iced'),productId};}
