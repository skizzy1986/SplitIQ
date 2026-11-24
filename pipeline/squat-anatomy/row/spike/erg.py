"""Concept2 RowErg geometry for the five key poses, in model axes: the rower faces +x, the flywheel is at +x, +y up,
z = 0 the mid-plane. Every value says whether it is published, estimated or inferred, and where it comes from
(values without a study behind them are the #754 build spec's estimates, labelled so)."""

ERG = {
    'seat_top_y': dict(value=0.36, unit='m', status='published', ref='Concept2 RowErg seat height (#754 spec, '
                       'Gate 1 research)'),
    'ischial_tissue': dict(value=0.015, unit='m', status='estimated', ref='soft tissue under the ischial '
                           'tuberosities, sitting (#754 spec estimate)'),
    'footplate_deg': dict(value=41.0, unit='°', status='estimated', ref='footstretcher angle, Soper & Hume as cited '
                          'in the #754 spec; the RFP013 RANK→RTOE line is reported beside it'),
    'ankle_x': dict(value=0.0, unit='m', status='inferred', ref='origin: the heel-down ankle centre'),
    'ankle_y': dict(value=None, unit='m', status='inferred', ref='RFP013 RANK height at the finish (Engstrom et '
                    'al. 2023 testtarget.txt); lab floor taken as the erg floor (A4)'),
    'handle_r': dict(value=0.016, unit='m', status='estimated', ref='handle grip radius (#754 spec estimate)'),
    'handle_y': dict(value=None, unit='m', status='inferred', ref='RFP013 median wrist-marker height over the '
                     'drive, minus a 0.035 m marker-to-axis offset (estimated)'),
    'grip_z': dict(value=0.19, unit='m', status='estimated', ref='third metacarpal 0.19 m from the mid-plane '
                   '(#754 spec estimate)'),
    'rail_len': dict(value=1.37, unit='m', status='published', ref='Concept2 RowErg rail (#754 spec, Gate 1 '
                     'research)'),
    'flywheel_dx': dict(value=0.55, unit='m', status='estimated', ref='chain exit ahead of the ankle (render only)'),
}


def erg(ankle_y, handle_y):
    """The table with the two data-derived values filled in."""
    out = {k: dict(v) for k, v in ERG.items()}
    out['ankle_y']['value'] = float(ankle_y)
    out['handle_y']['value'] = float(handle_y)
    return out


def v(table, key):
    return table[key]['value']
