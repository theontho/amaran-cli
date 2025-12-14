```
npm run dev -- auto-cct                                               main  05:15:20 PM 

> amaran-light-cli@1.2.0 dev
> tsx src/cli.ts auto-cct

Setting CCT to 2099K at 12.9% for active lights
  Location: 37.7852, -122.3874 (geoip (136.24.146.157))
  Time: 2025-12-14T01:15:40.874Z
  Curve: hann
All discovered lights are off; nothing to update.
  Skipped 3 light(s) to avoid turning them on.
```

One light was on, but it detected all 3 as off.  I turned off all of them, then I ran simulate-schedule on one, which left it on.  Probably something about the previous off command?