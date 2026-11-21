import {DurableObject} from 'cloudflare:workers';
import {createContainerProxy,createGateway} from './gateway.mjs';
export class BrowserHost extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.proxy=createContainerProxy(ctx,env);}
 fetch(request){return this.proxy.fetch(request);}
}
export default createGateway();
