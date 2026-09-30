/* Self-hosted Tailwind runtime shim.
   All utility classes are precompiled into ../tailwind-static.css (Tailwind v4 build), so the
   Play-CDN runtime compiler is not needed and no third-party CDN has to be reachable.
   This shim only defines window.tailwind so the inline config script does not poll forever.
   `npm run build:frontend-vendor` may overwrite this file with the real CDN build when online. */
(function () { window.tailwind = window.tailwind || { config: {} }; }());
