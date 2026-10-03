/** Points MapLibre at the Vite-bundled worker; import for side effects in every module that constructs a maplibregl.Map. */
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);
