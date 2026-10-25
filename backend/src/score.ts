import { z } from 'zod';
export const scoreMcq = (answers: Array<{questionId:string;selectedIndex:number}>, keys: Array<{id:string;correctIndex:number}>) => {
 const byId = new Map(keys.map(q=>[q.id,q.correctIndex]));
 const rows=answers.map(a=>({questionId:a.questionId,correct:byId.has(a.questionId)&&byId.get(a.questionId)===a.selectedIndex}));
 return {correct:rows.filter(x=>x.correct).length,total:keys.length,score:keys.length?Math.round(rows.filter(x=>x.correct).length/keys.length*100):0,rows};
};
export const evaluationSchema=z.object({technicalAccuracy:z.number().min(0).max(40),completeness:z.number().min(0).max(25),problemSolving:z.number().min(0).max(20),clarity:z.number().min(0).max(15),evidence:z.array(z.string()).max(5),missingConcepts:z.array(z.string()).max(8),feedback:z.string().max(1500)});
export const validateEvaluation=(x:unknown)=>evaluationSchema.parse(x);
