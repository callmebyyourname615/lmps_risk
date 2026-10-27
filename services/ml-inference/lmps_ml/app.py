import os
import asyncio
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
import hmac
import json
from pathlib import Path
import threading
import secrets
from collections.abc import Mapping
from typing import Literal

from fastapi import FastAPI, Response, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .config import read_config
from .model_contracts import ModelIdentity,ShadowResult


class Liveness(BaseModel):
    status: Literal["ok"] = "ok"
    service: Literal["ml-inference"] = "ml-inference"


class Readiness(BaseModel):
    status: Literal["not_ready"] = "not_ready"
    service: Literal["ml-inference"] = "ml-inference"
    reason: Literal["model_not_loaded"] = "model_not_loaded"


class ShadowReadiness(BaseModel):
    status: Literal['ready']
    service: Literal['ml-inference']
    execution_mode: Literal['shadow']
    model: ModelIdentity
    instance_id: str


class ShadowUnavailable(BaseModel):
    status: Literal['not_ready']
    service: Literal['ml-inference']
    reason: Literal['model_invalid_or_unavailable']


def create_app(env: Mapping[str, str] | None = None, *, shadow_server=None, shadow_timeout=0.5) -> FastAPI:
    configuration=os.environ if env is None else env
    read_config(configuration)
    instance_id=configuration.get('LMPS_ML_INSTANCE_ID') or secrets.token_hex(16)
    if len(instance_id)!=32 or any(c not in '0123456789abcdef' for c in instance_id):raise ValueError('Invalid local ML instance configuration.')
    if shadow_server is None and configuration.get('LMPS_ML_ROOT'):
        from .private import read_bytes
        from .serving import ShadowServer
        token=read_bytes(Path(configuration['LMPS_ML_TOKEN_FILE']),128).decode()
        key=read_bytes(Path(configuration['LMPS_ML_SIGNING_KEY_FILE']),32)
        shadow_server=ShadowServer(Path(configuration['LMPS_ML_ROOT']),token,key)
    executor=ThreadPoolExecutor(max_workers=1,thread_name_prefix='lmps-shadow') if shadow_server is not None else None
    admission=threading.BoundedSemaphore(2)
    @asynccontextmanager
    async def lifespan(_app):
        yield
        if executor is not None:executor.shutdown(wait=True,cancel_futures=True)
    app = FastAPI(
        title="LMPS ML Inference Bootstrap",
        version="0.0.0",
        docs_url=None,
        redoc_url=None,
        lifespan=lifespan,
    )

    @app.get("/health/live", response_model=Liveness, tags=["health"])
    async def live(response: Response) -> Liveness:
        response.headers["Cache-Control"] = "no-store"
        return Liveness()

    @app.get("/health/ready", response_model=Readiness if shadow_server is None else ShadowReadiness,
             status_code=503 if shadow_server is None else 200,tags=["health"],
             responses=None if shadow_server is None else {503:{'model':ShadowUnavailable}})
    async def ready(response: Response) -> Readiness:
        if shadow_server is not None:
            if shadow_server.model is None:
                return JSONResponse({'status':'not_ready','service':'ml-inference','reason':'model_invalid_or_unavailable'},status_code=503,headers={'Cache-Control':'no-store'})
            return JSONResponse({'status':'ready','service':'ml-inference','execution_mode':'shadow','model':shadow_server.model.identity,'instance_id':instance_id},headers={'Cache-Control':'no-store'})
        response.headers["Cache-Control"] = "no-store"
        return Readiness()

    if shadow_server is not None:
        from .serving import ShadowRequest
        @app.get('/v1/shadow/metrics')
        async def metrics(request:Request):
            if not hmac.compare_digest(request.headers.get('authorization','').encode(),('Bearer '+shadow_server.token).encode()):return JSONResponse({'code':'ML_UNAUTHORIZED'},status_code=401,headers={'Cache-Control':'no-store'})
            return JSONResponse({**shadow_server.metrics.snapshot(),'instance_id':instance_id},headers={'Cache-Control':'no-store'})
        @app.post('/v1/shadow/score',response_model=ShadowResult,responses={503:{'description':'Signed unavailable result or a fixed ML_TIMEOUT/ML_BUSY/ML_UNAVAILABLE error'},
            400:{'description':'ML_INVALID_INPUT'},401:{'description':'ML_UNAUTHORIZED'},413:{'description':'ML_INPUT_TOO_LARGE'}})
        async def score(request:Request):
            headers={'Cache-Control':'no-store'}
            def reply(value,status=200,code='scored'):
                shadow_server.metrics.response(str(status)+'_'+code);return JSONResponse(value,status_code=status,headers=headers)
            if not hmac.compare_digest(request.headers.get('authorization','').encode(),('Bearer '+shadow_server.token).encode()):
                return reply({'code':'ML_UNAUTHORIZED'},401,'unauthorized')
            raw=bytearray()
            async for chunk in request.stream():
                if len(raw)+len(chunk)>16384:return reply({'code':'ML_INPUT_TOO_LARGE'},413,'oversize')
                raw.extend(chunk)
            try:value=ShadowRequest.model_validate_json(raw).model_dump()
            except Exception:return reply({'code':'ML_INVALID_INPUT'},400,'invalid')
            if not admission.acquire(blocking=False):return reply({'code':'ML_BUSY'},503,'busy')
            future=executor.submit(shadow_server.score,value)
            future.add_done_callback(lambda _:admission.release())
            try:
                result=await asyncio.wait_for(asyncio.shield(asyncio.wrap_future(future)),timeout=shadow_timeout)
                return reply(result,200 if result['status']=='available' else 503,result['reason_code'])
            except asyncio.TimeoutError:return reply({'code':'ML_TIMEOUT'},503,'timeout')
            except Exception:return reply({'code':'ML_UNAVAILABLE'},503,'error')

        # Describe the strict wire without letting automatic body parsing bypass the streaming cap.
        original_openapi=app.openapi
        def shadow_openapi():
            spec=original_openapi();schema=ShadowRequest.model_json_schema(ref_template='#/components/schemas/{model}')
            definitions=schema.pop('$defs',{})
            spec.setdefault('components',{}).setdefault('schemas',{}).update(definitions)
            spec['components']['schemas']['ShadowRequest']=schema
            spec['components']['securitySchemes']={'LocalBearer':{'type':'http','scheme':'bearer'}}
            operation=spec['paths']['/v1/shadow/score']['post']
            operation['requestBody']={'required':True,'content':{'application/json':{'schema':{'$ref':'#/components/schemas/ShadowRequest'}}}}
            operation['security']=[{'LocalBearer':[]}]
            spec['paths']['/v1/shadow/metrics']['get']['security']=[{'LocalBearer':[]}]
            return spec
        app.openapi=shadow_openapi

    return app
