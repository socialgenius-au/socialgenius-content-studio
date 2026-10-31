"""Video Deconstructor — Stage 1. Shared CHECK-constraint SQL for the one geometry shape both
TextElement and VisualObject use identically (x/y/width/height/scale/rotation/anchor/opacity) —
kept here, once, so the two tables' constraints can never drift apart, the same reasoning as
certainty.py's shared CERTAINTY_CHECK_SQL. The actual `mapped_column` declarations are still
written out explicitly in each model file (matching this codebase's existing flat, explicit
style — no declarative mixins anywhere else in these models — rather than introducing a new
abstraction with a single point of precedent).

Coordinates are normalized 0-1 (resolution/aspect-ratio independent), NOT Video Studio's own
0-100 percent convention — converted only at reconstruction-compile time (Stage 22+), per the
design review's Part 5.2 reasoning: a reference video's own geometry shouldn't be expressed
relative to a target canvas it doesn't know about yet.
"""

XY_NORMALIZED_CHECK_SQL = "x >= 0 AND x <= 1 AND y >= 0 AND y <= 1"
WH_NORMALIZED_CHECK_SQL = "width >= 0 AND width <= 1 AND height >= 0 AND height <= 1"
ANCHOR_NORMALIZED_CHECK_SQL = "anchor_x >= 0 AND anchor_x <= 1 AND anchor_y >= 0 AND anchor_y <= 1"
OPACITY_RANGE_CHECK_SQL = "opacity >= 0 AND opacity <= 1"
