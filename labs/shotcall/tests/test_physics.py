"""Sanity checks on the ground-truth physics. Run: python -m tests.test_physics (from labs/shotcall)."""
import time
import numpy as np
from shotcall.court import G, RIM_Z, RIM_R
from shotcall.physics import flight, simulate_outcome, crossing_features, velocity
from shotcall.shots import sample_shots, solve_aim, A_TARGET


def test_vacuum():
    p0 = np.array([[-7.0, 0.0, 2.5]]); v0 = np.array([[6.0, 0.0, 7.0]]); z = np.zeros((1, 3))
    pos, tc, pc, vc = flight(p0, v0, z, np.zeros(1), n_store=60)
    t = np.arange(60) / 60
    err = np.abs(pos[0, :, 2] - (2.5 + 7 * t - 0.5 * G * t * t)).max()
    T = (7 + np.sqrt(49 - 2 * G * (RIM_Z - 2.5))) / G
    print(f"vacuum: max height error {err:.2e} m, crossing time error {abs(tc[0]-T):.2e} s, x error {abs(pc[0,0]-(-7+6*T)):.2e} m")
    assert err < 1e-9 and abs(tc[0] - T) < 1e-9


def test_drop():
    """A ball dropped dead centre goes in, one dropped on the rim's edge does not swish."""
    p0 = np.array([[0.0, 0.0, 4.0], [RIM_R, 0.0, 4.0], [-0.6, 0.0, 4.0]]); z = np.zeros((3, 3))
    made, contacts = simulate_outcome(p0, z, z, np.full(3, 0.5))
    print("drop: centre, on the rim, outside ->", made.tolist(), contacts.tolist())
    assert made[0] and contacts[0] == 0 and contacts[1] > 0 and not made[2]


def test_mirror():
    """The court is symmetric left to right: without contact noise, mirrored shots end the same."""
    rng = np.random.default_rng(1)
    s = sample_shots(4000, rng)
    m = np.array([1.0, -1.0, 1.0])
    a, _ = simulate_outcome(s["p0"], s["v0"], s["w"], s["cd"])
    b, _ = simulate_outcome(s["p0"] * m, s["v0"] * m, s["w"] * -m, s["cd"])   # spin is a pseudovector
    print(f"mirror: {np.mean(a == b):.4f} of 4000 mirrored shots agree, make rate {a.mean():.3f}")
    assert np.mean(a == b) > 0.995


def test_aim_and_stats():
    rng = np.random.default_rng(0)
    t = time.time()
    s = sample_shots(60000, rng)
    f = s["feat"]; k = s["kappa"]
    v = np.linalg.norm(s["v0"], axis=1)
    print(f"60k shots in {time.time()-t:.1f} s")
    print(f"make rate {s['made'].mean():.3f}  (corner {s['made'][s['corner']].mean():.3f}, above the break {s['made'][~s['corner']].mean():.3f})")
    print(f"release speed {v.mean():.2f} m/s, flight {np.nanmean(s['tc']):.2f} s, entry angle {np.rad2deg(np.nanmean(f[:,2])):.1f} deg")
    print(f"long/short sd {np.nanstd(f[:,0]):.3f} m, left/right sd {np.nanstd(f[:,1]):.3f} m, mean long {np.nanmean(f[:,0]):.3f}")
    print(f"per unit kappa: {np.nanstd(f[:,0]/k):.3f}, {np.nanstd(f[:,1]/k):.3f}")
    m = s["made"]; c = s["contacts"]
    print(f"makes: {np.mean(c[m]==0):.2f} swish, {np.mean(c[m]>0):.2f} off metal or glass; misses touching nothing {np.mean(c[~m]==0):.3f}")
    for lo, hi in ((0, .8), (.8, 1.0), (1.0, 1.25), (1.25, 9)):
        q = (k >= lo) & (k < hi)
        print(f"  kappa {lo:.2f}-{hi:.2f}: {m[q].mean():.3f} of {q.sum()}")
    p0 = s["p0"][:2000]; el = np.arctan2(s["v0"][:2000, 2], np.linalg.norm(s["v0"][:2000, :2], axis=1))
    sp, az = solve_aim(p0, el, s["w_back"][:2000], s["w_side"][:2000], s["cd"][:2000])
    v0 = velocity(sp, el, az)
    from shotcall.physics import spin_vector
    _, _, pc, vc = flight(p0, v0, spin_vector(v0, s["w_back"][:2000], s["w_side"][:2000]), s["cd"][:2000])
    g = crossing_features(pc, vc, 0, 0)
    print(f"aim solver: worst miss of the target {np.abs(g[:,0]-A_TARGET).max()*1000:.3f} mm long, {np.abs(g[:,1]).max()*1000:.3f} mm wide")
    assert np.abs(g[:, 0] - A_TARGET).max() < 1e-3


if __name__ == "__main__":
    test_vacuum(); test_drop(); test_mirror(); test_aim_and_stats()
    print("ok")
