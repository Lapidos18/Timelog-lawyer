export interface RateRule {id:string;matter_id:string;activity_type:string|null;user_id:string|null;valid_from:string;valid_to:string|null;hourly_rate:number|string;reason:string}
export function findRateRule(rules:RateRule[],matter:string,date:string,activity:string,user:string){
 return rules.filter(r=>r.matter_id===matter&&r.valid_from<=date&&(!r.valid_to||r.valid_to>=date)&&(!r.activity_type||r.activity_type===activity)&&(!r.user_id||r.user_id===user))
 .sort((a,b)=>((b.activity_type?2:0)+(b.user_id?1:0))-((a.activity_type?2:0)+(a.user_id?1:0))||b.valid_from.localeCompare(a.valid_from)||a.id.localeCompare(b.id))[0]
}
