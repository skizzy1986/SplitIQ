// The squat's decode worker: its one bundled bin, served by the shared
// protocol (anatomy/workers/decodeBins.js), which fetches only this URL and
// answers only the page that started it. The pinned size is the progress
// denominator when the host sends no Content-Length.
import dataUrl from '../assets/squat-anatomy.bin?url';
import { DATA_ASSET } from '../constants/dataAsset.js';
import { serveBin } from '../../anatomy/workers/decodeBins.js';

serveBin({ url: dataUrl, bytes: DATA_ASSET.bin.bytes });
