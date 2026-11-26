// Picks the backend. Views import { db, isDemo } from here and never talk to Supabase directly.
// Both modules export the same `api` object (see data-demo.js for the full list with comments).
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';
export { CELL, cellOf } from './shared.js';

export const isDemo = !SUPABASE_URL || !SUPABASE_KEY || new URLSearchParams(location.search).has('demo');
const mod = isDemo ? await import('./data-demo.js') : await import('./data-supabase.js');
export const db = mod.api;
