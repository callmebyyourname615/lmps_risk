import { BadRequestException, Controller, Get, HttpException, Inject, Param, Query, Req, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiProperty, ApiOkResponse } from '@nestjs/swagger';
import { readModelReceipt, type Database } from '@lmps/database';
import { ALERT_UUID, type ModelReceiptView, type ModelTrust } from '@lmps/risk';
import { LOCAL_SCOPE, LocalAccessGuard, type ScopedRequest } from './local-auth.js';
import { POSTGRES_DATABASE } from './postgres.service.js';

export const MODEL_TRUST=Symbol('MODEL_TRUST');
class ModelReceiptDto implements ModelReceiptView {
  @ApiProperty() request_id!:string;
  @ApiProperty() assessment_run_id!:string;
  @ApiProperty({type:'object',additionalProperties:true,description:'Immutable versioned task, probability threshold, pinned model, missing-model behavior and rule Alert policy.'}) policy!:ModelReceiptView['policy'];
  @ApiProperty() feature_sha256!:string;
  @ApiProperty({type:'object',additionalProperties:true,nullable:true,description:'Pinned model name/version/artifact/dataset hashes, algorithm and currency.'}) model!:ModelReceiptView['model'];
  @ApiProperty({enum:['available','unavailable']}) model_status!:ModelReceiptView['model_status'];
  @ApiProperty({type:'object',additionalProperties:{type:'string',pattern:'^(0\\.[0-9]{9}|1\\.000000000)$'},description:'Fraud/Mule/AML calibrated probabilities; empty when unavailable. Novelty is not a probability.'}) probabilities!:Record<string,string>;
  @ApiProperty({type:'object',additionalProperties:true,description:'Gate status/reason/task/probability/enforcement. No averaged rules/model score.'}) decision!:ModelReceiptView['decision'];
  @ApiProperty({type:String,nullable:true}) alert_id!:string|null;
  @ApiProperty() receipt_sha256!:string;
  @ApiProperty() recorded_by!:string;
  @ApiProperty() recorded_at!:string;
  @ApiProperty({enum:[false]}) training_eligible!:false;
  @ApiProperty({enum:[false]}) enforcement!:false;
  @ApiProperty({enum:['synthetic_shadow_only']}) scope!:'synthetic_shadow_only';
}
class ModelReceiptDetailDto {
  @ApiProperty({type:ModelReceiptDto,nullable:true}) receipt!:ModelReceiptDto|null;
}
@ApiTags('local-model-evidence')
@ApiBearerAuth()
@UseGuards(LocalAccessGuard)
@SetMetadata(LOCAL_SCOPE,['risk:read','alerts:read'])
@Controller('v1/local/model-receipts')
export class ModelSignalsController {
  constructor(@Inject(POSTGRES_DATABASE) private readonly database: Database|null,@Inject(MODEL_TRUST) private readonly trust: ModelTrust|null) {}
  @Get(':request_id')
  @ApiOperation({summary:'Read a verified immutable synthetic shadow receipt; requires both risk:read and alerts:read. No raw feature vectors or training labels.'})
  @ApiOkResponse({type:ModelReceiptDetailDto,description:'Typed ModelReceiptView or null for an unknown/foreign workspace request.'})
  @ApiResponse({status:503,description:'ML_STORAGE_UNAVAILABLE or ML_NOT_CONFIGURED; no fallback score.'})
  async detail(@Req() request:ScopedRequest,@Param('request_id') id:string,@Query() query:Record<string,unknown>):Promise<{receipt:ModelReceiptView|null}> {
    if(!ALERT_UUID.test(id)||Object.keys(query).length)throw new BadRequestException({code:'INVALID_QUERY'});
    if(!this.database||!this.trust)throw new HttpException({code:'ML_NOT_CONFIGURED'},503);
    try{return {receipt:await readModelReceipt(this.database.pool,request.principal.workspace,id,this.trust)};}
    catch{throw new HttpException({code:'ML_STORAGE_UNAVAILABLE'},503);}
  }
}
