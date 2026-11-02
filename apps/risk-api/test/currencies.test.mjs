import assert from 'node:assert/strict';
import test from 'node:test';
import {transactionListFixture} from './fixtures/transaction-list.mjs';

test('currency suggestions use latest revisions, authenticated workspace and configured source namespace without inferring policies',async()=>{
  const f=await transactionListFixture({readNamespace:'synthetic_transactions'});
  try{
    const get=async(token,query='')=>f.app.inject({method:'GET',url:'/v1/local/transactions/currencies'+query,headers:token?{authorization:'Bearer '+token}:{}});
    assert.equal((await get()).statusCode,401);
    assert.equal((await get(await f.token({scope:'alerts:read'}))).statusCode,403);
    assert.equal((await get(await f.token(),'?currency=LAK')).statusCode,400);
    const response=await get(await f.token());assert.equal(response.statusCode,200);
    assert.deepEqual(response.json(),{workspace_key:'synthetic_local',provenance:'local_test',execution_mode:'test',currencies:[{currency:'EUR',transactions:1},{currency:'LAK',transactions:15},{currency:'USD',transactions:23}]});
    const other=await get(await f.token({workspace_key:'synthetic_other'}));assert.deepEqual(other.json().currencies,[{currency:'USD',transactions:1}]);
  }finally{await f.close();}
});
