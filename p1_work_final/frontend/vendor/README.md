# Self-hosted frontend runtime assets

Run `node backend/scripts/vendor-frontend-assets.js` during a network-enabled production build.
The portal loads these pinned local assets first. CDN fallbacks remain only as a disaster-recovery path.
Do not place API keys in this directory.
