from pathlib import Path
import re,json
root=Path(__file__).resolve().parents[1];mobile=root/'apps/mobile'
files={str(p.relative_to(mobile)):p.read_text() for folder in ['lib','components','app'] for p in (mobile/folder).rglob('*') if p.suffix in ['.ts','.tsx','.js'] and not p.name.endswith('.test.mts')}

def resolve(parent,target):
 base=(mobile/parent).parent/target
 for suffix in ['', '.ts','.tsx','.js','/index.ts','/index.tsx']:
  candidate=Path(str(base)+suffix).resolve()
  try:key=str(candidate.relative_to(mobile))
  except ValueError:continue
  if key in files:return key
 return None
imports={}
for file,src in files.items():
 src=re.sub(r'import\s+type\b[^;]+;','',src)
 specs=re.findall(r'(?:from\s*|require\(\s*)[\'\"](\.[^\'\"]+)[\'\"]',src)
 imports[file]=set(filter(None,(resolve(file,target) for target in specs)))
def reach(seeds,block=()):
 seen=set();todo=list(seeds)
 while todo:
  n=todo.pop()
  if n in seen or n in block:continue
  seen.add(n);todo.extend(imports.get(n,[]))
 return seen
legacy=reach(['app/(gated)/home.tsx','components/pages/ContactsPage.tsx'],['components/ConnectedRolodex.tsx'])
new=reach(['components/ConnectedRolodex.tsx'])
common=reach(['app/_layout.tsx','app/(gated)/_layout.tsx','app/(auth)/sign-in.tsx','app/(gated)/onboarding.tsx'],['app/(gated)/home.tsx'])
modules=[]
for file,src in files.items():
 if not file.startswith('lib/'):continue
 paths=[{'line':src[:m.start()].count('\n')+1,'expression':m.group(1)} for m in re.finditer(r'path:\s*([`\'\"][^\n]+)',src)]
 exports=re.findall(r'export\s+(?:async\s+)?function\s+(\w+)',src)
 if paths or re.search(r'(?:expoFetch|fetch)\(',src):
  callers=sorted(k for k,v in imports.items() if file in v)
  modules.append({'file':file,'legacy_import_reachable':file in legacy,'redesign_import_reachable':file in new,'app_shell_import_reachable':file in common,'exports':exports,'callers':callers,'routes':paths})
out=root/'docs/sagar-main/audit';out.mkdir(exist_ok=True)
(out/'connector-inventory.json').write_text(json.dumps({'basis':'Static import reachability only; not proof a control is rendered or a request succeeds. Server checkout unavailable (iCloud placeholders). No credential or environment values read.','modules':modules},indent=2)+'\n')
missing=[m['file'] for m in modules if m['legacy_import_reachable'] and not m['redesign_import_reachable'] and not m['app_shell_import_reachable']]
print(json.dumps({'connector_modules':len(modules),'route_expressions':sum(len(m['routes']) for m in modules),'legacy_only_candidates':missing},indent=2))
