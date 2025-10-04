import React, { useEffect, useMemo, useState } from "react";
// Icons: lucide-react if available, otherwise placeholders to avoid crashes
let Icons: any = {};
try { Icons = require("lucide-react"); } catch { Icons = new Proxy({}, { get: () => (p: any) => <span {...p}>⦿</span> }); }
const { Calculator, AlarmClock, Play, Pause, RotateCcw, Sparkles, CheckCircle2, XCircle, ListTree } = Icons;

// ===================== Types =====================
type Difficulty = "easy" | "medium" | "hard";
type Mode = "2x2" | "3x3";
type AnswerType = "integers" | "fractions";

interface EquationStd { a: number; b: number; c?: number; d: number; } // ax + by (+ cz) = d
interface Problem {
  id: string;
  mode: Mode;
  variables: ("x" | "y" | "z")[];
  eqs: EquationStd[]; // internal standard form
  display: string[];  // pretty scrambled form
}
interface LifetimeStats { totalAttempts: number; totalCorrect: number; totalTimeSec: number; }
interface ExplainState { reasons: string[]; steps: string[]; correctText?: string; }

// ===================== Math helpers =====================
const rnd = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const choice = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const approx = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const igcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : igcd(b, a % b));
const lcm2 = (a: number, b: number) => Math.abs(a * b) / igcd(a, b);
const lcm3 = (a: number, b: number, c: number) => lcm2(lcm2(a, b), c);
function simplifyFraction(num: number, den: number){ if(den<0){num=-num;den=-den;} const g=igcd(num,den); return {num:num/g, den:den/g}; }
function fracToText(num:number, den:number){ return den===1?`${num}`:`${num}/${den}`; }
function toRationalApprox(x:number, maxDen=12){ let bestP=0,bestQ=1,bestErr=Infinity; for(let q=1;q<=maxDen;q++){const p=Math.round(x*q); const err=Math.abs(x-p/q); if(err<bestErr){bestErr=err;bestP=p;bestQ=q;}} const s=simplifyFraction(bestP,bestQ); return `${s.num}/${s.den}`; }

// ===================== Solvers =====================
function solve2(e1: EquationStd, e2: EquationStd){
  const D = e1.a*e2.b - e1.b*e2.a; if (D===0) return null;
  const Dx = e1.d*e2.b - e1.b*e2.d; const Dy = e1.a*e2.d - e1.d*e2.a;
  const fx = simplifyFraction(Dx, D); const fy = simplifyFraction(Dy, D);
  return { x: Dx/D, y: Dy/D, xNum: fx.num, xDen: fx.den, yNum: fy.num, yDen: fy.den } as const;
}
function solve3(eq: EquationStd[]){
  const A = eq.map(e=>[e.a,e.b,e.c??0,e.d]);
  for(let c=0;c<3;c++){
    let p=c; for(let r=c+1;r<3;r++) if(Math.abs(A[r][c])>Math.abs(A[p][c])) p=r;
    if(Math.abs(A[p][c])<1e-12) return null; if(p!==c)[A[p],A[c]]=[A[c],A[p]];
    for(let r=c+1;r<3;r++){ const f=A[r][c]/A[c][c]; for(let k=c;k<=3;k++) A[r][k]-=f*A[c][k]; }
  }
  const z=A[2][3]/A[2][2]; const y=(A[1][3]-A[1][2]*z)/A[1][1]; const x=(A[0][3]-A[0][2]*z-A[0][1]*y)/A[0][0];
  return {x,y,z} as const;
}

// ===================== Display (scramble) =====================
function formatSide(ax:number, by:number, cz:number|undefined, k:number, includeZ:boolean){
  type Tok = { coef:number, t:"const"|"x"|"y"|"z" };
  const toks: Tok[] = [];
  if (k!==0) toks.push({coef:k,t:"const"});
  if (ax!==0) toks.push({coef:ax,t:"x"});
  if (by!==0) toks.push({coef:by,t:"y"});
  if (includeZ && cz && cz!==0) toks.push({coef:cz,t:"z"});
  if (toks.length===0) return "0";
  let out="", first=true;
  for(const tok of toks){ const sign = tok.coef<0?"-":"+"; const mag=Math.abs(tok.coef); const core = tok.t==="const"?`${mag}`:`${mag===1?"":mag}${tok.t}`; if(first){ out += (tok.coef<0?"- ":"") + core; first=false; } else { out += ` ${sign} ${core}`; } }
  return out;
}
function scrambleLinear(e: EquationStd, includeZ:boolean){
  const a=e.a,b=e.b,c=(e.c??0),d=e.d;
  const axL=rnd(-3,3), axR=axL-a; const byL=rnd(-3,3), byR=byL-b; const czL=includeZ?rnd(-3,3):0, czR=includeZ?czL-c:0; const kL=rnd(-12,12), kR=kL-d;
  const L=formatSide(axL,byL,czL,kL,includeZ); const R=formatSide(axR,byR,czR,kR,includeZ);
  return `${L} = ${R}`;
}

// ===================== Generators =====================
function id() { return `p_${Math.random().toString(36).slice(2,9)}`; }
function loadStats(): LifetimeStats { try{const s=localStorage.getItem("simulsolve:min:stats"); if(s) return JSON.parse(s);}catch{} return { totalAttempts:0, totalCorrect:0, totalTimeSec:0 }; }
function saveStats(s: LifetimeStats){ try{localStorage.setItem("simulsolve:min:stats", JSON.stringify(s));}catch{} }

// Choose solutions first (integer or simple fractions), then create coefficients to make RHS integers exactly
function pickSolution2(ansType: AnswerType){
  const pickPQ = ()=> ansType==="integers"? {p:rnd(-6,6), q:1} : {p:rnd(-12,12), q:choice([2,3,4,5,6,7,8])};
  const sx=pickPQ(), sy=pickPQ(); return {x: sx.p/sx.q, y: sy.p/sy.q, qx:sx.q, qy:sy.q};
}
function pickSolution3(ansType: AnswerType){
  const pickPQ = ()=> ansType==="integers"? {p:rnd(-4,4), q:1} : {p:rnd(-10,10), q:choice([2,3,4,5,6,7,8])};
  const sx=pickPQ(), sy=pickPQ(), sz=pickPQ(); return {x: sx.p/sx.q, y: sy.p/sy.q, z: sz.p/sz.q, qx:sx.q, qy:sy.q, qz:sz.q};
}

function gen2x2(difficulty: Difficulty, ansType: AnswerType): Problem{
  const sol = pickSolution2(ansType); const L = lcm2(sol.qx, sol.qy);
  const base = difficulty==="easy"? [1,2,3] : difficulty==="medium"? [1,2,3,4,5] : [1,2,3,4,5,6,7];
  let a = L*choice([-1,1])*choice(base), b = L*choice([-1,1])*choice(base);
  let c = L*choice([-1,1])*choice(base), d = L*choice([-1,1])*choice(base);
  if (a*d - b*c === 0) d += L;
  const e1: EquationStd = { a, b, d: Math.trunc(a*sol.x + b*sol.y) };
  const e2: EquationStd = { a:c, b:d, d: Math.trunc(c*sol.x + d*sol.y) };
  const display = [scrambleLinear(e1,false), scrambleLinear(e2,false)];
  return { id:id(), mode:"2x2", variables:["x","y"], eqs:[e1,e2], display };
}

function gen3x3(difficulty: Difficulty, ansType: AnswerType): Problem{
  const sol = pickSolution3(ansType); const L = lcm3(sol.qx, sol.qy, sol.qz);
  const base = difficulty==="easy"? [1,2,3] : difficulty==="medium"? [1,2,3,4] : [1,2,3,4,5];
  const row = ()=> [L*choice([-1,1])*choice(base), L*choice([-1,1])*choice(base), L*choice([-1,1])*choice(base)];
  let A = [row(), row(), row()];
  const det = (M:number[][])=> M[0][0]*(M[1][1]*M[2][2]-M[1][2]*M[2][1]) - M[0][1]*(M[1][0]*M[2][2]-M[1][2]*M[2][0]) + M[0][2]*(M[1][0]*M[2][1]-M[1][1]*M[2][0]);
  if(det(A)===0) A[2][2]+=L;
  const rhs = [
    Math.trunc(A[0][0]*sol.x + A[0][1]*sol.y + A[0][2]*sol.z),
    Math.trunc(A[1][0]*sol.x + A[1][1]*sol.y + A[1][2]*sol.z),
    Math.trunc(A[2][0]*sol.x + A[2][1]*sol.y + A[2][2]*sol.z)
  ];
  const e1: EquationStd = { a:A[0][0], b:A[0][1], c:A[0][2], d:rhs[0] };
  const e2: EquationStd = { a:A[1][0], b:A[1][1], c:A[1][2], d:rhs[1] };
  const e3: EquationStd = { a:A[2][0], b:A[2][1], c:A[2][2], d:rhs[2] };
  const display = [scrambleLinear(e1,true), scrambleLinear(e2,true), scrambleLinear(e3,true)];
  return { id:id(), mode:"3x3", variables:["x","y","z"], eqs:[e1,e2,e3], display };
}

function genProblem(mode: Mode, difficulty: Difficulty, ansType: AnswerType){ return mode==="2x2"? gen2x2(difficulty, ansType) : gen3x3(difficulty, ansType); }

// ===================== Worked solution builder =====================
function eqToString(e: EquationStd){
  const left = formatSide(e.a, e.b, e.c, 0, e.c!==undefined);
  return `${left} = ${e.d}`;
}
function worked2x2(prob: Problem, sol: ReturnType<typeof solve2>){
  const [e1,e2] = prob.eqs;
  const lcmX = (e1.a===0||e2.a===0)?Infinity:lcm2(Math.abs(e1.a),Math.abs(e2.a));
  const lcmY = (e1.b===0||e2.b===0)?Infinity:lcm2(Math.abs(e1.b),Math.abs(e2.b));
  const eliminate = lcmX<=lcmY? 'x':'y';
  const s: string[] = [];
  s.push(`Start: Eq(1) ${eqToString(e1)},  Eq(2) ${eqToString(e2)}`);
  if(eliminate==='x'){
    const k1 = lcmX/Math.abs(e1.a), k2 = lcmX/Math.abs(e2.a), op = Math.sign(e1.a)===Math.sign(e2.a)?'-':'+', sx=Math.sign(e1.a), sy=Math.sign(e2.a);
    const E1 = {a:e1.a*k1,b:e1.b*k1,d:e1.d*k1};
    const E2 = {a:e2.a*k2,b:e2.b*k2,d:e2.d*k2};
    s.push(`Make |x| match: multiply Eq(1) by ${k1} → (${E1.a})x + (${E1.b})y = ${E1.d}`);
    s.push(`Multiply Eq(2) by ${k2} → (${E2.a})x + (${E2.b})y = ${E2.d}`);
    const By = E1.b - (op==='-'?E2.b:-E2.b);
    const Bd = E1.d - (op==='-'?E2.d:-E2.d);
    s.push(`Eliminate x: Eq(1) ${op} Eq(2) → (${By})y = ${Bd}`);
    const yNum = Bd; const yDen = By; const yS = simplifyFraction(yNum, yDen); s.push(`y = ${fracToText(yS.num, yS.den)}`);
    const xVal = (sol as any).x; const yVal = (sol as any).y; s.push(`Back-substitute into Eq(1): x = ${(xVal).toFixed(4)} ( = ${fracToText(sol!.xNum, sol!.xDen)})`);
  } else {
    const k1 = lcmY/Math.abs(e1.b), k2 = lcmY/Math.abs(e2.b), op = Math.sign(e1.b)===Math.sign(e2.b)?'-':'+', sx=Math.sign(e1.b), sy=Math.sign(e2.b);
    const E1 = {a:e1.a*k1,b:e1.b*k1,d:e1.d*k1};
    const E2 = {a:e2.a*k2,b:e2.b*k2,d:e2.d*k2};
    s.push(`Make |y| match: multiply Eq(1) by ${k1} → (${E1.a})x + (${E1.b})y = ${E1.d}`);
    s.push(`Multiply Eq(2) by ${k2} → (${E2.a})x + (${E2.b})y = ${E2.d}`);
    const Bx = E1.a - (op==='-'?E2.a:-E2.a);
    const Bd = E1.d - (op==='-'?E2.d:-E2.d);
    s.push(`Eliminate y: Eq(1) ${op} Eq(2) → (${Bx})x = ${Bd}`);
    const xNum = Bd; const xDen = Bx; const xS = simplifyFraction(xNum, xDen); s.push(`x = ${fracToText(xS.num, xS.den)}`);
    const xVal = (sol as any).x; const yVal = (sol as any).y; s.push(`Back-substitute into Eq(1): y = ${(yVal).toFixed(4)} ( = ${fracToText(sol!.yNum, sol!.yDen)})`);
  }
  return s;
}

// ===================== Component =====================
export default function SimulSolveMinimal(){
  const examFont = { fontFamily: 'Cambria, Georgia, "Times New Roman", ui-serif, serif' } as React.CSSProperties;

  // controls
  const [mode, setMode] = useState<Mode>("2x2");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [ansType, setAnsType] = useState<AnswerType>("fractions");
  const [targetSeconds, setTargetSeconds] = useState(120);

  // problem & run state
  const [p, setP] = useState<Problem>(()=>genProblem("2x2","medium","fractions"));
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [answer, setAnswer] = useState<Record<string,string>>({});
  const [status, setStatus] = useState<"idle"|"correct"|"wrong">("idle");
  const [explain, setExplain] = useState<ExplainState>({ reasons: [], steps: [] });
  const [inputErr, setInputErr] = useState<Record<string,string>>({});
  const [attemptsOnThis, setAttemptsOnThis] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [showWork, setShowWork] = useState(false);

  // stats
  const [session, setSession] = useState({ attempts:0, correct:0, timeSec:0 });
  const [lifetime, setLifetime] = useState<LifetimeStats>(loadStats());
  type AttemptRecord = { ts:number; seconds:number; correct:boolean };
  const [history, setHistory] = useState<AttemptRecord[]>(()=>{ try{const s=localStorage.getItem("simulsolve:min:history"); return s?JSON.parse(s):[];}catch{return [];} });
  const saveHistory=(h:AttemptRecord[])=>{ try{ localStorage.setItem("simulsolve:min:history", JSON.stringify(h.slice(-200))); }catch{} };

  // timer
  useEffect(()=>{ if(!running) return; const id=setInterval(()=>setElapsed(e=>e+0.1),100); return ()=>clearInterval(id); },[running]);
  // reset on new problem
  useEffect(()=>{ setElapsed(0); setAnswer({}); setStatus("idle"); setExplain({reasons:[],steps:[]}); setInputErr({}); setAttemptsOnThis(0); setRevealed(false); setShowWork(false); },[p.id]);

  const progress = Math.min(100, Math.round(100*elapsed/targetSeconds));

  function newProblem(){ setP(genProblem(mode, difficulty, ansType)); }

  function parseFraction(txt:string){ const s=txt.trim(); if(!s) return NaN; if(s.includes('/')){ const [pn,qn]=s.split('/'); const p=Number(pn), q=Number(qn); if(!isFinite(p)||!isFinite(q)||q===0) return NaN; return p/q; } return Number(s); }
  function validateField(name:string, value:string){ if(value.trim()===""){ setInputErr(e=>({...e,[name]:"Required"})); return; } const v=parseFraction(value); if(!isFinite(v)) setInputErr(e=>({...e,[name]:"Enter number or a/b"})); else setInputErr(e=>{ const { [name]:_, ...rest }=e; return rest; }); }

  const solved = useMemo(()=> p.mode==="2x2"? solve2(p.eqs[0], p.eqs[1]) : solve3(p.eqs), [p]);
  const workedSteps = useMemo(()=>{
    if(!solved) return [] as string[];
    if(p.mode==="2x2") return worked2x2(p, solved as any);
    return buildOptimalSteps(p);
  }, [p, solved]);

  function submit(){
    // validate
    for(const v of p.variables){ validateField(v, (answer as any)[v]??""); }
    if(Object.keys(inputErr).length>0){ setExplain({reasons:["Please fix input errors."], steps:[]}); setStatus("wrong"); return; }

    const sol2 = p.mode==="2x2"? solve2(p.eqs[0], p.eqs[1]) : null;
    const sol3 = p.mode==="3x3"? solve3(p.eqs) : null;
    if(!sol2 && !sol3){ setExplain({reasons:["Singular system — generate a new one."], steps:[]}); setStatus("wrong"); return; }

    const x = parseFraction(answer.x??""); const y=parseFraction(answer.y??""); const z=parseFraction(answer.z??"");
    let ok=false; let feedback: string[] = []; let correctText="";
    if(sol2){ ok = approx(x, sol2.x) && approx(y, sol2.y); if(!ok){ const r1=p.eqs[0].a*(x||0)+p.eqs[0].b*(y||0)-p.eqs[0].d; const r2=p.eqs[1].a*(x||0)+p.eqs[1].b*(y||0)-p.eqs[1].d; feedback.push(`Residuals: Eq1 ${r1.toFixed(2)}, Eq2 ${r2.toFixed(2)}`); correctText=`x = ${fracToText(sol2.xNum,sol2.xDen)}, y = ${fracToText(sol2.yNum,sol2.yDen)}`; } }
    if(sol3){ ok = approx(x, sol3.x) && approx(y, sol3.y) && approx(z, sol3.z); if(!ok){ const r1=p.eqs[0].a*(x||0)+p.eqs[0].b*(y||0)+(p.eqs[0].c??0)*(z||0)-p.eqs[0].d; const r2=p.eqs[1].a*(x||0)+p.eqs[1].b*(y||0)+(p.eqs[1].c??0)*(z||0)-p.eqs[1].d; const r3=p.eqs[2].a*(x||0)+p.eqs[2].b*(y||0)+(p.eqs[2].c??0)*(z||0)-p.eqs[2].d; feedback.push(`Residuals: Eq1 ${r1.toFixed(2)}, Eq(2) ${r2.toFixed(2)}, Eq(3) ${r3.toFixed(2)}`); correctText=`x ≈ ${toRationalApprox(sol3.x)}, y ≈ ${toRationalApprox(sol3.y)}, z ≈ ${toRationalApprox(sol3.z)}`; } }

    const nextTries = ok ? 0 : (attemptsOnThis + 1);
    const revealNow = !ok && nextTries >= 2;
    setAttemptsOnThis(nextTries);
    setRevealed(revealNow || revealed);

    setExplain(
      ok
        ? { reasons:["Nice! Your values satisfy all equations."], steps:[] }
        : { reasons: revealNow? [...feedback, "Answer revealed after two attempts."] : feedback, steps: buildOptimalSteps(p), correctText: revealNow? correctText : undefined }
    );
    setStatus(ok?"correct":"wrong");

    // stats + history
    setSession(s=>({ attempts:s.attempts+1, correct:s.correct+(ok?1:0), timeSec:s.timeSec+elapsed }));
    const nextLife: LifetimeStats = { totalAttempts:lifetime.totalAttempts+1, totalCorrect:lifetime.totalCorrect+(ok?1:0), totalTimeSec:lifetime.totalTimeSec+elapsed };
    setLifetime(nextLife); saveStats(nextLife);
    const nextHist = [...history, { ts: Date.now(), seconds: elapsed, correct: ok }]; setHistory(nextHist); saveHistory(nextHist);
  }

  // charts
  function SparkLine({data, title, height=80}:{data:number[]; title:string; height?:number}){
    const w=300,h=height,pad=8; if(data.length===0) return (<div className="rounded-xl border border-gray-200/10 p-3 bg-white/5"><div className="text-xs text-gray-400 mb-1">{title}</div><div className="text-gray-500 text-sm">No data yet</div></div>);
    const maxV=Math.max(...data), minV=Math.min(...data), span=Math.max(1e-6,maxV-minV); const pts=data.map((v,i)=>[ pad + (i*(w-2*pad))/Math.max(1,data.length-1), pad + (h-2*pad)*(1-(v-minV)/span) ] as const ); const path=pts.map((p,i)=> i?`L ${p[0]} ${p[1]}`:`M ${p[0]} ${p[1]}`).join(' '); const last=pts[pts.length-1];
    return (<div className="rounded-xl border border-gray-200/10 p-3 bg-white/5"><div className="text-xs text-gray-400 mb-1">{title}</div><svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20"><path d={path} fill="none" stroke="currentColor" strokeWidth="2"/><circle cx={last[0]} cy={last[1]} r="3"/></svg><div className="text-xs text-gray-500">min {minV.toFixed(2)} • max {maxV.toFixed(2)}</div></div>);
  }
  function Bars({data, title, height=80}:{data:number[]; title:string; height?:number}){
    const w=300,h=height,pad=8; if(data.length===0) return (<div className="rounded-xl border border-gray-200/10 p-3 bg-white/5"><div className="text-xs text-gray-400 mb-1">{title}</div><div className="text-gray-500 text-sm">No data yet</div></div>);
    const maxV=Math.max(...data,1); const bw=(w-2*pad)/Math.max(1,data.length); return (<div className="rounded-xl border border-gray-200/10 p-3 bg-white/5"><div className="text-xs text-gray-400 mb-1">{title}</div><svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20">{data.map((v,i)=>{ const x=pad+i*bw; const bh=(h-2*pad)*(v/maxV); const y=h-pad-bh; return <rect key={i} x={x} y={y} width={Math.max(1,bw-2)} height={bh}/>; })}</svg><div className="text-xs text-gray-500">max {maxV.toFixed(2)}s</div></div>);
  }
  const lastN = history.slice(-20); const timeSeries = lastN.map(a=>a.seconds); const accSeries = lastN.map((_,i)=>{ const w=lastN.slice(Math.max(0,i-4), i+1); return 100*(w.filter(x=>x.correct).length/Math.max(1,w.length)); });

  function resetStats(){ const cleared:LifetimeStats={totalAttempts:0,totalCorrect:0,totalTimeSec:0}; saveStats(cleared); setLifetime(cleared); setHistory([]); try{localStorage.removeItem("simulsolve:min:history");}catch{} setSession({attempts:0,correct:0,timeSec:0}); }

  // ===================== UI =====================
  return (
    <div className="min-h-screen w-full text-gray-100 bg-gradient-to-b from-neutral-950 via-neutral-900 to-neutral-950">
      <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3">
          <Calculator className="w-6 h-6 text-blue-400"/>
          <h1 className="text-xl font-semibold tracking-tight">SimulSolve — Minimal</h1>
          <div className="ml-auto text-sm text-gray-300 flex flex-wrap gap-4">
            <div>Session: {session.correct}/{session.attempts} • {session.timeSec.toFixed(1)}s</div>
            <div>Lifetime: {lifetime.totalCorrect}/{lifetime.totalAttempts} • {lifetime.totalTimeSec.toFixed(1)}s</div>
          </div>
        </div>

        {/* Controls */}
        <div className="rounded-xl border border-gray-200/10 bg-white/5 p-4 grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <fieldset>
            <div className="text-xs uppercase text-gray-400 mb-1">Mode</div>
            <div className="flex flex-wrap gap-2">
              {(["2x2","3x3"] as Mode[]).map(m=> (
                <button key={m} onClick={()=>{ setMode(m); setP(genProblem(m, difficulty, ansType)); }} className={`px-3 py-2 rounded-lg transition border ${mode===m?"border-blue-400/60 bg-blue-500/10 text-blue-200":"border-gray-700 bg-black/30 hover:bg-black/40"}`}>{m}</button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <div className="text-xs uppercase text-gray-400 mb-1">Difficulty</div>
            <div className="flex flex-wrap gap-2">
              {(["easy","medium","hard"] as Difficulty[]).map(d=> (
                <button key={d} onClick={()=>{ setDifficulty(d); setP(genProblem(mode,d, ansType)); }} className={`px-3 py-2 rounded-lg transition border ${difficulty===d?"border-blue-400/60 bg-blue-500/10 text-blue-200":"border-gray-700 bg-black/30 hover:bg-black/40"}`}>{d}</button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <div className="text-xs uppercase text-gray-400 mb-1">Answers</div>
            <div className="flex flex-wrap gap-2">
              {(["fractions","integers"] as AnswerType[]).map(t=> (
                <button key={t} onClick={()=>{ setAnsType(t); setP(genProblem(mode, difficulty, t)); }} className={`px-3 py-2 rounded-lg transition border ${ansType===t?"border-blue-400/60 bg-blue-500/10 text-blue-200":"border-gray-700 bg-black/30 hover:bg-black/40"}`}>{t}</button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <div className="text-xs uppercase text-gray-400 mb-1">Target (sec)</div>
            <div className="flex items-center gap-2">
              <AlarmClock className="w-4 h-4"/>
              <input type="number" value={targetSeconds} onChange={e=>setTargetSeconds(Math.max(20, Number(e.target.value||120)))} className="w-24 bg-black/30 border border-gray-700 rounded-lg px-3 py-2"/>
            </div>
          </fieldset>
          <div className="flex items-end">
            <button onClick={resetStats} className="ml-auto px-3 py-2 rounded-lg border border-gray-700 hover:bg-black/30">Reset stats</button>
          </div>
        </div>

        {/* Problem */}
        <div className="rounded-xl border border-gray-200/10 bg-white/5 p-4 space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold">Solve the system</h2>
            <button onClick={newProblem} className="ml-auto px-3 py-2 rounded-lg border border-blue-400/50 bg-blue-500/10 hover:bg-blue-500/20 text-blue-200 flex items-center gap-2"><Sparkles className="w-4 h-4"/> New</button>
          </div>
          <div className="space-y-2 font-serif text-xl leading-relaxed" style={examFont}>
            {p.display.map((line, i)=> (
              <div key={i} className="bg-black/30 border border-gray-800 rounded-lg px-3 py-2">Eq({i+1}): {line}</div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            {p.variables.map(v => (
              <label key={v} className="flex items-center gap-2">
                <span className="text-sm text-gray-300">{v} =</span>
                <input value={(answer as any)[v]??""} onChange={e=>{ setAnswer({...answer,[v]:e.target.value}); validateField(v, e.target.value); }} placeholder={ansType==="fractions"?"e.g. 9/4":"e.g. 3"} className="w-28 px-3 py-2 rounded-lg bg-black/30 border border-gray-700 focus:ring-2 focus:ring-blue-500 font-mono"/>
                {inputErr[v] && <span className="text-xs text-red-400 ml-2">{inputErr[v]}</span>}
              </label>
            ))}
            <button onClick={submit} className="px-4 py-2 rounded-lg border border-blue-400/50 bg-blue-500/10 hover:bg-blue-500/20 text-blue-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4"/> Submit
            </button>
            {status!=="idle" && (
              <span className={`text-sm ${status==="correct"?"text-emerald-400":"text-red-400"} flex items-center gap-1`}>
                {status==="correct"?<>Correct<CheckCircle2 className="w-4 h-4"/></>:<>Try again<XCircle className="w-4 h-4"/></>}
              </span>
            )}
          </div>

          {/* Solution reveal */}
          {(revealed || status==="correct") && solved && (
            <div className="rounded-lg border border-green-400/30 bg-green-500/10 px-3 py-2 flex flex-wrap items-center gap-3">
              <span className="text-sm">Solution:</span>
              {p.mode==="2x2" ? (
                <>
                  <span className="font-mono">x = {fracToText((solved as any).xNum,(solved as any).xDen)}</span>
                  <span className="font-mono">y = {fracToText((solved as any).yNum,(solved as any).yDen)}</span>
                </>
              ) : (
                <>
                  <span className="font-mono">x ≈ {toRationalApprox((solved as any).x)}</span>
                  <span className="font-mono">y ≈ {toRationalApprox((solved as any).y)}</span>
                  <span className="font-mono">z ≈ {toRationalApprox((solved as any).z)}</span>
                </>
              )}
              <button onClick={()=>setShowWork(s=>!s)} className="ml-auto px-3 py-1.5 rounded-md border border-blue-400/40 text-blue-200 bg-blue-500/10 hover:bg-blue-500/20 flex items-center gap-2"><ListTree className="w-4 h-4"/> {showWork?"Hide steps":"Show steps"}</button>
            </div>
          )}
          {showWork && workedSteps.length>0 && (
            <div className="rounded-lg border border-gray-200/10 bg-white/5 px-3 py-3">
              <div className="text-sm text-gray-300 mb-2">Worked solution ({p.mode})</div>
              <ol className="list-decimal pl-5 space-y-1 text-sm">
                {workedSteps.map((s,i)=>(<li key={i}>{s}</li>))}
              </ol>
            </div>
          )}
        </div>

        {/* Feedback */}
        <div className="rounded-xl border border-gray-200/10 bg-white/5 p-4">
          <h3 className="font-semibold mb-2">Feedback</h3>
          <ul className="list-disc pl-5 text-sm text-gray-300 space-y-1">
            {explain.reasons.map((r,i)=>(<li key={i}>{r}</li>))}
          </ul>
          {explain.correctText && <div className="mt-2 text-sm text-emerald-300">{explain.correctText}</div>}
        </div>

        {/* Timer */}
        <div className="rounded-xl border border-gray-200/10 p-4 bg-white/5">
          <div className="flex items-center gap-3">
            <AlarmClock className="w-5 h-5"/>
            <div className="text-lg tabular-nums">{elapsed.toFixed(1)}s</div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={()=>setRunning(r=>!r)} className={`px-3 py-1.5 rounded-lg border ${running?"border-red-400/50 text-red-300":"border-gray-700"}`}>{running? <Pause className="w-4 h-4"/> : <Play className="w-4 h-4"/>}</button>
              <button onClick={()=>setElapsed(0)} className="px-3 py-1.5 rounded-lg border border-gray-700"><RotateCcw className="w-4 h-4"/></button>
            </div>
          </div>
          <div className="h-2 rounded-full bg-black/30 overflow-hidden mt-2">
            <div className="h-full bg-blue-300/80" style={{width:`${progress}%`}}/>
          </div>
          <div className="mt-1 text-xs text-gray-400">{progress}% of {targetSeconds}s target</div>
        </div>

        {/* Graphs */}
        <div className="grid md:grid-cols-2 gap-4">
          <SparkLine data={accSeries} title="Rolling accuracy (last 20 attempts, % over last 5)" />
          <Bars data={timeSeries} title="Time per attempt (last 20)" />
        </div>

        <footer className="pt-2 text-xs text-gray-400">Tip: Enter fractions like <code>a/b</code>. We track your time & accuracy across sessions (saved locally).</footer>
      </div>
    </div>
  );
}
