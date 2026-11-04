"""Front door: the gtme engine lives in Dough, at engine/tools/gtme_library.py. Edit it there.

gtme-front-door. tools/dough_home.py finds Dough and runs or imports its copy.
"""
import importlib.util as _u
import os as _o
import sys as _s

_m = _s.modules.get("chewbacca_dough_home")
if _m is None:
    _p = _u.spec_from_file_location("chewbacca_dough_home", _o.path.join(_o.path.dirname(_o.path.realpath(__file__)), "dough_home.py"))
    _m = _u.module_from_spec(_p)
    _p.loader.exec_module(_m)
    _s.modules["chewbacca_dough_home"] = _m
_m.become(globals())
