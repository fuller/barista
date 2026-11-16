import {QueryClient,useQuery} from '@tanstack/react-query';
import type {CatalogSnapshot} from '../catalog/contracts';
import {catalogQueryOptions} from './catalog-cache.mjs';
export const catalogQueryClient=new QueryClient();
export function useCatalog(){return useQuery<CatalogSnapshot,Error>(catalogQueryOptions());}

import type {MenuDirectory} from '../catalog/menu-directory-contracts';
import bundledMenuDirectory from '../catalog/data/starbucks-menu-directory.json';
import {menuDirectoryQueryOptions} from './menu-directory-cache.mjs';
export function useMenuDirectory(){return useQuery<MenuDirectory,Error>({...menuDirectoryQueryOptions(),initialData:bundledMenuDirectory as MenuDirectory,initialDataUpdatedAt:Date.parse(bundledMenuDirectory.provenance.fetchedAt)});}
