import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { evaluateInterviewAnswers, generateQuestions, type GeminiUsageEvent } from './ai.js';
import path from 'node:path';
export const prisma=new PrismaClient(); export const app=express(); app.set('trust proxy',1);
const secret=process.env.JWT_SECRET?.trim(); if(!secret||secret.length<32||/^(change[-_ ]?me|replace[-_ ]?with|your[-_ ]|example)/i.test(secret)) throw new Error('JWT_SECRET must be set to a non-placeholder value with at least 32 characters');
const configuredOrigins=['FRONTEND_URL','CLIENT_URL'].flatMap(name=>(process.env[name]||'').split(',')).map(origin=>origin.trim().replace(/\/+$/, '')).filter(Boolean);
const allowedOrigins=[...new Set([...configuredOrigins,'https://complete-ai-interview-assessment-pl.vercel.app','http://localhost:5173','http://localhost:3000'])];
app.use(helmet());
app.use(cors({
  origin:(origin,callback)=>{if(!origin||allowedOrigins.includes(origin))return callback(null,true);callback(new Error('Origin is not allowed by CORS'))},
  credentials:true,
  methods:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders:['Authorization','Content-Type','Idempotency-Key'],
}));
app.use(express.json({limit:'1mb'}));
const aiLimiter=rateLimit({windowMs:60_000,max:process.env.NODE_ENV==='test'?100:10,standardHeaders:true,legacyHeaders:false});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:Number(process.env.MAX_UPLOAD_MB||5)*1024*1024},fileFilter:(_req,file,cb)=>cb(null,file.mimetype==='application/pdf')});
const auth=(req:any,res:any,next:any)=>{try{const token=(req.headers.authorization||'').replace(/^Bearer /,'');req.user=jwt.verify(token,secret);next()}catch{res.status(401).json({error:'Please sign in to continue.'})}};
const safe=(fn:(req:any,res:any)=>Promise<any>)=>(req:any,res:any)=>fn(req,res).catch(err=>{const name=err instanceof Error?err.name:'NonError';const code=typeof err?.code==='string'&&/^P\d{4}$/.test(err.code)?err.code:undefined;console.error(`[api] route=${req.path} error=${name}${code?` code=${code}`:''}`);const schemaMissing=code==='P2021';const aiMissing=err.message==='AI_NOT_CONFIGURED';const aiUnavailable=err.message==='AI_PROVIDER_UNAVAILABLE';const aiQuota=err.message==='AI_QUOTA_EXCEEDED';const aiRateLimited=err.message==='AI_RATE_LIMITED';const dailyLimit=err.message==='DAILY_LIMIT_REACHED';const status=err instanceof z.ZodError?400:dailyLimit?429:aiQuota||aiRateLimited?429:aiMissing||aiUnavailable||schemaMissing?503:code==='P2002'?409:err.status||500;res.status(status).json({error:schemaMissing?'Database schema is not initialized. Apply the pending Prisma migrations.':aiMissing?'AI practice generation is unavailable. Set GEMINI_API_KEY in the backend environment.':dailyLimit?'You have reached today’s limit of 10 mock interviews. Try again after midnight UTC.':aiQuota?'The Gemini API project has reached its current quota. Please try again after the quota resets.':aiRateLimited?'Gemini is receiving too many requests right now. Please wait a moment and try again.':aiUnavailable?'AI service is temporarily unavailable. Please try again shortly.':status===409?'Email is already registered.':status===500?'Something went wrong. Please try again.':err.message})});
const dailyLimit=10;
function utcDayStart(now=new Date()){return new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()))}
async function persistGeminiUsage(userId:string,attemptId:string,dailyUsageId:string,event:GeminiUsageEvent){await prisma.$transaction(async(tx:any)=>{await tx.geminiApiUsage.create({data:{userId,attemptId,dailyUsageId,...event}});await tx.dailyUsage.update({where:{id:dailyUsageId},data:{geminiRequestCount:{increment:1},geminiInputTokens:{increment:event.inputTokens},geminiOutputTokens:{increment:event.outputTokens},geminiTotalTokens:{increment:event.totalTokens}}})})}
function attemptQuestionResponse(attempt:any){return{id:attempt.id,deadline:attempt.deadline,questions:(attempt.questions||[]).slice().sort((a:any,b:any)=>a.position-b.position).map((q:any)=>({id:q.id,prompt:q.prompt,type:q.type,options:q.options}))}}
function completedInterviewResponse(attempt:any){const evaluation=attempt.evaluation as any;const correct=attempt.responses?.filter((response:any)=>response.correct).length??0;return{score:attempt.score,overallScore:evaluation?.overallScore??attempt.score,correct,total:8,feedback:evaluation?.feedback??'',strengths:evaluation?.strengths??[],weaknesses:evaluation?.weaknesses??[],questionScores:evaluation?.questionScores??[],rows:(evaluation?.questionScores??[]).map((q:any)=>({position:q.position,score:q.score,feedback:q.feedback}))}}
app.get('/api/health',async(_req,res)=>{if(!process.env.DATABASE_URL)return res.status(503).json({status:'unavailable',database:'not_configured'});try{await prisma.$queryRaw`SELECT 1`;res.json({status:'ok',database:'connected',ai:!!process.env.GEMINI_API_KEY})}catch{return res.status(503).json({status:'unavailable',database:'unavailable'})}});
app.post('/api/auth/signup',safe(async(req,res)=>{const d=z.object({name:z.string().min(2).max(80),email:z.string().email(),password:z.string().min(10).max(100)}).parse(req.body);const email=d.email.toLowerCase();const exists=await prisma.user.findUnique({where:{email}});if(exists)return res.status(409).json({error:'Email is already registered.'});const {password,...profile}=d;const user=await prisma.user.create({data:{...profile,email,passwordHash:await bcrypt.hash(password,12)}});res.status(201).json({token:jwt.sign({sub:user.id},secret,{expiresIn:'7d'}),user:{id:user.id,name:user.name,email:user.email}})}));
app.post('/api/auth/login',safe(async(req,res)=>{const d=z.object({email:z.string().email(),password:z.string().min(1)}).parse(req.body);const user=await prisma.user.findUnique({where:{email:d.email.toLowerCase()}});if(!user||!await bcrypt.compare(d.password,user.passwordHash))return res.status(401).json({error:'Email or password is incorrect.'});res.json({token:jwt.sign({sub:user.id},secret,{expiresIn:'7d'}),user:{id:user.id,name:user.name,email:user.email}})}));
app.get('/api/dashboard',auth,safe(async(req,res)=>{const where={userId:req.user.sub,status:'SUBMITTED'};const [attempts,completed,resumes]=await Promise.all([prisma.attempt.findMany({where,select:{id:true,score:true,category:true,createdAt:true},orderBy:{createdAt:'desc'},take:10}),prisma.attempt.count({where}),prisma.resume.findMany({where:{userId:req.user.sub},select:{id:true,fileName:true,createdAt:true},orderBy:{createdAt:'desc'},take:1})]);const scores=attempts.map((a:{score:number|null})=>a.score??0);res.json({completed,average:scores.length?Math.round(scores.reduce((a:number,b:number)=>a+b,0)/scores.length):null,best:scores.length?Math.max(...scores):null,attempts,resume:resumes[0]||null})}));
app.get('/api/questions',auth,safe(async(_req,res)=>res.json(await prisma.question.findMany({where:{active:true},select:{id:true,prompt:true,category:true,difficulty:true,options:true,type:true},take:100}))));
app.post('/api/resumes',auth,upload.single('resume'),safe(async(req,res)=>{if(!req.file)return res.status(400).json({error:'Choose a PDF file under the size limit.'});if(req.file.buffer.subarray(0,5).toString()!=='%PDF-')return res.status(400).json({error:'This file does not appear to be a valid PDF.'});const pdfParse=(await import('pdf-parse')).default;let parsed;try{parsed=await pdfParse(req.file.buffer,{max:8});}catch{return res.status(422).json({error:'We could not read that PDF. Try exporting it again.'})}if(!parsed.text.trim())return res.status(422).json({error:'No selectable text found. Scanned PDFs are not supported yet.'});const text=parsed.text.slice(0,20000);const skills=[...new Set(text.match(/\b(?:JavaScript|TypeScript|React|Node\.js|Python|Java|SQL|PostgreSQL|MongoDB|AWS|Docker|REST|Express)\b/gi)||[])];const resume=await prisma.resume.create({data:{userId:req.user.sub,fileName:path.basename(req.file.originalname).slice(0,150),text,skills}});res.status(201).json({id:resume.id,fileName:resume.fileName,skills,preview:text.slice(0,3000),notice:'Extracted from your document; not independently verified.'})}));
app.post('/api/assessments/generate',auth,aiLimiter,safe(async(req,res)=>{
  const d=z.object({role:z.string().min(2).max(100),category:z.string().min(2).max(100),difficulty:z.enum(['BEGINNER','INTERMEDIATE','ADVANCED']),count:z.literal(8).optional(),durationMinutes:z.number().int().min(5).max(120),resumeId:z.string().optional(),jobDescription:z.string().max(3000).optional()}).parse(req.body);
  const idempotencyKey=String(req.headers['idempotency-key']||'').trim();
  // Temporary deployment diagnostic: log only header presence/shape, never its value or request data.
  console.info(`[api] route=/api/assessments/generate idempotency_header_present=${idempotencyKey.length>0} idempotency_key_length=${idempotencyKey.length} idempotency_key_valid=${idempotencyKey.length>=8&&idempotencyKey.length<=128}`);
  if(idempotencyKey.length<8||idempotencyKey.length>128)return res.status(400).json({error:'A valid Idempotency-Key header is required to start a mock interview.'});
  let resume:any=null;
  if(d.resumeId){resume=await prisma.resume.findFirst({where:{id:d.resumeId,userId:req.user.sub}});if(!resume)return res.status(404).json({error:'Resume not found.'})}
  const userId=req.user.sub;
  const existing=await prisma.attempt.findFirst({where:{userId,idempotencyKey},include:{questions:true}});
  if(existing){if(existing.status==='IN_PROGRESS')return res.json(attemptQuestionResponse(existing));return res.status(409).json({error:existing.status==='GENERATING'?'This mock interview is already being generated. Please retry shortly.':'This request was already used. Start a new mock interview.'})}
  const dayStart=utcDayStart();
  let reserved:any;
  try{
    reserved=await prisma.$transaction(async(tx:any)=>{
      const usage=await tx.dailyUsage.upsert({where:{userId_dayStart:{userId,dayStart}},create:{userId,dayStart},update:{}});
      const changed=await tx.dailyUsage.updateMany({where:{id:usage.id,mockInterviewCount:{lt:dailyLimit}},data:{mockInterviewCount:{increment:1}}});
      if(changed.count!==1)throw new Error('DAILY_LIMIT_REACHED');
      const attempt=await tx.attempt.create({data:{userId,category:d.category,role:d.role,difficulty:d.difficulty,status:'GENERATING',idempotencyKey,dailyUsageId:usage.id,deadline:new Date()}});
      return{attempt,usage};
    });
  }catch(error:any){
    if(error?.code==='P2002'){
      const duplicate=await prisma.attempt.findFirst({where:{userId,idempotencyKey},include:{questions:true}});
      if(duplicate){if(duplicate.status==='IN_PROGRESS')return res.json(attemptQuestionResponse(duplicate));return res.status(409).json({error:'This mock interview is already being generated. Please retry shortly.'})}
    }
    throw error;
  }
  const options={operation:'GENERATION' as const,onUsage:(event:GeminiUsageEvent)=>persistGeminiUsage(userId,reserved.attempt.id,reserved.usage.id,event)};
  try{
    const qs=await generateQuestions({...d,resume:resume?.text},options);
    const attempt=await prisma.attempt.update({where:{id:reserved.attempt.id},data:{status:'IN_PROGRESS',deadline:new Date(Date.now()+d.durationMinutes*60_000),questions:{create:qs.map((q:any,i:number)=>({position:i,prompt:q.prompt,type:q.type,options:q.options,answerIndex:q.answerIndex,explanation:q.explanation}))}},include:{questions:true}});
    return res.status(201).json(attemptQuestionResponse(attempt));
  }catch(error){
    await prisma.$transaction(async(tx:any)=>{
      await tx.attempt.update({where:{id:reserved.attempt.id},data:{status:'GENERATION_FAILED'}});
      await tx.dailyUsage.update({where:{id:reserved.usage.id},data:{mockInterviewCount:{decrement:1}}});
    }).catch((recordError:any)=>console.error(`[api] failed to release interview reservation error=${recordError instanceof Error?recordError.name:'NonError'}`));
    throw error;
  }
}));

app.post('/api/assessments/:id/submit',auth,aiLimiter,safe(async(req,res)=>{
  const attempt=await prisma.attempt.findFirst({where:{id:req.params.id,userId:req.user.sub},include:{questions:true,responses:true}});
  if(!attempt)return res.status(404).json({error:'Assessment not found.'});
  if(attempt.status==='SUBMITTED')return res.json(completedInterviewResponse(attempt));
  if(attempt.status==='EVALUATING')return res.status(409).json({error:'Your interview is already being evaluated. Please wait a moment.'});
  if(attempt.status!=='IN_PROGRESS'&&attempt.status!=='EVALUATION_FAILED')return res.status(409).json({error:'This mock interview is not ready to submit.'});
  if(attempt.questions.length!==8)return res.status(409).json({error:'This mock interview does not contain exactly 8 questions.'});
  const answerSchema=z.array(z.object({questionId:z.string(),selectedIndex:z.number().int().min(0).max(3)})).length(8).superRefine((items,ctx)=>{if(new Set(items.map(item=>item.questionId)).size!==8)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Each question must have one answer.'})});
  const answers=answerSchema.parse(req.body.answers);
  const byQuestion=new Map(attempt.questions.map((question:any)=>[question.id,question]));
  if(answers.some(answer=>!byQuestion.has(answer.questionId)))return res.status(400).json({error:'Answer all 8 questions from this mock interview.'});
  if(new Date()>attempt.deadline)return res.status(410).json({error:'Assessment deadline has passed.'});
  const claimed=await prisma.$transaction(async(tx:any)=>{
    const changed=await tx.attempt.updateMany({where:{id:attempt.id,userId:req.user.sub,status:{in:['IN_PROGRESS','EVALUATION_FAILED']}},data:{status:'EVALUATING'}});
    if(changed.count!==1)return false;
    for(const answer of answers){
      const question:any=byQuestion.get(answer.questionId);
      const options=question.options as string[];
      const selectedAnswer=options[answer.selectedIndex];
      await tx.response.upsert({where:{attemptId_questionId:{attemptId:attempt.id,questionId:question.id}},create:{attemptId:attempt.id,questionId:question.id,answer:selectedAnswer,correct:answer.selectedIndex===question.answerIndex},update:{answer:selectedAnswer,correct:answer.selectedIndex===question.answerIndex}});
    }
    return true;
  });
  if(!claimed){
    const current=await prisma.attempt.findFirst({where:{id:attempt.id,userId:req.user.sub},include:{questions:true,responses:true}});
    if(current?.status==='SUBMITTED')return res.json(completedInterviewResponse(current));
    return res.status(409).json({error:'Your interview is already being evaluated. Please wait a moment.'});
  }
  const answerById=new Map(answers.map(answer=>[answer.questionId,answer]));
  const evaluationInput=attempt.questions.slice().sort((a:any,b:any)=>a.position-b.position).map((question:any,index:number)=>{
    const answer=answerById.get(question.id)!;
    const options=question.options as string[];
    return{position:index+1,prompt:question.prompt,selectedAnswer:options[answer.selectedIndex],correctAnswer:options[question.answerIndex],isCorrect:answer.selectedIndex===question.answerIndex,explanation:question.explanation};
  });
  try{
    let usageId=attempt.dailyUsageId;
    if(!usageId){
      const usage=await prisma.dailyUsage.upsert({where:{userId_dayStart:{userId:req.user.sub,dayStart:utcDayStart()}},create:{userId:req.user.sub,dayStart:utcDayStart()},update:{}});
      usageId=usage.id;
      await prisma.attempt.update({where:{id:attempt.id},data:{dailyUsageId:usageId}});
    }
    const evaluation=await evaluateInterviewAnswers(evaluationInput,{operation:'EVALUATION',onUsage:(event:GeminiUsageEvent)=>persistGeminiUsage(req.user.sub,attempt.id,usageId,event)});
    const score=evaluation.overallScore;
    const completed=await prisma.$transaction(async(tx:any)=>{
      await tx.attempt.update({where:{id:attempt.id},data:{status:'SUBMITTED',score,evaluation:evaluation as any}});
      return tx.attempt.findFirst({where:{id:attempt.id,userId:req.user.sub},include:{questions:true,responses:true}});
    });
    return res.json(completedInterviewResponse(completed));
  }catch(error){
    await prisma.attempt.update({where:{id:attempt.id},data:{status:'EVALUATION_FAILED'}}).catch((recordError:any)=>console.error(`[api] failed to mark evaluation error=${recordError instanceof Error?recordError.name:'NonError'}`));
    throw error;
  }
}));
if(process.env.NODE_ENV!=='test'){const port=Number(process.env.PORT||4000);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be a valid TCP port number');app.listen(port,'0.0.0.0',()=>console.log(`HirePrep API listening on port ${port}`))}



