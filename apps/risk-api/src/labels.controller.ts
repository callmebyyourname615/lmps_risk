import { ArgumentsHost,Body,Catch,Controller,ExceptionFilter,Get,HttpException,Inject,Param,Post,Query,Req,SetMetadata,UseFilters,UseGuards } from '@nestjs/common';
import { ApiBearerAuth,ApiBody,ApiOperation,ApiResponse,ApiTags } from '@nestjs/swagger';
import type {SchemaObject} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { createLabelReviews,readLabelReview,labelCandidates,LabelError,labelCommandSchema,type Database,type LabelReviewView } from '@lmps/database';
import { LOCAL_SCOPE,LocalAccessGuard,type ScopedRequest } from './local-auth.js';
import { POSTGRES_DATABASE } from './postgres.service.js';
export const LABEL_REVIEWS=Symbol('LABEL_REVIEWS');
@Catch()
class LabelFilter implements ExceptionFilter {
  catch(error:unknown,host:ArgumentsHost){
    const body=error instanceof HttpException?error.getResponse():null;
    const code=error instanceof LabelError?error.code:body&&typeof body==='object'&&'code'in body?String(body.code):'LABEL_STORAGE_UNAVAILABLE';
    const statuses:Record<string,number>={UNAUTHORIZED:401,FORBIDDEN:403,LABEL_INVALID_INPUT:400,LABEL_CONFLICT:409,LABEL_SELF_REVIEW:403,LABEL_SOURCE_NOT_CURRENT:409,LABEL_NOT_FOUND:404,LABEL_NOT_CONFIGURED:503,LABEL_STORAGE_UNAVAILABLE:503};
    host.switchToHttp().getResponse<FastifyReply>().header('Cache-Control','no-store').status(statuses[code]??503).send({code:Object.hasOwn(statuses,code)?code:'LABEL_STORAGE_UNAVAILABLE'});
  }
}
const noQuery=(q:Record<string,unknown>)=>{if(Object.keys(q).length)throw new LabelError('LABEL_INVALID_INPUT');};
@ApiTags('local-label-adjudication')
@ApiBearerAuth()
@UseGuards(LocalAccessGuard)
@UseFilters(LabelFilter)
@SetMetadata(LOCAL_SCOPE,['labels:read','cases:read','risk:read','alerts:read'])
@ApiResponse({status:503,description:'LABEL_STORAGE_UNAVAILABLE or LABEL_NOT_CONFIGURED'})
@Controller('v1/local')
export class LabelsController {
  constructor(@Inject(POSTGRES_DATABASE) private readonly database:Database,@Inject(LABEL_REVIEWS) private readonly writer:ReturnType<typeof createLabelReviews>|null){}
  @Get('cases/:case_id/label-candidates')
  @ApiOperation({summary:'Read task-specific candidates; case opinions never automatically become labels'})
  async candidates(@Req() request:ScopedRequest,@Param('case_id') id:string,@Query() q:Record<string,unknown>){noQuery(q);return labelCandidates(this.database.pool,request.principal.workspace,id);}
  @Get('labels/:label_id')
  @ApiOperation({summary:'Read immutable adjudication history head and current maturity/evidence eligibility; future labels remain unavailable'})
  async detail(@Req() request:ScopedRequest,@Param('label_id') id:string,@Query() q:Record<string,unknown>):Promise<{label:LabelReviewView|null}>{noQuery(q);return {label:await readLabelReview(this.database.pool,request.principal.workspace,id)};}
  @Post('cases/:case_id/labels/:label_id')
  @SetMetadata(LOCAL_SCOPE,['labels:read','labels:adjudicate','cases:read','risk:read','alerts:read'])
  @ApiOperation({summary:'Independent adjudication or revocation bound to one Alert/payment/task and one frozen Case outcome; synthetic eligibility only'})
  @ApiBody({schema:labelCommandSchema as SchemaObject})
  async adjudicate(@Req() request:ScopedRequest,@Param('case_id') caseId:string,@Param('label_id') labelId:string,@Body() body:unknown,@Query() q:Record<string,unknown>){
    noQuery(q);if(!this.writer)throw new HttpException({code:'LABEL_NOT_CONFIGURED'},503);
    return this.writer.adjudicate(request.principal.workspace,caseId,labelId,request.principal.subject,body);
  }
}
