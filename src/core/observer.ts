// Observer location for pass predictions / AR. Geolocation if granted, else camera nadir.
import { log } from './bus';
import { cameraInfo } from './viewer';

export interface Observer {
  lat: number;
  lon: number;
  h: number;
  source: 'gps' | 'camera' | 'manual';
}

let obs: Observer | null = null;

export function getObserverSync(): Observer {
  if (obs) return obs;
  const c = cameraInfo();
  return { lat: c.lat, lon: c.lon, h: 0, source: 'camera' };
}

export function setObserver(lat: number, lon: number) {
  obs = { lat, lon, h: 0, source: 'manual' };
  log('OBSERVER', `observer set ${lat.toFixed(3)}, ${lon.toFixed(3)}`, 'ok');
}

export function locate(): Promise<Observer> {
  if (obs?.source === 'gps') return Promise.resolve(obs);
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(getObserverSync());
    navigator.geolocation.getCurrentPosition(
      (p) => {
        obs = { lat: p.coords.latitude, lon: p.coords.longitude, h: p.coords.altitude ?? 0, source: 'gps' };
        log('OBSERVER', `GPS fix ${obs.lat.toFixed(3)}, ${obs.lon.toFixed(3)} ±${Math.round(p.coords.accuracy)}m`, 'ok');
        resolve(obs);
      },
      () => {
        log('OBSERVER', 'geolocation denied — using camera nadir', 'warn');
        resolve(getObserverSync());
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  });
}
