import os
os.environ['OPENBLAS_NUM_THREADS']='1'
os.environ['OMP_NUM_THREADS']='1'
os.environ['VECLIB_MAXIMUM_THREADS']='1'
import json, math, hashlib, sys
from pathlib import Path
import numpy as np
from scipy.signal import detrend, hilbert
from scipy.stats import beta
ROOT=Path(__file__).resolve().parents[1]
CHANNELS={'o':.01,'top':1.,'bx':1.,'by':1.,'bw':None,'bh':None,'dashOff':1.,'sw':.2}


def chunks(mask):
    edges=np.flatnonzero(np.diff(np.r_[False,mask,False]))
    return list(zip(edges[::2],edges[1::2]))


def spectral(v,y):
    # Fixed before seeing results: >=6 cycles; Hann five-bin share >=.55;
    # Hilbert amplitude range >=25%, scroll association |r|>=.8.
    if len(v)<128 or np.ptp(v)<1: return None
    v=detrend(v); power=abs(np.fft.rfft(v*np.hanning(len(v))))**2
    power[0]=0; peak=int(np.argmax(power))
    if peak<6 or peak>=len(power)-2: return None
    share=float(power[peak-2:peak+3].sum()/max(power.sum(),1e-20))
    if share<.55:return None
    sp=np.fft.rfft(v); band=np.zeros_like(sp); w=max(2,peak//3)
    band[max(1,peak-w):peak+w+1]=sp[max(1,peak-w):peak+w+1]
    env=abs(hilbert(np.fft.irfft(band,n=len(v)))); trim=int(np.ceil(len(v)/peak))
    env=env[trim:-trim]; yy=y[trim:-trim]
    change=float(np.ptp(np.percentile(env,[10,90]))/max(np.median(env),1e-12))
    corr=float(np.corrcoef(env,yy)[0,1]) if np.std(yy)>0 and np.std(env)>1e-10 else 0.
    return {'peak':peak,'share':share,'change':change,'r':corr,'modulated':change>=.25 and abs(corr)>=.8}


def hinge(y,v):
    # Prediction task: train on alternating contiguous blocks, validate on
    # intervening blocks. Same fixed 9 knot candidates for both films.
    if len(v)<128 or np.ptp(v)<1 or np.ptp(y)==0: return None
    x=(y-y.min())/np.ptp(y)
    block=np.arange(len(v))*8//len(v)
    train=block%2==0; test=~train
    X=np.column_stack([np.ones(len(x)),x]); base=np.linalg.lstsq(X[train],v[train],rcond=None)[0]
    err0=float(np.mean((v[test]-X[test]@base)**2))
    sse0=float(np.sum((v[train]-X[train]@base)**2)); n=train.sum()
    best=None
    for knot in np.linspace(.1,.9,9):
        Z=np.column_stack([X,np.maximum(0,x-knot)])
        fit=np.linalg.lstsq(Z[train],v[train],rcond=None)[0]
        sse=float(np.sum((v[train]-Z[train]@fit)**2))
        if best is None or sse<best[0]:best=(sse,Z,fit,knot)
    sse,Z,fit,knot=best
    # Search costs one extra parameter beyond the hinge coefficient.
    dbic=float(n*np.log(max(sse0,1e-12)/max(sse,1e-12))-2*np.log(n))
    err1=float(np.mean((v[test]-Z[test]@fit)**2))
    gain=1-err1/max(err0,1e-12)
    return {'gain':gain,'dbic':dbic,'accepted':err0>1 and gain>.25 and dbic>10,
            'base_rmse':math.sqrt(err0),'hinge_rmse':math.sqrt(err1),'knot':knot}


def residual_steps(y, v):
    y=np.asarray(y,dtype=float); v=np.asarray(v,dtype=float)
    finite=np.isfinite(v); residual=np.full_like(v,np.nan)
    for st,en in chunks(finite):
        yy=y[st:en]; vv=v[st:en]
        X=np.column_stack([np.ones(len(yy)),yy-yy.mean()])
        residual[st:en]=vv-X@np.linalg.lstsq(X,vv,rcond=None)[0]
    valid=finite[1:]&finite[:-1]&(np.diff(y)>0)
    return valid, abs(np.diff(residual))[valid]/np.diff(y)[valid]


def derivative_controls():
    y=np.arange(128,dtype=float)
    gap=y.copy(); gap[48:80]=np.nan; gap[80:]+=1000
    examples={'static':(y,np.ones(128)), 'pinned':(y,y),
              'affine':(y,2*y+3), 'step':(y,(y>=64).astype(float)*100),
              'missing_jump':(y,gap), 'duplicate_position':(np.repeat(y,2),np.repeat(y,2))}
    results={}
    for name,(yy,v) in examples.items():
        valid,slopes=residual_steps(yy,v)
        results[name]={'defined_intervals':int(valid.sum()),'max_residual_slope':float(max(slopes,default=0))}
    assert all(results[k]['max_residual_slope']<1e-9 for k in examples if k!='step')
    assert results['step']['max_residual_slope']>90
    assert results['duplicate_position']['defined_intervals']==127
    return results


def measure(name):
    path=ROOT/'lenses'/name/'film.json'; raw=path.read_bytes(); d=json.loads(raw); frames=d['frames']
    y=np.array([f['y'] for f in frames],dtype=float); ids=sorted({e['id'] for f in frames for e in f['el']}); ix={v:i for i,v in enumerate(ids)}
    M=np.full((len(ids),len(CHANNELS),len(y)),np.nan); keys=list(CHANNELS)
    for j,fr in enumerate(frames):
        for e in fr['el']:
            if not e.get('vis') or e.get('gone') or e.get('o',1)<=0:continue
            for c,key in enumerate(keys):
                v=e.get(key)
                if isinstance(v,(float,int)):M[ix[e['id']],c,j]=v+y[j] if key=='top' else v
    out={'sha256':hashlib.sha256(raw).hexdigest(),'frames':len(y),'tracked':len(ids),
         'span_px':float(np.ptp(y)),'stationary_intervals':int((np.diff(y)==0).sum()),
         'timestamp_frames':sum('ms' in f for f in frames),'spectral':{},'hinge':{}}
    for stride in [1,2]:
        spectral_rows=[]; hinge_rows=[]; eligible=0
        for i,el_id in enumerate(ids):
            for c,key in enumerate(keys):
                row=M[i,c]
                for start,end in chunks(np.isfinite(row)):
                    jj=np.arange(start,end,stride); v=row[jj]; yy=y[jj]
                    scale=CHANNELS[key] or max(abs(float(np.median(v))),1)*.02
                    v=v/scale
                    if len(v)<128 or np.ptp(v)<1:continue
                    eligible+=1
                    sp=spectral(v,yy)
                    if sp:spectral_rows.append({'id':el_id,'channel':key,'start':int(start),'end':int(end),**sp})
                    # One observation per reached scroll position, never insert
                    # across disappearance; a monotone segment is required.
                    take=np.r_[True,np.diff(yy)>0]; yy=yy[take];v=v[take]
                    h=hinge(yy,v)
                    if h:hinge_rows.append({'id':el_id,'channel':key,**h})
        mods=[r for r in spectral_rows if r['modulated']]
        out['spectral'][str(stride)]={'eligible_runs':eligible,'carrier_runs':len(spectral_rows),'modulated_runs':len(mods),'modulated_elements':len({r['id'] for r in mods}),'examples':mods[:8]}
        out['hinge'][str(stride)]={'eligible_runs':len(hinge_rows),'accepted_runs':sum(r['accepted'] for r in hinge_rows),'fraction':sum(r['accepted'] for r in hinge_rows)/max(len(hinge_rows),1),'median_gain':float(np.median([r['gain'] for r in hinge_rows])) if hinge_rows else None,'by_channel':{k:{'n':sum(r['channel']==k for r in hinge_rows),'accepted':sum(r['channel']==k and r['accepted'] for r in hinge_rows)} for k in keys},'examples':[r for r in hinge_rows if r['accepted']][:8]}
    # Matched, non-overlapping 1152px windows; common top/opacity channels only.
    # Exactly 128 points per window for both captures, no mount-gap interpolation.
    common=[]; shuffled=[]; rng=np.random.default_rng(230923)
    for i,eid in enumerate(ids):
      for c,key in enumerate(keys[:2]):
        row=M[i,c]
        for st,en in chunks(np.isfinite(row)):
          yy=y[st:en];vv=row[st:en]/CHANNELS[key]; take=np.r_[True,np.diff(yy)>0]; yy=yy[take]; vv=vv[take]
          if len(yy)<2:continue
          for left in np.arange(math.ceil(yy[0]/1152)*1152,yy[-1]-1152+1,1152):
            xx=np.linspace(left,left+1152,128); v=np.interp(xx,yy,vv)
            h=hinge(xx,v)
            if h:
              common.append({'id':eid,'channel':key,'left':float(left),**h})
              shuffled.append(hinge(xx,rng.permutation(v)))
    out['matched_hinge']={'eligible_windows':len(common),'accepted_windows':sum(r['accepted'] for r in common),'fraction':sum(r['accepted'] for r in common)/max(len(common),1),'shuffled_accepted':sum(r['accepted'] for r in shuffled), 'by_scroll_window':{str(left):{'n':sum(r['left']==left for r in common),'accepted':sum(r['left']==left and r['accepted'] for r in common)} for left in sorted({r['left'] for r in common})}}
    # Visible adjacent-pair finite differences, pooled sum with denominator.
    # Repeated scroll positions are UNDEFINED, not 1e-6 pixels.
    sums=np.zeros(len(y)-1);counts=np.zeros(len(y)-1,dtype=int)
    for i in range(len(ids)):
      for c,key in enumerate(keys):
        v=M[i,c];finite=np.isfinite(v);scale=CHANNELS[key] or max(abs(float(np.nanmedian(v))) if finite.any() else 1,1)*.02
        valid=finite[1:]&finite[:-1]&(np.diff(y)>0)
        valid,slopes=residual_steps(y,v/scale)
        sums[valid]+=slopes;counts[valid]+=1
    mask=counts>0
    out['masked_derivative']={'defined_intervals':int(mask.sum()),'max_sum_jnd_per_px':float(sums[mask].max()),'median_sum_jnd_per_px':float(np.median(sums[mask])),'max_mean_jnd_per_px':float((sums[mask]/counts[mask]).max()),'at_y':float(y[1:][mask][np.argmax(sums[mask])])}
    return out


def main():
    result={'films':{n:measure(n) for n in ['lemma-geo2','replica']}}
    t=np.linspace(0,1,1024,endpoint=False);rng=np.random.default_rng(8)
    controls={'constant_loop':np.sin(2*np.pi*16*t),'amplitude_modulated':(1+2*t)*np.sin(2*np.pi*16*t),'linear':20*t,'entrance':np.minimum(1,10*t),'noise':rng.normal(size=len(t)),'two_carriers':np.sin(2*np.pi*16*t)+np.sin(2*np.pi*19*t)}
    result['spectral_controls']={name:spectral(v*100,t) for name,v in controls.items()}
    result['hinge_controls']={name:hinge(t,v*100) for name,v in controls.items()}
    result['derivative_controls']=derivative_controls()
    result['rarity_intervals']={}
    for k in [0,1,2,5,37]:
      lo,hi=beta.ppf([.025,.975],k+.5,74-k+.5)
      result['rarity_intervals'][str(k)]={'p_mle':k/74,'bits_mle':-math.log2(k/74) if k else None,'jeffreys_p_95':[lo,hi],'jeffreys_bits_95':[-math.log2(hi),-math.log2(lo)]}
    print(json.dumps(result,indent=2,allow_nan=False))
if __name__=='__main__':main()
