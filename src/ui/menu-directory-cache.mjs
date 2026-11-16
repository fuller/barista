import {validateMenuDirectory} from '../catalog/menu-directory.mjs';
class MenuHTTPError extends Error {
 constructor(status){super(`Menu could not be loaded (${status}).`);this.status=status;}
}
export async function fetchMenuDirectory({signal,fetchImpl=fetch}={}){
 const response=await fetchImpl('/api/menu-directory',{signal,headers:{Accept:'application/json'}});
 if(!response.ok)throw new MenuHTTPError(response.status);
 const directory=await response.json();
 signal?.throwIfAborted();
 return validateMenuDirectory(directory);
}
export const menuDirectoryQueryOptions=(fetchImpl=fetch)=>({
 queryKey:['menu-directory',1,'US','en-US'],
 queryFn:({signal})=>fetchMenuDirectory({signal,fetchImpl}),
 staleTime:300000,gcTime:86400000,refetchOnWindowFocus:false,
 retry:(count,error)=>count<1&&(error instanceof TypeError||error instanceof MenuHTTPError&&error.status>=500&&error.status<600),
});
