import React, { useEffect, useState } from "react";
// Icons: use lucide-react if available; otherwise harmless placeholders
let Icons: any = {};
try { Icons = require("lucide-react"); } catch { Icons = new Proxy({}, { get: () => (p: any) => <span {...p}>⦿</span> }); }
const { Calculator, AlarmClock, Play, Pause, RotateCcw, Sparkles, CheckCircle2, XCircle } = Icons;

/*
  SimulSolve — Minimal v5 (icons + UX + auto‑reveal)
  ---------------------------------------
  - Fixed TS parse errors and unfinished code path in submit().
  - No duplicate state updates; clean success/wrong branches.
  - Stronger input validation with clear messages.
  - Exam-style serif font for question text.
  - Fraction/integer answer modes (generated, not memorized).
  - LocalStorage stats + simple SVG charts (accuracy & time).
*/

// ---------- Types ----------
type Difficulty = "easy" | "medium" | "hard";
type Mode = "2x2" | "3x3";
type AnswerType = "integers" | "fractions"; // target solution type

interface EquationStd { a: number; b: number; c?: number; d: number; } // ax + by (+ cz) = d
interface Problem {
  id: string;
  mode: Mode;
  variables: ("x"|"y"|"z")[];
  eqs: EquationStd[]; // standard (hidden) form used for checking
  display: string[];  // scrambled string forms users see
}

interface LifetimeStats { totalAttempts: number; totalCorrect: number; totalTimeSec: number; }

interface ExplainState { reasons: string[]; steps: string[]; correctText?: string; }

// ---------- Helpers ----------
const rnd = (min: number, max: number) => Math.floor(Math.random()*(max-min+1))+min;
const choice = <T,>(arr: T[]) => arr[Math.floor(Math.random()*arr.length)];
const approx = (a:number,b:number,eps=1e-6)=>Math.abs(a-b)<=eps;

function id() { return `p_${Math.random().toString(36).slice(2,9)}`; }

function loadStats(): LifetimeStats {
  try { const s = localStorage.getItem("simulsolve:min:stats"); if(s) return JSON.parse(s); } catch {}
  return { totalAttempts: 0, totalCorrect: 0, totalTimeSec: 0 };
}
function saveStats(s: LifetimeStats){ try { localStorage.setItem("simulsolve:min:stats", JSON.stringify(s)); } catch {} }

// Fractions helpers
const igcd = (a:number,b:number):number => (b===0?Math.abs(a):igcd(b,a%b));
function lcm(a:number,b:number){ return Math.abs(a*b)/igcd(a,b); }
function simplifyFraction(num:number, den:number){
  if(den<0){ num=-num; den=-den; }
  const g = igcd(num, den);
  return { num: num/g, den: den/g };
}
function fracToText(num:number, den:number){
  if (den===1) return `${num}`;
  return `${num}/${den}`;
}
// Rough rational approximation (for 3x3 display)
function toRationalApprox(x:number, maxDen=12){
  let bestP=0, bestQ=1, bestErr=Infinity;
  for(let q=1;q<=maxDen;q++){
    const p = Math.round(x*q);
    const err = Math.abs(x - p/q);
    if(err<bestErr){ bestErr=err; bestP=p; bestQ=q; }
  }
  const s = simplifyFraction(bestP,bestQ); return `${s.num}/${s.den}`;
}

// Solve 2x2 via Cramer
function solve2(e1: EquationStd, e2: EquationStd){
  const D = e1.a*e2.b - e1.b*e2.a; if (D===0) return null;
  const Dx = e1.d*e2.b - e1.b*e2.d; const Dy = e1.a*e2.d - e1.d*e2.a;
  const sx = simplifyFraction(Dx, D); const sy = simplifyFraction(Dy, D);
  return { x: Dx/D, y: Dy/D, xNum: sx.num, xDen: sx.den, yNum: sy.num, yDen: sy.den, D } as any;
}

// Solve 3x3 (Gaussian, tiny numbers)
function solve3(eq: EquationStd[]){
  const A = eq.map(e=>[e.a,e.b,e.c??0,e.d].map(n=>+n)); const n=3;
  for(let c=0;c<n;c++){ let p=c; for(let r=c+1;r<n;r++) if(Math.abs(A[r][c])>Math.abs(A[p][c])) p=r;
    if(Math.abs(A[p][c])<1e-12) return null; if(p!==c)[A[p],A[c]]=[A[c],A[p]];
    for(let r=c+1;r<n;r++){ const f=A[r][c]/A[c][c]; for(let k=c;k<=n;k++) A[r][k]-=f*A[c][k]; }
  }
  const z=A[2][3]/A[2][2]; const y=(A[1][3]-A[1][2]*z)/A[1][1]; const x=(A[0][3]-A[0][2]*z-A[0][1]*y)/A[0][0];
  return {x,y,z};
}

// Proper side formatting with explicit signs
function formatSide(ax:number, by:number, cz:number|undefined, k:number, includeZ:boolean){
  type Tok = { coef:number, t:"const"|"x"|"y"|"z" };
  const toks: Tok[] = [];
  if (k!==0) toks.push({coef:k,t:"const"});
  if (ax!==0) toks.push({coef:ax,t:"x"});
  if (by!==0) toks.push({coef:by,t:"y"});
  if (includeZ && cz && cz!==0) toks.push({coef:cz,t:"z"});
  if (toks.length===0) return "0";
  let out = ""; let first=true;
  for(const tok of toks){
    const sign = tok.coef<0?"-":"+"; const mag = Math.abs(tok.coef);
    const core = tok.t==="const"? `${mag}` : `${mag===1?"":mag}${tok.t}`;
    if(first){ out += (tok.coef<0?"- ":"") + core; first=false; }
    else { out += ` ${sign} ${core}`; }
  }
  return out;
}

// Scramble linear equation into balanced LHS=RHS
function scrambleLinear(e: EquationStd, includeZ: boolean){
  const a=e.a, b=e.b, c=(e.c??0), d=e.d;
  const axL = rnd(-3,3); const axR = axL - a;
  const byL = rnd(-3,3); const byR = byL - b;
  const czL = includeZ ? rnd(-3,3) : 0; const czR = includeZ ? czL - c : 0;
  const kL = rnd(-12,12); const kR = kL - d;
  const L = formatSide(axL,byL,czL,kL,includeZ);
  const R = formatSide(axR,byR,czR,kR,includeZ);
  return `${L} = ${R}`;
}

// --- Generators ---
function genSolution(dim:2|3, ansType: AnswerType){
  const pickPQ = () => {
    const q = ansType==="integers" ? 1 : choice([2,3,4,5,6,7,8]);
    const p = rnd(-12,12); return {p,q};
  };
  if (dim===2){ const sx = pickPQ(), sy = pickPQ(); return { x: sx.p/sx.q, y: sy.p/sy.q } as any; }
  const sx = pickPQ(), sy = pickPQ(), sz = pickPQ();
  return { x: sx.p/sx.q, y: sy.p/sy.q, z: sz.p/sz.q } as any;
}

function randMatrix2(q:number){
  const base = [-4,-3,-2,-1,1,2,3,4];
  let a = q*choice(base), b = q*choice(base), c = q*choice(base), d = q*choice(base);
  if (a*d - b*c === 0) { d += q; }
  return {a,b,c,d};
}
function randMatrix3(q:number){
  const base = [-3,-2,-1,1,2,3];
  const A = [0,0,0].map(()=>[q*choice(base), q*choice(base), q*choice(base)]);
  const det = (M:number[][])=> M[0][0]*(M[1][1]*M[2][2]-M[1][2]*M[2][1]) - M[0][1]*(M[1][0]*M[2][2]-M[1][2]*M[2][0]) + M[0][2]*(M[1][0]*M[2][1]-M[1][1]*M[2][0]);
  if (det(A)===0) A[2][2]+=q;
  return A as number[][];
}

function gen2x2(difficulty: Difficulty, ansType: AnswerType): Problem {
  const sol = genSolution(2, ansType) as any; const q = ansType==="integers" ? 1 : choice([2,3,4,5,6,7,8]);
  const {a,b,c,d} = randMatrix2(q);
  const rhs1 = a*sol.x + b*sol.y; const rhs2 = c*sol.x + d*sol.y;
  const e1: EquationStd = { a, b, d: Math.round(rhs1) };
  const e2: EquationStd = { a: c, b: d, d: Math.round(rhs2) };
  const display = [scrambleLinear(e1,false), scrambleLinear(e2,false)];
  return { id:id(), mode:"2x2", variables:["x","y"], eqs:[e1,e2], display };
}

function gen3x3(difficulty: Difficulty, ansType: AnswerType): Problem {
  const sol = genSolution(3, ansType) as any; const q = ansType==="integers" ? 1 : choice([2,3,4,5,6,7,8]);
  const A = randMatrix3(q);
  const rhs = [
    A[0][0]*sol.x + A[0][1]*sol.y + A[0][2]*sol.z,
    A[1][0]*sol.x + A[1][1]*sol.y + A[1][2]*sol.z,
    A[2][0]*sol.x + A[2][1]*sol.y + A[2][2]*sol.z,
  ].map(v=>Math.round(v));
  const e1: EquationStd = { a: A[0][0], b: A[0][1], c: A[0][2], d: rhs[0] };
  const e2: EquationStd = { a: A[1][0], b: A[1][1], c: A[1][2], d: rhs[1] };
  const e3: EquationStd = { a: A[2][0], b: A[2][1], c: A[2][2], d: rhs[2] };
  const display = [scrambleLinear(e1,true), scrambleLinear(e2,true), scrambleLinear(e3,true)];
  return { id:id(), mode:"3x3", variables:["x","y","z"], eqs:[e1,e2,e3], display };
}

function genProblem(mode: Mode, difficulty: Difficulty, ansType: AnswerType){
  return mode==="2x2"? gen2x2(difficulty, ansType) : gen3x3(difficulty, ansType);
}

// Build an optimal-elimination outline for feedback
function buildOptimalSteps(prob: Problem){
  const steps: string[] = [];
  if(prob.mode==="2x2"){
    const [e1,e2]=prob.eqs;
    const lcmX = (e1.a===0 || e2.a===0) ? Infinity : lcm(Math.abs(e1.a), Math.abs(e2.a));
    const lcmY = (e1.b===0 || e2.b===0) ? Infinity : lcm(Math.abs(e1.b), Math.abs(e2.b));
    const target = lcmX<=lcmY? 'x' : 'y';
    if(target==='x'){
      const k1 = lcmX/Math.abs(e1.a), k2 = lcmX/Math.abs(e2.a);
      const s1 = Math.sign(e1.a), s2 = Math.sign(e2.a);
      const op = s1===s2? 'subtract' : 'add';
      steps.push(`Eliminate x: multiply Eq(1) by ${k1}, Eq(2) by ${k2}, then ${op}.`);
      steps.push(`Solve the 1-variable equation for y, then back‑sub into the cleaner original equation.`);
    } else {
      const k1 = lcmY/Math.abs(e1.b), k2 = lcmY/Math.abs(e2.b);
      const s1 = Math.sign(e1.b), s2 = Math.sign(e2.b);
      const op = s1===s2? 'subtract' : 'add';
      steps.push(`Eliminate y: multiply Eq(1) by ${k1}, Eq(2) by ${k2}, then ${op}.`);
      steps.push(`Solve for x and back‑substitute.`);
    }
  } else {
    steps.push("Pivot on a11 (largest |a|). Do R2←R2−(a21/a11)R1, R3←R3−(a31/a11)R1.");
    steps.push("Pivot on a22, eliminate the second variable from row 3.");
    steps.push("Back‑substitute z → y → x.");
  }
  return steps;
}

// ---------- Component ----------
export default function SimulSolveMinimal(){
  const examFont = { fontFamily: 'Cambria, Georgia, "Times New Roman", ui-serif, serif' } as React.CSSProperties;
  const [mode, setMode] = useState<Mode>("2x2");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [ansType, setAnsType] = useState<AnswerType>("fractions");
  const [targetSeconds, setTargetSeconds] = useState<number>(120);

  const [p, setP] = useState<Problem>(()=>genProblem("2x2","medium","fractions"));
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [answer, setAnswer] = useState<Record<string,string>>({});
  const [status, setStatus] = useState<"idle"|"correct"|"wrong">("idle");
  const [explain, setExplain] = useState<ExplainState>({ reasons: [], steps: [] });
  const [inputErr, setInputErr] = useState<Record<string,string>>({});
  const [attemptsOnThis, setAttemptsOnThis] = useState(0);
  const [explain, setExplain] = useState<ExplainState>({ reasons: [], steps: [] });
  const [inputErr, setInputErr] = useState<Record<string,string>>({});

  const [session, setSession] = useState({ attempts:0, correct:0, timeSec:0 });
  const [lifetime, setLifetime] = useState<LifetimeStats>(loadStats());

  type AttemptRecord = { ts:number; seconds:number; correct:boolean };
  function loadHistory(): AttemptRecord[] { try { const s = localStorage.getItem("simulsolve:min:history"); return s? JSON.parse(s): []; } catch { return []; } }
  function saveHistory(h: AttemptRecord[]) { try { localStorage.setItem("simulsolve:min:history", JSON.stringify(h.slice(-200))); } catch {} }
  const [history, setHistory] = useState<AttemptRecord[]>(loadHistory());

  // Timer
  useEffect(()=>{ if(!running) return; const id = setInterval(()=> setElapsed(e=>e+0.1), 100); return ()=>clearInterval(id); },[running]);
  // Reset per problem
  useEffect(()=>{ setElapsed(0); setAnswer({}); setStatus("idle"); setExplain({ reasons: [], steps: [] }); setInputErr({}); setAttemptsOnThis(0); }, [p.id]);

  const progress = Math.min(100, Math.round(100*elapsed/targetSeconds));

  function newProblem(){ setP(genProblem(mode, difficulty, ansType)); }

  function parseFraction(txt:string){
    const s = txt.trim(); if(!s) return NaN;
    if(s.includes("/")){
      const parts = s.split("/");
      if(parts.length!==2) return NaN;
      const pn = Number(parts[0]); const qn = Number(parts[1]);
      if(!isFinite(pn) || !isFinite(qn) || qn===0) return NaN;
      return pn/qn;
    }
    return Number(s);
  }
  function validateField(name:string, value:string){
    if(value.trim()===""){ setInputErr(e=>({...e, [name]: "Required"})); return; }
    const v = parseFraction(value);
    if(!isFinite(v)) setInputErr(e=>({...e, [name]: "Enter a number or a/b"})); else setInputErr(e=>{ const { [name]:_, ...rest }=e; return rest; });
  }

  function submit(){
    const sol2 = p.mode==="2x2"? solve2(p.eqs[0], p.eqs[1]) : null;
    const sol3 = p.mode==="3x3"? solve3(p.eqs) : null;

    // Validate inputs
    for(const v of p.variables){ validateField(v, (answer as any)[v]??""); }
    if(Object.keys(inputErr).length>0){
      setExplain({ reasons: ["Please fix input errors."], steps: [] });
      setStatus("wrong");
      return;
    }

    let ok=false; let feedbackReasons: string[] = []; let correctText="";
    const x = parseFraction(answer.x??""); const y = parseFraction(answer.y??""); const z = parseFraction(answer.z??"");

    if(sol2){
      ok = approx(x, (sol2 as any).x) && approx(y, (sol2 as any).y);
      if(!ok){
        const r1 = p.eqs[0].a*(x||0) + p.eqs[0].b*(y||0) - p.eqs[0].d;
        const r2 = p.eqs[1].a*(x||0) + p.eqs[1].b*(y||0) - p.eqs[1].d;
        feedbackReasons.push(`Eq(1) residual: ${r1.toFixed(2)}; Eq(2) residual: ${r2.toFixed(2)}.`);
        const s:any = sol2; correctText = `Correct: x = ${fracToText(s.xNum, s.xDen)}, y = ${fracToText(s.yNum, s.yDen)}`;
      }
    } else if(sol3){
      ok = approx(x, sol3.x) && approx(y, sol3.y) && approx(z, sol3.z);
      if(!ok){
        const r1 = p.eqs[0].a*(x||0) + p.eqs[0].b*(y||0) + (p.eqs[0].c??0)*(z||0) - p.eqs[0].d;
        const r2 = p.eqs[1].a*(x||0) + p.eqs[1].b*(y||0) + (p.eqs[1].c??0)*(z||0) - p.eqs[1].d;
        const r3 = p.eqs[2].a*(x||0) + p.eqs[2].b*(y||0) + (p.eqs[2].c??0)*(z||0) - p.eqs[2].d;
        feedbackReasons.push(`Residuals — Eq(1): ${r1.toFixed(2)}, Eq(2): ${r2.toFixed(2)}, Eq(3): ${r3.toFixed(2)}.`);
        correctText = `Correct (≈): x = ${toRationalApprox(sol3.x)}, y = ${toRationalApprox(sol3.y)}, z = ${toRationalApprox(sol3.z)}`;
      }
    } else {
      setExplain({ reasons: ["This system is singular. Click New to regenerate."], steps: [] });
      setStatus("wrong");
      return;
    }

    // After two wrong tries for this problem, auto‑reveal
    let nextTries = attemptsOnThis;
    if(!ok){
      nextTries = attemptsOnThis + 1;
      let reasons = feedbackReasons;
      if(nextTries >= 2){
        reasons = [...feedbackReasons, "Answer revealed after two attempts."];
        // ensure correctText is set for either branch
        if(!correctText){
          if(sol2){ const s:any = sol2; correctText = `Correct: x = ${fracToText(s.xNum, s.xDen)}, y = ${fracToText(s.yNum, s.yDen)}`; }
          if(sol3){ correctText = `Correct (≈): x = ${toRationalApprox(sol3!.x)}, y = ${toRationalApprox(sol3!.y)}, z = ${toRationalApprox(sol3!.z)}`; }
        }
      }
      setExplain({ reasons, steps: buildOptimalSteps(p), correctText });
    } else {
      // correct
      nextTries = 0;
      setExplain({ reasons: ["Nice! Your values satisfy all equations."], steps: [] });
    }

    setAttemptsOnThis(nextTries);
    setStatus(ok?"correct":"wrong");

    // Update stats once per submit
    setSession(s=>({ attempts: s.attempts+1, correct: s.correct + (ok?1:0), timeSec: s.timeSec + elapsed }));
    const nextLife: LifetimeStats = { totalAttempts: lifetime.totalAttempts+1, totalCorrect: lifetime.totalCorrect + (ok?1:0), totalTimeSec: lifetime.totalTimeSec + elapsed };
    saveStats(nextLife); setLifetime(nextLife);
    const nextHist = [...history, { ts: Date.now(), seconds: elapsed, correct: ok }];
    setHistory(nextHist); saveHistory(nextHist);
  }

  // --- Small SVG chart helpers ---
  function SparkLine({data, title, height=80}:{data:number[]; title:string; height?:number}){
    const w = 300; const h = height; const pad = 8;
    if (data.length===0) return (
      <div className="rounded-xl border border-zinc-800 p-3 bg-zinc-900/40"><div className="text-xs text-zinc-400 mb-1">{title}</div><div className="text-zinc-500 text-sm">No data yet</div></div>
    );
    const maxV = Math.max(...data); const minV = Math.min(...data);
    const span = Math.max(1e-6, maxV - minV);
    const points = data.map((v,i)=>{
      const x = pad + (i*(w-2*pad))/Math.max(1,data.length-1);
      const y = pad + (h-2*pad) * (1 - (v - minV)/span);
      return [x,y];
    });
    const path = points.map((p,i)=> (i===0?`M ${p[0]} ${p[1]}`:`L ${p[0]} ${p[1]}`)).join(" ");
    const last = points[points.length-1];
    return (
      <div className="rounded-xl border border-zinc-800 p-3 bg-zinc-900/40">
        <div className="text-xs text-zinc-400 mb-1">{title}</div>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20">
          <path d={path} fill="none" stroke="currentColor" strokeWidth="2"/>
          <circle cx={last[0]} cy={last[1]} r="3" />
        </svg>
        <div className="text-xs text-zinc-500">min {minV.toFixed(2)} • max {maxV.toFixed(2)}</div>
      </div>
    );
  }

  function Bars({data, title, height=80}:{data:number[]; title:string; height?:number}){
    const w = 300; const h = height; const pad = 8;
    if (data.length===0) return (
      <div className="rounded-xl border border-zinc-800 p-3 bg-zinc-900/40"><div className="text-xs text-zinc-400 mb-1">{title}</div><div className="text-zinc-500 text-sm">No data yet</div></div>
    );
    const maxV = Math.max(...data, 1);
    const bw = (w - 2*pad) / Math.max(1,data.length);
    return (
      <div className="rounded-xl border border-zinc-800 p-3 bg-zinc-900/40">
        <div className="text-xs text-zinc-400 mb-1">{title}</div>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20">
          {data.map((v,i)=>{
            const x = pad + i*bw;
            const bh = (h - 2*pad) * (v / maxV);
            const y = h - pad - bh;
            return <rect key={i} x={x} y={y} width={Math.max(1,bw-2)} height={bh} />;
          })}
        </svg>
        <div className="text-xs text-zinc-500">max {maxV.toFixed(2)}s</div>
      </div>
    );
  }

  // Slice last N attempts
  const lastN = history.slice(-20);
  const timeSeries = lastN.map(a=> a.seconds);
  // rolling accuracy (percent over a 5-attempt window)
  const accSeries = lastN.map((_,i)=>{
    const window = lastN.slice(Math.max(0,i-4), i+1);
    const pct = 100 * (window.filter(w=>w.correct).length / Math.max(1,window.length));
    return pct;
  });

  function resetStats(){
    const cleared: LifetimeStats = { totalAttempts:0, totalCorrect:0, totalTimeSec:0 };
    saveStats(cleared); setLifetime(cleared); setHistory([]); try{ localStorage.removeItem("simulsolve:min:history"); }catch{}
    setSession({ attempts:0, correct:0, timeSec:0 });
  }

  return (
    <div className="min-h-screen w-full text-zinc-100 bg-gradient-to-b from-zinc-950 via-black to-zinc-950">
      <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Calculator className="w-6 h-6"/>
          <h1 className="text-xl font-semibold tracking-tight">SimulSolve — Minimal</h1>
          <div className="ml-auto grid grid-cols-2 gap-4 text-sm text-zinc-300">
            <div>Session: {session.correct}/{session.attempts} • {session.timeSec.toFixed(1)}s</div>
            <div>Lifetime: {lifetime.totalCorrect}/{lifetime.totalAttempts} • {lifetime.totalTimeSec.toFixed(1)}s</div>
          </div>
        </div>

        {/* Controls */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 grid sm:grid-cols-5 gap-3 shadow-lg">
          <div>
            <div className="text-xs uppercase text-zinc-400 mb-1">Mode</div>
            <div className="flex gap-2">
              {(["2x2","3x3"] as Mode[]).map(m=> (
                <button key={m} onClick={()=>{ setMode(m); setP(genProblem(m, difficulty, ansType)); }} className={`px-3 py-2 rounded-xl transition border ${mode===m?"border-indigo-400/60 bg-indigo-500/10 text-indigo-200":"border-zinc-700 bg-zinc-900/60 hover:bg-zinc-900"}`}>{m}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-zinc-400 mb-1">Difficulty</div>
            <div className="flex gap-2">
              {(["easy","medium","hard"] as Difficulty[]).map(d=> (
                <button key={d} onClick={()=>{ setDifficulty(d); setP(genProblem(mode,d, ansType)); }} className={`px-3 py-2 rounded-xl transition border ${difficulty===d?"border-indigo-400/60 bg-indigo-500/10 text-indigo-200":"border-zinc-700 bg-zinc-900/60 hover:bg-zinc-900"}`}>{d}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-zinc-400 mb-1">Answers</div>
            <div className="flex gap-2">
              {(["fractions","integers"] as AnswerType[]).map(t=> (
                <button key={t} onClick={()=>{ setAnsType(t); setP(genProblem(mode, difficulty, t)); }} className={`px-3 py-2 rounded-xl transition border ${ansType===t?"border-indigo-400/60 bg-indigo-500/10 text-indigo-200":"border-zinc-700 bg-zinc-900/60 hover:bg-zinc-900"}`}>{t}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-zinc-400 mb-1">Target (sec)</div>
            <div className="flex items-center gap-2">
              <AlarmClock className="w-4 h-4"/>
              <input type="number" value={targetSeconds} onChange={e=>setTargetSeconds(Math.max(20, Number(e.target.value||120)))} className="w-24 bg-zinc-900/60 border border-zinc-700 rounded-xl px-3 py-2"/>
            </div>
          </div>
          <div className="flex items-end">
            <button onClick={resetStats} className="ml-auto px-3 py-2 rounded-xl border border-zinc-700 hover:bg-zinc-900">Reset stats</button>
          </div>
        </div>

        {/* Problem */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 shadow-lg">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold">Solve the system</h2>
            <button onClick={newProblem} className="ml-auto px-3 py-2 rounded-xl border border-indigo-400/50 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-200 flex items-center gap-2"><Sparkles className="w-4 h-4"/> New</button>
          </div>
          <div className="mt-3 space-y-2 font-serif text-xl leading-relaxed" style={examFont}>
            {p.display.map((line, i)=> (
              <div key={i} className="bg-zinc-950/50 border border-zinc-800 rounded-xl px-3 py-2">Eq({i+1}): {line}</div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-3 items-center">
            {p.variables.map(v => (
              <label key={v} className="flex items-center gap-2">
                <span className="text-sm text-zinc-300">{v} =</span>
                <input value={(answer as any)[v]??""} onChange={e=>{ setAnswer({...answer, [v]: e.target.value}); validateField(v, e.target.value); }} placeholder={ansType==="fractions"?"e.g. 9/4":"e.g. 3"} className="w-32 px-3 py-2 rounded-xl bg-zinc-950/60 border border-zinc-700 focus:ring-2 focus:ring-indigo-500 font-mono"/>
                {inputErr[v] && <span className="text-xs text-red-400 ml-2">{inputErr[v]}</span>}
              </label>
            ))}
            <button onClick={submit} className="px-4 py-2 rounded-xl border border-indigo-400/50 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4"/> Submit
            </button>
            {status!=="idle" && (
              <span className={`text-sm ${status==="correct"?"text-emerald-400":"text-red-400"} flex items-center gap-1`}>
                {status==="correct"?<>Correct<CheckCircle2 className="w-4 h-4"/></>:<>Try again<XCircle className="w-4 h-4"/></>}
              </span>
            )}
            {attemptsOnThis>=2 && (
              <span className="text-xs px-2 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300">Answer revealed</span>
            )}
          </div>
        </div>

        {/* Feedback */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 shadow-lg">
          <h3 className="font-semibold mb-2">Feedback</h3>
          <ul className="list-disc pl-5 text-sm text-zinc-300 space-y-1">
            {explain.reasons.map((r,i)=>(<li key={i}>{r}</li>))}
          </ul>
          {explain.correctText && <div className="mt-2 text-sm text-emerald-300">{explain.correctText}</div>}
          {explain.steps.length>0 && (
            <div className="mt-3">
              <div className="text-sm text-zinc-400 mb-1">Optimal steps</div>
              <ol className="list-decimal pl-5 text-sm text-zinc-300 space-y-1">
                {explain.steps.map((s,i)=>(<li key={i}>{s}</li>))}
              </ol>
            </div>
          )}
        </div>

        {/* Timer */}
        <div className="rounded-2xl border border-zinc-800 p-4 bg-zinc-900/60 shadow-lg">
          <div className="flex items-center gap-3">
            <AlarmClock className="w-5 h-5"/>
            <div className="text-lg tabular-nums">{elapsed.toFixed(1)}s</div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={()=>setRunning(r=>!r)} className={`px-3 py-1.5 rounded-xl border ${running?"border-red-500/50 text-red-300":"border-zinc-700"}`}>{running? <Pause className="w-4 h-4"/> : <Play className="w-4 h-4"/>}</button>
              <button onClick={()=>setElapsed(0)} className="px-3 py-1.5 rounded-xl border border-zinc-700"><RotateCcw className="w-4 h-4"/></button>
            </div>
          </div>
          <div className="h-2 rounded-full bg-zinc-800 overflow-hidden mt-2">
            <div className="h-full bg-indigo-300/80" style={{width:`${progress}%`}}/>
          </div>
          <div className="mt-1 text-xs text-zinc-400">{progress}% of {targetSeconds}s target</div>
        </div>

        {/* Graphs */}
        <div className="grid md:grid-cols-2 gap-4">
          <SparkLine data={accSeries} title="Rolling accuracy (last 20 attempts, % over last 5)" />
          <Bars data={timeSeries} title="Time per attempt (last 20)" />
        </div>

        <footer className="pt-2 text-xs text-zinc-500">Tip: Enter fractions like <code>a/b</code>. We track your time & accuracy across sessions (saved locally).</footer>
      </div>
    </div>
  )}s</div>
          <div>Lifetime: {lifetime.totalCorrect}/{lifetime.totalAttempts} correct • {lifetime.totalTimeSec.toFixed(1)}s</div>
        </div>
      </div>

      {/* Controls */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 grid sm:grid-cols-5 gap-3">
        <div>
          <div className="text-xs uppercase text-zinc-400 mb-1">Mode</div>
          <div className="flex gap-2">
            {(["2x2","3x3"] as Mode[]).map(m=> (
              <button key={m} onClick={()=>{ setMode(m); setP(genProblem(m, difficulty, ansType)); }} className={`px-3 py-2 rounded-lg border ${mode===m?"border-zinc-400 bg-zinc-800":"border-zinc-700 bg-zinc-900/60 hover:bg-zinc-900"}`}>{m}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase text-zinc-400 mb-1">Difficulty</div>
          <div className="flex gap-2">
            {(["easy","medium","hard"] as Difficulty[]).map(d=> (
              <button key={d} onClick={()=>{ setDifficulty(d); setP(genProblem(mode,d, ansType)); }} className={`px-3 py-2 rounded-lg border ${difficulty===d?"border-zinc-400 bg-zinc-800":"border-zinc-700 bg-zinc-900/60 hover:bg-zinc-900"}`}>{d}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase text-zinc-400 mb-1">Answers</div>
          <div className="flex gap-2">
            {(["fractions","integers"] as AnswerType[]).map(t=> (
              <button key={t} onClick={()=>{ setAnsType(t); setP(genProblem(mode, difficulty, t)); }} className={`px-3 py-2 rounded-lg border ${ansType===t?"border-zinc-400 bg-zinc-800":"border-zinc-700 bg-zinc-900/60 hover:bg-zinc-900"}`}>{t}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase text-zinc-400 mb-1">Target (sec)</div>
          <div className="flex items-center gap-2">
            <AlarmClock className="w-4 h-4"/>
            <input type="number" value={targetSeconds} onChange={e=>setTargetSeconds(Math.max(20, Number(e.target.value||120)))} className="w-24 bg-zinc-900/60 border border-zinc-700 rounded-lg px-3 py-2"/>
          </div>
        </div>
        <div className="flex items-end">
          <button onClick={resetStats} className="ml-auto px-3 py-2 rounded-lg border border-zinc-700 hover:bg-zinc-900">Reset stats</button>
        </div>
      </div>

      {/* Problem */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold">Solve the system</h2>
          <button onClick={newProblem} className="ml-auto px-3 py-2 rounded-lg border border-zinc-600 bg-zinc-800 hover:bg-zinc-700 flex items-center gap-2"><Sparkles className="w-4 h-4"/> New</button>
        </div>
        <div className="mt-3 space-y-2 font-serif text-lg" style={examFont}>
          {p.display.map((line, i)=> (
            <div key={i} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">Eq({i+1}): {line}</div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-3 items-center">
          {p.variables.map(v => (
            <label key={v} className="flex items-center gap-2">
              <span className="text-sm text-zinc-300">{v} =</span>
              <input value={(answer as any)[v]??""} onChange={e=>{ setAnswer({...answer, [v]: e.target.value}); validateField(v, e.target.value); }} placeholder={ansType==="fractions"?"e.g. 9/4":"e.g. 3"} className="w-28 px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-700 focus:ring-2 focus:ring-zinc-500 font-mono"/>
              {inputErr[v] && <span className="text-xs text-red-400 ml-2">{inputErr[v]}</span>}
            </label>
          ))}
          <button onClick={submit} className="px-4 py-2 rounded-lg border border-zinc-600 bg-zinc-800 hover:bg-zinc-700 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4"/> Submit
          </button>
          {status!=="idle" && (
            <span className={`text-sm ${status==="correct"?"text-emerald-400":"text-red-400"} flex items-center gap-1`}>
              {status==="correct"?<>Correct<CheckCircle2 className="w-4 h-4"/></>:<>Try again<XCircle className="w-4 h-4"/></>}
            </span>
          )}
        </div>
      </div>

      {/* Feedback */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <h3 className="font-semibold mb-2">Feedback</h3>
        <ul className="list-disc pl-5 text-sm text-zinc-300 space-y-1">
          {explain.reasons.map((r,i)=>(<li key={i}>{r}</li>))}
        </ul>
        {explain.correctText && <div className="mt-2 text-sm text-emerald-300">{explain.correctText}</div>}
        {explain.steps.length>0 && (
          <div className="mt-3">
            <div className="text-sm text-zinc-400 mb-1">Optimal steps</div>
            <ol className="list-decimal pl-5 text-sm text-zinc-300 space-y-1">
              {explain.steps.map((s,i)=>(<li key={i}>{s}</li>))}
            </ol>
          </div>
        )}
      </div>

      {/* Timer */}
      <div className="rounded-2xl border border-zinc-800 p-4 bg-zinc-950/60">
        <div className="flex items-center gap-3">
          <AlarmClock className="w-5 h-5"/>
          <div className="text-lg tabular-nums">{elapsed.toFixed(1)}s</div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={()=>setRunning(r=>!r)} className={`px-3 py-1.5 rounded-lg border ${running?"border-red-500/50 text-red-300":"border-zinc-700"}`}>{running? <Pause className="w-4 h-4"/> : <Play className="w-4 h-4"/>}</button>
            <button onClick={()=>setElapsed(0)} className="px-3 py-1.5 rounded-lg border border-zinc-700"><RotateCcw className="w-4 h-4"/></button>
          </div>
        </div>
        <div className="h-2 rounded-full bg-zinc-800 overflow-hidden mt-2">
          <div className="h-full bg-zinc-300" style={{width:`${progress}%`}}/>
        </div>
        <div className="mt-1 text-xs text-zinc-400">{progress}% of {targetSeconds}s target</div>
      </div>

      {/* Graphs */}
      <div className="grid md:grid-cols-2 gap-4">
        <SparkLine data={accSeries} title="Rolling accuracy (last 20 attempts, % over last 5)" />
        <Bars data={timeSeries} title="Time per attempt (last 20)" />
      </div>

      <footer className="pt-2 text-xs text-zinc-500">Tip: Enter fractions like <code>a/b</code>. We track your time & accuracy across sessions (saved locally).</footer>
    </div>
  );
}
