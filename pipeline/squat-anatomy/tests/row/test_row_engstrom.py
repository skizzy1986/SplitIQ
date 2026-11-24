"""The Visual3D text parser, the group mean, the sign and event rules, on synthetic files (no data needed)."""
import numpy as np
import pytest

from row.spike import engstrom as eg

PATH = 'Z:\\042 Vicon Database\\RFP999\\Assessment\\{}'


def _joint_file(path, trials):
    """trials: {basename: (101, n) array}; Visual3D layout with five header rows."""
    cols = [(t, a[:, j]) for t, a in trials.items() for j in range(a.shape[1])]
    rows = [[''] + [PATH.format(t) for t, _ in cols], [''] + ['Right Knee'] * len(cols), [''] + ['LINK_MODEL_BASED'] * len(cols),
            [''] + ['PROCESSED'] * len(cols), ['ITEM'] + ['0'] * len(cols)]
    for i in range(101):
        rows.append([str(i + 1)] + [('nan' if np.isnan(c[i]) else f'{c[i]:.6f}') for _, c in cols])
    path.write_text('\n'.join('\t'.join(r) for r in rows) + '\n', encoding='utf-8')


def test_parse_skips_other_trials_and_nan(tmp_path):
    a = np.tile(np.arange(101.0)[:, None], (1, 2))
    a[5, 1] = np.nan
    _joint_file(tmp_path / 'k.txt', {'Neutral 22.c3d': a, 'Neutral 26.c3d': a + 100})
    s = eg.strokes(tmp_path / 'k.txt')
    assert s.shape == (101, 2) and np.isnan(s[5, 1]) and s[100, 0] == 100
    assert eg.group_mean([s]).tolist()[5] == 5.0


def test_group_mean_is_per_subject_then_equal():
    s1 = np.full((101, 10), 1.0)
    s2 = np.full((101, 2), 3.0)
    assert np.allclose(eg.group_mean([s1, s2]), 2.0)


def test_sign_rules():
    t = np.linspace(0, 1, 101)
    bump = np.sin(np.pi * t / 1.2)
    raw = {'knee': -130 * bump, 'hip': 40 + 80 * bump, 'ankle': 46 + 60 * bump, 'shoulder': -20 + 90 * bump,
           'lower_back': -10 - 20 * bump, 'upper_back': -7 + 25 * bump, 'elbow': 125 - 117 * bump}
    mean, signs, catch = eg.normalise(raw)
    assert catch == int(np.argmax(bump))
    assert signs['knee'] == -1 and signs['lower_back'] == -1 and signs['hip'] == 1 and signs['elbow'] == 1
    for k in ('knee', 'hip', 'ankle', 'shoulder', 'lower_back', 'upper_back'):
        assert mean[k][catch] > mean[k][0]
    assert mean['elbow'][0] > mean['elbow'][catch]


def test_event_rules():
    knee = np.r_[np.linspace(5, 130, 60), np.linspace(128, 5, 41)]
    theta = np.r_[np.linspace(28, -45, 60), np.linspace(-44, 28, 41)]
    ev, rules = eg.pose_events({'knee': knee}, theta, 59)
    after = np.arange(60, 101)
    assert ev['catch'] == 59 and ev['finish'] == 0 and ev['mid_recovery'] == 30
    assert ev['legs_flat'] == after[np.argmax(knee[after] <= 15)]
    assert ev['trunk_open'] == after[np.argmax(theta[after] >= 0)]
    assert theta[ev['trunk_open']] >= 0 > theta[ev['trunk_open'] - 1]
    assert set(rules) == set(ev)


def test_events_drive_and_recovery(tmp_path):
    fin = [270, 544, 815]
    cat = [160, 437, 707]
    rows = [['', PATH.format('Neutral 22.c3d'), PATH.format('Neutral 22.c3d'), PATH.format('Other.c3d')],
            ['', 'FINISH_FRAMES', 'CATCH_FRAMES', 'FINISH_FRAMES'], ['', 'EVENT_LABEL'] * 1 + ['EVENT_LABEL'] * 2,
            ['', 'DERIVED'] + ['DERIVED'] * 2, ['ITEM', 'X', 'X', 'X']]
    for i in range(3):
        rows.append([str(i + 1), f'{fin[i]:.6f}', f'{cat[i]:.6f}', '9'])
    rows.append(['4', '', '', ''])
    (tmp_path / 'events.txt').write_text('\n'.join('\t'.join(r) for r in rows) + '\n', encoding='utf-8')
    d, r = eg.events(tmp_path / 'events.txt')
    assert np.allclose(d, [1.07, 1.08]) and np.allclose(r, [1.67, 1.63])


def test_testtarget_triplets(tmp_path):
    hdr0, hdr1, hdr4 = [''], [''], ['ITEM']
    data = [[str(i + 1)] for i in range(101)]
    for m, base in (('RCIS', 0.0), ('RSHO', 10.0)):
        for s in range(2):
            for ax, off in (('X', 0.0), ('Y', 1.0), ('Z', 2.0)):
                hdr0.append(PATH.format('Neutral 22.c3d'))
                hdr1.append(m)
                hdr4.append(ax)
                for i in range(101):
                    data[i].append(f'{base + off + s:.5f}')
    rows = [hdr0, hdr1, [''] + ['TARGET'] * (len(hdr0) - 1), [''] + ['ORIGINAL'] * (len(hdr0) - 1), hdr4] + data
    (tmp_path / 'tt.txt').write_text('\n'.join('\t'.join(r) for r in rows) + '\n', encoding='utf-8')
    mk = eg.markers(tmp_path / 'tt.txt')
    assert mk['RCIS'].shape == (101, 2, 3) and mk['RSHO'][0, 1].tolist() == [11.0, 12.0, 13.0]


def test_basename_handles_backslashes():
    assert eg.basename('Z:\\a\\b\\Neutral 22.c3d') == 'Neutral 22.c3d'
    assert eg.num(' nan ') != eg.num(' nan ') and eg.num('') != eg.num('') and eg.num('1.5') == pytest.approx(1.5)


def test_event_rules_fail_loudly_when_a_condition_never_holds():
    knee = np.full(101, 60.0)                       # the knee never comes back under 15°
    theta = np.linspace(-45, 28, 101)
    with pytest.raises(eg.EngstromDataError) as e:
        eg.pose_events({'knee': knee}, theta, 59)
    assert '\n' not in str(e.value)
    knee = np.r_[np.linspace(5, 130, 60), np.linspace(128, 5, 41)]
    with pytest.raises(eg.EngstromDataError):
        eg.pose_events({'knee': knee}, np.full(101, -10.0), 59)    # the trunk never reaches vertical


def test_group_mean_refuses_a_subject_without_strokes():
    with pytest.raises(eg.EngstromDataError):
        eg.group_mean([np.ones((101, 3)), np.zeros((101, 0))])
    with pytest.raises(eg.EngstromDataError):
        eg.group_mean([np.full((101, 2), np.nan)])
