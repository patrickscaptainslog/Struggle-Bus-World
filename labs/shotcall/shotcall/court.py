"""Court, ball and air constants, SI units.

World frame: origin on the floor under the rim centre, +x from the court towards the baseline
behind the basket, +z up. The main broadcast camera sits on the -y side.
"""
import numpy as np

G = 9.81
BALL_R = 0.11925                    # size 7 ball, 29.5 in round
BALL_M = 0.6237                     # 22 oz
RHO_AIR = 1.2
BALL_A = np.pi * BALL_R**2
CD0 = 0.50                          # drag coefficient, subcritical sphere
KD = 0.5 * RHO_AIR * BALL_A / BALL_M            # drag accel = KD * Cd * |v| * v
CL_SLOPE = 0.8                      # lift coefficient per unit spin ratio r*w/v (assumed)
KM = 0.5 * RHO_AIR * BALL_A * BALL_R * CL_SLOPE / BALL_M   # Magnus accel = KM * (w x v)

RIM_Z = 3.048                       # 10 ft
ROD_R = 0.008                       # 5/8 in rim rod
RIM_R = 0.2286 + ROD_R              # ring centreline, 18 in inside diameter
BOARD_X = 0.381                     # backboard face, 15 in behind the rim centre
BOARD_HALF_W = 0.9144
BOARD_Z0, BOARD_Z1 = 2.8956, 3.9624
FLANGE_HALF_W = 0.075               # plate joining the rim to the board
ARC_R = 7.239                       # 23 ft 9 in
CORNER_Y = 6.706                    # 22 ft
E_RIM, E_BOARD, MU = 0.50, 0.62, 0.5    # restitution and friction of the contacts (assumed)
