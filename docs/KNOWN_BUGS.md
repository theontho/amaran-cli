### Some commands listed in the API spec are not implemented in the amaran desktop app

In my local install, the get_hsi command returns an unknown command error, which I think is an amaran bug.   set_hsi works although with my Amaran 150C.  I had issues get_protocol_versions I think too.

### Untested commands

I haven't gotten to properly testing / using these commands, so they probably have problems:

- fan
- firmware
- group
- color (these are named colors, not random rgb in actuallity in the amaran desktop app, need a way to query the list of names)
- rgb (unimplemented or improperly named color in the cli)
- preset
- quickshot
- scene
- preset
- toggle

### RGB & advanced features not tested 

I don't have an RGB capable light to test this command.

```
Capabilities for 150c back (AAAA-BBBBB):

Lighting Support:
  Correlated Color Temperature (CCT): Yes (2500K - 7500K)
  Hue, Saturation, Intensity (HSI):   Yes
  Red, Green, Blue (RGB):             No
  Green-Magenta (GM):                 Yes (0 - 20)

Advanced Features:
  CCT Extension:      No
  Advanced HSI:       No
  GM v2 Support:      No
```

### On off state bug?
```
npm run dev -- auto-cct                                              

> amaran-light-cli@1.2.0 dev
> tsx src/cli.ts auto-cct

Setting CCT to 2099K at 12.9% for active lights
  Location: AAA
  Time: 2025-12-14T01:15:40.874Z
  Curve: hann
All discovered lights are off; nothing to update.
  Skipped 3 light(s) to avoid turning them on.
```

One light was on, but it detected all 3 as off.  I turned off all of them, then I ran simulate-schedule on one, which left it on.  Probably something about the previous off command?