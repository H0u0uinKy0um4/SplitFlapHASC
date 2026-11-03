# SplitFlap Calibration

This document explains how module calibration is supposed to work, why the
coordinate system is defined the way it is, and how to verify a change. It is
the reference for anyone (human or agent) touching calibration again.

Calibration spans three layers:

| Layer | Repository | Owns |
| --- | --- | --- |
| Slave firmware | `SplFlp_Slave_Attiny` (PlatformIO repo) | The coordinate system, motion, homing, the stored map |
| ESP32 master | `SplFlp_Master` (PlatformIO repo) | RS485 transport, MQTT bridge, module cache |
| Home Assistant | this repository | UI, collection of measurements, fitting the map |

**Hard rule:** coordinate math lives in exactly one layer, the slave. The
master and Home Assistant forward values; they never re-project them.

> **Status:** the slave firmware, ESP32 master and Home Assistant integration all
> implement this design (hall-edge origin, non-blocking forward-only motion, `s`
> state query, `r` record command, live `current_step` / `busy` /
> `position_known`, board and per-module record flows). The optional
> `fit_drum()` fitting step is not implemented yet; direct `record` is the
> supported flow. See [Current status](#current-status).

---

## 1. Coordinate system

`FLAP_COUNT` is 64 on the stock drum. `N = stepsPerRev` is the number of
half-steps per drum revolution (`4096` nominal). Positions are half-steps.

```
                  hall edge = pos 0
                        |
   ... ---------------- + ---- flap 0 ---- flap 1 ---- ... ---- flap 63 --+
                        |<--------- N half-steps ---------------->|
                        |<-- homeOffset -->|
```

Definitions:

- **`pos`** &mdash; half-steps counted from the hall edge, modulo `N`. The
  origin is the hall edge, **not flap 0**. On every hall edge the slave sets
  `pos = 0`.
- **`homeOffset`** &mdash; the `pos` at which flap 0 is centred. One number,
  not a coordinate system.
- **`map[i]`** &mdash; the `pos` at which flap i is centred, recorded while the
  user aligns it. `0xFFFF` means unset; the fallback is
  `homeOffset + round(i * N / FLAP_COUNT)`.

### Why the origin is the hall edge

The previous design homed to flap 0 and then defined that physical point as
`pos = 0`. Any change to `homeOffset` therefore moved the whole coordinate
system, and every `map[i]` had to be shifted by the same delta. That shift was
implemented in `coordinator.py` from a cached map, so whenever a refresh was
missed the map was shifted from stale data and the calibration drifted or
corrupted. Moving the origin to the physical hall edge makes `homeOffset` an
ordinary stored position: changing it moves exactly one number and the map is
untouched.

The hall edge is also the only physical reference available, so it is the
natural origin for re-anchoring.

---

## 2. Motion

`pos` is the single source of truth. `currentFlapIndex` is **not** part of the
protocol; it can be derived from `pos` and `map`.

Motion is a non-blocking state machine. `loop()` calls `update()`, which emits
at most one half-step per millisecond, so the RS485 parser keeps running while
modules move.

```
stepForward():
    emit(halfStepSequence[phase--])
    if hallEntered() and stepsSinceEdge >= EDGE_LOCKOUT:
        pos = 0                   # re-anchor; this is the drift correction
        stepsSinceEdge = 0
        return true
    pos = (pos + 1) % N
    stepsSinceEdge++
    return false

update(), State::Move:
    edge = stepForward()
    if edge:
        if ++edgesSeen > 1: failMove()      # target outside the real revolution
        remaining = (target - pos + N) % N  # recompute after correction
    else:
        remaining--
    if remaining == 0 and pos == target: finishMove()
    else if --moveBudget == 0: failMove()

failMove():
    stop, releaseMotor(), positionKnown = false, moveFailed = true
```

Rules:

1. **Always the same edge.** `home()`, `countPerRev()` and the re-anchor
   all use the entering edge (hall becomes active) while moving forward. The
   `c` diagnostic is blocking but measures the same edge, so its result is
   directly comparable to the re-anchor.
2. **Handle "already on the magnet".** `home()` first moves out of the magnet
   (`HomeWaitOff`) and then seeks the next entering edge (`HomeSeek`). Starting
   on the magnet therefore behaves like starting anywhere else.
3. **Forward only.** Each move rewinds forward, which keeps backlash identical
   for every measurement. A "nudge left" takes the long way around; that is
   acceptable. Allowing reverse motion would require an overshoot-and-approach
   step before every measurement.
4. **Re-anchor is not optional.** `4096` is nominal. Without a re-anchor the
   model position and the physical position diverge every revolution, and no
   static map can compensate.
5. **Bounded error, not error detection.** A single hall sensor cannot detect a
   missed step when it happens. The goal is to make the error bounded to less
   than one revolution and reset it at every hall edge. Do not build a
   diagnostic subsystem on top of it.
6. **A move crosses at most one edge.** A forward-only move is shorter than one
   revolution. A second edge means the target lies outside the real revolution,
   typically a wrong `totalStepsPerRev`; the move stops and marks the position
   unknown instead of looping forever.

---

## 3. Recording measurements

The user is the sensor. The workflow only requires that the firmware reports
its current `pos` and can store it.

1. Move to the flap being measured (by index, using `map` or the fallback):
   `m<id>+<index>` or `m<id>g<pos>`.
2. Poll `m<id>s` until `busy` is `0` and `position_known` is `1`.
3. The user nudges until the flap is physically centred.
4. Record the current `pos` with `m<id>r<index>`. The reply is
   `m<id>r:<index>:<pos>`, or `-1` if the firmware was busy or did not know
   its position. Recording may be repeated while the flap stays centred; keep
   the median per index.
5. Always record after a forward approach, never after reverse motion.

The recorded value is the **actual `pos` of the firmware**, not a value
computed in JavaScript. `r` is intentionally dumb: it writes exactly the
position the firmware reports. This removes the whole class of "expected vs
actual" projection bugs.

Index `0` also updates `homeOffset`, so `map[0]` and `homeOffset` can never
disagree.

If Home Assistant is not available, `r` is already a usable firmware fallback
(`map[i] = pos`, naive). The fitting algorithm described below runs in Home
Assistant, where the samples can be collected without blocking the RS485 bus.

---

## 4. Fitting the map

Do not store raw observations as if they were mechanical truth; a repeated
calibration would progressively bake observer noise into the map. Separate the
systematic mechanical error from the random measurement error.

Observations are `(index, pos)` samples, `pos` in `[0, N)`.

### 4.1 Unwrap

Sort by index and add multiples of `N` so the sequence is monotonically
increasing. Flap positions are physically ordered, so a non-increasing sample
is either noise or a mislabelled flap.

### 4.2 Robust line fit

Model `pos_i = a + P * i + e_i`. Fit with Theil&ndash;Sen:

```
P = median over pairs (i != j) of (pos_i - pos_j) / (i - j)
a = median of (pos_i - P * i)
```

This tolerates up to ~29% outliers. It is `O(n^2)`; for `n = 64` that is about
four thousand operations and needs no library.

`P` is the true number of half-steps per flap, so:

```
N_fit = round(FLAP_COUNT * P)
```

This is a better estimate of `stepsPerRev` than counting hall edges, because it
averages over the whole drum.

### 4.3 Reject outliers

```
r_i   = pos_i - (a + P * i)
med   = median(r)
mad   = median(|r_i - med|) or 1
keep  if |r_i - med| <= 3 * 1.4826 * mad
```

Refit on the kept samples and repeat two or three times. A residual close to a
multiple of `P` is not noise: it means the wrong flap index was selected. Report
it instead of writing it into the map.

### 4.4 Model the residuals

Two branches, chosen from the data:

- **Smooth error around the drum** (eccentric pulley, warped drum): fit a
  low-order Fourier series

  ```
  e_i = c0 + sum over k=1..K [ c_k * cos(2*pi*k*i/M) + d_k * sin(2*pi*k*i/M) ]
  ```

  with `M = FLAP_COUNT` and `K = 1..2`. The first harmonic is the most common
  real-world error. A small least-squares solve with at most five unknowns is
  enough.
- **Per-flap error** (hand-applied flaps): keep the per-flap median and fill
  unmeasured indices with circular linear interpolation (the card already has
  `interpolateCircularOffsets` for this).

Decision rule: if the high-frequency residual energy dominates, the per-flap
values are noise and must not be stored; use the smooth model. If the residual
is clearly non-smooth per flap, the mechanical error is real and per-flap values
must be stored.

### 4.5 Close the loop

```
t_i  = a + P * i + e_i
g_i  = t_(i+1) - t_i                    for i < FLAP_COUNT - 1
g_63 = t_0 + N - t_63                   (circular gap)
```

Require every `g_i > 0`, and warn when a gap is outside roughly
`[0.5 * P, 1.5 * P]`. A non-positive gap means the flaps physically overlap;
no algorithm can fix that, but it can tell the user which flaps are broken.

Sanity-check `N_fit` against the nominal `N`. A difference above ~2% means the
unwrap or the flap labels are wrong; do not apply `N_fit` in that case.

### 4.6 Output

```
map[i]       = round(t_i)               (or 0xFFFF where |t_i - fallback| < ~10)
homeOffset   = map[0]
stepsPerRev  = N_fit                    (optional, improves the fallback)
quality      = { max_residual, outliers, min_gap, max_gap, N_fit }
```

Skip the map entirely when max `|residual|` is under ~10 steps. At ~64
steps/flap that is less than a quarter flap and is not visible.

Store a version tag and a CRC next to the calibration block (EEPROM addresses
205&ndash;511 are still free; 204 already holds `CAL_FORMAT_VERSION`, currently
`2` = "pos measured from the hall edge"). The slave uses that tag to migrate
legacy flap-0-relative maps exactly once, so do not reuse address 204 for
anything else.

---

## 5. Where the code lives

| Concern | Location |
| --- | --- |
| Motion, homing, re-anchor, `pos` | `SplFlp_Slave_Attiny/src/Motor.cpp`, `ModuleCommands.cpp` |
| Map storage, `s`/`r` responses, EEPROM migration | `SplFlp_Slave_Attiny/src/ModuleEeprom.cpp` |
| Command dispatch and wire formats | `SplFlp_Slave_Attiny/src/RS485Handler.cpp`, `PROTOCOL.md` |
| RS485 transport and module cache | `SplFlp_Master/src/display/*`, `src/RS485.cpp` |
| MQTT `calibrate` handling | `SplFlp_Master/src/network/WifiMqttHandler.cpp` |
| Fitting (`fit_drum`) | `custom_components/splitflap/calibration.py` (optional, not yet added) |
| Service schema and dispatch | `custom_components/splitflap/services.py`, `coordinator.py` |
| Calibration UI | `custom_components/splitflap/frontend/splitflap-card.js` |

The authoritative slave command reference is `SplFlp_Slave_Attiny/PROTOCOL.md`.

The direct `record` flow does not need any fitting code: each `r` stores the
slave's own `pos`. If `fit_drum()` is added later, keep it a pure function with
no external dependencies (the repository forbids new dependencies). It must be
unit-testable without Home Assistant.

---

## 6. Current status

Implemented in `SplFlp_Slave_Attiny` (authoritative details in its
`PROTOCOL.md`):

- [x] Coordinate origin at the hall edge, `pos = 0` on every entering edge,
      re-anchor inside the step loop.
- [x] Non-blocking motion. `update()` advances one half-step per millisecond,
      so the RS485 parser keeps running during moves.
- [x] `currentFlapIndex` removed; the index is derived from `pos` + `map`.
- [x] `c` stores `countPerRev()` using the same entering-edge definition.
- [x] State query `m<id>s` reports `pos`, `busy` and `position_known`. The
      `m<id>d` config+map wire format is unchanged.
- [x] `m<id>r<index>` records the current `pos` as `map[index]`; index 0 also
      sets `homeOffset`.
- [x] Legacy maps (stored relative to flap 0) are migrated once by adding
      `homeOffset`, tagged with `CAL_FORMAT_VERSION = 2` at EEPROM address 204.
- [x] Failed/unreachable moves stop, mark the position unknown and never
      report success.
- [x] `loadOnBoot()` no longer trusts the never-written
      `ADDR_SAVED_POS` / `ADDR_SAVED_INDEX`; a boot without auto-home starts
      with an unknown position and homes on the next move.

Implemented in `SplFlp_Master`:

- [x] Query `s` and publish `current_step`, `busy` and `position_known` in the
      status payload.
- [x] Poll `s` per module after movement instead of a blind refresh timer.
- [x] Validate the module id in every RS485 response.
- [x] Handle the `record` action (`r`), then refresh the module config.

Implemented in this repository:

- [x] `record` action in the service and coordinator; map shift removed from
      `coordinator.calibrate_module()`.
- [x] `busy` / `position_known` forwarded to module attributes, and
      `flap_position` fallback includes `home_offset`.
- [x] Board calibration rebuilt on `step` + `record`; per-module panel shows
      live state and records the current position.
- [x] `apply` kept for compatibility; it writes exactly the supplied values and
      never shifts existing entries.

Remaining work, in the order it should be done:

- [ ] HA: optional `fit_drum()` (`calibration.py`) to fit `map[i]` from many
      recorded flaps. Direct `record` remains the supported flow.
- [ ] Master: ACK/busy instead of fixed polling timeouts.

Do not change the existing public service names, entity IDs or MQTT topics.
New calibration fields may be added to the module payload; never rename the
existing ones.

---

## 7. Known pitfalls

Verify these before trusting an existing calibration or an old bug report.
The slave-side pitfalls are fixed in the current firmware; they are listed in
`SplFlp_Slave_Attiny` history and must not be reintroduced.

- Polling a moving module works because the slave services RS485 during
  motion, but `STATE_TIMEOUT_MS` must stay short enough not to stall the MQTT
  loop.
- `apply` is kept for compatibility. It must write exactly the supplied home
  offset and map entries and never shift or re-project existing entries;
  coordinates belong to the slave.
- The card and coordinator must not derive map entries from expected-vs-actual
  flap pairs. Recording uses the slave's live `pos` through `r`.
- Old firmware maps are stored relative to flap 0. The slave migrates them
  once by adding `homeOffset` and writes `CAL_FORMAT_VERSION` at EEPROM
  address 204. Do not repeat that shift in HA or in the card.
- `SplFlp_Slave_Attiny` is a separate git repository. Keep firmware history
  there; do not copy source files into this repository.

---

## 8. Verification

Run these after any calibration-related change.

1. **Measurement is real.** Send `m<id>c`, wait for `busy` to clear via
   `m<id>s`, then `m<id>d`. `total_steps` must change from the default and be
   close to the nominal `4096`.
2. **Motion keeps the bus alive.** Send display characters to 12+ modules in a
   single `send_text` burst. Every module must move; none may be lost while the
   first modules are still turning.
3. **State is observable.** During a long move `m<id>s` must report `busy=1`
   and a `pos` that advances; afterwards `busy=0` and `position_known=1`.
4. **No drift.** Change the displayed text ten times, then check the flap
   farthest from home. It must still be correct. Repeat with a deliberately
   wrong `t` (e.g. `4076` on a 4096 drum) and confirm drift stays bounded to
   less than one flap.
5. **Failure is not silent.** Disconnect the hall sensor (or point the module
   away from the magnet) and home it. `s` must end with `position_known=0`, and
   the module must not report a successful landing.
6. **Map quality.** Dump the map and the fit report. Check max residual,
   outlier count, min/max circular gap and `N_fit` against the nominal `N`.
7. **Idempotent apply.** Apply the same map twice without moving anything; the
   stored values must not change and the module must still home to flap 0.
8. **Empty map fallback.** Clear the map and verify that every flap index still
   lands on a sensible flap using the even-spacing fallback
   (`homeOffset + round(i * N / 64)`).
9. **Legacy migration runs once.** Boot an EEPROM image with an old flap-0
   map, read `d`, then reboot. The second read must be identical; the map must
   not be shifted twice.
