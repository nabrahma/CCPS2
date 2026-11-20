/**
 * QUADPACK `dqagse` (adaptive Gauss-Kronrod 21 with the epsilon-algorithm extrapolation `dqelg` and the
 * error-list ordering `dqpsrt`), ported line by line from the Fortran, so curve lengths come out as SciPy's `quad`
 * computes them (svgpathtools measures cubic and arc lengths with it). Arrays are 1-based like the Fortran.
 * Arithmetic is `+ - * /`, `Math.abs`, comparisons and dmath.pow.
 */
import { pow } from '../../../math/dmath';

const XGK = [
  0.9956571630258081, 0.9739065285171717, 0.9301574913557082,
  0.8650633666889845, 0.7808177265864169, 0.6794095682990244,
  0.5627571346686047, 0.4333953941292472, 0.2943928627014602,
  0.14887433898163122, 0,
];
const WGK = [
  0.011694638867371874, 0.032558162307964725, 0.054755896574351995,
  0.07503967481091996, 0.0931254545836976, 0.10938715880229764,
  0.12349197626206584, 0.13470921731147334, 0.14277593857706009,
  0.14773910490133849, 0.1494455540029169,
];
const WG = [
  0.06667134430868814, 0.1494513491505806, 0.21908636251598204,
  0.26926671930999635, 0.29552422471475287,
];
const EPMACH = 2.220446049250313e-16;
const UFLOW = 2.2250738585072014e-308;
const OFLOW = 1.7976931348623157e308;

interface Rule {
  result: number;
  abserr: number;
  /** Integral of |f| (QUADPACK `resabs`). */
  resabs: number;
  /** Integral of |f - mean| (QUADPACK `resasc`). */
  resasc: number;
}

/** QUADPACK dqk21 on [a, b]. */
export function qk21(f: (x: number) => number, a: number, b: number): Rule {
  const centr = 0.5 * (a + b);
  const hlgth = 0.5 * (b - a);
  const dhlgth = Math.abs(hlgth);
  const fv1 = new Array<number>(10);
  const fv2 = new Array<number>(10);
  let resg = 0;
  const fc = f(centr);
  let resk = WGK[10]! * fc;
  let resabs = Math.abs(resk);
  for (let j = 1; j <= 5; j++) {
    const jtw = 2 * j - 1; // Fortran jtw = 2j (1-based)
    const absc = hlgth * XGK[jtw]!;
    const fval1 = f(centr - absc);
    const fval2 = f(centr + absc);
    fv1[jtw] = fval1;
    fv2[jtw] = fval2;
    const fsum = fval1 + fval2;
    resg = resg + WG[j - 1]! * fsum;
    resk = resk + WGK[jtw]! * fsum;
    resabs = resabs + WGK[jtw]! * (Math.abs(fval1) + Math.abs(fval2));
  }
  for (let j = 1; j <= 5; j++) {
    const jtwm1 = 2 * j - 2; // Fortran jtwm1 = 2j - 1 (1-based)
    const absc = hlgth * XGK[jtwm1]!;
    const fval1 = f(centr - absc);
    const fval2 = f(centr + absc);
    fv1[jtwm1] = fval1;
    fv2[jtwm1] = fval2;
    const fsum = fval1 + fval2;
    resk = resk + WGK[jtwm1]! * fsum;
    resabs = resabs + WGK[jtwm1]! * (Math.abs(fval1) + Math.abs(fval2));
  }
  const reskh = resk * 0.5;
  let resasc = WGK[10]! * Math.abs(fc - reskh);
  for (let j = 0; j < 10; j++) resasc = resasc + WGK[j]! * (Math.abs(fv1[j]! - reskh) + Math.abs(fv2[j]! - reskh));
  const result = resk * hlgth;
  resabs = resabs * dhlgth;
  resasc = resasc * dhlgth;
  let abserr = Math.abs((resk - resg) * hlgth);
  if (resasc !== 0 && abserr !== 0) abserr = resasc * Math.min(1, pow((200 * abserr) / resasc, 1.5));
  if (resabs > UFLOW / (50 * EPMACH)) abserr = Math.max(EPMACH * 50 * resabs, abserr);
  return { result, abserr, resabs, resasc };
}

/** QUADPACK dqpsrt: keep the error list ordered; returns [maxerr, ermax, nrmax]. */
function qpsrt(limit: number, last: number, maxerrIn: number, elist: number[], iord: number[], nrmaxIn: number): [number, number, number] {
  let maxerr = maxerrIn;
  let nrmax = nrmaxIn;
  if (last <= 2) {
    iord[1] = 1;
    iord[2] = 2;
  } else {
    const errmax = elist[maxerr]!;
    if (nrmax !== 1) {
      const ido = nrmax - 1;
      for (let i = 1; i <= ido; i++) {
        const isucc = iord[nrmax - 1]!;
        if (errmax <= elist[isucc]!) break;
        iord[nrmax] = isucc;
        nrmax = nrmax - 1;
      }
    }
    let jupbn = last;
    if (last > Math.trunc(limit / 2) + 2) jupbn = limit + 3 - last;
    const errmin = elist[last]!;
    const jbnd = jupbn - 1;
    const ibeg = nrmax + 1;
    let inserted = false;
    if (ibeg <= jbnd) {
      for (let i = ibeg; i <= jbnd; i++) {
        const isucc = iord[i]!;
        if (errmax >= elist[isucc]!) {
          // insert errmin by traversing the list bottom-up
          iord[i - 1] = maxerr;
          let k = jbnd;
          let placed = false;
          for (let j = i; j <= jbnd; j++) {
            const isucc2 = iord[k]!;
            if (errmin < elist[isucc2]!) {
              iord[k + 1] = last;
              placed = true;
              break;
            }
            iord[k + 1] = isucc2;
            k = k - 1;
          }
          if (!placed) iord[i] = last;
          inserted = true;
          break;
        }
        iord[i - 1] = isucc;
      }
    }
    if (!inserted) {
      iord[jbnd] = maxerr;
      iord[jupbn] = last;
    }
  }
  maxerr = iord[nrmax]!;
  return [maxerr, elist[maxerr]!, nrmax];
}

/** QUADPACK dqelg (epsilon algorithm). Mutates the table and res3la; returns [n, result, abserr, nres]. */
function qelg(nIn: number, epstab: number[], res3la: number[], nresIn: number): [number, number, number, number] {
  let n = nIn;
  const nres = nresIn + 1;
  let abserr = OFLOW;
  let result = epstab[n]!;
  if (n < 3) return [n, result, Math.max(abserr, 5 * EPMACH * Math.abs(result)), nres];
  const limexp = 50;
  epstab[n + 2] = epstab[n]!;
  const newelm = Math.trunc((n - 1) / 2);
  epstab[n] = OFLOW;
  const num = n;
  let k1 = n;
  let converged = false;
  for (let i = 1; i <= newelm; i++) {
    const k2 = k1 - 1;
    const k3 = k1 - 2;
    let res = epstab[k1 + 2]!;
    const e0 = epstab[k3]!;
    const e1 = epstab[k2]!;
    const e2 = res;
    const e1abs = Math.abs(e1);
    const delta2 = e2 - e1;
    const err2 = Math.abs(delta2);
    const tol2 = Math.max(Math.abs(e2), e1abs) * EPMACH;
    const delta3 = e1 - e0;
    const err3 = Math.abs(delta3);
    const tol3 = Math.max(e1abs, Math.abs(e0)) * EPMACH;
    if (!(err2 > tol2 || err3 > tol3)) {
      result = res;
      abserr = err2 + err3;
      converged = true;
      break;
    }
    const e3 = epstab[k1]!;
    epstab[k1] = e1;
    const delta1 = e1 - e3;
    const err1 = Math.abs(delta1);
    const tol1 = Math.max(e1abs, Math.abs(e3)) * EPMACH;
    let omit = err1 <= tol1 || err2 <= tol2 || err3 <= tol3;
    let ss = 0;
    if (!omit) {
      ss = 1 / delta1 + 1 / delta2 - 1 / delta3;
      const epsinf = Math.abs(ss * e1);
      if (!(epsinf > 0.1e-3)) omit = true;
    }
    if (omit) {
      n = i + i - 1;
      break;
    }
    res = e1 + 1 / ss;
    epstab[k1] = res;
    k1 = k1 - 2;
    const error = err2 + Math.abs(res - e2) + err3;
    if (error > abserr) continue;
    abserr = error;
    result = res;
  }
  if (!converged) {
    if (n === limexp) n = 2 * Math.trunc(limexp / 2) - 1;
    let ib = Math.trunc(num / 2) * 2 === num ? 2 : 1;
    const ie = newelm + 1;
    for (let i = 1; i <= ie; i++) {
      const ib2 = ib + 2;
      epstab[ib] = epstab[ib2]!;
      ib = ib2;
    }
    if (num !== n) {
      let indx = num - n + 1;
      for (let i = 1; i <= n; i++) {
        epstab[i] = epstab[indx]!;
        indx = indx + 1;
      }
    }
    if (nres < 4) {
      res3la[nres] = result;
      abserr = OFLOW;
    } else {
      abserr = Math.abs(result - res3la[3]!) + Math.abs(result - res3la[2]!) + Math.abs(result - res3la[1]!);
      res3la[1] = res3la[2]!;
      res3la[2] = res3la[3]!;
      res3la[3] = result;
    }
  }
  abserr = Math.max(abserr, 5 * EPMACH * Math.abs(result));
  return [n, result, abserr, nres];
}

export interface QuadInfo {
  value: number;
  abserr: number;
  /** Number of subintervals used (QUADPACK `last`). */
  last: number;
  ier: number;
}

/** QUADPACK dqagse: integral of f over [a, b] (SciPy quad's algorithm and defaults). */
export function quadInfo(f: (x: number) => number, a: number, b: number, epsabs = 1.49e-8, epsrel = 1.49e-8, limit = 50): QuadInfo {
  const alist: number[] = [0, a];
  const blist: number[] = [0, b];
  const rlist: number[] = [0, 0];
  const elist: number[] = [0, 0];
  const iord: number[] = [0, 0];
  let ier = 0;
  const first = qk21(f, a, b);
  let result = first.result;
  let abserr = first.abserr;
  const defabs = first.resabs;
  const resabs = first.resasc;
  const dres = Math.abs(result);
  let errbnd = Math.max(epsabs, epsrel * dres);
  let last = 1;
  rlist[1] = result;
  elist[1] = abserr;
  iord[1] = 1;
  if (abserr <= 100 * EPMACH * defabs && abserr > errbnd) ier = 2;
  if (limit === 1) ier = 1;
  if (ier !== 0 || (abserr <= errbnd && abserr !== resabs) || abserr === 0) return { value: result, abserr, last, ier };
  const rlist2: number[] = new Array<number>(55).fill(0);
  const res3la: number[] = [0, 0, 0, 0];
  rlist2[1] = result;
  let errmax = abserr;
  let maxerr = 1;
  let area = result;
  let errsum = abserr;
  abserr = OFLOW;
  let nrmax = 1;
  let nres = 0;
  let numrl2 = 2;
  let ktmin = 0;
  let extrap = false;
  let noext = false;
  let ierro = 0;
  let iroff1 = 0;
  let iroff2 = 0;
  let iroff3 = 0;
  let ksgn = -1;
  if (dres >= (1 - 50 * EPMACH) * defabs) ksgn = 1;
  let small = 0;
  let erlarg = 0;
  let ertest = 0;
  let correc = 0;
  let sumResult = false;
  let done = false;
  for (last = 2; last <= limit; last++) {
    const a1 = alist[maxerr]!;
    const b1 = 0.5 * (alist[maxerr]! + blist[maxerr]!);
    const a2 = b1;
    const b2 = blist[maxerr]!;
    const erlast = errmax;
    const r1 = qk21(f, a1, b1);
    const r2 = qk21(f, a2, b2);
    const area1 = r1.result;
    const error1 = r1.abserr;
    const defab1 = r1.resasc;
    const area2 = r2.result;
    const error2 = r2.abserr;
    const defab2 = r2.resasc;
    const area12 = area1 + area2;
    const erro12 = error1 + error2;
    errsum = errsum + erro12 - errmax;
    area = area + area12 - rlist[maxerr]!;
    if (!(defab1 === error1 || defab2 === error2)) {
      if (!(Math.abs(rlist[maxerr]! - area12) > 0.1e-4 * Math.abs(area12) || erro12 < 0.99 * errmax)) {
        if (extrap) iroff2 = iroff2 + 1;
        else iroff1 = iroff1 + 1;
      }
      if (last > 10 && erro12 > errmax) iroff3 = iroff3 + 1;
    }
    rlist[maxerr] = area1;
    rlist[last] = area2;
    errbnd = Math.max(epsabs, epsrel * Math.abs(area));
    if (iroff1 + iroff2 >= 10 || iroff3 >= 20) ier = 2;
    if (iroff2 >= 5) ierro = 3;
    if (last === limit) ier = 1;
    if (Math.max(Math.abs(a1), Math.abs(b2)) <= (1 + 100 * EPMACH) * (Math.abs(a2) + 1000 * UFLOW)) ier = 4;
    if (error2 > error1) {
      alist[maxerr] = a2;
      alist[last] = a1;
      blist[last] = b1;
      rlist[maxerr] = area2;
      rlist[last] = area1;
      elist[maxerr] = error2;
      elist[last] = error1;
    } else {
      alist[last] = a2;
      blist[maxerr] = b1;
      blist[last] = b2;
      elist[maxerr] = error1;
      elist[last] = error2;
    }
    [maxerr, errmax, nrmax] = qpsrt(limit, last, maxerr, elist, iord, nrmax);
    if (errsum <= errbnd) {
      sumResult = true;
      done = true;
      break;
    }
    if (ier !== 0) {
      done = true;
      break;
    }
    if (last === 2) {
      small = Math.abs(b - a) * 0.375;
      erlarg = errsum;
      ertest = errbnd;
      rlist2[2] = area;
      continue;
    }
    if (noext) continue;
    erlarg = erlarg - erlast;
    if (Math.abs(b1 - a1) > small) erlarg = erlarg + erro12;
    if (!extrap) {
      if (Math.abs(blist[maxerr]! - alist[maxerr]!) > small) continue;
      extrap = true;
      nrmax = 2;
    }
    let goExtrapolate = true;
    if (!(ierro === 3 || erlarg <= ertest)) {
      const id = nrmax;
      let jupbnd = last;
      if (last > 2 + Math.trunc(limit / 2)) jupbnd = limit + 3 - last;
      for (let k = id; k <= jupbnd; k++) {
        maxerr = iord[nrmax]!;
        errmax = elist[maxerr]!;
        if (Math.abs(blist[maxerr]! - alist[maxerr]!) > small) {
          goExtrapolate = false;
          break;
        }
        nrmax = nrmax + 1;
      }
    }
    if (!goExtrapolate) continue;
    numrl2 = numrl2 + 1;
    rlist2[numrl2] = area;
    let reseps: number;
    let abseps: number;
    [numrl2, reseps, abseps, nres] = qelg(numrl2, rlist2, res3la, nres);
    ktmin = ktmin + 1;
    if (ktmin > 5 && abserr < 0.1e-2 * errsum) ier = 5;
    if (abseps < abserr) {
      ktmin = 0;
      abserr = abseps;
      result = reseps;
      correc = erlarg;
      ertest = Math.max(epsabs, epsrel * Math.abs(reseps));
      if (abserr <= ertest) {
        done = true;
        break;
      }
    }
    if (numrl2 === 1) noext = true;
    if (ier === 5) {
      done = true;
      break;
    }
    maxerr = iord[1]!;
    errmax = elist[maxerr]!;
    nrmax = 1;
    extrap = false;
    small = small * 0.5;
    erlarg = errsum;
  }
  if (!done) last = limit;
  // Final result and error estimate (labels 100-130 of dqagse).
  if (!sumResult) {
    let toSum = false;
    let end = false;
    if (abserr === OFLOW) toSum = true;
    else if (ier + ierro !== 0) {
      if (ierro === 3) abserr = abserr + correc;
      if (ier === 0) ier = 3;
      if (result !== 0 && area !== 0) {
        if (abserr / Math.abs(result) > errsum / Math.abs(area)) toSum = true;
      } else if (abserr > errsum) toSum = true;
      else if (area === 0) end = true;
    }
    if (!toSum && !end) {
      if (!(ksgn === -1 && Math.max(Math.abs(result), Math.abs(area)) <= defabs * 0.1e-1)) {
        if (0.1e-1 > result / area || result / area > 0.1e3 || errsum > Math.abs(area)) ier = 6;
      }
    }
    if (toSum) sumResult = true;
  }
  if (sumResult) {
    result = 0;
    for (let k = 1; k <= last; k++) result = result + rlist[k]!;
    abserr = errsum;
  }
  if (ier > 2) ier = ier - 1;
  return { value: result, abserr, last, ier };
}

/** Integral of f over [a, b] as SciPy quad computes it (epsabs, epsrel 1.49e-8, at most `limit` subintervals). */
export function quad(f: (x: number) => number, a: number, b: number, epsabs = 1.49e-8, epsrel = 1.49e-8, limit = 50): number {
  return quadInfo(f, a, b, epsabs, epsrel, limit).value;
}
