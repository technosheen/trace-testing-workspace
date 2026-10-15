import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const temp = await mkdtemp(path.join(tmpdir(), "trace-ai-test-"));
process.env.TRACE_DATA_DIR = temp;
const { aiConfig, createAiPlanner, validatePlan } = await import("./ai.mjs");
after(() => rm(temp, { recursive: true, force: true }));

const env = {
  AZURE_OPENAI_ENDPOINT: "https://example.cognitiveservices.azure.com/",
  AZURE_OPENAI_DEPLOYMENT: "trace-drafting",
};
const input = {
  brief:
    'Check the homepage and the exact phrase "Everyday essentials". Do not submit the newsletter.',
  mode: "smoke",
  expectedText: "",
  includeKnowledge: false,
};
const environment = { name: "Demo", url: "http://127.0.0.1:4310/demo" };
const draft = {
  summary: "Homepage availability and required copy.",
  checks: [
    { kind: "http", value: "" },
    { kind: "text", value: "Everyday essentials" },
  ],
  limitations: ["Newsletter submission is not supported."],
};
const response = (value = draft) => ({
  status: "completed",
  output_text: JSON.stringify(value),
});

test("AI drafts use actual runner assertions and stay unexecuted", async () => {
  const db = {};
  let calls = 0,
    request;
  const planner = createAiPlanner({
    env,
    db,
    save() {},
    client: {
      responses: {
        async create(body) {
          request = body;
          calls++;
          return response();
        },
      },
    },
  });
  const plan = await planner.generate(input, environment, [
    { title: "Private note", content: "Exclude this from prompt" },
  ]);
  assert.equal(calls, 1);
  assert.equal(request.store, false);
  assert.equal(request.max_output_tokens, 2000);
  assert.equal(request.text.format.strict, true);
  assert.deepEqual(JSON.parse(request.input).knowledge, []);
  assert.equal(
    plan.cases[0].acceptance,
    "The target page returns an HTTP status below 400.",
  );
  assert.ok(
    plan.cases.every(
      (c) => c.status === "not_run" && c.result === null && !c.evidence.length,
    ),
  );
  assert.ok(plan.generation.limitations.some((v) => v.includes("not visited")));
  assert.ok(planner.status().lastSuccessAt);
  await assert.rejects(planner.generate(input, environment), { status: 429 });
});
test("unsupported, invented and malformed model checks cannot become runnable cases", () => {
  for (const checks of [
    [{ kind: "login", value: "" }],
    [{ kind: "title", value: "Exact title" }],
    [{ kind: "text", value: "Invented copy" }],
    [
      { kind: "http", value: "" },
      { kind: "http", value: "" },
    ],
    [],
  ]) {
    assert.throws(() => validatePlan({ ...draft, checks }, input), {
      status: 502,
    });
  }
  assert.throws(() =>
    validatePlan({ ...draft, checks: Array(21).fill(draft.checks[0]) }, input),
  );
  assert.throws(() => validatePlan({ ...draft, malicious: "ignored?" }, input));
  const plan = validatePlan(
    { ...draft, checks: [{ kind: "http", value: "" }] },
    { ...input, expectedText: "Exact supplied phrase" },
  );
  assert.equal(plan.cases[1].value, "Exact supplied phrase");
});
test("provider errors do not leak secrets and concurrent or excessive drafts are bounded", async () => {
  let resolve;
  const db = {};
  const planner = createAiPlanner({
    env,
    db,
    save() {},
    client: {
      responses: {
        create: () =>
          new Promise((r) => {
            resolve = r;
          }),
      },
    },
  });
  const first = planner.generate(input, environment);
  await assert.rejects(planner.generate(input, environment), { status: 409 });
  resolve(response());
  await first;
  const failed = createAiPlanner({
    env,
    db: {},
    save() {},
    client: {
      responses: {
        async create() {
          throw new Error("API secret sensitive-input");
        },
      },
    },
  });
  await assert.rejects(
    failed.generate(input, environment),
    (e) => !e.message.includes("sensitive-input"),
  );
  const limited = createAiPlanner({
    env,
    db: {
      aiUsage: {
        day: new Date().toISOString().slice(0, 10),
        attempts: 60,
        lastAttemptAt: null,
      },
    },
    save() {},
  });
  await assert.rejects(limited.generate(input, environment), { status: 429 });
});
test("missing credentials fail clearly and knowledge notes require opt-in", async () => {
  assert.equal(aiConfig({}), null);
  assert.equal(
    aiConfig({ ...env, AZURE_OPENAI_ENDPOINT: "http://127.0.0.1/" }),
    null,
  );
  const missing = createAiPlanner({ env: {}, db: {}, save() {} });
  assert.equal(missing.status().configured, false);
  await assert.rejects(missing.generate(input, environment), { status: 503 });
  let request;
  const planner = createAiPlanner({
    env,
    db: {},
    save() {},
    client: {
      responses: {
        async create(body) {
          request = body;
          return response();
        },
      },
    },
  });
  await planner.generate(
    { ...input, includeKnowledge: true },
    environment,
    Array(20).fill({ title: "Requirements", content: "x".repeat(1000) }),
  );
  assert.equal(JSON.parse(request.input).knowledge.length, 8);
  assert.equal(JSON.parse(request.input).knowledge[0].content.length, 500);
});

test("source-grounded journeys preserve action order and reject invented targets and unsafe actions", () => {
  const supplied = {...input,brief:'Go to https://example.com/about, click "Back home", then expect "Everyday essentials". Selector: main'};
  const journey = {name:"Return home",acceptance:"The supplied homepage text is visible",actions:[{action:"navigate",url:"https://example.com/about"},{action:"click",target:{role:"link",name:"Back home"}},{action:"assertText",target:{selector:"main"},value:"Everyday essentials"}]};
  const plan = validatePlan({...draft,journeys:[journey]},supplied,[],environment);
  assert.equal(plan.cases.at(-1).kind,"journey");
  assert.deepEqual(plan.cases.at(-1).actions,journey.actions);
  assert.equal(plan.cases.at(-1).status,"not_run");
  for (const actions of [
    [{action:"navigate",url:"https://invented.example/"},{action:"assertVisible",target:{selector:"main"}}],
    [{action:"assertVisible",target:{selector:"#invented"}}],
    [{action:"click",target:{role:"link",name:"Invented button"}},{action:"assertVisible",target:{selector:"main"}}],
    [{action:"evaluate",value:"alert(1)"}],
    [{action:"click",target:{selector:"main"}}],
    Array(13).fill({action:"assertVisible",target:{selector:"main"}}),
  ]) assert.throws(() => validatePlan({...draft,journeys:[{...journey,actions}]},supplied,[],environment),{status:502});
  const envPlan = validatePlan({...draft,journeys:[{...journey,actions:[{action:"navigate",url:environment.url},{action:"assertUrl",value:environment.url}]}]},input,[],environment);
  assert.equal(envPlan.cases.at(-1).actions[0].url,environment.url);
});

test("knowledge is scoped before limiting and provider schema requires journeys", async () => {
  let request;
  const planner=createAiPlanner({env,db:{},save(){},client:{responses:{async create(body){request=body;return response();}}}});
  await planner.generate({...input,includeKnowledge:true},{...environment,id:"demo"},[
    ...Array(10).fill({title:"Wrong environment",content:"Never include",environmentId:"other"}),
    ...Array(10).fill({title:"Disabled",content:"Never include",enabled:false}),
    {title:"Global",content:"Useful terminology",category:"terminology"},
    {title:"Scoped",content:"Demo rules",category:"rules",environmentId:"demo"},
  ]);
  const notes=JSON.parse(request.input).knowledge;
  assert.deepEqual(notes.map(n=>n.title),["Global","Scoped"]);
  assert.deepEqual(notes.map(n=>n.category),["terminology","rules"]);
  assert.ok(request.text.format.schema.required.includes("journeys"));
});

test('agent AI failures retain safe categories without provider secrets', async () => {
 for (const [providerError,code] of [[Object.assign(new Error('private credential'),{status:429}),'ai_rate_limit'],[new Error('private credential'),'ai_unavailable']]) {
  const planner=createAiPlanner({env,db:{},save(){},client:{responses:{async create(){throw providerError;}}}});
  await assert.rejects(planner.decide({},new AbortController().signal),error=>error.code===code&&!error.message.includes('private credential'));
 }
 const planner=createAiPlanner({env,db:{},save(){},client:{responses:{async create(){return {status:'completed',output_text:'private malformed output'};}}}});
 await assert.rejects(planner.decide({},new AbortController().signal),error=>error.code==='invalid_decision'&&!error.message.includes('private malformed'));
});

test('initial draft save failure releases busy state and preserves storage code', async()=>{
 let calls=0,time=100000;const error=Object.assign(Error('save failed'),{code:'TRACE_STORAGE_STALE'});
 const planner=createAiPlanner({env,db:{},clock:()=>time,save(){throw error;},client:{responses:{async create(){calls++;return response();}}}});
 await assert.rejects(planner.generate(input,environment),{code:'TRACE_STORAGE_STALE'});assert.equal(planner.status().generating,false);assert.equal(calls,0);
 time+=10000;await assert.rejects(planner.generate(input,environment),{code:'TRACE_STORAGE_STALE'});assert.equal(calls,0);
});
