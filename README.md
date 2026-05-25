# Tuneshine Dashboard

Small 64x64 animated WebP dashboard for a Tuneshine.

## Slides

- `clock`: local time and date, 15 seconds by default, progress bar enabled.
- `weather`: current Oakland weather from Open-Meteo, 15 seconds by default, progress bar enabled.
- `bus`: AC Transit arrivals for route `88` at stop `59550` and route `12` at stop `53885`, 15 seconds by default, progress bar enabled.
- `gallery`: optional image gallery from `GALLERY_DIR`, 15 seconds by default, progress bar disabled; skipped when the folder is empty.
- `dvd`: bouncing DVD logo, 15 seconds by default, progress bar disabled.

## Commands

Build the WebP slides without uploading:

```bash
npm run dashboard:build
```

Upload each slide once:

```bash
npm run dashboard:once
```

Run continuously:

```bash
npm run dashboard:loop
```

When run in a terminal, `dashboard:once` and `dashboard:loop` show a `terminal-kit`
fullscreen TUI with the current slide, next slide, countdown, progress bar, and
a decoded WebP preview. Press `q` or `Ctrl+C` to stop. When output is redirected,
they fall back to plain upload logs.

Change timing:

```bash
npm run dashboard:loop -- --seconds 15 --dvd-seconds 15 --upload-delay 0.5 --loop-proof-delay 5
```

`--upload-delay` adds a small cushion to each generated WebP without changing the
slide cadence. For example, a 15 second slide with `--upload-delay 0.5` renders
as a 15.5 second animation, but the uploader still starts the next slide after
15 seconds so the current animation does not visibly restart during upload. On
slides with a duration bar, the bar reaches 0 at the cadence time and stays empty
during the buffer.

Some animations can opt into loop-proof rendering when their loop point is
visually obvious. DVD does this now, so a 15 second DVD slide renders as a 20
second WebP by default, while the uploader still advances after 15 seconds.

## Environment

You can put these in a local `.env` file. Start from the example:

```bash
cp .env.example .env
```

- `TUNESHINE_HOST`: Tuneshine IP or hostname. Defaults to `192.168.4.76`.
- `SLIDE_SECONDS`: default duration for normal slides.
- `DVD_SLIDE_SECONDS`: duration for the DVD slide.
- `GALLERY_DIR`: optional folder of images for the gallery slide. Images are center-cropped to square and resized to 64x64.
- `UPLOAD_DELAY_SECONDS`: extra animation cushion rendered into each WebP. Defaults to `0.5`.
- `LOOP_PROOF_DELAY_SECONDS`: extra cushion for slides that set `loopProof: true`. Defaults to `5`.
- `DEV_MODE`: set to `true` to upload with `overridable: false`, useful for testing while music is playing. On exit, dev mode sends `DELETE /image` to remove the local image.
- `511_TOKEN`: preferred token for live AC Transit predictions via 511 StopMonitoring.
- `ACTRANSIT_TOKEN`: fallback token for the AC Transit direct API. Without either bus token, the bus slide renders a token reminder.

Weather data is cached in `.cache/weather.json` for 10 minutes to avoid polling
Open-Meteo on every dashboard loop.

Example:

```bash
511_TOKEN=your_token npm run dashboard:loop
```

## Synology NAS

The recommended Synology setup is Docker through Container Manager. This keeps
Node, Sharp, and their native dependencies inside the container.

1. Clone the GitHub repo onto the NAS.
2. Copy `.env.example` to `.env` and set `TUNESHINE_HOST`, transit tokens, and timing.
3. Put gallery images in `gallery/`.
4. Start the service:

```bash
docker compose up -d --build
```

View logs:

```bash
docker compose logs -f
```

Stop it:

```bash
docker compose down
```

The compose file mounts:

- `./gallery` read-only into the container.
- `./.cache` for weather/gallery rotation state.
- `./slides` for generated WebPs.
