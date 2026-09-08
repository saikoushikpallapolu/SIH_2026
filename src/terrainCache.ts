/**
 * Persistent Browser Cache for OceanScope India
 * Uses native browser IndexedDB to persist binary/scientific terrain and ocean slices across browser sessions.
 */
import type { TerrainSliceData } from './types'

const DB_NAME = 'oceanscope_storage_v1'
const DB_VERSION = 1
const STORE_TERRAIN = 'terrain_slices'
const STORE_OCEAN = 'ocean_slices'

let dbPromise: Promise<IDBDatabase> | null = null

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported in this environment'))
      return
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_TERRAIN)) {
        db.createObjectStore(STORE_TERRAIN)
      }
      if (!db.objectStoreNames.contains(STORE_OCEAN)) {
        db.createObjectStore(STORE_OCEAN)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  return dbPromise
}

export async function getCachedTerrain(key: string): Promise<TerrainSliceData | null> {
  try {
    const db = await getDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_TERRAIN, 'readonly')
      const store = tx.objectStore(STORE_TERRAIN)
      const req = store.get(key)
      req.onsuccess = () => {
        const val = req.result
        if (val && val.elevation_buffer) {
          // Reconstitute typed Float32Array from raw ArrayBuffer
          resolve({
            ...val,
            elevation_grid: new Float32Array(val.elevation_buffer),
          })
        } else {
          resolve(null)
        }
      }
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function setCachedTerrain(key: string, data: TerrainSliceData): Promise<void> {
  try {
    const db = await getDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_TERRAIN, 'readwrite')
      const store = tx.objectStore(STORE_TERRAIN)
      // Store elevation_grid buffer for compact storage
      const record = {
        ...data,
        elevation_buffer: data.elevation_grid.buffer,
      }
      const req = store.put(record, key)
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
    })
  } catch {
    // Non-fatal if storage quota exceeded or disabled
  }
}
