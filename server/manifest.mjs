import { z } from 'zod';
import { checkKinds } from './checks.mjs';
const text = z.string().trim().min(1).max(2000);
const target = z.object({ selector: text.max(300).optional(), role: z.enum(['button','link','textbox','checkbox','combobox','heading','tab']).optional(), name: text.max(300).optional() }).strict().refine(t => Boolean(t.selector) !== Boolean(t.role && t.name), 'Provide a selector OR a role and name.');
const action = z.discriminatedUnion('action', [
 z.object({action:z.literal('navigate'),url:text.max(2000)}).strict(),
 ...['click','hover','assertVisible','scrollIntoView'].map(a=>z.object({action:z.literal(a),target}).strict()),
 ...['fill','select','assertText'].map(a=>z.object({action:z.literal(a),target,value:text.max(1000)}).strict()),
 z.object({action:z.literal('assertUrl'),value:text.max(2000)}).strict(),
]);
const basic=z.object({kind:z.enum(checkKinds),name:text.max(120),acceptance:text.max(500),value:text.max(200).optional()}).refine(v=>!['text','selector'].includes(v.kind)||Boolean(v.value),'Text and selector checks require a value.');
const journey=z.object({kind:z.literal('journey'),name:text.max(120),acceptance:text,preconditions:z.array(text).max(20).optional(),actions:z.array(action).min(1).max(50)}).refine(v=>v.actions.some(a=>a.action.startsWith('assert')),'A journey needs at least one assertion.');
export const manifestSchema=z.discriminatedUnion('schema',[
 z.object({schema:z.literal('trace/test/v1'),name:text.max(120),checks:z.array(basic).min(1).max(25)}),
 z.object({schema:z.literal('trace/test/v2'),name:text.max(120),policy:z.literal('read-only'),checks:z.array(z.union([basic,journey])).min(1).max(200)})
]);
