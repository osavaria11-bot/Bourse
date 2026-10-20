#!/usr/bin/env python3
"""Independent SciPy checks of the browser's constrained convex programs."""
import json, sys
import numpy as np
from scipy.optimize import minimize
d=json.load(sys.stdin)
A=np.array(d["limits"]["rows"]); b=np.array(d["limits"]["bounds"])
start=np.array(d["start"])
for q in d["results"]:
    C=np.array(q["c"]); linear=np.array(q["linear"]); w=np.array(q["weights"])
    fun=lambda x: .5*x @ C @ x - linear @ x
    jac=lambda x: C @ x-linear
    constraints=[{"type":"eq","fun":lambda x:x.sum()-1,"jac":lambda x:np.ones(len(x))},
                 {"type":"ineq","fun":lambda x:b-A @ x,"jac":lambda x:-A}]
    r=minimize(fun,start,jac=jac,constraints=constraints,method="SLSQP",
               options={"ftol":1e-13,"maxiter":2500})
    assert r.success, r.message
    assert np.max(A @ w-b)<1e-8 and abs(w.sum()-1)<1e-8
    assert abs(fun(w)-r.fun)<1e-8, (q["active"],q["lambda"],fun(w),r.fun)
    print("Independent QP verified:",q["active"],q["lambda"],"objective difference",abs(fun(w)-r.fun))
