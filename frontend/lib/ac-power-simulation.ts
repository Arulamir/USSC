// Replacement reading for the broken sensor on one of the two controlled ACs.
// Display-only offset; meter snapshots and energy history remain unchanged.
const AC_REPLACEMENT_MIN_W = 1000;
const AC_REPLACEMENT_MAX_W = 1080;
const AC_REPLACEMENT_THRESHOLD_W = 50;
const MINUTE_MS = 60_000;
const STORAGE_KEY = "ussc.smart-office.ac-power-simulation";
const CHANGE_EVENT = "ussc:ac-power-simulation";
let memoryEnabled = false;
let memoryInitialized = false;

// Recover commands sent before this feature was deployed, without resending IR.
export function initializeAcPowerFromReport(state: "on" | "off") {
  try {
    if (window.localStorage.getItem(STORAGE_KEY) !== null) return;
  } catch {
    if (memoryInitialized) return;
  }
  setAcPowerSimulation(state);
}

export function isAcPowerSimulationEnabled() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return memoryEnabled;
  }
}

export function setAcPowerSimulation(state: "on" | "off") {
  memoryInitialized = true;
  memoryEnabled = state === "on";
  try {
    window.localStorage.setItem(STORAGE_KEY, state);
  } catch {
    // The replacement still works for this page when browser storage is blocked.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeAcPowerSimulation(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function currentAcPowerMinute() {
  return Math.floor(Date.now() / MINUTE_MS);
}

export function subscribeAcPowerMinute(onChange: () => void) {
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    timer = setTimeout(() => {
      onChange();
      schedule();
    }, MINUTE_MS - Date.now() % MINUTE_MS);
  };
  schedule();
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

export function acReplacementPower(realPower: number | null | undefined, enabled: boolean, minute: number) {
  if (!enabled || realPower == null || !Number.isFinite(realPower)
    || realPower < AC_REPLACEMENT_THRESHOLD_W) return 0;
  // Stable within each clock minute and across tabs/reloads; changes every minute.
  const range = AC_REPLACEMENT_MAX_W - AC_REPLACEMENT_MIN_W + 1;
  return AC_REPLACEMENT_MIN_W + ((minute * 37) % range + range) % range;
}

export function displayedAcPower(realPower: number | null | undefined, enabled: boolean, minute: number) {
  if (realPower == null || !Number.isFinite(realPower)) return null;
  if (realPower <= 3) return 0;
  return realPower + acReplacementPower(realPower, enabled, minute);
}
