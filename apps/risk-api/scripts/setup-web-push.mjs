import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import webpush from 'web-push';
import {localMode} from '../../../packages/database/scripts/local.mjs';
try{
 localMode();const args=process.argv.slice(2);if(args.length!==1||!args[0].startsWith('--subject='))throw Error();
 const subject=args[0].slice(10);if(!/^mailto:[^\s@?]+@[^\s@?]+\.[^\s@?]+$/.test(subject)&&!/^https:\/\/[^\s]+$/.test(subject))throw Error();
 const directory=resolve('.local/web-push');await mkdir(directory,{recursive:true,mode:0o700});
 const path=join(directory,'config.json');await writeFile(path,JSON.stringify({subject,...webpush.generateVAPIDKeys(),storageKey:randomBytes(32).toString('base64url')})+'\n',{flag:'wx',mode:0o600});
 console.log('Private Web Push config created at .local/web-push/config.json. Set LMPS_WEB_PUSH_CONFIG to its absolute path and restart the API. Keys are not printed.');
}catch{console.error('Web Push setup failed. Use --subject=mailto:your-operator-address or an HTTPS contact URL. Existing key files are never overwritten.');process.exitCode=1;}
