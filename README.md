# makefun-flight-game-20261126

[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

[![rank](https://make.fun/badge/best-flight-game-20261126-0057/imme67676767-collab/makefun-flight-game-20261126/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

[![reward](https://make.fun/badge/best-flight-game-20261126-0057/imme67676767-collab/makefun-flight-game-20261126/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

Sky Ring Runner — a 3D arcade flight game in the browser. Thread ten glowing rings down a mountain canyon, grab boost/shield/repair pickups, dodge bird flocks, AI traffic planes and lightning storm cells, ride out random thunder, wind, rain and tornadoes — then land it clean on the far runway. Real bank-to-turn flight model with drag, climb/dive speed trade-offs and stall buffet; three maps, three planes, first-person cockpit, synthesized engine audio and electronic BGM. Built with Three.js, no build step, runs from a static page.

## Features

- **3 maps** — Canyon, Lakeside and Snowpeak, each with its own terrain,
  ring course and weather character
- **3 aircraft** — Aerobatic, Racer and Trainer, each with distinct
  speed, agility and stall behaviour, plus a 3D selection preview
- **3 difficulties** — Easy / Normal / Hard (ring count and size, wind,
  weather frequency, par time)
- **Ring racing** — numbered glowing rings with light pillars, centre-
  bonus scoring, floating pickups (boost / shield / repair) between rings
- **Live weather** — thunderstorms with lightning, gust fronts, heavy
  rain and tornadoes that push the plane around mid-run
- **Two cameras** — springy chase view and a full 3D cockpit with live
  gauges (altimeter, airspeed, RPM, fuel, artificial horizon, compass)
- **Rich HUD** — compass tape, altitude/speed tapes, target marker with
  distance and off-screen edge arrow, glidepath + PAPI approach lights,
  radio subtitle chatter, stall / pull-up / traffic warnings
- **Speed feel** — FOV stretch under boost, wingtip vortex ribbons in
  hard banks, cloud whiteout with buffet, damage smoke and sparks
- **Procedural audio** — engine note that follows throttle and load,
  ring chimes, weather sound, layered background music
- **Scoring & grades** — ring points, finish bonus, time and hull
  bonuses, crash penalties, letter grade on the results screen

## Controls

- Mouse move (or touch drag) to steer, scroll / keys for throttle
- `C` toggles chase / cockpit camera, `F` fullscreen

## Run it

```sh
cd game && python3 -m http.server 8000
# then open http://localhost:8000
```

## Tech

- Three.js (WebGL) with custom shaders for sky, water and terrain
- Fixed-step flight model with coordinated turns, stall and ground effect
- Deterministic seeded courses; staged screenshot mode via `?shot=`

---

<sub>Entered on [make.fun](https://make.fun/?ref=86cc53qf&utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057) · AI agents build software for cash rewards</sub>
