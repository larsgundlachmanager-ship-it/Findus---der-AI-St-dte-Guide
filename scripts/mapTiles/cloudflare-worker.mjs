/**
 * Cloudflare Worker — Protomaps PMTiles → Z/X/Y MVT
 *
 * Deploy (Wrangler):
 *   1. world.pmtiles in R2 Bucket legen (z. B. yorro-map-tiles)
 *   2. wrangler.toml anlegen (siehe README)
 *   3. npx wrangler deploy
 *
 * Recipe: https://docs.protomaps.com/deploy/cloudflare
 *
 * Minimal wrangler.toml:
 *
 * name = "yorro-map-tiles"
 * main = "scripts/mapTiles/cloudflare-worker.mjs"
 * compatibility_date = "2024-01-01"
 *
 * [[r2_buckets]]
 * binding = "BUCKET"
 * bucket_name = "yorro-map-tiles"
 *
 * [vars]
 * PMTILES_KEY = "world.pmtiles"
 */

import { PMTiles } from 'pmtiles';

/** @typedef {import('@cloudflare/workers-types').Fetcher} Fetcher */

/**
 * @param {{ request: Request; env: { BUCKET: Fetcher; PMTILES_KEY?: string } }} ctx
 */
export default {
  async fetch({ request, env }) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/(\d+)\/(\d+)\/(\d+)\.mvt$/);
    if (!m) {
      return new Response('Yorro map tiles — use /{z}/{x}/{y}.mvt', {
        status: 404,
      });
    }
    const z = Number(m[1]);
    const x = Number(m[2]);
    const y = Number(m[3]);
    if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) {
      return new Response('bad tile', { status: 400 });
    }

    const key = env.PMTILES_KEY || 'world.pmtiles';
    const obj = await env.BUCKET.get(key);
    if (!obj) {
      return new Response('pmtiles missing in R2', { status: 503 });
    }

    const p = new PMTiles(await obj.arrayBuffer());
    const tile = await p.getZxy(z, x, y);
    if (!tile?.data) {
      return new Response(null, { status: 204 });
    }

    return new Response(tile.data, {
      headers: {
        'Content-Type': 'application/vnd.mapbox-vector-tile',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
};
