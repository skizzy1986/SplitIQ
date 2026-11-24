"""One copy of the thresholds, matching issue #754, and every module reading that copy."""
from row.spike import collide, report, skin
from row.spike import thresholds as th


def test_constants_match_the_issue():
    assert (th.T_Q1_POS, th.T_Q1_ROT) == (1.0, 0.5)
    assert (th.T_PT_RMS, th.T_PT_MAX, th.T_V_P99, th.T_V_MAX) == (1.5, 5.0, 3.0, 8.0)
    assert (th.T_LEN, th.T_SIG) == (0.5, 0.005)
    assert (th.T_UP_RMS, th.T_UP_MAX) == (1.0, 4.0)
    assert (th.T_PEN, th.T_VOL) == (3.0, 10.0)
    assert (th.NOGO_DEEP_MM, th.NOGO_FRAC_PCT) == (5, 1)
    assert th.TIER == 2 and th.ATTACH_CM == 1
    assert (th.SKIN_BONE_PCT, th.SKIN_MUSCLE_PCT, th.SKIN_MED_LO, th.SKIN_MED_HI) == (0.1, 1, 2, 25)
    assert (th.SKIN_TRIS, th.SKIN_TOL_PCT, th.SKIN_H_MAX, th.SKIN_H_MEAN) == (12000, 2, 3, 0.5)


def test_modules_read_the_one_copy():
    assert report.T_PEN is th.T_PEN and report.T_VOL is th.T_VOL and report.NOGO_FRAC_PCT is th.NOGO_FRAC_PCT
    assert collide.DEEP == th.T_PEN / 1e3 and collide.NOGO_DEEP == th.NOGO_DEEP_MM / 1e3
    assert collide.NOGO_FRAC == th.NOGO_FRAC_PCT / 100
    assert skin.BUDGET == th.SKIN_TRIS and skin.BUDGET_TOL == th.SKIN_TOL_PCT / 100
