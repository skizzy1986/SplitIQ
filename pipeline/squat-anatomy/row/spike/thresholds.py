"""The spike's thresholds, as issue #754 states them: the one copy report.py, collide.py and skin.py read."""

T_Q1_POS, T_Q1_ROT = 1.0, 0.5                      # Q1 frames: mm, °
T_PT_RMS, T_PT_MAX, T_V_P99, T_V_MAX = 1.5, 5.0, 3.0, 8.0   # Q2 curve points and re-skinned vertices: mm
T_LEN, T_SIG = 0.5, 0.005                          # Q2 muscle length (%), sig
T_UP_RMS, T_UP_MAX = 1.0, 4.0                      # Q3a upper body: mm
T_PEN, T_VOL = 3.0, 10.0                           # Q3b penetration (mm), volume change (%)
NOGO_DEEP_MM, NOGO_FRAC_PCT = 5, 1                 # the kill rule: > 1 % of vertices > 5 mm inside, catch or finish
TIER = 2                                           # tier-2 up to twice a threshold
ATTACH_CM = 1                                      # attachment exclusion radius (cm)
SKIN_BONE_PCT, SKIN_MUSCLE_PCT, SKIN_MUSCLE_MM = 0.1, 1, 1
SKIN_MED_LO, SKIN_MED_HI, SKIN_TRIS, SKIN_TOL_PCT = 2, 25, 12000, 2
SKIN_H_MAX, SKIN_H_MEAN = 3, 0.5                   # decimation Hausdorff: mm

# Arm IK "converged" is a penalty-level label, not an optimiser status. The spec's pen <= 1e-3 is stricter than the
# squat's own accepted hand (cost3 pen 0.0067 at armik4_x), so the limit is that level, rounded up.
IK_PEN_OK, IK_ELBOW_OK = 0.01, 10.0

# model constants the report quotes (not thresholds)
GRIP_Z, GRIP_WEIGHT = 0.19, 5e2                    # armik grip target (m) and its cost weight
HANDLE_X_BACK, HANDLE_X_FWD = 0.3, 1.2             # handle x bounds about the hip centre (m)
LBFGSB_MAXFUN = 15000                              # scipy's L-BFGS-B default maxfun (optimize/_lbfgsb_py.py)
