"""Hand-authored round templates.

Each template takes parameters, computes the true mathematics with SymPy, and
then writes an "imperfect AI" attempt by applying one specific misconception.
The output is a *draft*: nothing here is trusted. `build_pack.py` re-verifies
every claim independently and rejects drafts whose intended answer key does not
match the verifier.

Provenance: these drafts are "template", not LLM output. The optional Qwen
pipeline (Phase 4) will produce drafts of the same shape with provenance "llm".
"""
from __future__ import annotations

from typing import Any

import sympy as sp

from .verify import parse, true_absolute_extremum, true_critical_points, x

MISCONCEPTIONS: dict[str, str] = {
    "wrong_derivative": "Incorrect derivative",
    "power_rule_error": "Power rule applied incorrectly to a negative exponent",
    "forgot_inner_derivative": "Forgot to multiply by the inner function's derivative",
    "solved_f_not_fprime": "Solved f(x) = 0 instead of f′(x) = 0",
    "forgot_endpoints": "Forgot to evaluate the interval endpoints",
    "outside_interval": "Used a critical point outside the interval",
    "bad_evaluation": "Incorrect evaluation of f at a point",
    "local_vs_absolute": "Confused a local extremum with the absolute extremum",
    "misclassified_extrema": "Mixed up local maximum and local minimum",
    "algebra_error": "Algebraic simplification or factoring error",
}

TOPICS = {
    "derivatives": "Derivatives",
    "chain-rule": "The chain rule",
    "critical-points": "Critical points",
    "closed-interval": "Max & min on closed intervals",
}


def L(s: str | sp.Expr) -> str:
    """LaTeX for an expression string or SymPy expression."""
    e = parse(s) if isinstance(s, str) else sp.sympify(s)
    if e.is_number and e.is_Add:
        # Write "2 + √3/3" rather than SymPy's default "√3/3 + 2".
        rational = sum((t for t in e.args if t.is_Rational), sp.Integer(0))
        rest = e - rational
        if rational != 0 and rest != 0:
            sign = "-" if rest.could_extract_minus_sign() else "+"
            rest_tex = sp.latex(-rest) if sign == "-" else sp.latex(rest)
            return f"{sp.latex(rational)} {sign} {rest_tex}"
    return sp.latex(e)


def S(e: sp.Expr) -> str:
    """Canonical string for storing an expression in a claim."""
    return sp.sstr(sp.nsimplify(e) if e.is_number else e)


def approx(e: sp.Expr) -> str:
    v = float(sp.N(e))
    return f"{v:.3f}".rstrip("0").rstrip(".") if not float(v).is_integer() else str(int(v))


def step(text: str, latex: str, claim: dict[str, Any]) -> dict[str, Any]:
    return {"text": text, "latex": latex, "claim": claim}


def pts_latex(points: list[sp.Expr]) -> str:
    return ",\\; ".join(f"x = {L(p)}" for p in points)


def interval_latex(a, b) -> str:
    return f"[{L(a)},\\,{L(b)}]"


# ---------------------------------------------------------------------------
# Topic 1: derivatives (power rule with a negative exponent)
# f(x) = a x^3 + b / x^2
# ---------------------------------------------------------------------------

def derivative_power(rid: str, a: int, b: int, mistake: bool) -> dict[str, Any]:
    f = f"{a}*x**3 + {b}/x**2"
    rewritten = f"{a}*x**3 + {b}*x**(-2)"
    t1, t2 = f"{a}*x**3", f"{b}*x**(-2)"
    d1 = f"{3*a}*x**2"
    d2_true = f"{-2*b}*x**(-3)"
    d2_wrong = f"{-2*b}*x**(-1)"
    d2 = d2_wrong if mistake else d2_true
    fprime_ai = f"{d1} + {d2}"

    steps = [
        step("Rewrite the fraction as a power of x.",
             f"f(x) = {a}x^{{3}} + {b}x^{{-2}}",
             {"type": "equivalent", "expr": rewritten, "to": f}),
        step("Differentiate the first term with the power rule.",
             f"\\frac{{d}}{{dx}}\\left({a}x^{{3}}\\right) = {L(d1)}",
             {"type": "derivative", "f": t1, "expr": d1}),
        step("Differentiate the second term with the power rule.",
             f"\\frac{{d}}{{dx}}\\left({b}x^{{-2}}\\right) = {-2*b}x^{{{-1 if mistake else -3}}}",
             {"type": "derivative", "f": t2, "expr": d2}),
        step("Add the two derivatives.",
             f"f'(x) = {L(d1)} {'-' if b > 0 else '+'} {2*abs(b)}x^{{{-1 if mistake else -3}}}",
             {"type": "derivative", "f": f, "expr": fprime_ai}),
    ]
    fix_exprs = [d2_true, d2_wrong, f"{2*b}*x**(-3)", f"{-2*b}*x**(-2)"]
    fix_tex = [f"{-2*b}x^{{-3}}", f"{-2*b}x^{{-1}}", f"{2*b}x^{{-3}}", f"{-2*b}x^{{-2}}"]
    fix_options = [
        step("Second term derivative", f"\\frac{{d}}{{dx}}\\left({b}x^{{-2}}\\right) = {t}",
             {"type": "derivative", "f": t2, "expr": e})
        for e, t in zip(fix_exprs, fix_tex)
    ]
    true_fp = sp.diff(parse(f), x)
    solution = [
        steps[0], steps[1],
        step("Power rule: bring the exponent down, then subtract 1 from it (−2 − 1 = −3).",
             f"\\frac{{d}}{{dx}}\\left({b}x^{{-2}}\\right) = {-2*b}x^{{-3}}",
             {"type": "derivative", "f": t2, "expr": d2_true}),
        step("Combine.", f"f'(x) = {L(true_fp)}",
             {"type": "derivative", "f": f, "expr": S(true_fp)}),
    ]
    return {
        "id": rid, "topic": "derivatives", "difficulty": 1,
        "problem_text": "Differentiate the function.",
        "problem_latex": f"f(x) = {a}x^{{3}} + \\frac{{{b}}}{{x^{{2}}}}",
        "steps": steps,
        "intended_first_incorrect": 3 if mistake else None,
        "mistake_label": "power_rule_error" if mistake else None,
        "fix_options": fix_options if mistake else [],
        "why_ids": ["power_rule_error", "algebra_error", "forgot_inner_derivative", "solved_f_not_fprime"],
        "correct_solution": solution,
        "verified_answer": {"latex": f"f'(x) = {L(true_fp)}", "claim": solution[-1]["claim"]},
        "key_lesson": "With negative exponents, 'subtract one' moves the exponent further from zero: x^{-2} becomes x^{-3}.",
        "hint_ladder": [
            "Which of the four steps uses the power rule on a negative exponent?",
            f"What is −2 − 1? Use it as the new exponent of x in the derivative of {b}x^(−2).",
            f"Write d/dx of x^n = n·x^(n−1) with n = −2, then multiply by {b}.",
        ],
    }


# ---------------------------------------------------------------------------
# Topic 2: chain rule. f(x) = outer(inner(x))
# ---------------------------------------------------------------------------

def chain_rule(rid: str, outer: str, inner: str, mistake: str | None,
               outer_tex: str, inner_tex: str, difficulty: int = 1) -> dict[str, Any]:
    U = parse(outer)
    I = parse(inner)
    f_expr = U.subs(parse("u"), I)
    f = S(f_expr)
    dO = sp.diff(U, parse("u"))
    dI = sp.diff(I, x)
    true_fp = sp.diff(f_expr, x)
    dO_at_inner = dO.subs(parse("u"), I)

    # Mistakes: "forgot_inner" (step 4 wrong) or "wrong_inner" (step 3 wrong)
    dI_ai = dI / 2 if mistake == "wrong_inner" else dI
    if mistake == "forgot_inner":
        fp_ai = dO_at_inner
    else:
        fp_ai = dO_at_inner * dI_ai

    steps = [
        step("Identify the outer and inner functions.",
             f"\\text{{outer: }} {outer_tex},\\quad u = {inner_tex}",
             {"type": "composition", "outer": outer, "inner": inner, "f": f}),
        step("Differentiate the outer function with respect to u.",
             f"\\frac{{d}}{{du}}\\left({outer_tex}\\right) = {L(dO)}",
             {"type": "derivative", "f": outer, "expr": S(dO), "var": "u"}),
        step("Differentiate the inner function.",
             f"\\frac{{du}}{{dx}} = {L(dI_ai)}",
             {"type": "derivative", "f": inner, "expr": S(dI_ai)}),
        step("Put it together.",
             f"f'(x) = {L(fp_ai)}",
             {"type": "derivative", "f": f, "expr": S(fp_ai)}),
    ]
    first = {"forgot_inner": 4, "wrong_inner": 3, None: None}[mistake]
    label = {"forgot_inner": "forgot_inner_derivative", "wrong_inner": "wrong_derivative", None: None}[mistake]

    if mistake == "forgot_inner":
        cands = [dO_at_inner * dI, dO_at_inner, dO_at_inner * 2 * dI, dO * dI]
        fix_options = [step("Combined derivative", f"f'(x) = {L(c)}",
                            {"type": "derivative", "f": f, "expr": S(c)}) for c in cands[:3]]
        # A plausible distractor written in terms of x only
        fix_options.append(step("Combined derivative", f"f'(x) = {L(dI)}",
                                {"type": "derivative", "f": f, "expr": S(dI)}))
    elif mistake == "wrong_inner":
        cands = [dI, dI / 2, I, dI + 1]
        fix_options = [step("Inner derivative", f"\\frac{{du}}{{dx}} = {L(c)}",
                            {"type": "derivative", "f": inner, "expr": S(c)}) for c in cands]
    else:
        fix_options = []

    solution = [
        steps[0], steps[1],
        step("Differentiate the inner function.", f"\\frac{{du}}{{dx}} = {L(dI)}",
             {"type": "derivative", "f": inner, "expr": S(dI)}),
        step("Chain rule: outer derivative (evaluated at the inner function) times inner derivative.",
             f"f'(x) = {L(dO_at_inner)}\\cdot {L(dI) if dI.is_Atom else '(' + L(dI) + ')'} = {L(sp.factor(true_fp))}",
             {"type": "derivative", "f": f, "expr": S(true_fp)}),
    ]
    return {
        "id": rid, "topic": "chain-rule", "difficulty": difficulty,
        "problem_text": "Differentiate the function.",
        "problem_latex": f"f(x) = {L(f_expr)}",
        "steps": steps,
        "intended_first_incorrect": first,
        "mistake_label": label,
        "fix_options": fix_options,
        "why_ids": ["forgot_inner_derivative", "wrong_derivative", "algebra_error", "power_rule_error"],
        "correct_solution": solution,
        "verified_answer": {"latex": f"f'(x) = {L(sp.factor(true_fp))}", "claim": solution[-1]["claim"]},
        "key_lesson": "Chain rule: differentiate the outside, keep the inside, then multiply by the derivative of the inside.",
        "hint_ladder": [
            "Steps 1–3 compute two separate derivatives. Does step 4 use both of them?",
            f"What is the derivative of the inner function u = {inner_tex.replace('{', '').replace('}', '')}?",
            "Write f'(x) = (outer derivative at u) × (du/dx) and compare it with step 4.",
        ],
    }


# ---------------------------------------------------------------------------
# Topic 3: critical points of a cubic (on all of R)
# ---------------------------------------------------------------------------

def critical_points(rid: str, f: str, f_tex: str, mistake: str | None,
                    factored_true: str, factored_true_tex: str) -> dict[str, Any]:
    F = parse(f)
    fp = sp.diff(F, x)
    crit = true_critical_points(F, None)
    f2 = sp.diff(F, x, 2)
    maxima = [p for p in crit if f2.subs(x, p) < 0]
    minima = [p for p in crit if f2.subs(x, p) > 0]

    if mistake == "solved_f":
        roots = sorted(sp.solveset(sp.Eq(F, 0), x, sp.S.Reals), key=float)
        step2 = step("Find the critical points by solving f(x) = 0.",
                     f"{L(sp.factor(F))} = 0 \\;\\Rightarrow\\; {pts_latex(roots)}",
                     {"type": "critical_points", "f": f, "points": [S(r) for r in roots]})
        step3 = step("Evaluate f at those points.",
                     ",\\; ".join(f"f({L(r)}) = {L(F.subs(x, r))}" for r in roots),
                     {"type": "evaluations", "f": f, "pairs": [[S(r), S(F.subs(x, r))] for r in roots]})
        ai_points = roots
        first, label = 2, "solved_f_not_fprime"
    elif mistake == "bad_factor":
        # factor with a sign error on the second root
        a = sp.Poly(fp, x).LC()
        r1, r2 = crit
        bad = a * (x - r1) * (x + r2)
        step2 = step("Set f′(x) = 0 and factor.",
                     f"{L(fp)} = {L(bad)} = 0",
                     {"type": "equivalent", "expr": S(bad), "to": S(fp)})
        ai_points = sorted([r1, -r2], key=float)
        step3 = step("So the critical points are", pts_latex(ai_points),
                     {"type": "critical_points", "f": f, "points": [S(r) for r in ai_points]})
        first, label = 2, "algebra_error"
    else:
        step2 = step("Set f′(x) = 0 and factor.",
                     f"{L(fp)} = {factored_true_tex} = 0",
                     {"type": "equivalent", "expr": factored_true, "to": S(fp)})
        step3 = step("So the critical points are", pts_latex(crit),
                     {"type": "critical_points", "f": f, "points": [S(r) for r in crit]})
        ai_points = crit
        first, label = None, None

    swap = mistake == "swap_classes"
    if swap:
        first, label = 4, "misclassified_extrema"
    if mistake in ("solved_f", "bad_factor"):
        # classify the AI's (wrong) points with the second derivative sign
        ai_max = [p for p in ai_points if f2.subs(x, p) < 0]
        ai_min = [p for p in ai_points if f2.subs(x, p) > 0]
    else:
        ai_max, ai_min = (minima, maxima) if swap else (maxima, minima)
    def cls_tex(mx, mn):
        parts = []
        if mx:
            parts.append("\\text{local max at } " + ", ".join(f"x={L(p)}" for p in mx))
        if mn:
            parts.append("\\text{local min at } " + ", ".join(f"x={L(p)}" for p in mn))
        return ";\\; ".join(parts) or "\\text{no local extrema}"

    steps = [
        step("Differentiate.", f"f'(x) = {L(fp)}",
             {"type": "derivative", "f": f, "expr": S(fp)}),
        step2, step3,
        step("Classify with the second derivative.",
             f"f''(x) = {L(f2)}:\\quad " + cls_tex(ai_max, ai_min),
             {"type": "local_extrema", "f": f, "max": [S(p) for p in ai_max], "min": [S(p) for p in ai_min]}),
    ]

    if mistake == "solved_f":
        opts = [crit, ai_points, [crit[0]], [-crit[0], -crit[1]]]
        fix_options = [step("Critical points", pts_latex(o),
                            {"type": "critical_points", "f": f, "points": [S(p) for p in o]}) for o in opts]
    elif mistake == "bad_factor":
        a = sp.Poly(fp, x).LC()
        r1, r2 = crit
        opts = [a * (x - r1) * (x - r2), a * (x - r1) * (x + r2), a * (x + r1) * (x - r2), (x - r1) * (x - r2)]
        fix_options = [step("Factored derivative", f"f'(x) = {L(o)}",
                            {"type": "equivalent", "expr": S(o), "to": S(fp)}) for o in opts]
    elif swap:
        opts = [(maxima, minima), (minima, maxima), (crit, []), ([], crit)]
        fix_options = [step("Classification", cls_tex(mx, mn),
                            {"type": "local_extrema", "f": f, "max": [S(p) for p in mx], "min": [S(p) for p in mn]})
                       for mx, mn in opts]
    else:
        fix_options = []

    solution = [
        steps[0],
        step("Set f′(x) = 0 (not f(x) = 0) and factor.", f"{L(fp)} = {factored_true_tex} = 0",
             {"type": "equivalent", "expr": factored_true, "to": S(fp)}),
        step("Critical points", pts_latex(crit),
             {"type": "critical_points", "f": f, "points": [S(r) for r in crit]}),
        step("Second-derivative test", cls_tex(maxima, minima),
             {"type": "local_extrema", "f": f, "max": [S(p) for p in maxima], "min": [S(p) for p in minima]}),
    ]
    return {
        "id": rid, "topic": "critical-points", "difficulty": 2,
        "problem_text": "Find the critical points of f and classify each one.",
        "problem_latex": f"f(x) = {f_tex}",
        "steps": steps,
        "intended_first_incorrect": first,
        "mistake_label": label,
        "fix_options": fix_options,
        "why_ids": ["solved_f_not_fprime", "algebra_error", "misclassified_extrema", "wrong_derivative"],
        "correct_solution": solution,
        "verified_answer": {"latex": pts_latex(crit), "claim": solution[2]["claim"]},
        "key_lesson": {
            "solved_f": "Critical points come from f′(x) = 0. Roots of f(x) are a different question, even when they happen to overlap.",
            "bad_factor": "Expand your factorisation back out to check it before reading off the roots.",
            "swap_classes": "f″ < 0 means concave down, which is a local maximum; f″ > 0 means a local minimum.",
        }.get(mistake or "", "Critical points come from f′(x) = 0; the second derivative's sign classifies them."),
        "hint_ladder": [
            "Critical points are where the derivative is zero. Which equation should be solved?",
            "Check each step against that equation. Expand any factorisation to see if it matches.",
            "If f″ at a point is negative, is the graph concave up or concave down there?",
        ],
    }


# ---------------------------------------------------------------------------
# Topic 4: absolute extrema on a closed interval
# ---------------------------------------------------------------------------

def closed_interval(rid: str, f: str, f_tex: str, a: int, b: int, kind: str,
                    mistake: str | None, difficulty: int = 2) -> dict[str, Any]:
    F = parse(f)
    fp = sp.diff(F, x)
    iv = [str(a), str(b)]
    best, locs, values = true_absolute_extremum(F, sp.Interval(a, b), kind)
    crit_in = true_critical_points(F, sp.Interval(a, b))
    crit_all = true_critical_points(F, None)
    word = "maximum" if kind == "max" else "minimum"
    val = lambda p: sp.nsimplify(sp.simplify(F.subs(x, p)))

    def eval_tex(pairs):
        out = []
        for p, v in pairs:
            t = f"f\\left({L(p)}\\right) = {L(v)}"
            if not v.is_Integer:
                t += f" \\approx {approx(v)}"
            out.append(t)
        return ",\\; ".join(out)

    def conclusion(value, at):
        t = L(value) if value.is_Integer else f"{L(value)} \\approx {approx(value)}"
        return f"\\text{{absolute {word} }} = {t} \\text{{ at }} " + ", ".join(f"x = {L(p)}" for p in at)

    def concl_claim(value, at):
        return {"type": "absolute_extremum", "f": f, "interval": iv, "kind": kind,
                "value": S(value), "at": [S(p) for p in at]}

    # --- The AI's attempt -----------------------------------------------
    first, label = None, None
    ai_crit = crit_in
    if mistake == "solved_f":
        ai_crit = sorted([r for r in sp.solveset(sp.Eq(F, 0), x, sp.Interval(a, b))], key=float)
        first, label = 2, "solved_f_not_fprime"
        crit_step = step("Find the critical points by solving f(x) = 0 on the interval.",
                         f"{L(sp.factor(F))} = 0 \\;\\Rightarrow\\; {pts_latex(ai_crit)}",
                         {"type": "critical_points", "f": f, "interval": iv, "points": [S(p) for p in ai_crit]})
    elif mistake == "outside_interval":
        ai_crit = crit_all
        first, label = 2, "outside_interval"
        crit_step = step(f"Solve f′(x) = 0 to get the critical points in [{a}, {b}].",
                         f"{L(fp)} = 0 \\;\\Rightarrow\\; {pts_latex(ai_crit)}",
                         {"type": "critical_points", "f": f, "interval": iv, "points": [S(p) for p in ai_crit]})
    else:
        crit_step = step(f"Solve f′(x) = 0. Both solutions lie in [{a}, {b}]." if len(crit_in) == 2
                         else f"Solve f′(x) = 0 and keep the solutions in [{a}, {b}].",
                         f"{L(fp)} = 0 \\;\\Rightarrow\\; {pts_latex(crit_in)}",
                         {"type": "critical_points", "f": f, "interval": iv, "points": [S(p) for p in crit_in]})

    if mistake in ("forgot_endpoints", "local_vs_absolute"):
        eval_points = list(crit_in)
    else:
        eval_points = sorted({sp.Integer(a), sp.Integer(b), *ai_crit}, key=float)
    eval_pairs = [(p, val(p)) for p in eval_points]
    if mistake == "bad_evaluation":
        # corrupt the evaluation at the right endpoint
        eval_pairs = [(p, v if p != b else v - 2) for p, v in eval_pairs]
        first, label = 3, "bad_evaluation"

    if mistake == "local_vs_absolute":
        f2 = sp.diff(F, x, 2)
        local = [p for p in crit_in if (f2.subs(x, p) < 0 if kind == "max" else f2.subs(x, p) > 0)]
        eval_step = step(f"Second-derivative test: f″(x) = {L(f2)}.",
                         f"\\text{{local {word} at }} x = {L(local[0])},\\; f({L(local[0])}) = {L(val(local[0]))}",
                         {"type": "local_extrema", "f": f, "interval": iv,
                          "max": [S(p) for p in crit_in if f2.subs(x, p) < 0],
                          "min": [S(p) for p in crit_in if f2.subs(x, p) > 0]})
        ai_value, ai_at = val(local[0]), [local[0]]
        first, label = 4, "local_vs_absolute"
        concl_text = f"The only local {word} is the absolute {word}."
    else:
        eval_text = ("Evaluate f at the critical points." if mistake == "forgot_endpoints"
                     else "Evaluate f at the endpoints and the critical points.")
        eval_step = step(eval_text, eval_tex(eval_pairs),
                         {"type": "evaluations", "f": f, "pairs": [[S(p), S(v)] for p, v in eval_pairs]})
        pick = max if kind == "max" else min
        ai_value = pick((v for _, v in eval_pairs), key=float)
        ai_at = [p for p, v in eval_pairs if v == ai_value]
        concl_text = f"The {'largest' if kind == 'max' else 'smallest'} value is the absolute {word}."
        if mistake == "forgot_endpoints":
            first, label = 4, "forgot_endpoints"

    steps = [
        step("Differentiate.", f"f'(x) = {L(fp)}", {"type": "derivative", "f": f, "expr": S(fp)}),
        crit_step,
        eval_step,
        step(concl_text, conclusion(ai_value, ai_at), concl_claim(ai_value, ai_at)),
    ]

    # --- Fix options ------------------------------------------------------
    def eval_opt(pairs):
        return step("Evaluations", eval_tex(pairs),
                    {"type": "evaluations", "f": f, "pairs": [[S(p), S(v)] for p, v in pairs]})

    def concl_opt(value, at, text):
        return step(text, conclusion(value, at), concl_claim(value, at))

    if mistake in ("forgot_endpoints", "local_vs_absolute"):
        other_best = min if kind == "max" else max
        worst_v, worst_at = other_best(values, key=lambda cv: float(cv[1]))[1], None
        worst_at = [c for c, v in values if v == worst_v]
        fix_options = [
            concl_opt(best, locs, f"Also compare the endpoints f({a}) = {L(val(a))} and f({b}) = {L(val(b))}."),
            concl_opt(ai_value, ai_at, "Keep the critical-point answer."),
            concl_opt(worst_v, worst_at, f"Pick the {'smallest' if kind == 'max' else 'largest'} candidate value."),
            concl_opt(best, [sp.Integer(a) if locs[0] != a else sp.Integer(b)], "Endpoint with the extreme value."),
        ]
    elif mistake in ("solved_f", "outside_interval"):
        opts = [crit_in, ai_crit, [sp.Integer(a), sp.Integer(b)], sorted({*crit_in, *ai_crit}, key=float) if mistake == "solved_f" else [crit_in[0] + 1]]
        fix_options = [step("Critical points in the interval", pts_latex(o),
                            {"type": "critical_points", "f": f, "interval": iv, "points": [S(p) for p in o]})
                       for o in opts]
    elif mistake == "bad_evaluation":
        true_pairs = [(p, val(p)) for p in eval_points]
        fix_options = [eval_opt(true_pairs), eval_opt(eval_pairs),
                       eval_opt([(p, v + 1 if p == a else v) for p, v in true_pairs]),
                       eval_opt([(p, -v if p == b else v) for p, v in true_pairs])]
    else:
        fix_options = []

    # --- Verified correct solution ----------------------------------------
    full_pts = sorted({sp.Integer(a), sp.Integer(b), *crit_in}, key=float)
    solution = [
        steps[0],
        step(f"Critical points: solve f′(x) = 0 and keep those inside [{a}, {b}].",
             f"{pts_latex(crit_in)}",
             {"type": "critical_points", "f": f, "interval": iv, "points": [S(p) for p in crit_in]}),
        step("Evaluate f at every critical point AND both endpoints.",
             eval_tex([(p, val(p)) for p in full_pts]),
             {"type": "evaluations", "f": f, "pairs": [[S(p), S(val(p))] for p in full_pts]}),
        step(f"Compare all candidate values.", conclusion(best, locs), concl_claim(best, locs)),
    ]
    lessons = {
        "forgot_endpoints": "On a closed interval the absolute extremum can sit at an endpoint. Always evaluate f at the endpoints too.",
        "solved_f_not_fprime": "A correct final answer does not prove correct reasoning. Critical points come from f′(x) = 0, not f(x) = 0.",
        "outside_interval": "Throw away critical points that lie outside the interval before evaluating.",
        "bad_evaluation": "Re-check arithmetic when you substitute. One wrong value can change the conclusion.",
        "local_vs_absolute": "A local extremum is only a candidate. Compare it with the endpoints to find the absolute one.",
    }
    return {
        "id": rid, "topic": "closed-interval", "difficulty": difficulty,
        "problem_text": f"Find the absolute {word} of f on the interval.",
        "problem_latex": f"f(x) = {f_tex},\\quad x \\in {interval_latex(a, b)}",
        "steps": steps,
        "intended_first_incorrect": first,
        "mistake_label": label,
        "fix_options": fix_options,
        "why_ids": ["forgot_endpoints", "solved_f_not_fprime", "outside_interval", "bad_evaluation", "local_vs_absolute"],
        "correct_solution": solution,
        "verified_answer": {"latex": conclusion(best, locs), "claim": concl_claim(best, locs)},
        "key_lesson": lessons.get(label or "", "Closed-interval method: critical points inside the interval plus both endpoints, then compare."),
        "hint_ladder": [
            f"On a closed interval, which x-values are candidates for the absolute {word}?",
            "List every candidate: the critical points inside the interval and the two endpoints. Did the attempt check all of them?",
            f"Compute f({a}) and f({b}) yourself and compare them with the values in step 3.",
        ],
    }


def all_drafts() -> list[dict[str, Any]]:
    d: list[dict[str, Any]] = []
    # Derivatives (power rule, negative exponent)
    d.append(derivative_power("der-01", 2, 5, mistake=True))
    d.append(derivative_power("der-02", 4, 3, mistake=True))
    d.append(derivative_power("der-03", 1, 7, mistake=True))
    d.append(derivative_power("der-04", 3, 2, mistake=False))
    # Chain rule
    d.append(chain_rule("chn-01", "u**5", "3*x + 1", "forgot_inner", "u^{5}", "3x + 1"))
    d.append(chain_rule("chn-02", "u**4", "2*x - 5", "forgot_inner", "u^{4}", "2x - 5"))
    d.append(chain_rule("chn-03", "sin(u)", "3*x**2", "forgot_inner", "\\sin u", "3x^{2}", difficulty=2))
    d.append(chain_rule("chn-04", "exp(u)", "x**2 + 1", "wrong_inner", "e^{u}", "x^{2} + 1", difficulty=2))
    d.append(chain_rule("chn-05", "u**3", "x**2 - 4*x", None, "u^{3}", "x^{2} - 4x", difficulty=2))
    # Critical points
    d.append(critical_points("crt-01", "x**3 - 6*x**2 + 9*x", "x^{3} - 6x^{2} + 9x", "solved_f",
                             "3*(x - 1)*(x - 3)", "3(x - 1)(x - 3)"))
    d.append(critical_points("crt-02", "x**3 - 6*x**2 + 9*x + 2", "x^{3} - 6x^{2} + 9x + 2", "bad_factor",
                             "3*(x - 1)*(x - 3)", "3(x - 1)(x - 3)"))
    d.append(critical_points("crt-03", "2*x**3 - 3*x**2 - 12*x", "2x^{3} - 3x^{2} - 12x", "swap_classes",
                             "6*(x + 1)*(x - 2)", "6(x + 1)(x - 2)"))
    d.append(critical_points("crt-04", "x**3 - 12*x + 1", "x^{3} - 12x + 1", None,
                             "3*(x - 2)*(x + 2)", "3(x - 2)(x + 2)"))
    # Closed interval — includes the two mandatory demonstration rounds
    d.append(closed_interval("int-demo-endpoints", "x**3 - 6*x**2 + 11*x - 6", "x^{3} - 6x^{2} + 11x - 6",
                             0, 4, "max", "forgot_endpoints"))
    d.append(closed_interval("int-demo-lucky", "x**3 - 3*x**2", "x^{3} - 3x^{2}", -1, 4, "max", "solved_f"))
    d.append(closed_interval("int-03", "x**3 - 3*x**2 + 2", "x^{3} - 3x^{2} + 2", -1, 4, "max", "forgot_endpoints"))
    d.append(closed_interval("int-04", "x**3 - 12*x", "x^{3} - 12x", 0, 3, "max", "outside_interval"))
    d.append(closed_interval("int-05", "x**3 - 3*x + 1", "x^{3} - 3x + 1", 0, 2, "max", "bad_evaluation", difficulty=1))
    d.append(closed_interval("int-06", "x**3 - 3*x", "x^{3} - 3x", -2, 3, "max", "local_vs_absolute"))
    d.append(closed_interval("int-07", "2*x**3 - 3*x**2 - 12*x", "2x^{3} - 3x^{2} - 12x", -2, 3, "min", None, difficulty=3))
    d.append(closed_interval("int-08", "x**3 - 3*x**2 - 9*x", "x^{3} - 3x^{2} - 9x", -2, 4, "max", None))
    return d
