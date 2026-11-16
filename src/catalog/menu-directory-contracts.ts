/** Public menu listings. These types make no recipe, cash-price or ordering claim. */
export interface MenuCategoryPathPart {id:string;name:string;}
export interface MenuDirectoryCategory {
 pathKey:string;id:string;name:string;parentPathKey:string|null;
 rootCategory:MenuCategoryPathPart;path:MenuCategoryPathPart[];
 uri:string|null;displayOrder:number|null;imageURL:string|null;heroImageURL:string|null;
}
export interface MenuDirectoryMembership {
 pathKey:string;path:MenuCategoryPathPart[];rootCategory:MenuCategoryPathPart;displayOrder:number|null;
}
export interface MenuDirectoryProduct {
 identity:string;productNumber:string;formCode:string;name:string;description:string|null;
 imageURL:string|null;productType:string;defaultSize:{sku:string;displayName:string}|null;
 sizes:{sizeCode:string}[];availability:string|null;uri:string|null;
 categories:MenuDirectoryMembership[];
 /** Optional legacy mapping only; does not establish recipe support or orderability. */
 knownProductId?:string;
}
export interface MenuDirectory {
 schemaVersion:1;version:string;
 provenance:{source:'Starbucks website menu';fetchedAt:string;sourceUrls:string[];storeContext:null;acquisition:'fixture'|'live'};
 categories:MenuDirectoryCategory[];products:MenuDirectoryProduct[];
}
