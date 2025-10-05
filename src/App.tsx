import React, { useEffect, useMemo, useRef, useState } from "react";
import { Calculator, AlarmClock, Play, Pause, RotateCcw, Sparkles, CheckCircle2, XCircle, StopCircle, Clock } from "lucide-react";

/** ===== Typography for exam-like equations ===== */
const examFont = { fontFamily: 'Cambria, Georgia, "Times New Roman", ui-serif, serif' } as React.CSSProperties;

/** ===== Types ===== */
type Difficulty = "easy" | "medium" | "hard";
type Mode = "2x2" | "3x3";
type AnswerType = "integers" | "fractions";

interface EquationStd { a: number; b: number; c: number; d: number; } // ax + by (+ cz) = d
interface Problem {
  id: string;
  mode: Mode;
  variables: ("x" | "y" | "z")[];
  eqs: EquationStd[];
  display: string[];
}
interface LifetimeStats { totalAttempts: number; totalCorrect: number; totalTimeSec: number; }
interface ExplainState { reasons: string[]; steps: string[]; correctText?: string; }

type AttemptRecord = {
  ts: number;             // per-attempt timestamp
  seconds: number;        // time taken for that attempt
  correct: boolean;
  difficulty: Difficulty;
  mode: Mode;
};

type SessionPhase = "setup" | "active" | "summary";

type SessionConfig = {
  minutes: number;
  mode: Mode;
  difficulty: Difficulty;
  ansType: AnswerType;
};

type SessionSummary = {
  id: string;
  startedAt: number;
  durationMin: number;          // intended duration
  actualSeconds: number;        // actual elapsed
  attempts: number;
  correct: number;
  accuracyPct: number;
  avgTimePerAttempt: number;    // seconds
  avgTimeAdj: number;           // difficulty-adjusted seconds
  problemsPerMin: number;
  config: SessionConfig;
};

/** ===== Difficulty weights (for adjusted speed metric) ===== */
const DIFF_WEIGHT: Record<Difficulty, number> = { easy: 1.0, medium: 1.2, hard: 1.45 };

/** ===== Math helpers (same logic as your code) ===== */
const rnd = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const choice = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const approx = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const igcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : igcd(b, a % b));
const lcm2 = (a: number, b: number) => Math.abs(a * b) / igcd(a, b);
const lcm3 = (a: number, b: number, c: number) => lcm2(lcm2(a, b), c);
function simplifyFraction(num: number, den: number){ if(den<0){num=-num;den=-den;} const g=igcd(num,den); return {num:num/g, den:den/g}; }
function fracToText(num:number, den:number){ return den===1?`${num}`:`${num}/${den}`; }
function toRationalApprox(x:number, maxDen=12){ let bestP=0,bestQ=1,bestErr=Infinity; for(let q=1;q<=maxDen;q++){const p=Math.round(x*q); const err=Math.abs(x-p/q); if(err<bestErr){bestErr=err;bestP=p;bestQ=q;}} const s=simplifyFraction(bestP,bestQ); return `${s.num}/${s.den}`; }

/** ===== Solvers (same logic) ===== */
function solve2(e1: EquationStd, e2: EquationStd){
  const D = e1.a*e2.b - e1.b*e2.a; if (D===0) return null;
  const Dx = e1.d*e2.b - e1.b*e2.d; const Dy = e1.a*e2.d - e1.d*e2.a;
  const fx = simplifyFraction(Dx, D); const fy = simplifyFraction(Dy, D);
  return { x: Dx/D, y: Dy/D, xNum: fx.num, xDen: fx.den, yNum: fy.num, yDen: fy.den } as const;
}
function solve3(eq: EquationStd[]){
  const A = eq.map(e=>[e.a,e.b,e.c,e.d]);
  for(let c=0;c<3;c++){
    let p=c; for(let r=c+1;r<3;r++) if(Math.abs(A[r][c])>Math.abs(A[p][c])) p=r;
    if(Math.abs(A[p][c])<1e-12) return null; if(p!==c)[A[p],A[c]]=[A[c],A[p]];
    for(let r=c+1;r<3;r++){ const f=A[r][c]/A[c][c]; for(let k=c;k<=3;k++) A[r][k]-=f*A[c][k]; }
  }
  const z=A[2][3]/A[2][2]; const y=(A[1][3]-A[1][2]*z)/A[1][1]; const x=(A[0][3]-A[0][2]*z-A[0][1]*y)/A[0][0];
  return {x,y,z} as const;
}

/** ===== Display scrambling (same logic) ===== */
function formatSide(ax:number, by:number, cz:number, k:number, includeZ?:boolean){
  type Tok = { coef:number, t:"const"|"x"|"y"|"z" };
  const toks: Tok[] = [];
  if (k!==0) toks.push({coef:k,t:"const"});
  if (ax!==0) toks.push({coef:ax,t:"x"});
  if (by!==0) toks.push({coef:by,t:"y"});
  if (includeZ && cz !== 0) toks.push({coef:cz,t:"z"});
  if (toks.length===0) return "0";
  let out="", first=true;
  for(const tok of toks){
    const sign = tok.coef<0?"-":"+"; const mag=Math.abs(tok.coef);
    const core = tok.t==="const"?`${mag}`:`${mag===1?"":mag}${tok.t}`;
    if(first){ out += (tok.coef<0?"- ":"") + core; first=false; } else { out += ` ${sign} ${core}`; }
  }
  return out;
}
function scrambleLinear(e: EquationStd, includeZ?:boolean){
  const a=e.a,b=e.b,c=e.c,d=e.d;
  const axL=rnd(-3,3), axR=axL-a; const byL=rnd(-3,3), byR=byL-b; const czL=includeZ?rnd(-3,3):0, czR=includeZ?czL-c:0; const kL=rnd(-12,12), kR=kL+d;
  const L=formatSide(axL,byL,czL,kL,includeZ); const R=formatSide(axR,byR,czR,kR,includeZ);
  return `${L} = ${R}`;
}

/** ===== Generators (same logic) ===== */
function id() { return `p_${Math.random().toString(36).slice(2,9)}`; }

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
  const e1: EquationStd = { a, b, c: 0, d: Math.trunc(a*sol.x + b*sol.y) };
  const e2: EquationStd = { a:c, b:d, c: 0, d: Math.trunc(c*sol.x + d*sol.y) };
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

/** ===== Worked steps (same) ===== */
function eqToString(e: EquationStd){
  const left = formatSide(e.a, e.b, e.c, 0, e.c !== 0);
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
    const k1 = lcmX/Math.abs(e1.a), k2 = lcmX/Math.abs(e2.a), op = Math.sign(e1.a)===Math.sign(e2.a)?'-':'+'; // E1 op E2
    const E1 = {a:e1.a*k1,b:e1.b*k1,c:0,d:e1.d*k1};
    const E2 = {a:e2.a*k2,b:e2.b*k2,c:0,d:e2.d*k2};
    s.push(`Make |x| match: Eq(1)×${k1} → (${E1.a})x + (${E1.b})y = ${E1.d}`);
    s.push(`Eq(2)×${k2} → (${E2.a})x + (${E2.b})y = ${E2.d}`);
    const By = E1.b - (op==='-'?E2.b:-E2.b);
    const Bd = E1.d - (op==='-'?E2.d:-E2.d);
    s.push(`Eliminate x: Eq(1) ${op} Eq(2) → (${By})y = ${Bd}`);
    const yS = simplifyFraction(Bd, By); s.push(`y = ${fracToText(yS.num, yS.den)}`);
    s.push(`Back-sub into Eq(1) for x (exact below).`);
  } else {
    const k1 = lcmY/Math.abs(e1.b), k2 = lcmY/Math.abs(e2.b), op = Math.sign(e1.b)===Math.sign(e2.b)?'-':'+'; // E1 op E2
    const E1 = {a:e1.a*k1,b:e1.b*k1,c:0,d:e1.d*k1};
    const E2 = {a:e2.a*k2,b:e2.b*k2,c:0,d:e2.d*k2};
    s.push(`Make |y| match: Eq(1)×${k1} → (${E1.a})x + (${E1.b})y = ${E1.d}`);
    s.push(`Eq(2)×${k2} → (${E2.a})x + (${E2.b})y = ${E2.d}`);
    const Bx = E1.a - (op==='-'?E2.a:-E2.a);
    const Bd = E1.d - (op==='-'?E2.d:-E2.d);
    s.push(`Eliminate y: Eq(1) ${op} Eq(2) → (${Bx})x = ${Bd}`);
    const xS = simplifyFraction(Bd, Bx); s.push(`x = ${fracToText(xS.num, xS.den)}`);
    s.push(`Back-sub into Eq(1) for y (exact below).`);
  }
  if(sol){
    s.push(`Exact: x = ${fracToText(sol.xNum, sol.xDen)}, y = ${fracToText(sol.yNum, sol.yDen)}`);
  }
  return s;
}

/** ===== Storage helpers ===== */
function loadLifetime(): LifetimeStats {
  try{ const s=localStorage.getItem("simulsolve:min:stats"); if(s) return JSON.parse(s);}catch{}
  return { totalAttempts:0, totalCorrect:0, totalTimeSec:0 };
}
function saveLifetime(v: LifetimeStats){
  try{ localStorage.setItem("simulsolve:min:stats", JSON.stringify(v)); }catch{}
}
function loadSessions(): SessionSummary[] {
  try{ const s=localStorage.getItem("simulsolve:sessions"); if(s) return JSON.parse(s);}catch{}
  return [];
}
function saveSessions(list: SessionSummary[]){
  try{ localStorage.setItem("simulsolve:sessions", JSON.stringify(list.slice(-50))); }catch{}
}

/** ===== Small UI helpers ===== */
function Stat({label, value}:{label:string; value:string}) {
  return (
    <div className="px-3 py-2 rounded-xl border border-neutral-800 bg-neutral-900">
      <div className="text-xs text-neutral-400">{label}</div>
      <div className="text-sm text-neutral-200 tabular-nums">{value}</div>
    </div>
  );
}

/** ===== Main Component with Session Flow (Auto-start fixed) ===== */
export default function SimulSolveSessions(){
  const [phase, setPhase] = useState<SessionPhase>("setup");

  // session config
  const [minutes, setMinutes] = useState(10);
  const [mode, setMode] = useState<Mode>("2x2");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [ansType, setAnsType] = useState<AnswerType>("fractions");
  const config: SessionConfig = { minutes, mode, difficulty, ansType };

  // per-session state
  const [sessionStart, setSessionStart] = useState<number>(0);
  const [sessionElapsed, setSessionElapsed] = useState(0); // seconds
  const sessionTotal = minutes * 60;
  const sessionRemaining = Math.max(0, sessionTotal - sessionElapsed);

  // per-problem state
  const [p, setP] = useState<Problem>(()=>genProblem(mode, difficulty, ansType));
  const [runningProblem, setRunningProblem] = useState(false);
  const [elapsedProblem, setElapsedProblem] = useState(0);
  const [answer, setAnswer] = useState<Record<string,string>>({});
  const [status, setStatus] = useState<"idle"|"correct"|"wrong">("idle");
  const [explain, setExplain] = useState<ExplainState>({ reasons: [], steps: [] });
  const [inputErr, setInputErr] = useState<Record<string,string>>({});
  const [attemptsOnThis, setAttemptsOnThis] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const firstEditRef = useRef(false);

  // aggregate stats
  const [sessionAttempts, setSessionAttempts] = useState<AttemptRecord[]>([]);
  const [lifetime, setLifetime] = useState<LifetimeStats>(loadLifetime());
  const [pastSessions, setPastSessions] = useState<SessionSummary[]>(loadSessions());

  /** ====== Robust auto-start helpers ====== */
  function ensureProblemRunning(){
    if(phase!=="active") return;
    setRunningProblem(curr => (curr ? curr : true));
  }

  // Safety net: if any field becomes non-empty, start timer
  useEffect(() => {
    if (phase!=="active" || runningProblem) return;
    for (const v of p.variables) {
      const val = (answer as any)[v];
      if (typeof val === "string" && val.trim() !== "") { setRunningProblem(true); break; }
    }
  }, [answer, p.variables, runningProblem, phase]);

  /** ===== timers ===== */
  useEffect(()=>{
    if(phase !== "active") return;
    const id = setInterval(()=>setSessionElapsed(s=>+(s+0.2).toFixed(1)), 200);
    return ()=>clearInterval(id);
  }, [phase]);

  useEffect(()=>{
    if(!runningProblem || phase!=="active") return;
    const id = setInterval(()=>setElapsedProblem(s=>+(s+0.1).toFixed(1)), 100);
    return ()=>clearInterval(id);
  }, [runningProblem, phase]);

  // stop session when time up
  useEffect(()=>{
    if(phase==="active" && sessionRemaining <= 0){ endSession(); }
  }, [phase, sessionRemaining]);

  // reset per-problem state when new problem
  useEffect(()=>{
    setElapsedProblem(0);
    setAnswer({});
    setStatus("idle");
    setExplain({reasons:[],steps:[]});
    setInputErr({});
    setAttemptsOnThis(0);
    setRevealed(false);
    firstEditRef.current = false;
  }, [p.id]);

  // precompute solution and steps
  const solved = useMemo(()=> p.mode==="2x2"? solve2(p.eqs[0], p.eqs[1]) : solve3(p.eqs), [p]);
  const workedSteps = useMemo(()=>{
    if(!solved) return [] as string[];
    if(p.mode==="2x2") return worked2x2(p, solved as any);
    return [
      "Gaussian elimination:",
      "1) Pivot row 1 → eliminate x from rows 2–3.",
      "2) Pivot row 2 → eliminate y from row 3.",
      "3) Back-substitute: z → y → x.",
    ];
  }, [p, solved]);

  /** ===== handlers ===== */
  function startSession() {
    setSessionStart(Date.now());
    setSessionElapsed(0);
    setSessionAttempts([]);
    setP(genProblem(config.mode, config.difficulty, config.ansType));
    setPhase("active");
    setRunningProblem(true);    // start per-problem timer immediately at session start
  }

  function newProblem() {
    setP(genProblem(config.mode, config.difficulty, config.ansType));
    setRunningProblem(true); // start immediately
  }

  function onAnswerEdit(vname: string, val: string){
    setAnswer(prev=>({ ...prev, [vname]: val }));
    validateField(vname, val);
    if(!firstEditRef.current && phase==="active"){
      firstEditRef.current = true;
      ensureProblemRunning();   // start on first interaction
    }
  }

  function parseFraction(txt:string){
    const s=txt.trim(); if(!s) return NaN;
    if(s.includes('/')){ const [pn,qn]=s.split('/'); const p=Number(pn), q=Number(qn); if(!isFinite(p)||!isFinite(q)||q===0) return NaN; return p/q; }
    return Number(s);
  }
  function validateField(name:string, value:string){
    if(value.trim()===""){ setInputErr(e=>({...e,[name]:"Required"})); return; }
    const v=parseFraction(value);
    if(!isFinite(v)) setInputErr(e=>({...e,[name]:"Enter number or a/b"}));
    else setInputErr(e=>{ const { [name]:_, ...rest }=e; return rest; });
  }

  function submit(){
    if(phase!=="active") return;

    // validate
    for(const v of p.variables){ validateField(v, (answer as any)[v]??""); }
    if(Object.values(inputErr).length>0 || p.variables.some(v => ((answer as any)[v]??"").trim()==="")){
      setExplain({reasons:["Please fix input errors."], steps:[]});
      setStatus("wrong");
      return;
    }

    const sol2 = p.mode==="2x2"? solve2(p.eqs[0], p.eqs[1]) : null;
    const sol3 = p.mode==="3x3"? solve3(p.eqs) : null;
    if(!sol2 && !sol3){
      setExplain({reasons:["Singular system — generate a new one."], steps:[]});
      setStatus("wrong");
      return;
    }

    const x = parseFraction(answer.x??""); const y=parseFraction(answer.y??""); const z=parseFraction(answer.z??"");
    let ok=false; let feedback: string[] = []; let correctText="";

    if(sol2){
      ok = approx(x, sol2.x) && approx(y, sol2.y);
      if(!ok){
        const r1=p.eqs[0].a*(x||0)+p.eqs[0].b*(y||0)-p.eqs[0].d;
        const r2=p.eqs[1].a*(x||0)+p.eqs[1].b*(y||0)-p.eqs[1].d;
        feedback.push(`Residuals: Eq(1) ${r1.toFixed(2)}, Eq(2) ${r2.toFixed(2)}`);
        correctText=`x = ${fracToText(sol2.xNum,sol2.xDen)}, y = ${fracToText(sol2.yNum,sol2.yDen)}`;
      }
    }
    if(sol3){
      ok = approx(x, sol3.x) && approx(y, sol3.y) && approx(z, sol3.z);
      if(!ok){
        const r1=p.eqs[0].a*(x||0)+p.eqs[0].b*(y||0)+p.eqs[0].c*(z||0)-p.eqs[0].d;
        const r2=p.eqs[1].a*(x||0)+p.eqs[1].b*(y||0)+p.eqs[1].c*(z||0)-p.eqs[1].d;
        const r3=p.eqs[2].a*(x||0)+p.eqs[2].b*(y||0)+p.eqs[2].c*(z||0)-p.eqs[2].d;
        feedback.push(`Residuals: Eq(1) ${r1.toFixed(2)}, Eq(2) ${r2.toFixed(2)}, Eq(3) ${r3.toFixed(2)}`);
        correctText=`x ≈ ${toRationalApprox(sol3.x)}, y ≈ ${toRationalApprox(sol3.y)}, z ≈ ${toRationalApprox(sol3.z)}`;
      }
    }

    const nextTries = ok ? 0 : (attemptsOnThis + 1);
    const revealNow = !ok && nextTries >= 2;
    setAttemptsOnThis(nextTries);
    setRevealed(revealNow || revealed);

    setExplain(
      ok
        ? { reasons:["Nice! Your values satisfy all equations."], steps:[] }
        : { reasons: revealNow? [...feedback, "Answer revealed after two attempts."] : feedback, steps: workedSteps, correctText: revealNow? correctText : undefined }
    );
    setStatus(ok?"correct":"wrong");

    // record attempt for session & lifetime
    const attempt: AttemptRecord = {
      ts: Date.now(),
      seconds: elapsedProblem,
      correct: ok,
      difficulty: config.difficulty,
      mode: config.mode,
    };
    setSessionAttempts(a => [...a, attempt]);

    const nextLife: LifetimeStats = {
      totalAttempts: lifetime.totalAttempts + 1,
      totalCorrect: lifetime.totalCorrect + (ok?1:0),
      totalTimeSec: +(lifetime.totalTimeSec + elapsedProblem).toFixed(1),
    };
    setLifetime(nextLife); saveLifetime(nextLife);

    // stop problem timer on correct; load next problem after a short delay
    if(ok){
      setRunningProblem(false);
      setTimeout(()=> newProblem(), 200);
    }
  }

  function endSession() {
    // compute summary
    const attempts = sessionAttempts.length;
    const correct = sessionAttempts.filter(a=>a.correct).length;
    const accuracy = attempts ? (100*correct/attempts) : 0;
    const avgTime = attempts ? (sessionAttempts.reduce((s,a)=>s+a.seconds,0) / attempts) : 0;
    const avgAdj  = attempts ? (sessionAttempts.reduce((s,a)=>s + a.seconds/DIFF_WEIGHT[a.difficulty],0) / attempts) : 0;
    const actual = sessionElapsed;
    const ppm = actual>0 ? (attempts / (actual/60)) : 0;

    const summary: SessionSummary = {
      id: `s_${Math.random().toString(36).slice(2,9)}`,
      startedAt: sessionStart,
      durationMin: config.minutes,
      actualSeconds: +actual.toFixed(1),
      attempts,
      correct,
      accuracyPct: +accuracy.toFixed(1),
      avgTimePerAttempt: +avgTime.toFixed(2),
      avgTimeAdj: +avgAdj.toFixed(2),
      problemsPerMin: +ppm.toFixed(2),
      config: { ...config },
    };

    const next = [...pastSessions, summary];
    setPastSessions(next);
    saveSessions(next);

    setPhase("summary");
    setRunningProblem(false);
  }

  function resetAllData(){
    setPastSessions([]); saveSessions([]);
    const cleared:LifetimeStats={totalAttempts:0,totalCorrect:0,totalTimeSec:0};
    setLifetime(cleared); saveLifetime(cleared);
  }

  /** ====== UI ====== */
  if(phase === "setup"){
    return (
      <div className="min-h-screen w-full text-neutral-100 bg-neutral-950">
        <div className="max-w-xl mx-auto p-6 space-y-6">
          <header className="flex items-center gap-3">
            <Calculator className="w-6 h-6 text-blue-400"/>
            <h1 className="text-xl font-semibold">SimulSolve — Session Mode</h1>
          </header>

          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 space-y-4">
            <div className="text-sm text-neutral-300">Session setup</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex items-center justify-between rounded-xl border border-neutral-800 bg-black/30 px-3 py-2">
                <span className="text-sm text-neutral-300 flex items-center gap-2"><Clock className="w-4 h-4"/> Length (min)</span>
                <input type="number" min={3} max={90} value={minutes} onChange={e=>setMinutes(Math.max(3, Math.min(90, Number(e.target.value||10))))} className="w-24 bg-black/30 border border-neutral-800 rounded-lg px-3 py-2 text-right"/>
              </label>
              <label className="flex items-center justify-between rounded-xl border border-neutral-800 bg-black/30 px-3 py-2">
                <span className="text-sm text-neutral-300">Mode</span>
                <select value={mode} onChange={e=>setMode(e.target.value as Mode)} className="bg-black/30 border border-neutral-800 rounded-lg px-3 py-2">
                  <option value="2x2">2×2</option>
                  <option value="3x3">3×3</option>
                </select>
              </label>
              <label className="flex items-center justify-between rounded-xl border border-neutral-800 bg-black/30 px-3 py-2">
                <span className="text-sm text-neutral-300">Difficulty</span>
                <select value={difficulty} onChange={e=>setDifficulty(e.target.value as Difficulty)} className="bg-black/30 border border-neutral-800 rounded-lg px-3 py-2">
                  <option>easy</option><option>medium</option><option>hard</option>
                </select>
              </label>
              <label className="flex items-center justify-between rounded-xl border border-neutral-800 bg-black/30 px-3 py-2">
                <span className="text-sm text-neutral-300">Answers</span>
                <select value={ansType} onChange={e=>setAnsType(e.target.value as AnswerType)} className="bg-black/30 border border-neutral-800 rounded-lg px-3 py-2">
                  <option value="fractions">fractions</option>
                  <option value="integers">integers</option>
                </select>
              </label>
            </div>

            <button onClick={startSession} className="w-full mt-2 px-4 py-3 rounded-xl border border-blue-400/50 bg-blue-500/10 hover:bg-blue-500/20 text-blue-200 flex items-center justify-center gap-2">
              <Sparkles className="w-4 h-4"/> Start session
            </button>
          </section>

          {pastSessions.length>0 && (
            <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm text-neutral-300">Past sessions</div>
                <button onClick={resetAllData} className="text-xs text-red-300 hover:text-red-200">Reset all data</button>
              </div>
              <div className="space-y-2">
                {pastSessions.slice().reverse().map(s=>(
                  <div key={s.id} className="rounded-xl border border-neutral-800 bg-black/30 p-3">
                    <div className="text-xs text-neutral-400">
                      {new Date(s.startedAt).toLocaleString()} • {s.config.mode} • {s.config.difficulty} • {s.config.ansType} • {s.durationMin} min
                    </div>
                    <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <Stat label="Attempts" value={`${s.correct}/${s.attempts}`}/>
                      <Stat label="Accuracy" value={`${s.accuracyPct}%`}/>
                      <Stat label="Avg time" value={`${s.avgTimePerAttempt.toFixed(2)}s`}/>
                      <Stat label="Adj. avg time" value={`${s.avgTimeAdj.toFixed(2)}s`}/>
                      <Stat label="Problems/min" value={`${s.problemsPerMin.toFixed(2)}`}/>
                      <Stat label="Actual time" value={`${s.actualSeconds.toFixed(1)}s`}/>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    );
  }

  if(phase === "summary"){
    const last = pastSessions[pastSessions.length-1];
    return (
      <div className="min-h-screen w-full text-neutral-100 bg-neutral-950">
        <div className="max-w-3xl mx-auto p-6 space-y-6">
          <header className="flex items-center gap-3">
            <Calculator className="w-6 h-6 text-blue-400"/>
            <h1 className="text-xl font-semibold">Session Summary</h1>
            <div className="ml-auto">
              <button onClick={()=>setPhase("setup")} className="px-3 py-2 rounded-lg border border-neutral-800 hover:bg-neutral-900">Back to setup</button>
            </div>
          </header>

          {last ? (
            <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
              <div className="text-xs text-neutral-400">
                {new Date(last.startedAt).toLocaleString()} • {last.config.mode} • {last.config.difficulty} • {last.config.ansType} • {last.durationMin} min
              </div>
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Stat label="Attempts" value={`${last.correct}/${last.attempts}`}/>
                <Stat label="Accuracy" value={`${last.accuracyPct}%`}/>
                <Stat label="Problems/min" value={`${last.problemsPerMin.toFixed(2)}`}/>
                <Stat label="Avg time / attempt" value={`${last.avgTimePerAttempt.toFixed(2)}s`}/>
                <Stat label="Adj. avg time" value={`${last.avgTimeAdj.toFixed(2)}s`}/>
                <Stat label="Actual time" value={`${last.actualSeconds.toFixed(1)}s`}/>
              </div>
              <div className="mt-4">
                <button onClick={()=>setPhase("setup")} className="px-4 py-2 rounded-xl border border-blue-400/50 bg-blue-500/10 hover:bg-blue-500/20 text-blue-200">New session</button>
              </div>
            </section>
          ) : null}

          {/* History list */}
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
            <div className="text-sm text-neutral-300 mb-2">Past sessions</div>
            <div className="space-y-2">
              {pastSessions.slice().reverse().map(s=>(
                <div key={s.id} className="rounded-xl border border-neutral-800 bg-black/30 p-3">
                  <div className="text-xs text-neutral-400">
                    {new Date(s.startedAt).toLocaleString()} • {s.config.mode} • {s.config.difficulty} • {s.config.ansType} • {s.durationMin} min
                  </div>
                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <Stat label="Attempts" value={`${s.correct}/${s.attempts}`}/>
                    <Stat label="Accuracy" value={`${s.accuracyPct}%`}/>
                    <Stat label="Avg time" value={`${s.avgTimePerAttempt.toFixed(2)}s`}/>
                    <Stat label="Adj. avg time" value={`${s.avgTimeAdj.toFixed(2)}s`}/>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    );
  }

  // ===== ACTIVE =====
  const progressPct = Math.min(100, Math.round(100*sessionElapsed/sessionTotal));

  return (
    <div className="min-h-screen w-full text-neutral-100 bg-neutral-950">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Header */}
        <header className="flex items-center gap-3">
          <Calculator className="w-6 h-6 text-blue-400"/>
          <h1 className="text-xl font-semibold">SimulSolve — Session</h1>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={endSession} className="px-3 py-2 rounded-lg border border-red-500/60 text-red-300 hover:bg-red-500/10 flex items-center gap-2">
              <StopCircle className="w-4 h-4"/> End session
            </button>
          </div>
        </header>

        {/* Session status bar */}
        <section className="rounded-2xl border border-neutral-800 p-4 bg-neutral-900">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <AlarmClock className="w-5 h-5"/>
              <div className="tabular-nums text-lg">{Math.floor(sessionRemaining/60)}:{String(Math.floor(sessionRemaining%60)).padStart(2,"0")}</div>
              <div className="text-xs text-neutral-400 ml-2">left • {minutes} min session</div>
            </div>
            <div className="ml-auto flex gap-2">
              <Stat label="Attempts" value={`${sessionAttempts.filter(a=>a.correct).length}/${sessionAttempts.length}`}/>
              <Stat label="Avg time" value={`${(sessionAttempts.reduce((s,a)=>s+a.seconds,0)/Math.max(1,sessionAttempts.length)).toFixed(2)}s`}/>
              <Stat label="Problems/min" value={`${(sessionAttempts.length/Math.max(1,sessionElapsed/60)).toFixed(2)}`}/>
            </div>
          </div>
          <div className="h-2 rounded-full bg-black/30 overflow-hidden mt-2">
            <div className="h-full bg-blue-300/80" style={{width:`${progressPct}%`}}/>
          </div>
        </section>

        {/* Problem card */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold">Solve the system</h2>
            <div className="text-xs text-neutral-400">Mode {config.mode} • {config.difficulty} • {config.ansType}</div>
            <div className="ml-auto flex items-center gap-2">
              <div className="text-sm tabular-nums">{elapsedProblem.toFixed(1)}s</div>
              <button onClick={()=>setRunningProblem(r=>!r)} className={`px-3 py-1.5 rounded-xl border ${runningProblem?"border-red-500/50 text-red-300":"border-neutral-800"}`}>
                {runningProblem? <Pause className="w-4 h-4"/> : <Play className="w-4 h-4"/>}
              </button>
              <button onClick={()=>setElapsedProblem(0)} className="px-3 py-1.5 rounded-xl border border-neutral-800"><RotateCcw className="w-4 h-4"/></button>
            </div>
          </div>

          <div className="space-y-2 font-serif text-xl leading-relaxed" style={examFont}>
            {p.display.map((line, i)=> (
              <div key={i} className="bg-black/30 border border-neutral-800 rounded-lg px-3 py-2">Eq({i+1}): {line}</div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
            {p.variables.map(v => (
              <label key={v} className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-black/30 px-3 py-2">
                <span className="text-sm text-neutral-300 shrink-0 w-6 text-right">{v} =</span>
                <input
                  value={(answer as any)[v]??""}
                  onFocus={ensureProblemRunning}
                  onKeyDown={ensureProblemRunning}
                  onPaste={ensureProblemRunning}
                  onChange={e=>onAnswerEdit(v, e.target.value)}
                  placeholder={config.ansType==="fractions"?"e.g. 9/4":"e.g. 3"}
                  className="w-full px-3 py-2 rounded-lg bg-black/30 border border-neutral-800 focus:ring-2 focus:ring-blue-500 font-mono"/>
                {inputErr[v] && <span className="text-xs text-red-400 ml-1">{inputErr[v]}</span>}
              </label>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 items-center justify-between">
            <div className="flex gap-3">
              <button onClick={submit} className="px-4 py-2 rounded-xl border border-blue-400/50 bg-blue-500/10 hover:bg-blue-500/20 text-blue-200 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4"/> Submit
              </button>
              <button onClick={newProblem} className="px-3 py-2 rounded-xl border border-neutral-800 hover:bg-black/30">Skip / New</button>
            </div>
            {status!=="idle" && (
              <span className={`text-sm ${status==="correct"?"text-emerald-400":"text-red-400"} flex items-center gap-1`}>
                {status==="correct"?<>Correct<CheckCircle2 className="w-4 h-4"/></>:<>Try again<XCircle className="w-4 h-4"/></>}
              </span>
            )}
          </div>
        </section>

        {/* Feedback */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="font-semibold mb-2">Feedback</h3>
          <ul className="list-disc pl-5 text-sm text-neutral-300 space-y-1">
            {explain.reasons.map((r,i)=>(<li key={i}>{r}</li>))}
          </ul>
          {explain.correctText && <div className="mt-2 text-sm text-emerald-300">{explain.correctText}</div>}
          {explain.steps.length>0 && (
            <div className="mt-3">
              <div className="text-sm text-neutral-400 mb-1">Optimal steps</div>
              <ol className="list-decimal pl-5 text-sm text-neutral-300 space-y-1">
                {explain.steps.map((s,i)=>(<li key={i}>{s}</li>))}
              </ol>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}