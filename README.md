# Orbis

**An atlas of worlds that never existed.** Every seed becomes a planet with its own star, climate, seas, weather, rings and moons. Each one is rendered live in the browser with hand-written WebGL2 shaders, and has a survey record, a named map and a soundtrack of its own.

No frameworks, no assets, no dependencies at runtime. The whole thing is about 140 KB in a single HTML file.

![A temperate world with rings and place names](docs/hero-ui.png)

| | |
|---|---|
| ![Ringed gas giant](docs/hero-gas.png) | ![Volcanic world](docs/hero-lava.png) |
| ![Low orbit over an ocean world](docs/hero-ocean.png) | |

## What you can do

- **Travel.** Press <kbd>Space</kbd> for a new world, or pick a kind of world first: terran, oceanic, exotic, arid, frozen, volcanic, greenhouse, airless, gas giant or ice giant. Travel warps you out of one system and into the next while the new planet bakes in the background.
- **Orbit and descend.** Drag to orbit and scroll or pinch to zoom from a distant view down to low orbit. Near the surface the camera tilts toward the horizon so the limb and the atmosphere stay in frame. Double-click to dive or pull back.
- **Read the survey record.** Host star, orbit and year length, radius, mass, density, surface gravity, escape velocity, temperature, day length, axial tilt, atmospheric pressure and composition, hydrosphere, highest peak, moons, rings and the [Earth Similarity Index](https://en.wikipedia.org/wiki/Earth_Similarity_Index). The values are derived from each other: the orbit comes from radiative balance with the star, the year from Kepler's third law, and gravity from mass and radius.
- **See place names.** Continents, islands and oceans are found by flood-filling the elevation grid, named in the world's own invented language, and labelled on the globe at their poles of inaccessibility.
- **Open the atlas.** <kbd>A</kbd> renders an equirectangular shaded-relief map with a graticule, a scale and the same place names.
- **Use the forge.** Change ocean coverage, cloud cover, atmospheric density, climate, relief, the flow of time and the sun's position, and switch rings, moons and aurorae on or off. Ocean coverage is exact: the sea level comes from an area-weighted elevation histogram.
- **Take the tour.** <kbd>C</kbd> starts a cinematic camera that films an establishing orbit, a low pass over the day side and a sunrise over the limb, then moves on to the next world.
- **Listen.** <kbd>M</kbd> plays a generative ambient score in a key and mode chosen by the world: a drone, a slowly voice-led pad, sparse FM bells and a noise bed of wind, surf or magma.
- **Send a postcard.** <kbd>P</kbd> composes the current view into a travel postcard with a stamp and postmark.
- **Share a world.** Every world has a code such as `#3k9x2f-terran`. Add it after `#` in the page's address to land on the same planet.

### Keys

| Key | Action |
|---|---|
| <kbd>Space</kbd> / <kbd>N</kbd> | New world |
| <kbd>←</kbd> <kbd>→</kbd> | Previous / next world |
| <kbd>A</kbd> | Atlas map |
| <kbd>L</kbd> | Place names |
| <kbd>F</kbd> | Forge |
| <kbd>C</kbd> | Cinematic tour |
| <kbd>M</kbd> | Sound |
| <kbd>P</kbd> | Postcard |
| <kbd>H</kbd> | Hide the interface |
| <kbd>+</kbd> <kbd>−</kbd> | Zoom |

## How it works

**Baking.** A world's seed feeds a [PCG](https://jcgt.org/published/0009/03/02/) hash that drives every noise function, so a planet is a pure function of its seed. When you arrive, a set of fragment shaders bakes three cubemaps:

- **Terrain** (RGBA16F): elevation, moisture, a feature mask and a rock mask. Continents are domain-warped fBm, mountains are ridged multifractal noise masked by continentality, and hills use derivative-damped fBm that reads like erosion. Each class adds its own features: settlement clusters, mesas and canyons, fracture networks and lineae, lava channels and calderas, multi-scale craters and maria. Gas giants are laid down as irregular latitudinal bands after iterated curl-noise advection and vortex swirls.
- **Clouds** (RG8): two independent cloud fields with cyclone spirals, zonal stretching and Hadley-cell climate bands. The renderer cross-fades between them so the weather changes over time.
- **Sky** (RGBA16F): a galactic band with dust lanes and a brighter core, and emission nebulae tinted from the host system.

The bake is split into small steps that run during the warp, so travelling never stalls a frame.

**Rendering.** A single fullscreen pass ray-traces everything analytically:

- **Planet surface.** Shaded from the baked terrain, with normals from finite differences and procedural micro-relief once you zoom past the texture's resolution. Climate decides the biome. Temperature falls with latitude and altitude, and Hadley-cell moisture bands give wet tropics, dry subtropics and temperate storm belts.
- **Oceans.** GGX sun glints, Fresnel sky reflection, depth-tinted shallows, sea ice with a noisy freeze line, and lava seas with glowing cracks between crust plates.
- **Cloud shell.** Rendered at altitude with parallax, self-shadowing, silver linings and shadows cast on the ground.
- **Atmosphere.** Single scattering with Rayleigh, Mie and an absorption term, using [Schüler's approximation](https://www.gamedev.net/blogs/entry/2255326-chapman-function/) of the Chapman function for optical depth toward the sun. That is what reddens the terminator and gives backlit limbs their glow. Tinted Mie haze gives dusty, smoggy and sulphurous skies.
- **Rings.** Procedural radial profiles with gaps, lit and back-lit faces, the planet's shadow across them, and their shadow on the planet.
- **Moons.** Tidally locked, with analytic craters. They cast eclipse shadows on the planet and pass through its shadow, glowing red inside the umbra when the planet has air.
- **Extras.** Polar aurorae, city lights on the night side, and procedural stars with blackbody colours.

**Post-processing.** Bloom with 13-tap downsampling and tent upsampling, with a Karis average on the first level. Then a lens flare that is occluded by the planet, its rings and its moons. ACES tonemapping, an automatic white balance against the sunlight that reaches the ground, chromatic aberration, vignette and dithered grain. Resolution adapts to keep the frame rate up.

## Running it

Open `dist/index.html` in a browser. It is self-contained.

To work on the source:

```sh
npm install
npm run dev     # serves the unbundled ES modules at http://localhost:5173
npm run build   # writes dist/index.html and dist/embed.html
```

Useful query parameters for development: `?seed=abc&class=gas` (a seed in base 36), `tex=512` (cubemap size), `nointro`, `hideui`, `labels`, `tour`, `debug=1|2|3` (night lights, feature mask, albedo).

Orbis needs WebGL2. Float render targets (`EXT_color_buffer_float`) are used for HDR when available.

## Layout

```
src/
  main.js        boot, intro, wiring
  app.js         world state, frame loop, transitions, white balance
  renderer.js    GL resources, bake steps, survey readback, bloom chain
  world.js       seed -> star, class, palettes, atmosphere, rings, moons, physics
  camera.js      orbit camera with inertia and horizon tilt
  ui.js          survey record, travel, forge, labels, input
  atlas.js       region detection and naming, the map plate
  director.js    cinematic tour
  audio.js       generative score
  postcard.js    postcard composition
  names.js       invented languages
  shaders/
    noise.js     hashing, gradient noise with derivatives, fBm, cellular noise
    bake.js      terrain, cloud and sky bakes
    surface.js   shared surface and climate model
    scene.js     the real-time ray tracer
    map.js       equirectangular relief
    post.js      bloom, flare, tonemapping
```

## License

MIT
