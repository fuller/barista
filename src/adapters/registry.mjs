import {createMenuDeciderAdapter} from './menu-decider.mjs';

export function createRegistry(factories={}){
 const providers={decider:config=>createMenuDeciderAdapter(config),...factories};
 return {resolve(provider,config){if(!Object.hasOwn(providers,provider))throw new Error('Unknown decision provider');return providers[provider](config);},has(provider){return Object.hasOwn(providers,provider)}};
}
