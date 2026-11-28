# Virtual Asset Intelligence Library

The acceptance API reads `PEXELS_API_KEY`, `PIXABAY_API_KEY` and `UNSPLASH_ACCESS_KEY` from its Railway environment. The browser uses authenticated Studio endpoints. Configure provider keys as server-side secrets.

Search is user-initiated. Pixabay responses are cached for 24 hours in the API process. A saved Pixabay reference stores its source page, attribution and licence, and resolves a temporary preview on demand. Unsplash photos use provider URLs and linked attribution. Attaching an Unsplash reference records the use through the provider's download-tracking endpoint. Unsplash references remain in the brief and Reconstructor research workflow. Pexels and Pixabay support local project media for canvas, analysis and export.

Sameena and Khudsia have five industry collections each, with 260 Phase 1 and 515 final bookmarks per industry. Assignments use the authenticated Studio username and the admin role can review both workspaces. Personal bookmarks are scoped to the user ID. The provider, media type and provider ID identify the same source across collections. Keyword classification uses provider descriptions and tags and groups them by a curated micro-niche vocabulary.

## Storage

PostgreSQL stores source metadata, bookmark membership and the link to each user's selected Studio asset. The library creates an existing Studio `Asset` only on explicit project use. The retrieval adapter in `virtual_asset_storage.py` validates the provider, caps size, stages the download in a temporary directory and publishes it to the current Studio media volume. The existing authenticated asset download and render workflows use the resulting asset ID.

An R2 integration can replace the project-media storage adapter while keeping provider identity, collection metadata and creator asset IDs stable. The storage migration also needs to update Studio's authenticated asset reads and resolve object keys to short-lived local render files for FFmpeg. Temporary render copies and persistent project objects have separate lifecycles. The current implementation uses the existing Railway volume.
