export {SIZES,MILKS,SYRUPS,CATALOG,deriveAliases} from '../catalog/legacy-recipes.mjs';
import {getDefaults as legacyDefaults} from '../catalog/legacy-recipes.mjs';
import {getCatalogService,LEGACY_CATALOG_VERSION} from '../catalog/service.mjs';
export function getDefaults(productId,size,temperature,catalogVersion=LEGACY_CATALOG_VERSION){if(catalogVersion===LEGACY_CATALOG_VERSION)return legacyDefaults(productId,size,temperature);const service=getCatalogService(catalogVersion);const p=service.getProduct(productId,temperature);if(!p)throw new Error('Unsupported catalog product');return service.getRecipe(p.identity,size??(productId==='espresso'?'short':'grande')).defaults;}
export {getCatalogService,LEGACY_CATALOG_VERSION};
