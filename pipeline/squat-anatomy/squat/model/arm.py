"""Build the Arm from the squat's girdle pose, bar seat and six STLs (the Arm model is core/arm.py)."""
import numpy as np
from numpy.linalg import norm

from core.arm import Arm
from core.geom import Rof, inv, screw, tpts


def load_arm(paths, base, girdle, stl):
    Pr=base.pr; pidr=base.pidr; Tcur=girdle.tcur; META=base.meta; TG=base.tg; GH=girdle.gh
    # ---- armik.py
    PG=np.load(paths.require('v3/girdle_p.npy', 'fixed')); RSC,RS=girdle.girdle(PG)
    BAR=np.load(paths.require('v3/bar_seat.npy', 'fixed')); RB=META['bar']['r']
    def jax(a,b,near):
        ax,ang,p=screw(Tcur[b]@inv(Tcur[a])); p=p+ax*((near-p)@ax); return ax,p,np.degrees(ang)
    ELB=jax(0,1,Pr[pidr==0][np.argmin(Pr[pidr==0][:,1])])
    PRO=jax(1,2,Pr[pidr==2].mean(0))
    H0=stl.vertices('FMA23130'); R0=stl.vertices('FMA23464'); U0=stl.vertices('FMA23467')
    lowH=H0[H0[:,2]<H0[:,2].min()+40]; EPI_M=lowH[np.argmax(lowH[:,0])]; EPI_L=lowH[np.argmin(lowH[:,0])]
    RS_=R0[np.argmin(R0[:,2])]; US_=U0[np.argmin(U0[:,2])]
    MC3_0=stl.vertices('FMA24468'); CAP0=stl.vertices('FMA24446'); LUN0=stl.vertices('FMA24437')
    RR=Rof(Tcur[2]); WC=tpts(Tcur[4],LUN0).mean(0)                 # wrist centre ~ lunate
    WF=(RR@np.array([1.,0,0])); WD=(RR@np.array([0,1.,0]))         # flexion (med-lat) and deviation (AP) axes
    CH={'index':(12,16,17,18),'middle':(13,19,20,21),'ring':(14,22,23,24),'little':(15,25,26,27)}
    FJ={}
    for f,ch in CH.items():
        for a,b in zip(ch[:-1],ch[1:]): FJ[(a,b)]=jax(a,b,Pr[pidr==b].mean(0))
    FJ[(11,28)]=jax(11,28,Pr[pidr==28].mean(0)); FJ[(28,29)]=jax(28,29,Pr[pidr==29].mean(0))
    NV=3+1+1+2+12+2
    HP=list(range(3,30)); HV={p:Pr[pidr==p] for p in HP}
    MARG={**{p:0.0065 for p in range(3,16)},**{p:0.0045 for p in range(16,30)}}
    SIG=np.radians([10,10,10, 12, 15, 15,15]+[12]*12+[10,10])
    GH_NEW=tpts(RS,GH[None])[0]
    # ---- armik2.py
    H0v=stl.vertices('FMA23130'); _top=H0v[H0v[:,2]>H0v[:,2].max()-35]
    _A=np.c_[2*_top,np.ones(len(_top))]; _b=(_top**2).sum(1); _cc,*_=np.linalg.lstsq(_A,_b,rcond=None); GH0=_cc[:3]
    def hframe(Th):
        gh=tpts(Th,GH0[None])[0]; em=tpts(Th,EPI_M[None])[0]; el=tpts(Th,EPI_L[None])[0]; ec=(em+el)/2
        y=gh-ec; y/=norm(y); z=el-em; z-=(z@y)*y; z/=norm(z); return gh,ec,y,z
    _gh0,_ec0,Y0,Z0=hframe(TG)
    # ---- isb.py: thorax frame from IJ/PX/C7/T8
    Pt_t,pid_t,bm_t=base.bone('thorax'); _n=bm_t['names']
    def _pts(name): return Pt_t[pid_t==_n.index(name)]
    _man=_pts('Manubrium'); _xi=_pts('Xiphoid process'); _c7=_pts('Seventh cervical vertebra'); _t8=_pts('Eighth thoracic vertebra')
    def _mid(P): return P[np.abs(P[:,2])<0.006]
    IJ=_mid(_man)[np.argmax(_mid(_man)[:,1])]; PX=_mid(_xi)[np.argmin(_mid(_xi)[:,1])]; C7=_mid(_c7)[np.argmin(_mid(_c7)[:,0])]; T8=_mid(_t8)[np.argmin(_mid(_t8)[:,0])]
    _yt=(IJ+C7)/2-(PX+T8)/2; _yt[2]=0; _yt/=norm(_yt)          # model is mirror-symmetric: keep the thorax frame in the sagittal plane
    _zt=np.array([0,0,1.]); _xt=np.cross(_yt,_zt); _xt/=norm(_xt)
    TF=np.c_[_xt,_yt,_zt]
    return Arm(Tcur=Tcur, Pr=Pr, pidr=pidr, GH=GH, RSC=RSC, RS=RS, BAR=BAR, RB=RB, ELB=ELB, PRO=PRO, EPI_M=EPI_M,
               EPI_L=EPI_L, RS_=RS_, US_=US_, MC3_0=MC3_0, CAP0=CAP0, WC=WC, WF=WF, WD=WD, CH=CH, FJ=FJ, NV=NV, HP=HP,
               HV=HV, MARG=MARG, SIG=SIG, GH_NEW=GH_NEW, GH0=GH0, Y0=Y0, Z0=Z0, IJ=IJ, PX=PX, C7=C7, T8=T8, TF=TF)
