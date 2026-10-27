import json
from pathlib import Path
from .serving import ShadowRequest
from .model_contracts import ShadowResult
from .dataset import FEATURE_SPEC

DIRECTORY=Path(__file__).resolve().parents[3]/'packages/contracts/schemas'


def schemas():
    return {name:{'$schema':'https://json-schema.org/draft/2020-12/schema',**model.model_json_schema()} for name,model in (
        ('ml-shadow-request',ShadowRequest),('ml-shadow-result',ShadowResult))}


if __name__=='__main__':
    for name,value in schemas().items():(DIRECTORY/(name+'.schema.json')).write_text(json.dumps(value,indent=2)+'\n')
    (DIRECTORY/'ml-feature-spec.json').write_text(json.dumps(FEATURE_SPEC,indent=2)+'\n')
    print('Exported2 bounded shadow schemas')
