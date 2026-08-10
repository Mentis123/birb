# Grok Rogue

Unlisted browser-only procedural FPS dungeon crawler served at
`https://birbmobile.vercel.app/grokrogue/`.

This directory contains the verified production bundle built by Grok Build
from [`Mentis123/procedural-line-dungeon`](https://github.com/Mentis123/procedural-line-dungeon)
at commit `44dd135`.

The bundle is self-contained under this directory and uses relative asset
paths so it can be hosted safely as a sibling Birb artefact. The root service
worker explicitly bypasses `/grokrogue` to prevent either app from caching the
other app's navigation shell.
