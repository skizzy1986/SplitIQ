"""Muscle-in-bone penetration depth and per-muscle volume for a posed body (right side + axial).

Depth per bone part (split by part id): a watertight part uses trimesh's contains() and the closest-point distance;
an open part uses the closest point and the sign of its face normal (normals oriented outward by signed volume).
An AABB prefilter keeps it fast.
"""
import numpy as np
import trimesh

from row.spike.thresholds import NOGO_DEEP_MM, NOGO_FRAC_PCT, T_PEN

DEEP, NOGO_DEEP, NOGO_FRAC = T_PEN / 1e3, NOGO_DEEP_MM / 1e3, NOGO_FRAC_PCT / 100   # metres, fraction


def bone_parts(bones):
    """(name, trimesh, watertight) per bone part."""
    out = []
    for g, (V, F, pid) in bones.items():
        for p in np.unique(pid):
            fm = np.all(pid[F] == p, axis=1)
            if fm.sum() < 4:
                continue
            used = np.unique(F[fm])
            remap = -np.ones(len(V), np.int64)
            remap[used] = np.arange(len(used))
            m = trimesh.Trimesh(V[used], remap[F[fm]], process=False)
            if m.volume < 0:
                m.invert()
            out.append((f'{g}:{p}', m, bool(m.is_watertight)))
    return out


def depth(V, parts, force_sign=False):
    """Per-vertex penetration depth (m, 0 = outside every bone) and the part each deepest value is in.
    force_sign: use the open-mesh method (closest point + face-normal sign) on watertight parts too (for checks)."""
    d = np.zeros(len(V))
    who = np.full(len(V), -1)
    for k, (name, m, wt) in enumerate(parts):
        lo, hi = m.bounds
        c = np.where(np.all((V >= lo) & (V <= hi), axis=1))[0]
        if not len(c):
            continue
        if wt and not force_sign:
            inside = m.contains(V[c])
            c = c[inside]
            if not len(c):
                continue
            _, dist, _ = trimesh.proximity.closest_point(m, V[c])
        else:
            cp, dist, fi = trimesh.proximity.closest_point(m, V[c])
            sgn = np.einsum('ij,ij->i', V[c] - cp, m.face_normals[fi])
            keep = sgn < 0
            c, dist = c[keep], dist[keep]
        better = dist > d[c]
        d[c[better]] = dist[better]
        who[c[better]] = k
    return d, who


def penetration(sets, parts, excl_attach, baseline, D=None):
    """Q3-pen rows per set. excl_attach / baseline: set -> bool masks (None: no such exclusion). D: precomputed
    depths per set (depths())."""
    rows = {}
    raw_all, use_all = [], []
    for k, (V, F, mid) in sets.items():
        d = D[k][0] if D is not None else depth(V, parts)[0]
        ea = excl_attach.get(k)
        ea = np.zeros(len(V), bool) if ea is None else ea
        bl = baseline.get(k)
        bl = np.zeros(len(V), bool) if bl is None else bl
        use = ~(ea | bl)
        du = d[use]
        rows[k] = dict(tested=int(len(V)), excl_attach=int(ea.sum()), excl_baseline=int((bl & ~ea).sum()),
                       deep=int((du > DEEP).sum()), frac=float((du > DEEP).mean()) if len(du) else 0.0,
                       max_depth=float(du.max() * 1e3) if len(du) else 0.0,
                       nogo_frac=float((du > NOGO_DEEP).mean()) if len(du) else 0.0,
                       raw_nogo_frac=float((d > NOGO_DEEP).mean()))
        raw_all.append(d)
        use_all.append(use)
    d = np.concatenate(raw_all)
    u = np.concatenate(use_all)
    rows['all'] = dict(tested=int(len(d)), excl_attach=sum(r['excl_attach'] for r in rows.values()),
                       excl_baseline=sum(r['excl_baseline'] for r in rows.values()), deep=int((d[u] > DEEP).sum()),
                       frac=float((d[u] > DEEP).mean()), max_depth=float(d[u].max() * 1e3),
                       nogo_frac=float((d[u] > NOGO_DEEP).mean()), raw_nogo_frac=float((d > NOGO_DEEP).mean()))
    return rows


def depths(sets, parts):
    """set -> (depth, part index) per vertex."""
    return {k: depth(V, parts) for k, (V, F, mid) in sets.items()}


def muscle_volumes(V, F, mid, closed=None):
    """Per muscle |Σ (v0−c)·((v1−c)×(v2−c))/6| about the posed centroid (the signed volume when closed)."""
    fm = mid[F]
    same = (fm[:, 0] == fm[:, 1]) & (fm[:, 1] == fm[:, 2])
    out = {}
    for m in np.unique(fm[same, 0]):
        f = F[same & (fm[:, 0] == m)]
        c = V[np.unique(f)].mean(0)
        a, b, e = V[f[:, 0]] - c, V[f[:, 1]] - c, V[f[:, 2]] - c
        out[int(m)] = float(abs(np.einsum('ij,ij->i', a, np.cross(b, e)).sum() / 6))
    return out


def watertight_muscles(V, F, mid):
    fm = mid[F]
    same = (fm[:, 0] == fm[:, 1]) & (fm[:, 1] == fm[:, 2])
    out = {}
    for m in np.unique(fm[same, 0]):
        f = F[same & (fm[:, 0] == m)]
        out[int(m)] = bool(trimesh.Trimesh(V, f, process=False).is_watertight)
    return out


def deep_muscles(sets, parts, excl_attach, baseline, names, D, top=8):
    """The muscles with the most non-excluded vertices more than 5 mm inside bone."""
    rows = []
    for k, (V, F, mid) in sets.items():
        d, who = D[k]
        ea = excl_attach.get(k)
        use = ~(baseline.get(k, np.zeros(len(V), bool)) | (np.zeros(len(V), bool) if ea is None else ea))
        deep = use & (d > NOGO_DEEP)
        for m in np.unique(mid[deep]):
            sel = deep & (mid == m)
            bone = np.bincount(who[sel]).argmax()
            rows.append(dict(set=k, muscle=names.get(int(m), str(m)) if isinstance(names, dict) else str(m),
                             n=int(sel.sum()), max_depth=float(d[sel].max() * 1e3), bone=parts[bone][0]))
    return sorted(rows, key=lambda r: (-r['n'], r['muscle']))[:top]
