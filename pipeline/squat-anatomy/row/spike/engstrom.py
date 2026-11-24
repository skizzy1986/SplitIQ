"""Engstrom et al. 2023 rowing data (Visual3D text exports), parsed as text only: str.split('\\t') and float().

Measured, group mean (n = 11, Concept2 Model D): each subject's Neutral 22 spm strokes are averaged, then the 11
subjects equally. Rows 0-4 of each file are headers (file path, name, type, folder, ITEM/component), then 101
time-normalised samples, finish to finish. testtarget.txt holds one subject's (RFP013) marker paths in metres:
Y fore-aft with the flywheel toward -Y, Z up.
"""
from dataclasses import dataclass

import numpy as np

from row import inputs

TRIAL = 'Neutral 22.c3d'
JOINTS = {'RightKnee': 'knee', 'RightHip': 'hip', 'RightAnkle': 'ankle', 'RightElbow': 'elbow',
          'RightShoulder': 'shoulder', 'LowerBack': 'lower_back', 'UpperBack': 'upper_back'}
LEGS_FLAT_KNEE = 15.0      # deg: the legs are flat once the knee is back under this
MARKER_OFFSET = 0.035      # m, wrist marker to handle axis (estimated)
HZ = 100.0


def read_table(path):
    """Header rows and the data rows of a Visual3D export: (headers[5][cols], data[n][cols]) as strings."""
    with open(path, encoding='utf-8') as fh:
        rows = [line.rstrip('\r\n').split('\t') for line in fh]
    return rows[:5], rows[5:]


def basename(cell):
    return cell.replace('\\', '/').split('/')[-1]


def num(s):
    s = s.strip()
    if not s or s.lower() == 'nan':
        return np.nan
    return float(s)


def trial_columns(headers, trial=TRIAL):
    return [j for j, c in enumerate(headers[0]) if j > 0 and basename(c) == trial]


def strokes(path, trial=TRIAL):
    """(101, n_strokes) for one joint file, the trial's columns only."""
    h, data = read_table(path)
    cols = trial_columns(h, trial)
    return np.array([[num(r[j]) for j in cols] for r in data if len(r) > max(cols, default=0)], float)


class EngstromDataError(ValueError):
    """The data hold no strokes or events where the spike needs them (one line, no traceback at the CLI)."""


def group_mean(per_subject):
    """Mean over each subject's strokes, then equally over subjects. per_subject: list of (101, n) arrays."""
    if not per_subject or any(a.size == 0 or np.isnan(a).all() for a in per_subject):
        raise EngstromDataError(f'a subject has no {TRIAL} strokes')
    return np.nanmean(np.stack([np.nanmean(a, 1) for a in per_subject]), 0)


def first_after(cond, after, what):
    """The first index in `after` where cond holds; an error when it never does (argmax would return 0)."""
    hit = cond[after]
    if not hit.any():
        raise EngstromDataError(f'no sample after the catch where {what}')
    return int(after[np.argmax(hit)])


def events(path, trial=TRIAL):
    """Drive and recovery times (s) of one trial from FINISH_FRAMES / CATCH_FRAMES (100 Hz)."""
    h, data = read_table(path)
    cols = trial_columns(h, trial)
    fin = [num(r[j]) for r in data for j in cols if h[1][j] == 'FINISH_FRAMES']
    cat = [num(r[j]) for r in data for j in cols if h[1][j] == 'CATCH_FRAMES']
    fin = np.sort([f for f in fin if np.isfinite(f)])
    cat = np.sort([c for c in cat if np.isfinite(c)])
    drive, rec = [], []
    for a, b in zip(fin[:-1], fin[1:]):
        c = cat[(cat > a) & (cat < b)]
        if len(c) == 1:
            rec.append((c[0] - a) / HZ)
            drive.append((b - c[0]) / HZ)
    return np.array(drive), np.array(rec)


def markers(path, trial=TRIAL):
    """marker -> (101, n_strokes, 3) [X, Y, Z] in metres, from testtarget.txt."""
    h, data = read_table(path)
    out = {}
    for j in trial_columns(h, trial):
        out.setdefault(h[1][j], {}).setdefault(h[4][j], []).append(j)
    res = {}
    for m, ax in out.items():
        res[m] = np.stack([np.array([[num(r[j]) for j in ax[a]] for r in data], float) for a in ('X', 'Y', 'Z')], -1)
    return res


@dataclass(frozen=True)
class Targets:
    mean: dict          # joint -> (101,) normalised group mean
    raw: dict           # joint -> (101,) raw-sign group mean
    signs: dict         # joint -> +1 / -1 applied
    events: dict        # pose -> index
    rules: dict         # pose -> rule text
    theta: np.ndarray   # RFP013 trunk line (deg, + back), mean over strokes
    handle_y: float     # m, RFP013 median wrist height over [catch, 100] minus the marker offset
    rfp013_catch: int
    footplate_deg: float
    rcis_y: np.ndarray  # RFP013 iliac-crest fore-aft (m)
    drive_s: float
    recovery_s: float
    rate_note: str
    ankle_y: float              # RFP013 RANK height at the finish (m)
    knee_peak_subjects: float   # mean of each subject's peak knee flexion (the paper-style anchor)
    catch_subjects: float       # mean of each subject's catch index


def normalise(raw):
    """Sign rules: catch = argmax |knee|; knee, hip, ankle, shoulder, lower and upper back read catch > finish;
    the elbow reads finish > catch."""
    catch = int(np.argmax(np.abs(raw['knee'])))
    signs = {}
    for k, v in raw.items():
        s = 1.0 if v[catch] > v[0] else -1.0
        signs[k] = -s if k == 'elbow' else s
    return {k: signs[k] * v for k, v in raw.items()}, signs, catch


def pose_events(mean, theta, catch):
    after = np.arange(catch + 1, 101)
    flat = first_after(mean['knee'] <= LEGS_FLAT_KNEE, after, f'the knee is back under {LEGS_FLAT_KNEE:g}°')
    opened = first_after(theta >= 0, after, 'the trunk line reaches vertical')
    ev = dict(catch=catch, legs_flat=flat, trunk_open=opened, finish=0, mid_recovery=int(round(catch / 2)))
    rules = dict(catch='argmax knee flexion', legs_flat=f'first after the catch with knee ≤ {LEGS_FLAT_KNEE:g}°',
                 trunk_open='first after the catch with RFP013 trunk line Θ ≥ 0°', finish='index 0',
                 mid_recovery='round(catch / 2)')
    return ev, rules


def load(root):
    """All the targets the pose solve needs, from a fetched rowing data root."""
    per = {k: [] for k in JOINTS.values()}
    drives, recs = [], []
    for s in inputs.ENGSTROM_SUBJECTS:
        for f, k in JOINTS.items():
            per[k].append(strokes(root / 'Data' / s / f'{f}.txt'))
        d, r = events(root / 'Data' / s / 'events.txt')
        if not len(d):
            raise EngstromDataError(f'{s}: no complete {TRIAL} stroke in events.txt')
        drives.append(d.mean())
        recs.append(r.mean())
    raw = {k: group_mean(v) for k, v in per.items()}
    subj_knee = np.abs(np.stack([np.nanmean(a, 1) for a in per['knee']]))
    mean, signs, catch = normalise(raw)
    mk = markers(root / 'testtarget.txt')
    rcis, rsho, rwrb = mk['RCIS'].mean(1), mk['RSHO'].mean(1), mk['RWRB'].mean(1)
    theta = np.degrees(np.arctan2(rsho[:, 1] - rcis[:, 1], rsho[:, 2] - rcis[:, 2]))
    ev, rules = pose_events(mean, theta, catch)
    rank, rtoe = mk['RANK'].mean(1), mk['RTOE'].mean(1)
    foot = np.degrees(np.arctan2(rtoe[0, 2] - rank[0, 2], rank[0, 1] - rtoe[0, 1]))
    return Targets(mean=mean, raw=raw, signs=signs, events=ev, rules=rules, theta=theta,
                   handle_y=float(np.median(rwrb[catch:, 2]) - MARKER_OFFSET), rfp013_catch=int(np.argmin(rwrb[:, 1])),
                   footplate_deg=float(foot), rcis_y=rcis[:, 1], drive_s=float(np.mean(drives)),
                   recovery_s=float(np.mean(recs)), rate_note='Neutral foot position, 22 strokes/min',
                   ankle_y=float(rank[0, 2]),
                   knee_peak_subjects=float(subj_knee.max(1).mean()), catch_subjects=float(subj_knee.argmax(1).mean()))


def pose_targets(t, e):
    """The five angle targets at an event index: model conventions (ankle dorsiflexion = A − 90°, spinal flexion
    Λ = lower back + upper back)."""
    i = t.events[e]
    m = t.mean
    return dict(index=i, knee=float(m['knee'][i]), hip=float(m['hip'][i]), ankle=float(m['ankle'][i] - 90),
                spinal=float(m['lower_back'][i] + m['upper_back'][i]), theta=float(t.theta[i]),
                elbow=float(m['elbow'][i]), shoulder=float(m['shoulder'][i]), handle_y=t.handle_y)
