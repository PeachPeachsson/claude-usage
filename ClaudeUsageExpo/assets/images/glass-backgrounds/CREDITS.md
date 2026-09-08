# Glass background image credits

These three images were downloaded from Unsplash on 2026-09-05. Their source pages identify them as free under the [Unsplash License](https://unsplash.com/license), which permits downloading and bundling them in a commercial app. They are not Unsplash+ assets.

| App label | Bundled filename | Creator | Source |
| --- | --- | --- | --- |
| Prisma | topographic-metal.jpg | Carlos Vega | [Iridescent glass](https://unsplash.com/photos/a-blurry-image-of-a-blue-and-pink-background-CuOLJFf-gfs) |
| Färgflöde | neon-grid.jpg | Pawel Czerwinski | [Blue and pink fluid painting](https://unsplash.com/photos/blue-and-pin-abstract-painting-8uZPynIu-rQ) |
| Regnbågsmarmor | cosmic-ink.jpg | Daniel Olah | [Iridescent soap film](https://unsplash.com/photos/swirling-iridescent-soap-film-patterns-VS_kFx4yF5g) |

The legacy preset IDs and filenames are intentionally retained for compatibility with saved preferences. The earlier generated artwork is replaced; its originals remain available in Git history.

The crumpled-film image that used to be the default was removed at the owner's request; its
history remains in the reference repository.

## Download variants

Each URL uses `fm=jpg&q=85&w=2400&h=2400&fit=max`, then resampled for bundling:

```bash
sips -Z 1600 --setProperty formatOptions 80 image.jpg --out image.jpg
```

What matters is the decoded bitmap, not the file. At 2400 pixels each background costs 12 to
15 MB of RAM while on screen; at 1600 it is under 7 MB. Every background sits behind a 0.42
contrast scrim and is blurred by the panes above it, so the detail never reaches the eye.
